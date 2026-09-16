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
 * Reutiliza las clases .card / .card-name de styles.css
 * (las mismas que usa la rejilla de sesion.html).
 */
function crearTarjeta(ejercicio) {
    const a = document.createElement('a');
    a.className = 'card';
    a.href = `progreso.html?id=${encodeURIComponent(ejercicio.id)}`;
    a.setAttribute('aria-label', `Ver progreso de ${ejercicio.nombre}`);

    const img = document.createElement('img');
    img.src = ejercicio.imagen || IMG_PLACEHOLDER;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => { img.style.visibility = 'hidden'; });

    const nombre = document.createElement('div');
    nombre.className = 'card-name';
    nombre.textContent = ejercicio.nombre;

    a.append(img, nombre);
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
 *
 * Se puede ajustar para leer desde localStorage
 *
 * Formato esperado: Array<{ id: string, nombre: string, imagen?: string }>
 */
async function cargarMaquinas() {
    // Opción A: desde un JSON estático.
    const res = await fetch('ejercicios.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('No se pudo cargar la lista de ejercicios');
    const maquinas = await res.json();
    return maquinas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    // return res.json();

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