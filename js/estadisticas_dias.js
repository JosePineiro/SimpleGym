/* =========================================================
   estadisticas_dias.js — Calendario de días de entreno
   Fuente de datos: IndexedDB (store "historico") vía database.js
   Registros: { id, sesion, fecha, peso, repeticiones }
   ========================================================= */

import { dbAll } from './database.js';

const EJERCICIOS_URL = 'ejercicios.json';

let ejercicios = [];
let ejerciciosPorId = new Map();
let ejerciciosPorNombre = new Map();
let historial = [];
let cacheDias = new Map();
let mesActual = new Date();
let diaSeleccionado = null;

/* ---------- Utilidades ---------- */
const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseISO(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
}

const MESES = ['enero','febrero','marzo','abril','mayo','junio',
               'julio','agosto','septiembre','octubre','noviembre','diciembre'];

function normalizarFecha(s) {
    s = String(s ?? '').trim().replace(/^["']|["']$/g, '');
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
    if (m) {
        const y = m[3].length === 2 ? '20' + m[3] : m[3];
        return `${y}-${pad(m[2])}-${pad(m[1])}`;
    }
    return s;
}

/* Resuelve el nombre del ejercicio desde id numérico o desde nombre directo */
function resolverEjercicio(raw) {
    if (raw == null) return '';
    const s = String(raw).trim();
    if (!s) return '';
    if (/^\d+$/.test(s)) {
        const ej = ejerciciosPorId.get(Number(s));
        if (ej) return ej.nombre;
    }
    const porNombre = ejerciciosPorNombre.get(s.toLowerCase());
    return porNombre ? porNombre.nombre : s;
}

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
        })()
    };
}

/* ---------- Carga ---------- */
async function cargarEjercicios() {
    const res = await fetch(EJERCICIOS_URL);
    if (!res.ok) throw new Error('No se pudo cargar ejercicios.json');
    ejercicios = await res.json();
    ejerciciosPorId = new Map();
    ejerciciosPorNombre = new Map();
    for (const e of ejercicios) {
        ejerciciosPorId.set(Number(e.id), e);
        ejerciciosPorNombre.set(e.nombre.toLowerCase(), e);
    }
}

/* Carga el historial desde IndexedDB */
async function cargarHistorial() {
    try {
        const arr = await dbAll();
        if (!Array.isArray(arr)) return [];
        return arr
            .map(normalizarFila)
            .filter(r => r.fecha && r.ejercicio);
    } catch (err) {
        console.error('Error leyendo IndexedDB:', err);
        return [];
    }
}

/* ---------- Cálculo de días ---------- */
function construirCache() {
    cacheDias = new Map();
    if (!historial.length || !ejercicios.length) return;

    // 1) Agrupar registros por fecha (ordenados)
    const regsPorFecha = new Map();
    for (const r of [...historial].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
        if (!regsPorFecha.has(r.fecha)) regsPorFecha.set(r.fecha, []);
        regsPorFecha.get(r.fecha).push(r);
    }

    // 2) Ejercicios que componen cada sesión
    const sesiones = new Set();
    ejercicios.forEach(e => e.sesion.forEach(s => sesiones.add(s)));
    const ejerciciosDe = new Map();
    for (const s of sesiones) {
        ejerciciosDe.set(s, ejercicios.filter(e => e.sesion.includes(s)).map(e => e.nombre));
    }

    // 3) Recorrer fechas en orden manteniendo el último registro de cada ejercicio
    const ultimoPorEj = new Map();
    const fechas = [...regsPorFecha.keys()].sort();

    for (const iso of fechas) {
        const regs = regsPorFecha.get(iso);

        // --- Progreso ---
        const detalles = [];
        for (const r of regs) {
            const ant = ultimoPorEj.get(r.ejercicio);
            if (!ant) continue;
            const masPeso = r.peso > ant.peso;
            const masReps = r.repeticiones > ant.repeticiones;
            if (masPeso || masReps) {
                detalles.push({
                    ejercicio: r.ejercicio,
                    antes: { ...ant },
                    ahora: { peso: r.peso, repeticiones: r.repeticiones },
                    motivo: masPeso && masReps ? 'peso y reps'
                          : masPeso              ? 'peso'
                          :                        'repeticiones'
                });
            }
        }

        // --- Detectar sesión y si está completa ---
        const nombresHechos = new Set(regs.map(r => r.ejercicio));
        const sesionesRegs = new Set(regs.map(r => r.sesion).filter(s => s != null));
        const sesionCandidata = sesionesRegs.size === 1 ? [...sesionesRegs][0] : null;

        let sesionCompleta = false;
        let sesionDetectada = sesionCandidata;

        if (sesionCandidata != null) {
            const nombres = ejerciciosDe.get(sesionCandidata) || [];
            if (nombres.length && nombres.every(n => nombresHechos.has(n))) {
                sesionCompleta = true;
            }
        }

        if (!sesionCompleta) {
            let mejor = null, mejorPunt = -1;
            for (const s of sesiones) {
                const nombres = ejerciciosDe.get(s) || [];
                const punt = nombres.filter(n => nombresHechos.has(n)).length;
                if (punt > mejorPunt) { mejorPunt = punt; mejor = s; }
            }
            sesionDetectada = mejor;
        }

        // --- Estado del día ---
        let estado;
        if (sesionCompleta && detalles.length) estado = 'best';
        else if (sesionCompleta)                estado = 'all';
        else                                    estado = 'some';

        cacheDias.set(iso, { estado, regs, sesion: sesionDetectada, detalles });

        // Actualizar último registro por ejercicio
        for (const r of regs) {
            ultimoPorEj.set(r.ejercicio, {
                peso: r.peso,
                repeticiones: r.repeticiones
            });
        }
    }
}

function infoDia(iso) {
    return cacheDias.get(iso) ||
        { estado: 'none', regs: [], sesion: null, detalles: [] };
}

const ETIQUETA_ESTADO = {
    none: 'sin entrenamiento',
    some: 'algo de ejercicio',
    all:  'sesión completa',
    best: 'sesión completa con progreso'
};

/* ---------- Render calendario ---------- */
function renderCalendario() {
    const grid   = document.getElementById('calGrid');
    const titulo = document.getElementById('calTitulo');
    const y = mesActual.getFullYear();
    const m = mesActual.getMonth();

    titulo.textContent = `${MESES[m]} ${y}`;
    grid.innerHTML = '';

    const primerDia = new Date(y, m, 1);
    let offset = primerDia.getDay() - 1;
    if (offset < 0) offset = 6;

    const diasEnMes = new Date(y, m + 1, 0).getDate();
    const hoyISO = toISO(new Date());

    for (let i = 0; i < offset; i++) {
        const c = document.createElement('div');
        c.className = 'cal-day cal-day--empty';
        grid.appendChild(c);
    }

    for (let d = 1; d <= diasEnMes; d++) {
        const iso = toISO(new Date(y, m, d));
        const { estado } = infoDia(iso);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `cal-day cal-day--${estado}`;
        if (iso === hoyISO) btn.classList.add('cal-day--hoy');
        if (iso === diaSeleccionado) btn.classList.add('cal-day--sel');
        btn.textContent = d;
        btn.dataset.fecha = iso;
        btn.setAttribute('aria-label',
            `${d} de ${MESES[m]} de ${y}: ${ETIQUETA_ESTADO[estado]}`);
        btn.addEventListener('click', () => seleccionarDia(iso));
        grid.appendChild(btn);
    }

    const resto = grid.children.length % 7;
    if (resto) {
        for (let i = 0; i < 7 - resto; i++) {
            const c = document.createElement('div');
            c.className = 'cal-day cal-day--empty';
            grid.appendChild(c);
        }
    }
}

/* ---------- Resumen mensual ---------- */
function renderResumen() {
    const el = document.getElementById('calResumen');
    const y = mesActual.getFullYear();
    const m = mesActual.getMonth();
    const diasEnMes = new Date(y, m + 1, 0).getDate();
    const hoyISO = toISO(new Date());

    const cuenta = { none: 0, some: 0, all: 0, best: 0 };
    for (let d = 1; d <= diasEnMes; d++) {
        const iso = toISO(new Date(y, m, d));
        const est = infoDia(iso).estado;
        if (iso > hoyISO && est === 'none') continue;
        cuenta[est]++;
    }

    el.innerHTML = `
        <div><span>Sin entreno</span><strong>${cuenta.none}</strong></div>
        <div><span>Parcial</span><strong>${cuenta.some}</strong></div>
        <div><span>Completo</span><strong>${cuenta.all}</strong></div>
        <div><span>Con progreso</span><strong>${cuenta.best}</strong></div>
    `;
}

/* ---------- Detalle del día ---------- */
function seleccionarDia(iso) {
    diaSeleccionado = iso;
    renderCalendario();
    renderDetalle(iso);
}

function renderDetalle(iso) {
    const titulo = document.getElementById('detalleTitulo');
    const texto  = document.getElementById('detalleTexto');
    const cont   = document.getElementById('detalleContenido');

    const d = parseISO(iso);
    titulo.textContent =
        `Detalle · ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;

    const { estado, regs, sesion, detalles } = infoDia(iso);

    if (estado === 'none') {
        texto.textContent = 'No se registró entrenamiento este día.';
        cont.innerHTML = '';
        return;
    }

    texto.innerHTML =
        `Sesión detectada: <strong>${sesion ?? '—'}</strong> · ` +
        `Estado: <strong>${ETIQUETA_ESTADO[estado]}</strong>`;

    const filas = regs.map(r => {
        const det = detalles.find(x => x.ejercicio === r.ejercicio);
        let badge = '';
        if (det) {
            const partes = [];
            if (det.ahora.peso > det.antes.peso) {
                partes.push(`${det.antes.peso}→${det.ahora.peso} kg`);
            }
            if (det.ahora.repeticiones > det.antes.repeticiones) {
                partes.push(`${det.antes.repeticiones}→${det.ahora.repeticiones} reps`);
            }
            badge = ` <span class="progreso-badge">▲ ${partes.join(' · ')}</span>`;
        }
        return `<tr>
            <td>${r.ejercicio}${badge}</td>
            <td>${r.peso} kg</td>
            <td>${r.repeticiones}</td>
        </tr>`;
    }).join('');

    cont.innerHTML = `
        <div class="table-wrap">
            <table>
                <thead>
                    <tr><th>Ejercicio</th><th>Peso</th><th>Reps</th></tr>
                </thead>
                <tbody>${filas}</tbody>
            </table>
        </div>
    `;
}

/* ---------- Render general ---------- */
function renderTodo() {
    renderCalendario();
    renderResumen();
    if (diaSeleccionado) renderDetalle(diaSeleccionado);
}

/* ---------- Init ---------- */
async function init() {
    try {
        await cargarEjercicios();
    } catch (err) {
        // document.getElementById('origenDatos').textContent =
        //     'Error cargando ejercicios.json: ' + err.message;
        return;
    }

    historial = await cargarHistorial();
    cacheDias = new Map();
    construirCache();

    const fechas = historial.map(r => r.fecha).sort();
    if (fechas.length) {
        diaSeleccionado = fechas[fechas.length - 1];
        mesActual = parseISO(diaSeleccionado);
    } else {
        diaSeleccionado = toISO(new Date());
        mesActual = new Date();
    }

    renderTodo();

    document.getElementById('btnMesAnterior').addEventListener('click', () => {
        mesActual.setMonth(mesActual.getMonth() - 1);
        renderCalendario();
        renderResumen();
    });
    document.getElementById('btnMesSiguiente').addEventListener('click', () => {
        mesActual.setMonth(mesActual.getMonth() + 1);
        renderCalendario();
        renderResumen();
    });
    document.getElementById('btnHoy').addEventListener('click', () => {
        mesActual = new Date();
        diaSeleccionado = toISO(new Date());
        renderTodo();
    });
}

init();