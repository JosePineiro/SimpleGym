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
        if (parts.length < 4) { skipped++; continue; }

        const [idStr, fecha, pesoStr, repStr] = parts;
        const id = Number(idStr);
        const peso = Number(pesoStr);
        const rep = Number(repStr);

        if (!idStr || isNaN(id) || !pesoStr || isNaN(peso) || !repStr || isNaN(rep) || !/^2\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(fecha)) {
        skipped++;
        continue;
        }

        rows.push({ id_ejercicio: id, fecha, peso, repeticiones: rep });
    }
    return { rows, skipped };
}


function getSesionActual(ejerciciosDB, historialEjercicios) {
    try {
        // Total de sesiones existentes
        const todasLasSesiones = ejerciciosDB.flatMap(e => e.sesion);
        if (!todasLasSesiones.length) throw new Error("ejercicios.json sin sesiones");
        const totalSesiones = Math.max(...todasLasSesiones);

        // Devuelve el array de sesiones de un ejercicio del DB
        const getSesiones = id => ejerciciosDB.find(e => e.id === id)?.sesion ?? [];

        // Agrupamos el historial por fecha
        const porFecha = {};
        for (const h of historialEjercicios) {
            (porFecha[h.fecha] = porFecha[h.fecha] || []).push(h);
        }

        // Fechas ordenadas de más antigua a más reciente
        const fechas = Object.keys(porFecha).sort();

        // Para cada fecha, calculamos el conjunto de sesiones posibles
        // (intersección de las sesiones de todos los ejercicios de esa fecha)
        const posiblesPorFecha = fechas.map(fecha => {
            const ejerciciosFecha = porFecha[fecha];
            let interseccion = null;
            for (const h of ejerciciosFecha) {
                const sesiones = getSesiones(h.id_ejercicio);
                if (!sesiones) continue;
                if (interseccion === null) {
                    interseccion = new Set(sesiones);
                } else {
                    interseccion = new Set([...interseccion].filter(s => sesiones.includes(s)));
                }
            }
            return interseccion ? Array.from(interseccion).sort((a, b) => a - b) : [];
        });

        // Buscamos la primera fecha que tenga una única sesión posible (unívoca)
        let indiceInicio = -1;
        let sesionActual = null;
        for (let i = 0; i < posiblesPorFecha.length; i++) {
            if (posiblesPorFecha[i].length === 1) {
                indiceInicio = i;
                sesionActual = posiblesPorFecha[i][0];
                break;
            }
        }

        // Si no hay ninguna fecha unívoca, no podemos determinar la secuencia
        if (indiceInicio === -1) {
            return 1; // fallback
        }

        // Propagamos hacia adelante resolviendo las ambigüedades
        for (let i = indiceInicio + 1; i < posiblesPorFecha.length; i++) {
            const posibles = posiblesPorFecha[i];
            if (posibles.length === 0) continue;

            // Buscamos la siguiente sesión después de sesionActual que esté en posibles
            let siguiente = null;
            for (let offset = 1; offset <= totalSesiones; offset++) {
                const candidata = ((sesionActual - 1 + offset) % totalSesiones) + 1;
                if (posibles.includes(candidata)) {
                    siguiente = candidata;
                    break;
                }
            }
            if (siguiente === null) {
                // Sin consistencia: tomamos la primera posible
                siguiente = posibles[0];
            }
            sesionActual = siguiente;
        }

        // La última sesión registrada es sesionActual
        const ultimaSesion = sesionActual;
        const ultimaFecha = fechas[fechas.length - 1];

        // Si la última fecha es hoy, la sesión actual es la de hoy.
        // Si no, la sesión actual es la siguiente a la última registrada.
        const fechaHoy = hoy();
        if (ultimaFecha === fechaHoy) {
            return ultimaSesion;
        } else {
            return (ultimaSesion % totalSesiones) + 1;
        }

    } catch (error) {
        console.error("Error calculando la sesión:", error);
        return 1;
    }
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
        "id;fecha;peso;repeticiones",
        ...historialEjercicios.map(row =>
            `${row.id_ejercicio};${row.fecha};${row.peso};${row.repeticiones}`
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
            sesionActual = getSesionActual(ejerciciosDB, historialEjercicios);
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