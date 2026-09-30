import { cargarEjercicios, cargarRegistrosEjercicio } from "./database.mjs";

let ejerciciosPorId = new Map();
let fechaActual = new Date();
let diaSeleccionado = null; // ISO "YYYY-MM-DD"
const cacheDias = new Map();

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const ETIQUETA_ESTADO = {
	none: "sin entrenamiento",
	some: "algo de ejercicio",
	all: "sesión completa",
	best: "sesión completa con progreso",
};

function epley(peso, repeticiones) {
	if (repeticiones > 29) repeticiones = 30;
	return peso * (1 + repeticiones / 30);
}

/* ---------- Utilidades de fecha ---------- */

const pad = (n) => String(n).padStart(2, "0");
const toISO = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const parseISO = (iso) => {
	const [y, m, d] = iso.split("-").map(Number);
	return new Date(y, m - 1, d);
};

/* ---------- Historial ---------- */

/**
 * Adapta un registro de IndexedDB al formato interno.
 *
 * Formato actual de la BD (definido en database.mjs / importador del CSV):
 *   { idEjercicio, fecha, peso, repeticiones, numeroSeries, numeroSesion, totalEjercicios }
 */
function normalizarFila(r) {
	if (!r || !(r.fecha instanceof Date) || Number.isNaN(r.fecha.getTime())) {
		return null;
	}

	const exId = r.idEjercicio ?? r.exId;
	if (exId == null) return null;

	return {
		fecha: toISO(r.fecha),
		exId: Number(exId),
		weight: r.peso,
		reps: r.repeticiones,
		sesion: r.numeroSesion ?? r.sesion ?? r.session ?? null,
		totals: r.totalEjercicios ?? r.total_ejercicios ?? r.totals ?? null,
		sets: r.numeroSeries ?? r.series ?? r.sets,
	};
}

/* ---------- Cálculo de días ---------- */

function construirCache(historial) {
	// Agrupar por fecha ISO.
	const regsPorFecha = new Map();
	for (const r of historial) {
		if (!regsPorFecha.has(r.fecha)) regsPorFecha.set(r.fecha, []);
		regsPorFecha.get(r.fecha).push(r);
	}

	// Último registro por ejercicio (para detectar progreso).
	const ultimoPorEj = new Map();
	const fechas = [...regsPorFecha.keys()].sort();

	for (const iso of fechas) {
		const regs = regsPorFecha.get(iso);

		/* 1) Mejor serie del día por ejercicio */
		const mejorPorEj = new Map();
		for (const r of regs) {
			const prev = mejorPorEj.get(r.exId);
			if (!prev || r.weight > prev.weight || (r.weight === prev.weight && r.reps > prev.reps)) {
				mejorPorEj.set(r.exId, r);
			}
		}

		/* 2) Detectar mejoras y descensos */
		const detalles = new Map();
		for (const [exId, r] of mejorPorEj) {
			const ant = ultimoPorEj.get(exId);
			if (!ant) continue;

			const actual = epley(r.weight, r.reps);
			const anterior = epley(ant.weight, ant.reps);
			const tipo = actual > anterior ? "up" : actual < anterior ? "down" : null;

			if (tipo) {
				detalles.set(exId, {
					antes: { ...ant },
					ahora: { weight: r.weight, reps: r.reps },
					tipo,
				});
			}
		}

		/* 3) Sesión y completitud */
		const { sesion, totals } = regs[0];
		const ejerciciosRealizados = new Set(regs.map((r) => r.exId)).size;
		const sesionCompleta = totals != null ? ejerciciosRealizados >= totals : true;

		/* 4) Estado del día */
		const estado = !sesionCompleta ? "some" : detalles.size ? "best" : "all";

		cacheDias.set(iso, { estado, regs, sesion, detalles });

		/* 5) Actualizar últimos valores */
		for (const [exId, r] of mejorPorEj) {
			ultimoPorEj.set(exId, { weight: r.weight, reps: r.reps });
		}
	}
}

function infoDia(iso) {
	return (
		cacheDias.get(iso) || {
			estado: "none",
			regs: [],
			sesion: null,
			detalles: new Map(),
		}
	);
}

/* ---------- Navegación de meses ---------- */

function esMesFuturo(fecha) {
	const hoy = new Date();
	return fecha.getFullYear() > hoy.getFullYear() || (fecha.getFullYear() === hoy.getFullYear() && fecha.getMonth() > hoy.getMonth());
}

function actualizarNavegacion() {
	const btn = document.getElementById("btn-mes-siguiente");
	const siguiente = new Date(fechaActual.getFullYear(), fechaActual.getMonth() + 1, 1);
	const bloqueado = esMesFuturo(siguiente);

	btn.disabled = bloqueado;
	btn.classList.toggle("btn-disabled", bloqueado);
	btn.setAttribute("aria-disabled", String(bloqueado));
}

/* ---------- Render calendario ---------- */

function renderCalendario(mes) {
	const grid = document.getElementById("cal-grid");
	const titulo = document.getElementById("cal-titulo");

	const y = mes.getFullYear();
	const m = mes.getMonth();

	titulo.textContent = `${MESES[m]} ${y}`;
	grid.innerHTML = "";

	const primerDia = new Date(y, m, 1);
	let offset = primerDia.getDay() - 1;
	if (offset < 0) offset = 6;

	const diasEnMes = new Date(y, m + 1, 0).getDate();
	const hoy = toISO(new Date());

	for (let i = 0; i < offset; i++) {
		const c = document.createElement("div");
		c.className = "cal-day cal-day--empty";
		grid.appendChild(c);
	}

	for (let d = 1; d <= diasEnMes; d++) {
		const iso = toISO(new Date(y, m, d));
		const { estado } = infoDia(iso);

		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = `cal-day cal-day--${estado}`;

		if (iso === hoy) btn.classList.add("cal-day--hoy");
		if (iso === diaSeleccionado) btn.classList.add("cal-day--sel");

		btn.textContent = d;
		btn.dataset.fecha = iso;
		btn.setAttribute("aria-label", `${d} de ${MESES[m]} de ${y}: ${ETIQUETA_ESTADO[estado]}`);

		if (iso > hoy) {
			btn.disabled = true;
			btn.classList.add("btn-disabled");
			btn.setAttribute("aria-disabled", "true");
		} else {
			btn.addEventListener("click", () => {
				diaSeleccionado = iso;
				fechaActual = parseISO(iso);
				renderCalendario(fechaActual);
				renderDetalleDia(diaSeleccionado);
			});
		}

		grid.appendChild(btn);
	}

	const resto = grid.children.length % 7;
	if (resto) {
		for (let i = 0; i < 7 - resto; i++) {
			const c = document.createElement("div");
			c.className = "cal-day cal-day--empty";
			grid.appendChild(c);
		}
	}
}

/* ---------- Resumen mensual ---------- */

function renderResumenMes(mes) {
	const year = mes.getFullYear();
	const month = mes.getMonth();
	const diasEnMes = new Date(year, month + 1, 0).getDate();
	const hoy = toISO(new Date());

	const cuenta = { none: 0, some: 0, all: 0, best: 0 };

	for (let d = 1; d <= diasEnMes; d++) {
		const iso = toISO(new Date(year, month, d));
		const est = infoDia(iso).estado;

		if (iso > hoy && est === "none") continue;

		cuenta[est]++;
	}

	document.getElementById("descanso").textContent = cuenta.none;
	document.getElementById("parcial").textContent = cuenta.some;
	document.getElementById("completo").textContent = cuenta.all;
	document.getElementById("progreso").textContent = cuenta.best;
}

/* ---------- Detalle del día ---------- */

function renderDetalleDia(iso) {
	const { estado, regs, sesion, detalles } = infoDia(iso);
	const tarjetaDetalle = document.getElementById("tarjeta-detalle");

	if (estado === "none") {
		tarjetaDetalle.hidden = true;
		return;
	}
	tarjetaDetalle.hidden = false;

	const date = parseISO(iso);
	document.getElementById("detalle-titulo").textContent =
		`Detalle del ${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;

	document.getElementById("detalle-texto").innerHTML =
		`Sesión: <strong>${sesion ?? "—"}</strong> · Estado: <strong>${ETIQUETA_ESTADO[estado]}</strong>`;

	document.getElementById("detalle-filas").innerHTML = regs
		.map((r) => {
			const nombre = ejerciciosPorId.get(Number(r.exId)) ?? String(r.exId);

			// Si no hay entrada en `detalles`, usamos los valores actuales
			// como "antes" para que se muestre "=" en lugar de una flecha falsa.
			const det = detalles.get(r.exId);
			const antes = det?.antes ?? { weight: r.weight, reps: r.reps };

			return `
				<tr>
					<td><a href="estadisticas-ejercicio.html?idEjercicio=${encodeURIComponent(r.exId)}">${nombre}</a></td>
					${getTD(antes.weight, r.weight, 1)}
					${getTD(antes.reps, r.reps, 0)}
					${getTD(epley(antes.weight, antes.reps), epley(r.weight, r.reps), 1)}
				</tr>
			`;
		})
		.join("");
}

const getTD = (anterior, actual, decimales) => {
	const arrow = anterior < actual ? "↑" : anterior > actual ? "↓" : "=";
	const tipo = anterior < actual ? "up" : anterior > actual ? "down" : "equal";
	return `<td><span class="progreso-badge progreso-${tipo}">${arrow}</span> ${actual.toFixed(decimales)}</td>`;
};

/* ---------- Navegación ---------- */

function irMes(delta) {
	const destino = new Date(fechaActual.getFullYear(), fechaActual.getMonth() + delta, 1);
	if (delta > 0 && esMesFuturo(destino)) return;

	fechaActual = destino;

	const prefijo = `${fechaActual.getFullYear()}-${pad(fechaActual.getMonth() + 1)}-`;
	diaSeleccionado = [...cacheDias.keys()].filter((iso) => iso.startsWith(prefijo)).at(-1) ?? prefijo + "01";

	renderCalendario(fechaActual);
	renderResumenMes(fechaActual);
	renderDetalleDia(diaSeleccionado);
	actualizarNavegacion();
}

/* ---------- Init ---------- */

async function inicializar() {
	try {
		const [ejercicios, registrosEjercicio] = await Promise.all([cargarEjercicios(), cargarRegistrosEjercicio()]);
		if (registrosEjercicio.length === 0) {
			throw new Error(`No hay historial de entrenamiento`);
		}

		ejerciciosPorId = new Map(
			(Array.isArray(ejercicios) ? ejercicios : []).filter((e) => e.id != null).map((e) => [Number(e.id), e.nombre]),
		);

		const historial = (Array.isArray(registrosEjercicio) ? registrosEjercicio : [])
			.map(normalizarFila)
			.filter(Boolean)
			.sort((a, b) => a.fecha.localeCompare(b.fecha));

		construirCache(historial);

		diaSeleccionado = historial.at(-1)?.fecha ?? toISO(new Date());
		fechaActual = parseISO(diaSeleccionado);

		renderCalendario(fechaActual);
		renderResumenMes(fechaActual);
		renderDetalleDia(diaSeleccionado);
		actualizarNavegacion();

		document.getElementById("btn-mes-anterior").addEventListener("click", () => irMes(-1));
		document.getElementById("btn-mes-siguiente").addEventListener("click", () => irMes(+1));
	} catch (error) {
		console.error(error);
		titulo.textContent = "Error";
		subtitulo.textContent = error.message || "No se pudo cargar el historial.";
		document.getElementById("main-container").style.display = "none";
	}
}

inicializar();
