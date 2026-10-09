// database.mjs — Firebase Auth + Firestore con caché persistente.
//
//  - Las escrituras (guardar*) usan setDoc: la caché local se actualiza al instante
//    y la subida a Firebase queda encolada, sin esperar a la red.
//  - Las lecturas (cargar*) usan getDocFromCache: siempre salen de la caché local,
//    sin red ni coste.
//  - La caché se refresca desde la nube una vez al día: la primera operación de cada
//    día (iniciarSesion, cargar* o guardar*) sube lo pendiente y descarga los documentos.
//    El resto del día todo va por caché. No hace falta volver a iniciar sesión.
//  - Si el refresco falla (p. ej. al abrir sin conexión en un día nuevo), la operación
//    lanza el error y se reintenta en la siguiente llamada o al volver la red.
//
// Datos:    guardarHistorial(registros) / cargarHistorial()
//           guardarEjercicios(obj)      / cargarEjercicios()
// Sesión:   iniciarSesion(proveedor) / cerrarSesion()
//           alCambiarSesion(callback)

import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
	GoogleAuthProvider, getAuth, getRedirectResult, OAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut,
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
	Bytes, doc, getDocFromCache, getDocFromServer, initializeFirestore,
	persistentLocalCache, persistentMultipleTabManager, setDoc, waitForPendingWrites,
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const firebaseConfig = {
	apiKey: "AIzaSyCzTeurftuxGf6ergWSmiNjkkZ9S5QX1wg",
	authDomain: "simplegym-8e10e.firebaseapp.com",
	projectId: "simplegym-8e10e",
	storageBucket: "simplegym-8e10e.firebasestorage.app",
	messagingSenderId: "1086535851954",
	appId: "1:1086535851954:web:5eb50586ba1db2c9498eab",
};

// Clave de localStorage donde se guarda { uid, dia } del último refresco de la caché.
const CLAVE_SESION_DIA = "fitnessDB.sesionDia";
const MSG_SIN_SESION = "Sesión no iniciada. Llama a iniciarSesion(proveedor) desde un botón.";
const MSG_SIN_CONEXION = "Esta operación necesita conexión a internet.";

const COL_USUARIOS = "users";
const COL_REGISTROS = "registros";
const COL_EJERCICIOS = "ejercicios";
const ID_HISTORIAL = "Historial";
const ID_EJERCICIOS = "archivo";

const MAX_BYTES_DOCUMENTO = 1_000_000;
const CODIGOS_USAR_REDIRECCION = ["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"];

const PROVEEDORES = {
	google: () => new GoogleAuthProvider(),
	microsoft: () => new OAuthProvider("microsoft.com"),
};

/* ------------------------------------------------------------------ */
/* Firebase (constantes de módulo)                                    */
/* ------------------------------------------------------------------ */

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
	localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
	ignoreUndefinedProperties: true,
});

// Completa el inicio de sesión si se volvió de una redirección.
getRedirectResult(auth).catch((e) => console.error("Error al completar el inicio de sesión:", e));

/* ------------------------------------------------------------------ */
/* Empaquetado binario del histórico                                  */
/* ------------------------------------------------------------------ */

// Layout (big-endian): 1 byte de versión + 9 bytes por registro:
//   +0 idEjercicio  +1 numeroSesion  +2 totalEjercicios  +3..4 fecha (días, uint16)
//   +5 numeroSeries +6..7 peso (decagramos, uint16)  +8 repeticiones
// La fecha se guarda como día del calendario local (se pierde la hora).
// Rangos: bytes 0-255; fecha 1970-2149; peso 0 a 655.35 kg.
const VERSION_FORMATO = 1, BYTES_CABECERA = 1, BYTES_REGISTRO = 9, MS_DIA = 86_400_000;

/**
 * @brief Valida que `valor` sea un entero entre 0 y `max` (NaN también se rechaza).
 * @param {number} valor Valor a validar.
 * @param {number} max Valor máximo permitido.
 * @param {string} campo Nombre del campo (para el mensaje de error).
 * @param {number} indice Índice del registro (para el mensaje de error).
 * @returns {number} El mismo valor si es válido.
 * @throws {RangeError} Si el valor no es un entero o está fuera de rango.
 */
function entero(valor, max, campo, indice) {
	if (!Number.isInteger(valor) || valor < 0 || valor > max)
		throw new RangeError(`Registro ${indice}: "${campo}" no es válido o está fuera de rango (valor: ${valor}).`);
	return valor;
}

/**
 * @brief Convierte una fecha local a días desde 1970 (NaN si no es una Date válida).
 * @param {Date} fecha Fecha a convertir.
 * @returns {number} Días desde 1970.
 */
const fechaADias = (fecha) =>
	fecha instanceof Date ? Math.round(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()) / MS_DIA) : NaN;

/**
 * @brief Convierte días desde 1970 a un objeto Date a medianoche local.
 * @param {number} dias Días desde 1970.
 * @returns {Date} Fecha resultante.
 */
function diasAFecha(dias) {
	const utc = new Date(dias * MS_DIA);
	return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

/**
 * @brief Empaqueta un array de registros en un Uint8Array binario.
 * @param {Array<Object>} registros Array de registros a empaquetar.
 * @returns {Uint8Array} Buffer con los datos empaquetados.
 * @throws {RangeError} Si el tamaño supera el límite o algún campo no es válido.
 */
function empaquetarHistorial(registros) {
	const tamano = BYTES_CABECERA + registros.length * BYTES_REGISTRO;
	if (tamano > MAX_BYTES_DOCUMENTO)
		throw new RangeError(`El histórico (${registros.length} registros) supera el límite de un documento de Firestore.`);

	const buffer = new Uint8Array(tamano);
	const vista = new DataView(buffer.buffer);
	buffer[0] = VERSION_FORMATO;

	registros.forEach((r, i) => {
		const o = BYTES_CABECERA + i * BYTES_REGISTRO;
		buffer[o] = entero(r?.idEjercicio, 255, "idEjercicio", i);
		buffer[o + 1] = entero(r.numeroSesion, 255, "numeroSesion", i);
		buffer[o + 2] = entero(r.totalEjercicios, 255, "totalEjercicios", i);
		vista.setUint16(o + 3, entero(fechaADias(r.fecha), 65535, "fecha", i));
		buffer[o + 5] = entero(r.numeroSeries, 255, "numeroSeries", i);
		vista.setUint16(o + 6, entero(Math.round(r.peso * 100), 65535, "peso", i));
		buffer[o + 8] = entero(r.repeticiones, 255, "repeticiones", i);
	});

	return buffer;
}

/**
 * @brief Desempaqueta un Uint8Array binario a un array de registros.
 * @param {Uint8Array} buffer Buffer con los datos empaquetados.
 * @returns {Array<Object>} Array de registros.
 * @throws {Error} Si la versión no es soportada o el tamaño es inválido.
 */
function desempaquetarHistorial(buffer) {
	if (!buffer || buffer.length === 0) return [];
	if (buffer[0] !== VERSION_FORMATO)
		throw new Error(`Versión del formato del histórico no soportada: ${buffer[0]}.`);
	if ((buffer.length - BYTES_CABECERA) % BYTES_REGISTRO !== 0)
		throw new Error("El histórico almacenado está dañado (tamaño no válido).");

	const vista = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	const registros = new Array((buffer.length - BYTES_CABECERA) / BYTES_REGISTRO);

	for (let i = 0; i < registros.length; i++) {
		const o = BYTES_CABECERA + i * BYTES_REGISTRO;
		registros[i] = {
			idEjercicio: buffer[o], numeroSesion: buffer[o + 1], totalEjercicios: buffer[o + 2],
			fecha: diasAFecha(vista.getUint16(o + 3)), numeroSeries: buffer[o + 5],
			peso: vista.getUint16(o + 6) / 100, repeticiones: buffer[o + 8],
		};
	}
	return registros;
}

/* ------------------------------------------------------------------ */
/* Sesión y refresco diario de la caché                               */
/* ------------------------------------------------------------------ */

const oyentes = new Set();
let ultimoResumen;     // undefined = aún no resuelto; null = sin sesión o refresco fallido; objeto = usuario
let validando = null;  // { uid, promesa } del refresco en curso (evita lanzar dos a la vez)
let version = 0;       // descarta resultados de notificaciones antiguas

/**
 * @brief Devuelve la fecha actual en formato AAAA-MM-DD (hora local).
 * @returns {string} Fecha en formato ISO corto.
 */
const hoy = () => new Date().toLocaleDateString("sv"); // AAAA-MM-DD en hora local

/**
 * @brief Lee de localStorage la sesión diaria guardada.
 * @returns {Object|null} Objeto { uid, dia } o null si no existe o hay error.
 */
function leerSesionDia() {
	try { return JSON.parse(localStorage.getItem(CLAVE_SESION_DIA)); } catch { return null; }
}

/**
 * @brief Guarda en localStorage la sesión diaria.
 * @param {Object} sesion Objeto { uid, dia }.
 */
function guardarSesionDia(sesion) {
	try { localStorage.setItem(CLAVE_SESION_DIA, JSON.stringify(sesion)); }
	catch (e) { console.warn("No se pudo guardar la sesión:", e); }
}

/**
 * @brief Borra de localStorage la sesión diaria.
 */
function borrarSesionDia() {
	try { localStorage.removeItem(CLAVE_SESION_DIA); } catch { /* sin almacenamiento: nada que borrar */ }
}

/**
 * @brief Devuelve el usuario con la caché refrescada hoy, o null si no hay sesión.
 *        Si hoy aún no se ha refrescado, descarga de la nube (previa subida de lo pendiente).
 *        Si falla, lanza el error y se reintenta en la siguiente llamada.
 * @returns {Promise<Object|null>} Usuario de Firebase o null.
 */
async function usuarioValidado() {
	await auth.authStateReady();

	const usuario = auth.currentUser;
	if (!usuario) return null;

	const guardada = leerSesionDia();
	if (guardada?.uid === usuario.uid && guardada.dia === hoy()) return usuario;

	if (validando?.uid !== usuario.uid) {
		const promesa = refrescarCache(usuario.uid)
			.then(() => guardarSesionDia({ uid: usuario.uid, dia: hoy() }))
			.finally(() => { if (validando?.promesa === promesa) validando = null; });
		validando = { uid: usuario.uid, promesa };
	}
	await validando.promesa;
	return usuario;
}

/**
 * @brief Resuelve el estado de la sesión y lo publica a los oyentes.
 *        Si hay varias notificaciones solapadas, solo se publica la más reciente.
 */
async function notificar() {
	const v = ++version;
	let usuario = null;
	try { usuario = await usuarioValidado(); }
	catch (e) { console.error("No se pudo refrescar la caché:", e); }
	if (v === version) publicar(resumirUsuario(usuario));
}

/**
 * @brief Avisa a los oyentes solo si cambia el usuario (o en la primera resolución).
 * @param {Object|null} resumen Resumen del usuario o null.
 */
function publicar(resumen) {
	if (ultimoResumen !== undefined && (ultimoResumen?.uid ?? null) === (resumen?.uid ?? null)) return;
	ultimoResumen = resumen;
	for (const cb of oyentes) cb(ultimoResumen);
}

/**
 * @brief Crea un objeto resumen a partir de un usuario de Firebase.
 * @param {Object|null} usuario Usuario de Firebase.
 * @returns {Object|null} Resumen con uid, nombre, email, foto y proveedor.
 */
function resumirUsuario(usuario) {
	return usuario && {
		uid: usuario.uid, nombre: usuario.displayName, email: usuario.email,
		foto: usuario.photoURL, proveedor: usuario.providerData[0]?.providerId ?? null,
	};
}

onAuthStateChanged(auth, notificar);

// Si el refresco falló (p. ej. al abrir sin conexión), reintentar al volver la red.
addEventListener("online", () => {
	if (auth.currentUser && ultimoResumen === null) notificar();
});

/* ------------------------------------------------------------------ */
/* Acceso a datos                                                     */
/* ------------------------------------------------------------------ */

/**
 * @brief Obtiene la referencia a un documento de Firestore dentro de la colección del usuario.
 * @param {string} uid UID del usuario.
 * @param {string} coleccion Nombre de la colección.
 * @param {string} id ID del documento.
 * @returns {Object} Referencia al documento.
 */
const documentoUsuario = (uid, coleccion, id) => doc(db, COL_USUARIOS, uid, coleccion, id);

/**
 * @brief Espera a que la caché esté refrescada hoy y devuelve el uid. Lanza si no hay sesión.
 * @returns {Promise<string>} UID del usuario.
 * @throws {Error} Si no hay sesión iniciada.
 */
async function obtenerUid() {
	const usuario = await usuarioValidado();
	if (!usuario) throw new Error(MSG_SIN_SESION);
	return usuario.uid;
}

/**
 * @brief Lee siempre de la caché local; null si el documento no está en caché.
 * @param {string} coleccion Nombre de la colección.
 * @param {string} id ID del documento.
 * @returns {Promise<Object|null>} Documento o null.
 */
async function leerDeCache(coleccion, id) {
	const uid = await obtenerUid();
	try { return await getDocFromCache(documentoUsuario(uid, coleccion, id)); }
	catch { return null; }
}

/**
 * @brief Escribe en Firestore sin esperar a la nube (la caché se actualiza al instante).
 * @param {string} coleccion Nombre de la colección.
 * @param {string} id ID del documento.
 * @param {Object} datos Datos a escribir.
 */
async function escribir(coleccion, id, datos) {
	const uid = await obtenerUid();
	setDoc(documentoUsuario(uid, coleccion, id), datos).catch((e) => console.error("Error sincronizando escritura:", e));
}

/**
 * @brief Única lectura de red. Sube las escrituras pendientes antes de descargar.
 * @param {string} uid UID del usuario.
 * @throws {Error} Si no hay conexión.
 */
async function refrescarCache(uid) {
	if (!navigator.onLine) throw new Error(MSG_SIN_CONEXION);
	await waitForPendingWrites(db);
	await Promise.all([
		getDocFromServer(documentoUsuario(uid, COL_REGISTROS, ID_HISTORIAL)),
		getDocFromServer(documentoUsuario(uid, COL_EJERCICIOS, ID_EJERCICIOS)),
	]);
}

/* ------------------------------------------------------------------ */
/* API pública                                                        */
/* ------------------------------------------------------------------ */

/**
 * @brief Inicia sesión con el proveedor indicado (google o microsoft).
 *        Si ya hay sesión de Firebase, solo refresca la caché cuando toca (una vez al día).
 * @param {string} proveedor Nombre del proveedor ("google" o "microsoft").
 * @returns {Promise<Object|null>} Resumen del usuario, o null si se ha redirigido a la página de login.
 * @throws {Error} Si el proveedor no es válido o falla el inicio de sesión.
 * @example
 *   const usuario = await iniciarSesion("google");
 *   if (usuario) console.log("Bienvenido", usuario.nombre);
 */
export async function iniciarSesion(proveedor) {
	await auth.authStateReady();

	if (!auth.currentUser) {
		const p = crearProveedor(proveedor);
		try {
			await signInWithPopup(auth, p);
		} catch (error) {
			if (CODIGOS_USAR_REDIRECCION.includes(error.code)) {
				await signInWithRedirect(auth, p);
				return null;
			}
			throw error;
		}
	}

	const usuario = await usuarioValidado();
	if (!usuario) throw new Error(MSG_SIN_SESION);
	return resumirUsuario(usuario);
}

/**
 * @brief Cierra la sesión de Firebase y borra la sesión diaria almacenada.
 * @returns {Promise<void>}
 * @example
 *   await cerrarSesion();
 */
export async function cerrarSesion() {
	borrarSesionDia();
	await signOut(auth);
}

/**
 * @brief Registra un oyente de cambios de sesión; devuelve la función para darlo de baja.
 * @param {Function} callback Función que recibe el resumen del usuario (o null).
 * @returns {Function} Función para cancelar la suscripción.
 * @example
 *   const unsubscribe = alCambiarSesion((usuario) => console.log(usuario));
 *   // Más tarde: unsubscribe();
 */
export function alCambiarSesion(callback) {
	oyentes.add(callback);
	if (ultimoResumen !== undefined) callback(ultimoResumen);
	return () => oyentes.delete(callback);
}

/**
 * @brief Crea un proveedor de autenticación a partir de su nombre.
 * @param {string} nombre Nombre del proveedor ("google" o "microsoft").
 * @returns {Object} Proveedor configurado.
 * @throws {Error} Si el proveedor no está soportado.
 */
function crearProveedor(nombre) {
	const crear = PROVEEDORES[String(nombre).toLowerCase()];
	if (!crear) throw new Error(`Proveedor no soportado: "${nombre}". Usa "google" o "microsoft".`);
	const p = crear();
	p.setCustomParameters({ prompt: "select_account" });
	return p;
}

/* ------------------------------------------------------------------ */
/* Histórico                                                          */
/* ------------------------------------------------------------------ */

/**
 * @brief Guarda el histórico completo de registros en Firestore (caché local + subida encolada).
 * @param {Array<Object>} registros Array de registros a guardar.
 * @returns {Promise<void>}
 * @throws {TypeError} Si registros no es un array.
 * @throws {RangeError} Si algún registro no es válido o el tamaño excede el límite.
 * @example
 *   await guardarHistorial([{ idEjercicio: 1, numeroSesion: 1, ... }]);
 */
export async function guardarHistorial(registros) {
	if (!Array.isArray(registros)) throw new TypeError("guardarHistorial espera el array completo.");
	const bytes = empaquetarHistorial(registros); // valida antes de tocar la sesión
	await escribir(COL_REGISTROS, ID_HISTORIAL, { datos: Bytes.fromUint8Array(bytes) });
}

/**
 * @brief Carga el histórico desde la caché local.
 * @returns {Promise<Array<Object>>} Array de registros. Vacío si no hay datos.
 * @example
 *   const registros = await cargarHistorial();
 */
export async function cargarHistorial() {
	const snap = await leerDeCache(COL_REGISTROS, ID_HISTORIAL);
	return snap?.exists() ? desempaquetarHistorial(snap.data().datos.toUint8Array()) : [];
}

/* ------------------------------------------------------------------ */
/* Ejercicios                                                         */
/* ------------------------------------------------------------------ */

/**
 * @brief Guarda el objeto de ejercicios en Firestore (caché local + subida encolada).
 * @param {Object} ejercicios Objeto con los ejercicios.
 * @returns {Promise<void>}
 * @throws {Error} Si el tamaño excede el límite.
 * @example
 *   await guardarEjercicios({ ejercicios: [...] });
 */
export async function guardarEjercicios(ejercicios) {
	const texto = JSON.stringify(ejercicios);
	if (new TextEncoder().encode(texto).length > MAX_BYTES_DOCUMENTO)
		throw new Error("El archivo de ejercicios es demasiado grande para guardarlo en la nube.");
	await escribir(COL_EJERCICIOS, ID_EJERCICIOS, { texto });
}

/**
 * @brief Carga el objeto de ejercicios desde la caché local.
 * @returns {Promise<Object>} Objeto con los ejercicios.
 * @throws {Error} Si no hay ejercicios importados.
 * @example
 *   const ejercicios = await cargarEjercicios();
 */
export async function cargarEjercicios() {
	const snap = await leerDeCache(COL_EJERCICIOS, ID_EJERCICIOS);
	if (!snap?.exists()) throw new Error("No hay ejercicios importados. Usa 'Importar JSON' para cargarlos.");
	return JSON.parse(snap.data().texto);
}