import { dbAll, dbAdd, dbClear, loadExercises, esMismoDia, dbSaveExercisesFile } from './database.js';


// ---- Importar / Exportar historial en CSV ----

function parseCSV(text) {
    const lines = text
        .replace(/^\uFEFF/, '')          // BOM
        .replaceAll('\r', '')
        .replaceAll(',', '.')
        .trim()
        .split('\n');

    // Saltar cabecera si existe
    if (lines[0]?.toLowerCase().includes('id')) {
        lines.shift();
    }

    const rows = [];
    let skipped = 0;

    for (const line of lines) {
        const parts = line.split(';').map(p => p.trim());
        if (parts.length < 7) {
            skipped++;
            continue;
        }

        const [exIdStr, sessionStr, totalsStr, dateStr, setsStr, weightStr, repsStr] = parts;
        const exId = Number(exIdStr);
        const session = Number(sessionStr);
        const totals = Number(totalsStr);
        const [year, month, day] = dateStr.split(/[\/-]/).map(Number);
        const date = new Date(year, month - 1, day);
        const sets = Number(setsStr);
        const weight = Number(weightStr);
        const reps = Number(repsStr);

        // Validación
        if (
            !exIdStr    || isNaN(exId)    ||
            !sessionStr || isNaN(session) ||
            !totalsStr  || isNaN(totals)  ||
            isNaN(date.getTime())         ||
            !setsStr  || isNaN(sets)  ||
            !weightStr  || isNaN(weight)  ||
            !repsStr    || isNaN(reps)
        ) {
            skipped++;
            continue;
        }

        rows.push({ exId, session, totals, date, sets, weight, reps});
    }
    return { rows, skipped };
}

async function importarCSV(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const { rows, skipped } = parseCSV(text);

        if (rows.length === 0) {
            throw new Error("El CSV no contiene filas válidas.");
        }

        await dbClear();
        for (const row of rows) await dbAdd(row);
        alert(`${rows.length} ejercicios del historial importados${skipped ? `, ${skipped} saltados.` : '.'}`);

        await inicializarPantalla();
    } catch (error) {
        alert(`Error al procesar el archivo CSV: ${error?.message || error}`);
        console.error(error);
    } finally {
        event.target.value = '';
    }
}

async function exportarCSV() {
    const historialEjercicios = await dbAll();
    if (historialEjercicios.length === 0) {
        alert("No hay datos en el historial para exportar.");
        return;
    }

    const filas = [
        "id;sesion;totales;fecha;series;peso;repeticiones",
        ...historialEjercicios.map(row => {
            const fecha = `${row.date.getFullYear()}/${String(row.date.getMonth() + 1).padStart(2, '0')}/${String(row.date.getDate()).padStart(2, '0')}`;
            return `${row.exId};${row.session};${row.totals};${fecha};${row.sets};${row.weight};${row.reps}`;
        })
    ];

    const blob = new Blob(
        ["\uFEFF" + filas.join("\n")],
        { type: "text/csv;charset=utf-8" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "historico.csv";
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 100);
}

// ---- Importar / Exportar ejercicios en JSON ----

async function importarJSON(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();

        // Validamos que sea un JSON de ejercicios correcto antes de guardarlo
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error("El archivo no contiene un JSON válido.");
        }

        if (!Array.isArray(data) || data.length === 0) {
            throw new Error("El JSON no contiene ningún ejercicio.");
        }

        if (!data.every(e => typeof e.id === 'number' && Array.isArray(e.sesion))) {
            throw new Error("El JSON no tiene el formato de ejercicios esperado.");
        }

        // Guardamos el archivo como binario (Blob), en IndexedDB
        const blob = new Blob([text], { type: 'application/json' });
        await dbSaveExercisesFile(blob);

        await inicializarPantalla();
        alert(`Ejercicios importados correctamente (${data.length} ejercicios).`);
    } catch (error) {
        alert(`Error al procesar el archivo JSON: ${error?.message || error}`);
        console.error(error);
    } finally {
        event.target.value = '';
    }
}

async function exportarJSON() {
    let ejercicios;
    try {
        ejercicios = await loadExercises();
    } catch {
        alert("No hay ejercicios guardados en el almacenamiento local para exportar.");
        return;
    }

    const blob = new Blob([JSON.stringify(ejercicios, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "ejercicios.json";
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 100);
}

// ---- Inicializar el formulario ----

function getSesionActual(totalSessions, historialEjercicios) {
    if (!historialEjercicios?.length || !totalSessions) return 1;

    // Registro con la fecha más reciente (si hay empate da igual, misma sesión)
    // const last = historialEjercicios.reduce((a, b) => a.date.getTime() >= b.date.getTime() ? a : b);
    const last = historialEjercicios.reduce((a, b) => a.date > b.date ? a : b);

    // Si el último entrenamiento fue hoy → misma sesión
    if (esMismoDia(last.date, new Date())) return last.session;

    // Si fue antes de hoy, avanzamos una sesión (con wrap-around)
    return (last.session % totalSessions) + 1;
}


function getNumeroEjerciciosPendientes(ejerciciosDB, historialEjercicios, sesion) {
    // Conjunto de IDs de ejercicios ya realizados hoy
    const hechosHoy = new Set(historialEjercicios.filter(h => esMismoDia(h.date, new Date())).map(h => h.exId));

    return ejerciciosDB.filter(e => e.sesion.includes(sesion) && !hechosHoy.has(e.id)).length;
}

async function inicializarPantalla() {
    try {
        // Cargamos los ejercicios y el historial
        const [ejerciciosDB, historialEjercicios] = await Promise.all([
            loadExercises(),
            dbAll()
        ]);

        // Configuramos la ficha de entrenamiento
        const totalSesiones = ejerciciosDB.reduce((max, e) => Math.max(max, e.sesion || 0), 1);         // Sesión más alta definida en ejercicios.json
        const sesionActual = getSesionActual(totalSesiones, historialEjercicios);
        const btnSesion = document.getElementById('btnIrSesion');
        btnSesion.textContent = `Comenzar Sesión ${sesionActual}`;
        btnSesion.href = `sesion.html?sesion=${sesionActual}`;

        const infoSesion = document.getElementById('infoSesion')
        const numeroEjerciciosPendientes = getNumeroEjerciciosPendientes(ejerciciosDB, historialEjercicios, sesionActual);
        if (numeroEjerciciosPendientes === 0) {
            infoSesion.textContent = `Todos los ejercicios de hoy completados`;
        } else {
            infoSesion.textContent = `Hoy tienes ${numeroEjerciciosPendientes} ejercicios pendientes.`;
        }
    } catch (error) {
        alert(`Error inicializando: ${error?.message || error}`);
        console.error(error);
    }
}

document.getElementById('importarCSV').addEventListener('change', importarCSV);
document.getElementById('exportarCSV').addEventListener('click', exportarCSV);
document.getElementById('importarJSON').addEventListener('change', importarJSON);
document.getElementById('exportarJSON').addEventListener('click', exportarJSON);
inicializarPantalla();