import { dbAll, hoy } from './database.js';

async function loadExercises() {
    const response = await fetch("ejercicios.json");
    const list = await response.json();
    return list;
}

function crearCard(ejercicio, sesionActual, completado) {
    const a = document.createElement('a');
    a.href = `ejercicio.html?sesion=${encodeURIComponent(sesionActual)}&ejercicio=${encodeURIComponent(ejercicio.id)}`;
    a.className = `card${completado ? ' completado' : ''}`;
    a.setAttribute('aria-label', `${ejercicio.nombre}${completado ? ' (completado)' : ''}`);

    const img = document.createElement('img');
    img.src = ejercicio.imagen;
    img.alt = ejercicio.nombre;
    img.loading = 'lazy';

    const div = document.createElement('div');
    div.className = 'card-name';
    div.textContent = ejercicio.nombre;

    a.append(img, div);
    return a;
}

async function inicializarPantalla() {
    const titulo = document.getElementById('tituloSesion');
    const subtitulo = document.getElementById('subtituloSesion');
    const contenedor = document.getElementById('contenedorEjercicios');

    try {
        // Leer sesionActual
        const params = new URLSearchParams(window.location.search);
        const sesionActual = params.get('sesion') ? parseInt(params.get('sesion')) : null;
        if (!Number.isInteger(sesionActual) || sesionActual <= 0) {
            throw new Error('Falta el parámetro SESION o no es válido.');
        }

        const [ejerciciosDB, historialEjercicios] = await Promise.all([
            loadExercises(),
            dbAll()
        ]);

        const fechaHoy = hoy();
        const hechosHoy = new Set(
            historialEjercicios
                .filter(h => h.fecha === fechaHoy)
                .map(h => Number(h.id_ejercicio))
        );
        
        // const ejerciciosDeHoy = ejerciciosDB.filter(e => e.sesion.includes(sesionActual));
        const ejerciciosDeHoy = ejerciciosDB
            .filter(e => e.sesion.includes(sesionActual))
            .sort((a, b) => (a.orden ?? Number.MAX_SAFE_INTEGER) - (b.orden ?? Number.MAX_SAFE_INTEGER)
                            || Number(a.id) - Number(b.id));

        titulo.textContent = `Sesión ${sesionActual}`;

        const total = ejerciciosDeHoy.length;
        const hechos = ejerciciosDeHoy.filter(e => hechosHoy.has(Number(e.id))).length;

        subtitulo.textContent = total
            ? `${hechos} de ${total} ejercicios completados`
            : 'No hay ejercicios para esta sesión';

        contenedor.replaceChildren();

        if (!total)  {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = 'No hay ejercicios asignados a esta sesión.';
            contenedor.appendChild(empty);
            return;
        }

        const fragment = document.createDocumentFragment();
        for (const ejercicio of ejerciciosDeHoy) {
            const completado = hechosHoy.has(Number(ejercicio.id));
            fragment.appendChild(crearCard(ejercicio, sesionActual, completado));
        }
        contenedor.appendChild(fragment);
    } catch (error) {
        console.error(error);
        titulo.textContent = 'Error';
        subtitulo.textContent = error?.message || 'Error inicializando la sesión';
        contenedor.replaceChildren();

        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'No se pudo cargar la sesión.';
        contenedor.appendChild(empty);
    }
}

window.addEventListener('DOMContentLoaded', inicializarPantalla);