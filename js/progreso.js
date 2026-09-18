/* =========================================================
   progreso.html
   Evolución del peso estimado para una máquina concreta.
   ========================================================= */

import { dbAll, loadExercises } from './database.js';

/* ---------- Utilidades ---------- */
const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function normalizarFila(r) {
    if (!(r.date instanceof Date) || isNaN(r.date)) return null;
    return {
        fecha: toISO(r.date),
        exId: r.exId,
        peso: r.weight,
        reps: r.reps,
        sesion: r.session
    };
}

async function cargarHistorial() {
    try {
        const arr = await dbAll();
        if (!Array.isArray(arr)) return [];
        return arr.map(normalizarFila).filter(Boolean);
    } catch (err) {
        console.error('[progreso] Error leyendo IndexedDB:', err);
        return [];
    }
}

/* ---------- Chart zoom (por si el UMD no lo registró) ---------- */
if (window.ChartZoom && !window.Chart.registry.plugins.get('zoom')) {
    window.Chart.register(window.ChartZoom);
}

/* ---------- Contexto ---------- */
const idMaquina = new URLSearchParams(location.search).get('id');

const els = {
    titulo:  document.getElementById('tituloMaquina'),
    resumen: document.getElementById('resumenMaquina'),
    canvas:  document.getElementById('grafico'),
    hint:    document.getElementById('chartHint'),
    actions: document.getElementById('chartActions'),
    stats:   document.getElementById('statsRow'),
    reset:   document.getElementById('btnResetZoom'),
};

let chart = null;

/* ---------- Formato ---------- */
const fmtFecha = d =>
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

const fmtFechaCorta = d =>
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`;

const fmtPeso = n => (Number.isFinite(n) ? `${n.toFixed(1)} kg` : '—');

function parseISO(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
}

/* ---------- Peso estimado ---------- */
function calcularPesoEstimado(peso, reps, maquina) {
    const inc  = Number(maquina.incremento_peso) || 0;
    const rMin = Number(maquina.repeticiones_minimas);
    const rMax = Number(maquina.repeticiones_maximas);
    const rango = rMax - rMin;

    if (!Number.isInteger(rango) || rango <= 0 || !Number.isInteger(reps)) {
        return peso;
    }

    const progreso = Math.min(Math.max(reps - rMin, 0), rango);
    peso += (inc / (rango + 1)) * progreso;

    return Number(peso.toFixed(1));
}

/* ---------- Serie temporal ---------- */
function construirPuntos(maquina, historial) {
    const idBuscado = maquina.id;

    return historial
        .filter(r => r.exId === idBuscado)
        .map(r => {
            const fecha = parseISO(r.fecha);
            const estimado = calcularPesoEstimado(r.peso, r.reps, maquina);
            if (!Number.isFinite(estimado)) return null;
            return {
                fecha,
                peso: r.peso,
                reps: r.reps,
                sesion: r.sesion,
                estimado
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.fecha - b.fecha);
}

/* ---------- Render ---------- */
function mostrarVacio(msg) {
    els.resumen.textContent = msg;
    els.canvas.parentElement.style.display = 'none';
    els.hint.style.display    = 'none';
    els.actions.style.display = 'none';
    els.stats.innerHTML = '';
}

function renderResumen(puntos) {
    const u = puntos[puntos.length - 1];
    els.resumen.textContent = `Última: ${fmtFecha(u.fecha)} → ${u.peso} kg / ${u.reps} reps`;
}

function renderStats(puntos) {
    const primero = puntos[0];
    const ultimo  = puntos[puntos.length - 1];
    const mejor   = puntos.reduce((acc, p) => (p.estimado > acc.estimado ? p : acc), puntos[0]);

    els.stats.innerHTML = [
        { label: 'Sesiones', value: String(puntos.length) },
        { label: 'Primera',  value: fmtFecha(primero.fecha) },
        { label: 'Última',   value: fmtFecha(ultimo.fecha) },
        { label: 'Actual',   value: fmtPeso(ultimo.estimado) },
        { label: 'Mejor',    value: fmtPeso(mejor.estimado) },
    ].map(i => `<div><span>${i.label}</span><strong>${i.value}</strong></div>`).join('');
}

/* ---------- Gráfico ---------- */
function crearGrafico(puntos) {
    if (chart) { chart.destroy(); chart = null; }

    const data = puntos.map(p => ({ x: p.fecha.getTime(), y: p.estimado }));

    chart = new Chart(els.canvas, {
        type: 'line',
        data: {
            datasets: [{
                label: 'Peso estimado',
                data,
                borderColor: '#007bff',
                backgroundColor: 'rgba(0, 123, 255, 0.12)',
                borderWidth: 2.5,
                tension: 0.25,
                pointRadius: 3,
                pointHoverRadius: 6,
                pointBackgroundColor: '#007bff',
                pointBorderColor: '#fff',
                pointBorderWidth: 1.5,
                fill: true,
                spanGaps: true,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 400 },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: items => {
                            const t = items[0]?.parsed?.x;
                            return t ? fmtFecha(new Date(t)) : '';
                        },
                        label: item => {
                            const p = puntos[item.dataIndex];
                            if (!p) return '';
                            return `Estimado: ${fmtPeso(p.estimado)} (${p.reps} reps @ ${p.peso} kg)`;
                        },
                    },
                },
                zoom: {
                    pan:  { enabled: true, mode: 'x', threshold: 8 },
                    zoom: {
                        wheel: { enabled: true, speed: 0.08 },
                        pinch: { enabled: true },
                        mode: 'x',
                    },
                    limits: {
                        x: { min: 'original', max: 'original', minRange: 24 * 60 * 60 * 1000 },
                    },
                },
            },
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: 'Fecha' },
                    ticks: {
                        autoSkip: true,
                        maxTicksLimit: 6,
                        maxRotation: 0,
                        callback: v => fmtFechaCorta(new Date(v)),
                    },
                    grid: { color: 'rgba(0,0,0,0.05)' },
                },
                y: {
                    title: { display: true, text: 'Peso (kg)' },
                    beginAtZero: false,
                    ticks: { callback: v => fmtPeso(v) },
                    grid: { color: 'rgba(0,0,0,0.05)' },
                },
            },
        },
    });
}

/* ---------- Init ---------- */
(async function init() {
    if (!idMaquina) {
        els.titulo.textContent = 'Máquina no especificada';
        mostrarVacio('Falta el parámetro ?id= en la URL.');
        return;
    }

    let ejercicios = [];
    let historial  = [];

    try {
        [ejercicios, historial] = await Promise.all([
            loadExercises(),
            cargarHistorial(),
        ]);
    } catch (err) {
        console.error('[progreso] Error cargando datos:', err);
    }

    const maquina = (Array.isArray(ejercicios) ? ejercicios : [])
        .find(e => e.id == idMaquina); 

    if (!maquina) {
        els.titulo.textContent = `Máquina ${idMaquina}`;
        mostrarVacio(`No se encontró la máquina con id "${idMaquina}".`);
        return;
    }

    const nombre = maquina.nombre || `Máquina ${idMaquina}`;
    els.titulo.textContent = nombre;
    document.title = `SIMPLEGYM - ${nombre}`;

    const puntos = construirPuntos(maquina, historial);

    if (!puntos.length) {
        mostrarVacio(`Sin registros para ${nombre}.`);
        return;
    }

    renderResumen(puntos);
    renderStats(puntos);
    crearGrafico(puntos);
})();

els.reset.addEventListener('click', () => {
    if (chart?.resetZoom) chart.resetZoom();
});