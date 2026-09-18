import { loadExercises } from './database.js';

/* =========================================================
   estadisticas_lista.js
   Muestra una ficha por cada máquina/ejercicio.
   Al pulsar una ficha → progreso.html?id=<id>
   ========================================================= */

const contenedor = document.getElementById('contenedorMaquinas');
const subtitulo  = document.getElementById('subtituloPagina');

/* ---------- Utilidades ---------- */

// Ruta por defecto para la imagen de una máquina sin imagen propia.
const IMG_PLACEHOLDER = 'img/placeholder.svg';

/**
 * Crea la tarjeta-enlace de una máquina.
 */
function crearTarjeta(ejercicio) {
    const a = document.createElement('a');
    a.className = 'card';
    a.href = `progreso.html?id=${encodeURIComponent(ejercicio.id)}`;
    a.setAttribute('aria-label', `Ver progreso de ${ejercicio.nombre}`);

    const img = document.createElement('img');
    img.src = ejercicio.imagen || IMG_PLACEHOLDER;
    img.alt = ejercicio.nombre;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => { img.src = IMG_PLACEHOLDER; });

    const div = document.createElement('div');
    div.className = 'card-name';
    div.textContent = ejercicio.nombre;

    a.append(img, div);
    return a;
}

function mostrarVacio(mensaje) {
    const div = document.createElement('div');
    div.className = 'empty-state';
    div.textContent = mensaje;
    contenedor.replaceWith(div);
}

/* ---------- Carga de datos ---------- */

/**
 * Devuelve la lista de máquinas/ejercicios.
 */
async function cargarMaquinas() {
    // desde un JSON estático.
    const ejerciciosDB = await loadExercises();

    const maquinas = ejerciciosDB.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    return maquinas;
    
    // Opción B (por defecto): desde localStorage, la misma clave que use sesion.js.
    // const raw = localStorage.getItem('ejercicios');
    // if (!raw) return [];
    // try {
    //     const data = JSON.parse(raw);
    //     return Array.isArray(data) ? data : [];
    // } catch {
    //     return [];
    // }
}

/* ---------- Inicialización ---------- */

(async function init() {
    try {
        const maquinas = await cargarMaquinas();

        if (!maquinas.length) {
            subtitulo.textContent = '';
            mostrarVacio('Todavía no hay máquinas registradas.');
            return;
        }

        subtitulo.textContent = `${maquinas.length} máquina${maquinas.length === 1 ? '' : 's'}`;

        const frag = document.createDocumentFragment();
        for (const m of maquinas) frag.appendChild(crearTarjeta(m));
        contenedor.appendChild(frag);
    } catch (err) {
        console.error('[estadisticas_lista]', err);
        mostrarVacio('No se pudieron cargar las máquinas.');
    }
})();