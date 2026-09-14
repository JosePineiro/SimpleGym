import { dbAll, dbAdd, dbClear, hoy } from './database.js';

async function loadExercises(){
    const response = await fetch("ejercicios.json", { cache: "no-cache" });

    if (!response.ok) {
        throw new Error(`Error cargando ejercicios: ${response.status}`);
    }

    return response.json();
}


function parseCSV(text) {
    const lines = text.replace(/^\uFEFF/, '').replaceAll(`\r`, '').replaceAll('/', '-').replaceAll(',', '.').trim().split(/\n/);
    
    if (lines[0]?.toLowerCase().includes('id')) lines.shift(); // saltar cabecera
    const rows = [];
    let skipped = 0;

    for (const line of lines) {
        const parts = line.split(';').map(p => p.trim());
        if (parts.length < 5) { skipped++; continue; }

        const [idStr, sesionStr, fecha, pesoStr, repeticionesStr] = parts;
        const id = Number(idStr);
        const peso = Number(pesoStr);
        const repeticiones = Number(repeticionesStr);
        const sesion = Number(sesionStr);
        
        if (!idStr || isNaN(id) || !pesoStr || isNaN(peso) || !repeticionesStr || isNaN(repeticiones) ||
            !sesionStr || isNaN(sesion) || !/^2\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(fecha)) {
        skipped++;
        continue;
        }

        rows.push({ id_ejercicio: id, sesion, fecha, peso, repeticiones});
    }
    return { rows, skipped };
}


function getSesionActual(totalSesiones, historialEjercicios) {
    if (!historialEjercicios.length) return 1;

    // Registro con la fecha más reciente (si hay empate da igual, misma sesión)
    const ultimo = historialEjercicios.reduce((a, b) => (a.fecha >= b.fecha ? a : b));
    const sesionUltima = Number(ultimo.sesion);

    // Si el último entrenamiento fue hoy, esa es la sesión actual
    if (ultimo.fecha === hoy()) return sesionUltima;

    // Si fue antes de hoy, avanzamos una sesión (con wrap-around)
    return (sesionUltima % totalSesiones) + 1;
}

function getNumeroEjerciciosPendientes(ejerciciosDB, historialEjercicios, sesion) {
    // Conjunto de IDs de ejercicios ya realizados hoy
    const fechaHoy = hoy();
    const hechosHoy = new Set(historialEjercicios.filter(h => h.fecha === fechaHoy).map(h => Number(h.id_ejercicio)));

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
        "id;sesion;fecha;peso;repeticiones",
        ...historialEjercicios.map(row =>
            `${row.id_ejercicio};${row.sesion};${row.fecha};${row.peso};${row.repeticiones}`
        )
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
            btnSesion.classList.add('btn-disabled');
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