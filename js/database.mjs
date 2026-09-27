const DB_NAME = "fitnessDB";
const STORE_REGISTROS_EJERCICIO = "historico";
const STORE_ARCHIVOS = "archivos";
const DB_VERSION = 3;

const EJERCICIOS_KEY = "ejercicios";

let dbPromise = null;

function abrirBaseDatos() {
	if (!dbPromise) {
		dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);

			request.onupgradeneeded = () => {
				const db = request.result;

				if (!db.objectStoreNames.contains(STORE_REGISTROS_EJERCICIO)) {
					db.createObjectStore(STORE_REGISTROS_EJERCICIO, {
						autoIncrement: true,
					});
				}

				if (!db.objectStoreNames.contains(STORE_ARCHIVOS)) {
					db.createObjectStore(STORE_ARCHIVOS);
				}
			};

			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
			request.onblocked = () => console.warn("IndexedDB bloqueada por otra pestaña");
		}).catch((error) => {
			dbPromise = null;
			throw error;
		});
	}

	return dbPromise;
}

export async function guardarRegistroEjercicio(registroEjercicio) {
	const db = await abrirBaseDatos();

	return new Promise((resolve, reject) => {
		const transaction = db.transaction(STORE_REGISTROS_EJERCICIO, "readwrite");

		transaction.oncomplete = () => resolve(true);

		transaction.onabort = transaction.onerror = () => {
			console.error("Error en la transacción:", transaction.error);
			reject(transaction.error);
		};

		transaction.objectStore(STORE_REGISTROS_EJERCICIO).add(registroEjercicio);
	});
}

export async function cargarRegistrosEjercicio() {
	const db = await abrirBaseDatos();

	return new Promise((resolve, reject) => {
		const request = db.transaction(STORE_REGISTROS_EJERCICIO, "readonly").objectStore(STORE_REGISTROS_EJERCICIO).getAll();

		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

export async function borrarRegistrosEjercicio() {
	const db = await abrirBaseDatos();

	return new Promise((resolve, reject) => {
		const transaction = db.transaction(STORE_REGISTROS_EJERCICIO, "readwrite");

		transaction.objectStore(STORE_REGISTROS_EJERCICIO).clear();

		transaction.oncomplete = () => resolve();
		transaction.onabort = transaction.onerror = () => reject(transaction.error);
	});
}

// Guarda el archivo de ejercicios como Blob en IndexedDB.
export async function guardarEjercicios(blob) {
	const db = await abrirBaseDatos();

	return new Promise((resolve, reject) => {
		const transaction = db.transaction(STORE_ARCHIVOS, "readwrite");

		transaction.objectStore(STORE_ARCHIVOS).put(blob, EJERCICIOS_KEY);

		transaction.oncomplete = () => resolve();
		transaction.onabort = transaction.onerror = () => reject(transaction.error);
	});
}

export async function cargarEjercicios() {
	const db = await abrirBaseDatos();

	const blob = await new Promise((resolve, reject) => {
		const request = db.transaction(STORE_ARCHIVOS, "readonly").objectStore(STORE_ARCHIVOS).get(EJERCICIOS_KEY);

		request.onsuccess = () => resolve(request.result ?? null);
		request.onerror = () => reject(request.error);
	});

	if (!blob) {
		throw new Error("No hay ejercicios importados. Usa 'Importar JSON' para cargarlos.");
	}

	return JSON.parse(await blob.text());
}