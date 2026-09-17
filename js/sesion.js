import { dbAll, loadExercises, esMismoDia } from './database.js';

const IMG_PLACEHOLDER = 'img/placeholder.svg';


function crearCard(ejercicio, completado, sesionActual, totales) {
    const a = document.createElement('a');
    a.href = `ejercicio.html?curSes=${sesionActual}&exId=${ejercicio.id}&tot=${totales}`;
    a.className = `card${completado ? ' completado' : ''}`;
    a.setAttribute('aria-label', `${ejercicio.nombre}${completado ? ' (completado)' : ''}`);

    const img = document.createElement('img');
    img.src = ejercicio.imagen || IMG_PLACEHOLDER;
    img.alt = ejercicio.nombre;
    img.loading = 'lazy';

    const div = document.createElement('div');
    div.className = 'card-name';
    div.textContent = ejercicio.nombre;

    a.append(img, div);
    return a;
}

async function inicializarPantalla() {
    const titulo     = document.getElementById('tituloSesion');
    const subtitulo  = document.getElementById('subtituloSesion');
    const contenedor = document.getElementById('contenedorEjercicios');

    try {
        const sesionActual = parseInt(new URLSearchParams(location.search).get('sesion'), 10);
        if (!Number.isInteger(sesionActual) || sesionActual <= 0) {
            throw new Error('Falta el parámetro sesion o no es válido.');
        }

        const [ejerciciosDB, historial] = await Promise.all([
            loadExercises(),
            dbAll()
        ]);

        const ahora = new Date();
        const hechosHoy = new Set(
            historial
                .filter(h => h.date instanceof Date && esMismoDia(h.date, ahora))
                .map(h => h.exId)
        );

        const ejerciciosDeHoy = ejerciciosDB
            .filter(e => (e.sesion || []).includes(sesionActual))
            .sort((a, b) =>
                (a.orden ?? Infinity) - (b.orden ?? Infinity) ||
                a.id - b.id
            );

        titulo.textContent = `Sesión ${sesionActual}`;

        const total  = ejerciciosDeHoy.length;
        const hechos = ejerciciosDeHoy.filter(e => hechosHoy.has(e.id)).length;

        subtitulo.textContent = total
            ? `${hechos} de ${total} ejercicios completados`
            : 'No hay ejercicios para esta sesión';

        contenedor.replaceChildren();

        if (!total) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = 'No hay ejercicios asignados a esta sesión.';
            contenedor.appendChild(empty);
            return;
        }

        const fragment = document.createDocumentFragment();
        for (const ejercicio of ejerciciosDeHoy) {
            fragment.appendChild(
                crearCard(ejercicio, hechosHoy.has(ejercicio.id), sesionActual, total)
            );
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