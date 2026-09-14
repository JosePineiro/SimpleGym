/* =========================================================
   progreso.html
   Evolución del peso estimado para una máquina concreta.
   - Máquina:  loadExercises()  →  ejercicios.json
   - Histórico: dbAll()          →  IndexedDB
   ========================================================= */

import { dbAll, loadExercises } from './database.js';

/* ---------------------------------------------------------
   Utilidades de normalización (locales).
   Si ya las tienes en un módulo compartido, bórralas aquí y
   añade el import correspondiente, p. ej.:
       import { normalizarFecha, resolverEjercicio } from './utils.js';
   --------------------------------------------------------- */

/** Convierte cualquier formato de fecha habitual a "YYYY-MM-DD". */
function normalizarFecha(valor) {
    if (!valor) return '';
    if (valor instanceof Date && !isNaN(valor)) {
        const y = valor.getFullYear();
        const m = String(valor.getMonth() + 1).padStart(2, '0');
        const d = String(valor.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    const s = String(valor).trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const d = new Date(s);
    if (!isNaN(d)) {
        const y = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${y}-${mm}-${dd}`;
    }
    return '';
}

/**
 * Devuelve el id de un ejercicio en formato string, sea cual
 * sea el nombre del campo en el JSON de ejercicios o en el
 * registro normalizado.
 */
function idDeEjercicio(e) {
    if (e === null || e === undefined) return '';
    if (typeof e !== 'object') return String(e);
    const v =
        e.id            ??
        e.id_ejercicio  ??
        e.idEjercicio   ??
        e.ID            ??
        e.Id            ??
        '';
    return String(v);
}

/**
 * Devuelve SIEMPRE el id en formato string.
 * (Si tu helper original devolvía el nombre, reemplázalo por este.)
 */
function resolverEjercicio(valor) {
    return idDeEjercicio(valor);
}

/** Normaliza una fila cruda de IndexedDB al formato interno. */
function normalizarFila(r) {
    return {
        fecha: normalizarFecha(r.fecha ?? r.Fecha ?? r.date ?? r.Date ?? ''),
        ejercicio: resolverEjercicio(
            r.id_ejercicio  ?? r.idEjercicio  ??
            r.id            ?? r.ID           ?? r.Id ??
            r.ejercicio     ?? r.Ejercicio    ??
            r.nombre        ?? r.Nombre       ?? ''
        ),
        peso: Number(r.peso ?? r.Peso ?? r.weight ?? 0) || 0,
        repeticiones: Number(
            r.repeticiones ?? r.reps ?? r.Repeticiones ?? r.Reps ?? 0
        ) || 0,
        sesion: (() => {
            const s = r.sesion ?? r.Sesion ?? r['sesión'] ?? r.session ?? '';
            return s === '' ? null : (Number(s) || null);
        })(),
    };
}

/** Carga el histórico desde IndexedDB ya normalizado. */
async function cargarHistorial() {
    try {
        const arr = await dbAll();
        if (!Array.isArray(arr)) return [];
        return arr
            .map(normalizarFila)
            .filter((r) => r.fecha && r.ejercicio);
    } catch (err) {
        console.error('[progreso] Error leyendo IndexedDB:', err);
        return [];
    }
}

/* ---------- Registro del plugin de zoom (por si el UMD no lo hizo) ---------- */
if (window.ChartZoom && !window.Chart.registry.plugins.get('zoom')) {
    window.Chart.register(window.ChartZoom);
}

/* ---------- Contexto ---------- */
const params    = new URLSearchParams(location.search);
const idMaquina = params.get('id');

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

/* =========================================================
   Utilidades de formato
   ========================================================= */
const fmtFecha = (d) =>
    `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

const fmtFechaCorta = (d) =>
    `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;

const fmtPeso = (n) => (Number.isFinite(n) ? `${n.toFixed(1)} kg` : '—');

/** Acepta "YYYY-MM-DD", "DD/MM/YYYY" o cualquier cadena válida para Date. */
function parseFecha(str) {
    if (!str) return null;
    if (str instanceof Date) return isNaN(str) ? null : str;
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    const d = new Date(str);
    return isNaN(d) ? null : d;
}

/* =========================================================
   Cálculo del peso estimado
   ---------------------------------------------------------
   estimado = peso + (incremento_peso / (rep_max - rep_min))
                     * (reps - rep_min)

   Ej.: peso=100, reps=11, inc=5, rep_min=10, rep_max=12
        → 100 + (5 / 2) * 1 = 102.5
   ========================================================= */
function calcularPesoEstimado(peso, reps, maquina) {
    const pesoN = Number(peso);
    if (!Number.isFinite(pesoN)) return NaN;

    const inc   = Number(maquina.incremento_peso) || 0;
    const rMin  = Number(maquina.repeticiones_minimas);
    const rMax  = Number(maquina.repeticiones_maximas);
    const repsN = Number(reps);

    const rango = rMax - rMin;
    if (!Number.isFinite(rango) || rango <= 0 || !Number.isFinite(repsN)) {
        return pesoN; // sin datos suficientes: usamos el peso real
    }

    return pesoN + (inc / rango) * (repsN - rMin);
}

/* =========================================================
   Construcción de la serie temporal
   ========================================================= */
function construirPuntos(maquina, historial) {
    const idBuscado = idDeEjercicio(maquina);

    return historial
        .filter((r) => idDeEjercicio(r.ejercicio) === idBuscado)
        .map((r) => {
            const fecha = parseFecha(r.fecha);
            if (!fecha) return null;

            const peso = Number(r.peso);
            const reps = Number(r.repeticiones);

            return {
                fecha,
                peso,
                reps,
                sesion: r.sesion,
                estimado: calcularPesoEstimado(peso, reps, maquina),
            };
        })
        .filter(Boolean)
        .filter((p) => Number.isFinite(p.estimado))
        .sort((a, b) => a.fecha - b.fecha);
}

/* =========================================================
   Render
   ========================================================= */
function mostrarVacio(msg) {
    els.resumen.textContent = msg;
    els.canvas.parentElement.style.display = 'none';   // .chart-wrap
    els.hint.style.display     = 'none';
    els.actions.style.display  = 'none';
    els.stats.innerHTML = '';
}

function renderResumen(maquina, puntos) {
    const u = puntos[puntos.length - 1];
    const reps = Number.isFinite(u.reps) ? `${u.reps} reps` : '—';
    els.resumen.textContent =
        `${puntos.length} sesión${puntos.length === 1 ? '' : 'es'} · ` +
        `Última: ${fmtFecha(u.fecha)} — ${fmtPeso(u.estimado)} ` +
        `(${reps} @ ${u.peso} kg)`;
}

function renderStats(puntos) {
    const primero = puntos[0];
    const ultimo  = puntos[puntos.length - 1];
    const mejor   = puntos.reduce(
        (acc, p) => (p.estimado > acc.estimado ? p : acc),
        puntos[0]
    );

    const items = [
        { label: 'Sesiones', value: String(puntos.length) },
        { label: 'Primera',  value: fmtFecha(primero.fecha) },
        { label: 'Última',   value: fmtFecha(ultimo.fecha) },
        { label: 'Actual',   value: fmtPeso(ultimo.estimado) },
        { label: 'Mejor',    value: fmtPeso(mejor.estimado) },
    ];

    els.stats.innerHTML = items
        .map((i) => `<div><span>${i.label}</span><strong>${i.value}</strong></div>`)
        .join('');
}

/* =========================================================
   Gráfico (Chart.js + zoom/pan) — solo peso estimado
   ========================================================= */
/* =========================================================
   Gráfico (Chart.js + zoom/pan) — solo peso estimado
   ========================================================= */
function crearGrafico(puntos) {
    if (chart) { chart.destroy(); chart = null; }

    const dataEstimado = puntos.map((p) => ({ x: p.fecha.getTime(), y: p.estimado }));

    chart = new Chart(els.canvas, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Peso estimado',   // se mantiene por accesibilidad interna
                    data: dataEstimado,
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
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 400 },
            interaction: { mode: 'index', intersect: false },

            plugins: {
                legend: {
                    display: false,          // sin leyenda
                },

                tooltip: {
                    callbacks: {
                        title: (items) => {
                            const t = items[0]?.parsed?.x;
                            return t ? fmtFecha(new Date(t)) : '';
                        },
                        label: (item) => {
                            const p = puntos[item.dataIndex];
                            if (!p) return '';
                            const reps = Number.isFinite(p.reps) ? p.reps : '—';
                            return `Estimado: ${fmtPeso(p.estimado)} (${reps} reps @ ${p.peso} kg)`;
                        },
                    },
                },

                zoom: {
                    pan: {
                        enabled: true,
                        mode: 'x',
                        threshold: 8,
                    },
                    zoom: {
                        wheel: { enabled: true, speed: 0.08 },
                        pinch: { enabled: true },
                        mode: 'x',
                    },
                    limits: {
                        x: {
                            min: 'original',
                            max: 'original',
                            minRange: 24 * 60 * 60 * 1000, // máx. zoom = 1 día visible
                        },
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
                        callback: (v) => fmtFechaCorta(new Date(v)),
                    },
                    grid: { color: 'rgba(0, 0, 0, 0.05)' },
                },
                y: {
                    title: { display: true, text: 'Peso (kg)' },
                    beginAtZero: false,
                    ticks: { callback: (v) => `${v}` },
                    grid: { color: 'rgba(0, 0, 0, 0.05)' },
                },
            },
        },
    });
}


/* =========================================================
   Inicialización
   ========================================================= */
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

    console.log('[progreso] id solicitado:', idMaquina);
    console.log('[progreso] ejercicios cargados:', ejercicios);
    console.log('[progreso] registros de historial:', historial.length);

    const maquina = (Array.isArray(ejercicios) ? ejercicios : [])
        .find((e) => idDeEjercicio(e) === String(idMaquina));

    if (!maquina) {
        els.titulo.textContent = `Máquina ${idMaquina}`;
        mostrarVacio(`No se encontró la máquina con id "${idMaquina}".`);
        return;
    }

    const nombre = maquina.nombre || maquina.Nombre || `Máquina ${idMaquina}`;
    els.titulo.textContent = nombre;
    document.title = `SIMPLEGYM - ${nombre}`;

    const puntos = construirPuntos(maquina, historial);

    if (!puntos.length) {
        mostrarVacio(`Sin registros para ${nombre}.`);
        return;
    }

    renderResumen(maquina, puntos);
    renderStats(puntos);
    crearGrafico(puntos);
})();

/* =========================================================
   Botón «Reiniciar zoom»
   ========================================================= */
els.reset.addEventListener('click', () => {
    if (chart && typeof chart.resetZoom === 'function') chart.resetZoom();
});