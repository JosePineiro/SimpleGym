// database.mjs — almacenamiento en la nube (Firebase Auth + Cloud Firestore) con copia local.
//
// Funciona así:
//  - Al validarse (iniciarSesion) se descarga TODO de la nube y se sustituye la copia local
//    (IndexedDB). Es la única sincronización de lectura.
//  - Todas las lecturas (cargar...) se hacen sobre la copia local: sin red y sin coste.
//  - Cada guardado se envía a la nube en el momento de solicitarse y también a la copia local.
//  - La validación caduca a medianoche (hora local). Después hay que volver a validarse,
//    lo que vuelve a sincronizar.
//
// Funciones de datos:
//   guardarHistorial(registros), cargarHistorial(), guardarEjercicios(blob), cargarEjercicios()
//
// guardarHistorial recibe el array COMPLETO del histórico (array de objetos) y lo guarda
// en un único documento en formato binario (ver empaquetarHistorial/desempaquetarHistorial).
//
// Funciones de sesión:
//   iniciarSesion(firebaseConfig, proveedor), cerrarSesion(), obtenerUsuario(),
//   alCambiarSesion(callback), sincronizar()  (esta última es opcional: refresco manual)
//
// Estructura en Firestore (un documento por dato, bajo el uid del usuario; máx. 1 MiB cada uno):
//   users/{uid}/registros/Historial -> { datos: <Bytes empaquetados> }
//   users/{uid}/ejercicios/archivo  -> { texto: "<JSON de ejercicios>" }
//
// La REGIÓN de Firestore (p. ej. eur3 / europe-west) se elige al crear la base de datos
// en la consola de Firebase; no se configura desde el código.

import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
	GithubAuthProvider,
	GoogleAuthProvider,
	getAuth,
	getRedirectResult,
	OAuthProvider,
	onAuthStateChanged,
	signInWithPopup,
	signInWithRedirect,
	signOut,
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
	Bytes,
	doc,
	getDocFromServer,
	initializeFirestore,
	persistentLocalCache,
	persistentMultipleTabManager,
	setDoc,
	waitForPendingWrites,
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const firebaseConfig = {
	apiKey: "AIzaSyCzTeurftuxGf6ergWSmiNjkkZ9S5QX1wg",
	authDomain: "simplegym-8e10e.firebaseapp.com",
	projectId: "simplegym-8e10e",
	storageBucket: "simplegym-8e10e.firebasestorage.app",
	messagingSenderId: "1086535851954",
	appId: "1:1086535851954:web:5eb50586ba1db2c9498eab",
	idCliente: "1086535851954-eq056gas9v59s07k7g6svm96v6l1rst0.apps.googleusercontent.com"
};

const CLAVE_CONFIG = "fitnessDB.firebaseConfig";
const CLAVE_SESION_DIA = "fitnessDB.sesionDia";

const MSG_SIN_SESION = "Sesión no iniciada. Llama a iniciarSesion(firebaseConfig, proveedor) desde un botón.";
const MSG_CADUCADA = "La sesión ha caducado (fin del día). Vuelve a validarte con iniciarSesion().";
const MSG_SIN_CONEXION = "Esta operación necesita conexión a internet.";

const COL_USUARIOS = "users";
const COL_REGISTROS = "registros";
const COL_EJERCICIOS = "ejercicios";
const ID_HISTORIAL = "Historial";
const ID_EJERCICIOS = "archivo";

// Límite de Firestore: 1 MiB (1.048.576 bytes) por documento. Se deja margen.
const MAX_BYTES_DOCUMENTO = 1_000_000;

// Tiempo máximo esperando la confirmación del servidor antes de dar la escritura por buena
// (queda en la cola local de Firestore y se sube sola cuando haya conexión).
const ESPERA_ESCRITURA_MS = 5000;

const CODIGOS_USAR_REDIRECCION = ["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"];

// Copia local (IndexedDB): un único almacén clave-valor.
const DB_LOCAL = "fitnessCloudCache";
const DB_LOCAL_VERSION = 1;
const STORE_ARCHIVOS = "archivos";
const EJERCICIOS_KEY = "ejercicios";
const REGISTROS_KEY = "registros"; // histórico empaquetado (Uint8Array)

// Estado interno (no sale del módulo).
let contexto = null; // { auth, db }
let ultimaSesion; // undefined = aún no resuelta; null = sin sesión; objeto = usuario
let preparacion = null; // validación/sincronización en curso
let temporizadorCaducidad = null;
let dbLocalPromise = null;
const oyentes = new Set();

/* ------------------------------------------------------------------ */
/* Formato empaquetado del histórico                                  */
/* ------------------------------------------------------------------ */

// Layout (big-endian): 1 byte de versión + 9 bytes por registro:
//   +0 idEjercicio  +1 numeroSesion  +2 totalEjercicios  +3..4 fecha (días, uint16)
//   +5 numeroSeries +6..7 peso (decagramos, uint16)  +8 repeticiones
// La fecha se guarda como día del calendario local (se pierde la hora).
const VERSION_FORMATO = 1;
const BYTES_CABECERA = 1;
const BYTES_REGISTRO = 9;
const MS_DIA = 86_400_000;

function leerByte(registro, campo, indice) {
	const valor = registro?.[campo];

	if (!Number.isInteger(valor) || valor < 0 || valor > 255) {
		throw new RangeError(`Registro ${indice}: "${campo}" debe ser un entero entre 0 y 255 (valor: ${valor}).`);
	}

	return valor;
}

function pesoADecagramos(peso, indice) {
	const n = Number(peso);

	if (!Number.isFinite(n)) {
		throw new TypeError(`peso inválido en registro ${indice}: ${peso}`);
	}

	const decimas = Math.round(n * 100);

	// Uint16: 0 .. 65535 -> 0.0 .. 655.35 kg
	if (decimas < 0 || decimas > 0xFFFF) {
		throw new RangeError(`peso fuera de rango en registro ${indice}: ${peso}. Rango permitido: 0.0 a 655.35`);
	}

	return decimas;
}

function fechaADias(fecha, indice) {
	if (!(fecha instanceof Date) || Number.isNaN(fecha.getTime())) {
		throw new TypeError(`Registro ${indice}: "fecha" debe ser un Date válido.`);
	}

	const dias = Math.round(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()) / MS_DIA);

	if (dias < 0 || dias > 65535) {
		throw new RangeError(`Registro ${indice}: "fecha" fuera del rango admitido (1970-2149).`);
	}

	return dias;
}

function diasAFecha(dias) {
	const utc = new Date(dias * MS_DIA);

	return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate()); // medianoche local
}

// Array de objetos -> Uint8Array. Valida los rangos (un Uint8 truncaría sin avisar).
export function empaquetarHistorial(registros) {
	const tamano = BYTES_CABECERA + registros.length * BYTES_REGISTRO;

	if (tamano > MAX_BYTES_DOCUMENTO) {
		throw new RangeError(`El histórico (${registros.length} registros) supera el límite de un documento de Firestore.`);
	}

	const buffer = new Uint8Array(tamano);
	const vista = new DataView(buffer.buffer);

	buffer[0] = VERSION_FORMATO;

	registros.forEach((registro, indice) => {
		const o = BYTES_CABECERA + indice * BYTES_REGISTRO;

		buffer[o] = leerByte(registro, "idEjercicio", indice);
		buffer[o + 1] = leerByte(registro, "numeroSesion", indice);
		buffer[o + 2] = leerByte(registro, "totalEjercicios", indice);
		vista.setUint16(o + 3, fechaADias(registro.fecha, indice));
		buffer[o + 5] = leerByte(registro, "numeroSeries", indice);
		vista.setUint16(o + 6, pesoADecagramos(registro.peso, indice));
		buffer[o + 8] = leerByte(registro, "repeticiones", indice);
	});

	return buffer;
}

// Uint8Array -> array de objetos.
export function desempaquetarHistorial(buffer) {
	if (!buffer || buffer.length === 0) return [];

	if (buffer[0] !== VERSION_FORMATO) {
		throw new Error(`Versión del formato del histórico no soportada: ${buffer[0]}.`);
	}

	if ((buffer.length - BYTES_CABECERA) % BYTES_REGISTRO !== 0) {
		throw new Error("El histórico almacenado está dañado (tamaño no válido).");
	}

	const vista = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	const registros = new Array((buffer.length - BYTES_CABECERA) / BYTES_REGISTRO);

	for (let i = 0; i < registros.length; i++) {
		const o = BYTES_CABECERA + i * BYTES_REGISTRO;

		registros[i] = {
			idEjercicio: buffer[o],
			numeroSesion: buffer[o + 1],
			totalEjercicios: buffer[o + 2],
			fecha: diasAFecha(vista.getUint16(o + 3)),
			numeroSeries: buffer[o + 5],
			peso: vista.getUint16(o + 6) / 100, // centésimas a kg
			repeticiones: buffer[o + 8],
		};
	}

	return registros;
}

/* ------------------------------------------------------------------ */
/* Copia local (IndexedDB)                                            */
/* ------------------------------------------------------------------ */

function abrirBaseLocal() {
	if (!dbLocalPromise) {
		dbLocalPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_LOCAL, DB_LOCAL_VERSION);

			request.onupgradeneeded = () => {
				const db = request.result;

				if (!db.objectStoreNames.contains(STORE_ARCHIVOS)) {
					db.createObjectStore(STORE_ARCHIVOS);
				}
			};

			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
			request.onblocked = () => console.warn("IndexedDB bloqueada por otra pestaña");
		}).catch((error) => {
			dbLocalPromise = null;
			throw error;
		});
	}

	return dbLocalPromise;
}

// Ejecuta una transacción sobre el almacén. "accion" recibe el almacén y puede devolver una
// petición (IDBRequest), cuyo resultado se devuelve al terminar.
async function operarLocal(modo, accion) {
	const db = await abrirBaseLocal();

	return new Promise((resolve, reject) => {
		const transaction = db.transaction(STORE_ARCHIVOS, modo);
		const peticion = accion(transaction.objectStore(STORE_ARCHIVOS));

		transaction.oncomplete = () => resolve(peticion?.result);
		transaction.onabort = transaction.onerror = () => reject(transaction.error);
	});
}

const leerLocal = (clave) => operarLocal("readonly", (almacen) => almacen.get(clave));
const guardarLocal = (clave, valor) => operarLocal("readwrite", (almacen) => almacen.put(valor, clave));

// Sustituye toda la copia local. Cada argumento es null si no existe en la nube.
function reemplazarLocal(bytesRegistros, textoEjercicios) {
	return operarLocal("readwrite", (almacen) => {
		almacen.clear();

		if (bytesRegistros !== null) almacen.put(bytesRegistros, REGISTROS_KEY);
		if (textoEjercicios !== null) almacen.put(textoEjercicios, EJERCICIOS_KEY);
	});
}

/* ------------------------------------------------------------------ */
/* Utilidades de Firestore                                            */
/* ------------------------------------------------------------------ */

function documentoUsuario(db, uid, coleccion, id) {
	return doc(db, COL_USUARIOS, uid, coleccion, id);
}

// Con la caché offline de Firestore, una escritura no se resuelve hasta que el servidor
// la confirma, y sin conexión eso puede no ocurrir nunca. Aquí se espera la confirmación
// solo si hay conexión (con un tiempo máximo); si no, la escritura queda en la cola local
// de Firestore y se sube sola al volver la red.
function confirmarEscritura(escritura) {
	if (!navigator.onLine) {
		escritura.catch((error) => console.error("Error sincronizando escritura pendiente:", error));
		return Promise.resolve();
	}

	let agotado = false;
	let temporizador;

	const espera = new Promise((resolve) => {
		temporizador = setTimeout(() => {
			agotado = true;
			resolve();
		}, ESPERA_ESCRITURA_MS);
	});

	escritura.catch((error) => {
		if (agotado) console.error("Error sincronizando escritura pendiente:", error);
	});

	return Promise.race([escritura, espera]).finally(() => clearTimeout(temporizador));
}

/* ------------------------------------------------------------------ */
/* Sincronización (única lectura de la nube)                          */
/* ------------------------------------------------------------------ */

async function sincronizarConNube(db, uid) {
	if (!navigator.onLine) throw new Error(MSG_SIN_CONEXION);

	// Primero se sube lo que hubiera pendiente de otras sesiones sin conexión.
	await waitForPendingWrites(db);

	const [Historial, ejercicios] = await Promise.all([
		getDocFromServer(documentoUsuario(db, uid, COL_REGISTROS, ID_HISTORIAL)),
		getDocFromServer(documentoUsuario(db, uid, COL_EJERCICIOS, ID_EJERCICIOS)),
	]);

	await reemplazarLocal(
		Historial.exists() ? Historial.data().datos.toUint8Array() : null,
		ejercicios.exists() ? ejercicios.data().texto : null,
	);
}

// Refresco manual opcional (requiere sesión y conexión). No amplía la caducidad.
export async function sincronizar() {
	const { db, uid } = await obtenerSesion();

	await sincronizarConNube(db, uid);
}

/* ------------------------------------------------------------------ */
/* Sesión y caducidad                                                 */
/* ------------------------------------------------------------------ */

function configValida(config) {
	return Boolean(config?.apiKey && config.projectId && config.appId);
}

function guardarConfig(config) {
	try {
		localStorage.setItem(CLAVE_CONFIG, JSON.stringify(config));
	} catch (error) {
		console.warn("No se pudo guardar la configuración de Firebase:", error);
	}
}

function leerConfigGuardada() {
	try {
		const config = JSON.parse(localStorage.getItem(CLAVE_CONFIG));

		return configValida(config) ? config : null;
	} catch {
		return null;
	}
}

function leerSesionDia() {
	try {
		return JSON.parse(localStorage.getItem(CLAVE_SESION_DIA));
	} catch {
		return null;
	}
}

function guardarSesionDia(sesion) {
	try {
		localStorage.setItem(CLAVE_SESION_DIA, JSON.stringify(sesion));
	} catch (error) {
		console.warn("No se pudo guardar la sesión:", error);
	}
}

function sesionDiaCaducada(uid) {
	const sesion = leerSesionDia();

	return sesion?.uid === uid && Date.now() >= sesion.caduca;
}

// Próxima medianoche en hora local.
function finDelDia() {
	const fecha = new Date();

	fecha.setHours(24, 0, 0, 0);

	return fecha.getTime();
}

function programarCaducidad(caduca) {
	clearTimeout(temporizadorCaducidad);

	temporizadorCaducidad = setTimeout(
		() => expirarSesion().catch((error) => console.error("Error al caducar la sesión:", error)),
		Math.max(0, caduca - Date.now()),
	);
}

// Los temporizadores no son fiables si el dispositivo se suspende; se revisa al volver a la pestaña.
function comprobarCaducidad() {
	const sesion = leerSesionDia();

	if (sesion && Date.now() >= sesion.caduca) {
		expirarSesion().catch((error) => console.error("Error al caducar la sesión:", error));
	}
}

async function expirarSesion() {
	clearTimeout(temporizadorCaducidad);

	try {
		localStorage.removeItem(CLAVE_SESION_DIA);
	} catch {
		// sin acceso a localStorage: nada que limpiar
	}

	if (contexto) await signOut(contexto.auth); // onAuthStateChanged avisará con null
}

function resumirUsuario(usuario) {
	if (!usuario) return null;

	return {
		uid: usuario.uid,
		nombre: usuario.displayName,
		email: usuario.email,
		foto: usuario.photoURL,
		proveedor: usuario.providerData[0]?.providerId ?? null,
	};
}

function publicarSesion(resumen) {
	if (ultimaSesion !== undefined && (ultimaSesion?.uid ?? null) === (resumen?.uid ?? null)) return;

	ultimaSesion = resumen;

	for (const callback of oyentes) {
		callback(ultimaSesion);
	}
}

// Comprueba la validación del día. Si es nueva (o de otro usuario) sincroniza con la nube y
// fija la caducidad a medianoche; si ya estaba vigente no toca la red.
function prepararSesion(usuario) {
	if (!preparacion) {
		preparacion = ejecutarPreparacion(usuario).finally(() => {
			preparacion = null;
		});
	}

	return preparacion;
}

async function ejecutarPreparacion(usuario) {
	const guardada = leerSesionDia();

	if (guardada?.uid === usuario.uid) {
		if (Date.now() >= guardada.caduca) {
			await expirarSesion();
			throw new Error(MSG_CADUCADA);
		}

		programarCaducidad(guardada.caduca);
		return;
	}

	// Validación nueva: descarga completa. Si falla, no se da por válida.
	await sincronizarConNube(contexto.db, usuario.uid);

	const sesion = { uid: usuario.uid, caduca: finDelDia() };

	guardarSesionDia(sesion);
	programarCaducidad(sesion.caduca);
}

function inicializar(firebaseConfig) {
	if (contexto) return contexto;

	if (!configValida(firebaseConfig)) {
		throw new Error("Configuración de Firebase incompleta (faltan apiKey, projectId o appId).");
	}

	const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
	const auth = getAuth(app); // Firebase conserva el usuario entre recargas; la caducidad la gestiona este módulo

	// La caché persistente de Firestore se usa para la cola de escrituras sin conexión.
	const db = initializeFirestore(app, {
		localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
		ignoreUndefinedProperties: true,
	});

	contexto = { auth, db };

	getRedirectResult(auth).catch((error) => console.error("Error al completar el inicio de sesión:", error));

	onAuthStateChanged(auth, async (usuario) => {
		if (!usuario) {
			publicarSesion(null);
			return;
		}

		try {
			await prepararSesion(usuario);
			publicarSesion(resumirUsuario(usuario));
		} catch (error) {
			console.error("No se pudo validar la sesión:", error);
			publicarSesion(null);
		}
	});

	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") comprobarCaducidad();
	});

	return contexto;
}

function crearProveedor(nombre) {
	switch (String(nombre).toLowerCase()) {
		case "google": {
			const proveedor = new GoogleAuthProvider();

			proveedor.setCustomParameters({ prompt: "select_account" });
			return proveedor;
		}
		case "microsoft": {
			const proveedor = new OAuthProvider("microsoft.com");

			proveedor.setCustomParameters({ prompt: "select_account" });
			return proveedor;
		}
		case "github":
			return new GithubAuthProvider();
		default:
			throw new Error(`Proveedor no soportado: "${nombre}". Usa "google", "microsoft" o "github".`);
	}
}

// Valida al usuario con su cuenta y sincroniza. Debe llamarse desde un gesto del usuario (clic).
//  - firebaseConfig: objeto de configuración de la app web de Firebase.
//  - proveedor: "google" | "microsoft" | "github".
// La validación y la config quedan guardadas dentro del módulo hasta medianoche: mientras
// tanto, las funciones de datos funcionan solas tras recargar la página.
// Devuelve { uid, nombre, email, foto, proveedor }, o null si se ha redirigido a la página de login.
export async function iniciarSesion(proveedor) {
	const { auth } = inicializar(firebaseConfig);
	const proveedorAuth = crearProveedor(proveedor);

	await auth.authStateReady();

	if (auth.currentUser && sesionDiaCaducada(auth.currentUser.uid)) await expirarSesion();

	if (!auth.currentUser) {
		try {
			await signInWithPopup(auth, proveedorAuth);
		} catch (error) {
			// Algunos navegadores móviles bloquean popups: se usa el flujo por redirección.
			if (CODIGOS_USAR_REDIRECCION.includes(error.code)) {
				guardarConfig(firebaseConfig);
				await signInWithRedirect(auth, proveedorAuth);
				return null; // la página se recarga al volver del login y entonces se sincroniza
			}
			throw error;
		}
	}

	guardarConfig(firebaseConfig);
	await prepararSesion(auth.currentUser);

	const usuario = resumirUsuario(auth.currentUser);

	publicarSesion(usuario);
	return usuario;
}

export async function cerrarSesion() {
	await expirarSesion();
}

// Usuario con la validación vigente, o null.
export function obtenerUsuario() {
	return ultimaSesion ?? null;
}

// Avisa del estado de la sesión (usuario o null) al registrarse y en cada cambio, incluida
// la caducidad. Devuelve una función para dejar de escuchar.
export function alCambiarSesion(callback) {
	oyentes.add(callback);

	if (ultimaSesion !== undefined) {
		// Ya se conoce el estado: aviso inmediato.
		callback(ultimaSesion);
	} else if (contexto) {
		// Sesión aún resolviéndose: onAuthStateChanged avisará (o el catch de abajo).
	} else {
		const config = leerConfigGuardada();

		if (config) {
			try {
				inicializar(config);
			} catch (error) {
				console.error("Error al inicializar la sesión:", error);
				publicarSesion(null);
			}
		} else {
			// Sin config guardada no hay sesión posible: se avisa ya.
			publicarSesion(null);
		}
	}

	return () => oyentes.delete(callback);
}

// Todas las funciones de datos pasan por aquí: exige validación vigente del día.
async function obtenerSesion() {
	if (!contexto) {
		const config = leerConfigGuardada();

		if (!config) throw new Error(MSG_SIN_SESION);
		inicializar(config);
	}

	await contexto.auth.authStateReady();

	const usuario = contexto.auth.currentUser;

	if (!usuario) throw new Error(MSG_SIN_SESION);

	await prepararSesion(usuario);

	return { db: contexto.db, uid: usuario.uid };
}

/* ------------------------------------------------------------------ */
/* Registros de ejercicio                                             */
/* ------------------------------------------------------------------ */

// Guarda el histórico COMPLETO (array de objetos) en un único documento, sustituyendo al anterior.
// Se envía a la nube en el momento y después se guarda en la copia local.
export async function guardarHistorial(registros) {
	if (!Array.isArray(registros)) {
		throw new TypeError("guardarHistorial espera el array completo de registros.");
	}

	const { db, uid } = await obtenerSesion();
	const bytes = empaquetarHistorial(registros);

	try {
		await confirmarEscritura(
			setDoc(documentoUsuario(db, uid, COL_REGISTROS, ID_HISTORIAL), { datos: Bytes.fromUint8Array(bytes) }),
		);
	} catch (error) {
		console.error("Error guardando el histórico en la nube:", error);
		throw error;
	}

	await guardarLocal(REGISTROS_KEY, bytes);

	return true;
}

// Lectura 100 % local. Devuelve el array de objetos (vacío si no hay histórico).
export async function cargarHistorial() {
	await obtenerSesion();

	return desempaquetarHistorial(await leerLocal(REGISTROS_KEY));
}

/* ------------------------------------------------------------------ */
/* Archivo de ejercicios                                              */
/* ------------------------------------------------------------------ */

// Guarda el archivo de ejercicios (Blob/File con JSON) en un único documento y en la copia local.
export async function guardarEjercicios(ejercicios) {
	const { db, uid } = await obtenerSesion();

	const texto = JSON.stringify(ejercicios);
	const bytes = new TextEncoder().encode(texto).length;
	if (bytes > MAX_BYTES_DOCUMENTO) {
		throw new Error("El archivo de ejercicios es demasiado grande para guardarlo en la nube.");
	}

	try {
		await confirmarEscritura(setDoc(documentoUsuario(db, uid, COL_EJERCICIOS, ID_EJERCICIOS), { texto }));
	} catch (error) {
		console.error("Error guardando los ejercicios en la nube:", error);
		throw error;
	}

	await guardarLocal(EJERCICIOS_KEY, texto);
}

// Lectura 100 % local.
export async function cargarEjercicios() {
	await obtenerSesion();

	const texto = await leerLocal(EJERCICIOS_KEY);

	if (texto === undefined || texto === null) {
		throw new Error("No hay ejercicios importados. Usa 'Importar JSON' para cargarlos.");
	}

	return JSON.parse(texto);
}