const DB_NAME = "fitnessDB", STORE = "historico", DB_VERSION = 2;

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
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror   = () => reject(req.error);
            req.onblocked = () => console.warn("IndexedDB bloqueada por otra pestaña");
        }).catch(err => { dbPromise = null; throw err; });
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
        r.onerror   = () => reject(r.error);
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

// export function hoy() {
//   const d = new Date();
//   return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
// }

export async function loadExercises() {
    const response = await fetch("ejercicios.json", { cache: "no-cache" });

    if (!response.ok) {
        throw new Error(`Error cargando ejercicios: ${response.status} ${response.statusText}`);
    }

    return response.json();
}

export function esMismoDia(fecha1, fecha2) {
    return (
        fecha1.getFullYear() === fecha2.getFullYear() &&
        fecha1.getMonth() === fecha2.getMonth() &&
        fecha1.getDate() === fecha2.getDate()
    );
}