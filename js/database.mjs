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

// Valida que `valor` sea un entero entre 0 y `max` (NaN también se rechaza).
// `campo` e `indice` identifican el dato erróneo en el mensaje de error.
function entero(valor, max, campo, indice) {
	if (!Number.isInteger(valor) || valor < 0 || valor > max)
		throw new RangeError(`Registro ${indice}: "${campo}" no es válido o está fuera de rango (valor: ${valor}).`);
	return valor;
}

// Fecha local -> días desde 1970 (NaN si no es una Date válida).
const fechaADias = (fecha) =>
	fecha instanceof Date ? Math.round(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()) / MS_DIA) : NaN;

// Días desde 1970 -> Date a medianoche local.
function diasAFecha(dias) {
	const utc = new Date(dias * MS_DIA);
	return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

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

const hoy = () => new Date().toLocaleDateString("sv"); // AAAA-MM-DD en hora local

function leerSesionDia() {
	try { return JSON.parse(localStorage.getItem(CLAVE_SESION_DIA)); } catch { return null; }
}

function guardarSesionDia(sesion) {
	try { localStorage.setItem(CLAVE_SESION_DIA, JSON.stringify(sesion)); }
	catch (e) { console.warn("No se pudo guardar la sesión:", e); }
}

function borrarSesionDia() {
	try { localStorage.removeItem(CLAVE_SESION_DIA); } catch { /* sin almacenamiento: nada que borrar */ }
}

// Devuelve el usuario con la caché refrescada hoy, o null si no hay sesión.
// Si hoy aún no se ha refrescado, descarga de la nube (previa subida de lo pendiente);
// si falla, lanza el error y se reintenta en la siguiente llamada.
// No hay temporizadores: el cambio de día se detecta en la primera llamada tras medianoche.
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

// Resuelve el estado de la sesión y lo publica a los oyentes.
// Si hay varias notificaciones solapadas, solo se publica la más reciente.
async function notificar() {
	const v = ++version;
	let usuario = null;
	try { usuario = await usuarioValidado(); }
	catch (e) { console.error("No se pudo refrescar la caché:", e); }
	if (v === version) publicar(resumirUsuario(usuario));
}

// Avisa a los oyentes solo si cambia el usuario (o en la primera resolución).
function publicar(resumen) {
	if (ultimoResumen !== undefined && (ultimoResumen?.uid ?? null) === (resumen?.uid ?? null)) return;
	ultimoResumen = resumen;
	for (const cb of oyentes) cb(ultimoResumen);
}

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

const documentoUsuario = (uid, coleccion, id) => doc(db, COL_USUARIOS, uid, coleccion, id);

// Espera a que la caché esté refrescada hoy y devuelve el uid. Lanza si no hay sesión.
async function obtenerUid() {
	const usuario = await usuarioValidado();
	if (!usuario) throw new Error(MSG_SIN_SESION);
	return usuario.uid;
}

// Lee siempre de la caché local; null si el documento no está en caché.
async function leerDeCache(coleccion, id) {
	const uid = await obtenerUid();
	try { return await getDocFromCache(documentoUsuario(uid, coleccion, id)); }
	catch { return null; }
}

// No espera a la nube: la caché se actualiza al instante y la subida queda encolada.
async function escribir(coleccion, id, datos) {
	const uid = await obtenerUid();
	setDoc(documentoUsuario(uid, coleccion, id), datos).catch((e) => console.error("Error sincronizando escritura:", e));
}

// Única lectura de red. Sube las escrituras pendientes antes de descargar.
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

// Devuelve el resumen del usuario, o null si se ha redirigido a la página de login.
// Si ya hay sesión de Firebase, solo refresca la caché cuando toca (una vez al día).
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

export async function cerrarSesion() {
	borrarSesionDia();
	await signOut(auth);
}

// Registra un oyente de cambios de sesión; devuelve la función para darlo de baja.
export function alCambiarSesion(callback) {
	oyentes.add(callback);
	if (ultimoResumen !== undefined) callback(ultimoResumen);
	return () => oyentes.delete(callback);
}

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

export async function guardarHistorial(registros) {
	if (!Array.isArray(registros)) throw new TypeError("guardarHistorial espera el array completo.");
	const bytes = empaquetarHistorial(registros); // valida antes de tocar la sesión
	await escribir(COL_REGISTROS, ID_HISTORIAL, { datos: Bytes.fromUint8Array(bytes) });
}

export async function cargarHistorial() {
	const snap = await leerDeCache(COL_REGISTROS, ID_HISTORIAL);
	return snap?.exists() ? desempaquetarHistorial(snap.data().datos.toUint8Array()) : [];
}

/* ------------------------------------------------------------------ */
/* Ejercicios                                                         */
/* ------------------------------------------------------------------ */

export async function guardarEjercicios(ejercicios) {
	const texto = JSON.stringify(ejercicios);
	if (new TextEncoder().encode(texto).length > MAX_BYTES_DOCUMENTO)
		throw new Error("El archivo de ejercicios es demasiado grande para guardarlo en la nube.");
	await escribir(COL_EJERCICIOS, ID_EJERCICIOS, { texto });
}

export async function cargarEjercicios() {
	const snap = await leerDeCache(COL_EJERCICIOS, ID_EJERCICIOS);
	if (!snap?.exists()) throw new Error("No hay ejercicios importados. Usa 'Importar JSON' para cargarlos.");
	return JSON.parse(snap.data().texto);
}