const DB_NAME = "fitnessDB",
	STORE = "historico",
	FILES_STORE = "archivos",
	DB_VERSION = 3;
const EJERCICIOS_KEY = "ejercicios";

let dbPromise = null;

function openDB() {
	if (!dbPromise) {
		dbPromise = new Promise((resolve, reject) => {
			const req = indexedDB.open(DB_NAME, DB_VERSION);

			req.onupgradeneeded = (e) => {
				const db = req.result;
				if (!db.objectStoreNames.contains(STORE)) {
					db.createObjectStore(STORE, { autoIncrement: true });
				}
				if (!db.objectStoreNames.contains(FILES_STORE)) {
					db.createObjectStore(FILES_STORE);
				}
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
			req.onblocked = () => console.warn("IndexedDB bloqueada por otra pestaña");
		}).catch((err) => {
			dbPromise = null;
			throw err;
		});
	}
	return dbPromise;
}

export async function dbAdd(item) {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, "readwrite");
		tx.oncomplete = () => resolve(true);
		tx.onabort = tx.onerror = () => {
			console.error("TX abort/error:", tx.error);
			reject(tx.error);
		};
		tx.objectStore(STORE).add(item).onsuccess = (e) => {
			console.log("Añadido con key:", e.target.result);
		};
	});
}

export async function dbAll() {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const r = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
		r.onsuccess = () => resolve(r.result);
		r.onerror = () => reject(r.error);
	});
}

export async function dbClear() {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, "readwrite");
		tx.objectStore(STORE).clear();
		tx.oncomplete = () => resolve();
		tx.onabort = tx.onerror = () => reject(tx.error);
	});
}

// Guarda el archivo de ejercicios tal cual, en binario (Blob), en IndexedDB.
export async function dbSaveExercises(blob) {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(FILES_STORE, "readwrite");
		tx.objectStore(FILES_STORE).put(blob, EJERCICIOS_KEY);
		tx.oncomplete = () => resolve();
		tx.onabort = tx.onerror = () => reject(tx.error);
	});
}

export async function dbLoadExercises() {
	const db = await openDB();
	const blob = await new Promise((resolve, reject) => {
		const r = db.transaction(FILES_STORE, "readonly").objectStore(FILES_STORE).get(EJERCICIOS_KEY);
		r.onsuccess = () => resolve(r.result ?? null);
		r.onerror = () => reject(r.error);
	});

	if (!blob) {
		throw new Error("No hay ejercicios importados. Usa 'Importar JSON' para cargarlos.");
	}

	return JSON.parse(await blob.text());
}

export function esMismoDia(fecha1, fecha2) {
	return fecha1.getFullYear() === fecha2.getFullYear() && fecha1.getMonth() === fecha2.getMonth() && fecha1.getDate() === fecha2.getDate();
}
