import { dbAll, dbAdd, dbClear, loadExercises, esMismoDia } from './database.js';

function parseCSV(text) {
    const lines = text
        .replace(/^\uFEFF/, '')          // BOM
        .replaceAll('\r', '')
        .replaceAll('/', '-')
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
        if (parts.length < 6) { 
            skipped++; 
            continue;
        }

        const [exIdStr, sessionStr, totalsStr, dateStr, weightStr, repsStr] = parts;
        const exId = Number(exIdStr);
        const session = Number(sessionStr);
        const totals = Number(totalsStr);
        const date = new Date(dateStr);
        const weight = Number(weightStr);
        const reps = Number(repsStr);

        // Validación
        if (
            !exIdStr    || isNaN(exId)    ||
            !sessionStr || isNaN(session) ||
            !totalsStr  || isNaN(totals)  ||
            isNaN(date.getTime())         ||
            !weightStr  || isNaN(weight)  ||
            !repsStr    || isNaN(reps)
        ) {
            skipped++;
            continue;
        }

        rows.push({ exId, session, totals, date, weight, reps});
    }
    return { rows, skipped };
}


function getSesionActual(totalSessions, historialEjercicios) {
    if (!historialEjercicios?.length || !totalSessions) return 1;

    // Registro con la fecha más reciente (si hay empate da igual, misma sesión)
    const last = historialEjercicios.reduce((a, b) => a.date.getTime() >= b.date.getTime() ? a : b);

    // Si el último entrenamiento fue hoy → misma sesión
    if (esMismoDia(last.date, new Date())) {
        return last.session;
    }
     
    // Si fue antes de hoy, avanzamos una sesión (con wrap-around)
    return (last.session % totalSessions) + 1;
}

function getNumeroEjerciciosPendientes(ejerciciosDB, historialEjercicios, sesion) {
    // Conjunto de IDs de ejercicios ya realizados hoy
    const hechosHoy = new Set(
        (historialEjercicios || [])
            .filter(h => esMismoDia(h.date, new Date()))
            .map(h => h.exId)
    );

    // Filtramos los ejercicios que pertenecen a la sesión indicada
    const ejerciciosSesion = ejerciciosDB.filter(e => e.sesion.includes(sesion));

    // Contamos los que NO se han hecho hoy
    const pendientes = ejerciciosSesion.filter(e => !hechosHoy.has(e.id)).length;

    return pendientes;
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
        await inicializarIndex();

        alert(`Importación finalizada. ${rows.length} registros importados, ${skipped} saltados.`);
    } catch (err) {
        alert(`Error al procesar el archivo CSV: ${err.message}`);
        console.error(err);
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
        "id;sesion;totales;fecha;peso;repeticiones",
        ...historialEjercicios.map(row => {
            const fecha = `${row.date.getFullYear()}/${String(row.date.getMonth() + 1).padStart(2, '0')}/${String(row.date.getDate()).padStart(2, '0')}`;
            return `${row.exId};${row.session};${row.totals};${fecha};${row.weight};${row.reps}`;
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

async function inicializarIndex() {
    try {            
        let sesionActual;

        // Cargamos el json con los ejercicios
        const ejerciciosDB = await loadExercises();
        if (!ejerciciosDB || ejerciciosDB.length === 0) {
            throw new Error("No se encontraron ejercicios en la base de datos.");
        }
        
        // Cargamos el historial
        const historialEjercicios = await dbAll();

        // Configuramos la ficha de entrenamiento
        const infoSesion = document.getElementById('infoSesion')
        const btnSesion = document.getElementById('btnIrSesion');
        btnSesion.classList.remove('btn-disabled');

        if (historialEjercicios.length === 0) {
            btnSesion.textContent = '¡Bienvenido! Empieza tu primera sesión.';
            sesionActual = 1;
        } else {
            const totalSesiones = Math.max(...ejerciciosDB.flatMap(e => e.sesion)); // Sesión más alta definida en ejercicios.json
            sesionActual = getSesionActual(totalSesiones, historialEjercicios);
            btnSesion.textContent = `Comenzar Sesión ${sesionActual}`;
        }

        const numeroEjerciciosPendientes = getNumeroEjerciciosPendientes(ejerciciosDB, historialEjercicios, sesionActual);

        if (numeroEjerciciosPendientes === 0) {
            infoSesion.textContent = `Todos los ejercicios de hoy completados`;
        } else {
            btnSesion.href = `sesion.html?sesion=${sesionActual}`;
            infoSesion.textContent = `Hoy tienes ${numeroEjerciciosPendientes} ejercicios pendientes.`;
        }
    } catch (error) {
        alert(`Error inicializando: ${error?.message || error}`);
        console.error(error);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('importFile').addEventListener('change', importarCSV);
    document.getElementById('btnExportar').addEventListener('click', exportarCSV);
    inicializarIndex();
});