import { dbAll, loadExercises } from './database.js';

let ejercicios = [];
let ejerciciosPorId = new Map();
let historial = [];
let cacheDias = new Map();
let mesActual = new Date();
let diaSeleccionado = null;

/* ---------- Utilidades ---------- */
const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
};

const MESES = ['enero','febrero','marzo','abril','mayo','junio',
               'julio','agosto','septiembre','octubre','noviembre','diciembre'];

const ETIQUETA_ESTADO = {
    none: 'sin entrenamiento',
    some: 'algo de ejercicio',
    all:  'sesión completa',
    best: 'sesión completa con progreso'
};

function nombreEj(id) {
    return ejerciciosPorId.get(id)?.nombre ?? String(id);
}

function normalizarFila(r) {
    if (!(r.date instanceof Date) || isNaN(r.date)) return null;
    return {
        fecha: toISO(r.date),
        exId: r.exId,
        peso: r.weight,
        reps: r.reps,
        sesion: r.session,
        totals: r.totals,
        series: r.sets
    };
}

async function cargarHistorial() {
    try {
        const arr = await dbAll();
        if (!Array.isArray(arr)) return [];
        return arr.map(normalizarFila).filter(Boolean);
    } catch (err) {
        console.error('Error leyendo IndexedDB:', err);
        return [];
    }
}

/* ---------- Cálculo de días ---------- */

function construirCache() {
    cacheDias = new Map();
    if (!historial.length) return;

    // Agrupar por fecha
    const regsPorFecha = new Map();

    for (const r of historial) {
        if (!regsPorFecha.has(r.fecha)) {
            regsPorFecha.set(r.fecha, []);
        }

        regsPorFecha.get(r.fecha).push(r);
    }

    // Último registro por ejercicio
    const ultimoPorEj = new Map();

    const fechas = [...regsPorFecha.keys()].sort();

    for (const iso of fechas) {
        const regs = regsPorFecha.get(iso);

        // 1) Mejor serie del día por ejercicio
        const mejorPorEj = new Map();

        for (const r of regs) {
            const prev = mejorPorEj.get(r.exId);

            if (
                !prev ||
                r.peso > prev.peso ||
                (r.peso === prev.peso && r.reps > prev.reps)
            ) {
                mejorPorEj.set(r.exId, r);
            }
        }

        // 2) Detectar mejoras y descensos
        const detalles = new Map();

        for (const [exId, r] of mejorPorEj) {
            const ant = ultimoPorEj.get(exId);

            if (!ant) continue;

            const masPeso = r.peso > ant.peso;
            const menosPeso = r.peso < ant.peso;

            const masReps = r.reps > ant.reps;
            const menosReps = r.reps < ant.reps;

            let tipo = null;

            // El peso tiene prioridad
            if (masPeso) {
                tipo = 'up';
            } else if (menosPeso) {
                tipo = 'down';
            } else if (masReps) {
                tipo = 'up';
            } else if (menosReps) {
                tipo = 'down';
            }

            // Guardar cualquier cambio
            if (tipo) {
                detalles.set(exId, {
                    antes: { ...ant },
                    ahora: {
                        peso: r.peso,
                        reps: r.reps
                    },
                    tipo
                });
            }
        }

        // 3) Sesión y completitud
        // Todos los registros del día comparten sesión y `totals`
        const { sesion, totals } = regs[0];
        const sesionCompleta = new Set(regs.map(r => r.exId)).size >= totals;

        // 4) Estado del día
        const estado =
            !sesionCompleta
                ? 'some'
                : detalles.size
                    ? 'best'
                    : 'all';

        cacheDias.set(iso, {
            estado,
            regs,
            sesion,
            detalles
        });

        // 5) Actualizar últimos valores
        for (const [exId, r] of mejorPorEj) {
            ultimoPorEj.set(exId, {
                peso: r.peso,
                reps: r.reps
            });
        }
    }
}

function infoDia(iso) {
    return cacheDias.get(iso) || { estado: 'none', regs: [], sesion: null, detalles: new Map() };
}

/* ---------- Navegación de meses ---------- */
function esMesFuturo(f) {
    const h = new Date();
    return f.getFullYear() > h.getFullYear() || (f.getFullYear() === h.getFullYear() && f.getMonth() > h.getMonth());
}

function actualizarNavegacion() {
    const btn = document.getElementById('btnMesSiguiente');
    const siguiente = new Date(mesActual.getFullYear(), mesActual.getMonth() + 1, 1);
    const bloqueado = esMesFuturo(siguiente);

    btn.disabled = bloqueado;
    btn.classList.toggle('btn-disabled', bloqueado);
    btn.setAttribute('aria-disabled', String(bloqueado));
}

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
        btn.setAttribute('aria-label', `${d} de ${MESES[m]} de ${y}: ${ETIQUETA_ESTADO[estado]}`);

        if (iso > hoyISO) {
            btn.disabled = true;
            btn.classList.add('btn-disabled');
            btn.setAttribute('aria-disabled', 'true');
        } else {
            btn.addEventListener('click', () => seleccionarDia(iso));
        }

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
    titulo.textContent = `Detalle del ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
    const { estado, regs, sesion, detalles } = infoDia(iso);

    if (estado === 'none') {
        texto.textContent = 'No se registró entrenamiento este día.';
        cont.innerHTML = '';
        return;
    }

    texto.innerHTML =
        `Sesión: <strong>${sesion ?? '—'}</strong> · ` +
        `Estado: <strong>${ETIQUETA_ESTADO[estado]}</strong>`;

    const filas = regs.map(r => {
        const det = detalles.get(r.exId);
        let badge = '';
        if (det) {
            const partes = [];

            if (det.ahora.peso !== det.antes.peso) {
                partes.push(`${det.antes.peso}→${det.ahora.peso} kg`);
            }

            if (det.ahora.reps !== det.antes.reps) {
                partes.push(`${det.antes.reps}→${det.ahora.reps} reps`);
            }

            badge = ` <span class="progreso-badge progreso-${det.tipo}">${partes.join(' · ')}</span>`;
        }
        return `<tr>
            <td>${nombreEj(r.exId)}${badge}</td>
            <td>${r.series}</td>
            <td>${r.peso} kg</td>
            <td>${r.reps}</td>
        </tr>`;
    }).join('');

    cont.innerHTML = `
        <div class="table-wrap">
            <table>
                <thead>
                    <tr><th>Ejercicio</th><th>Series</th><th>Peso</th><th>Reps</th></tr>
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
    actualizarNavegacion();
}

/* ---------- Init ---------- */
function irMes(delta) {
    const destino = new Date(mesActual.getFullYear(), mesActual.getMonth() + delta, 1);
    if (delta > 0 && esMesFuturo(destino)) return;

    mesActual = destino;
    renderCalendario();
    renderResumen();
    actualizarNavegacion();
}

function bindUI() {
    document.getElementById('btnMesAnterior').addEventListener('click', () => irMes(-1));
    document.getElementById('btnMesSiguiente').addEventListener('click', () => irMes(+1));
}

async function init() {
    try {
        ejercicios = await loadExercises();
        ejerciciosPorId = new Map(ejercicios.filter(e => e.id != null).map(e => [Number(e.id), e]));
    } catch (err) {
        alert(`Error al procesar el iniciar: ${err?.message || err}`);
        return;
    }

    historial = (await cargarHistorial()).sort((a, b) => a.fecha.localeCompare(b.fecha));
    construirCache();

    const ultima = historial.at(-1)?.fecha;
    diaSeleccionado = ultima ?? toISO(new Date());
    mesActual = ultima ? parseISO(ultima) : new Date();

    renderTodo();
    bindUI();
}

init();