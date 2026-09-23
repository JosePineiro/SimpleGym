import { dbAll, dbLoadExercises } from "./database.mjs";

let ejerciciosPorId = new Map();
let mesActual = new Date();
let diaSeleccionado = null; // Siempre en formato ISO "YYYY-MM-DD".
let cacheDias = new Map();

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const ETIQUETA_ESTADO = {
	none: "sin entrenamiento",
	some: "algo de ejercicio",
	all: "sesión completa",
	best: "sesión completa con progreso",
};

/* ---------- Utilidades de fecha ---------- */

/**
 * Convierte un Date a una fecha de negocio ISO local:  "YYYY-MM-DD"
 */
const pad = (n) => String(n).padStart(2, "0");
const toISO = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * Convierte una fecha de negocio ISO "YYYY-MM-DD" a un Date local.
 */
const parseISO = (iso) => {
	const [y, m, d] = iso.split("-").map(Number);
	return new Date(y, m - 1, d);
};

/* ---------- Historial ---------- */

function normalizarFila(r) {
	if (!(r.date instanceof Date) || Number.isNaN(r.date.getTime())) return null;

	return {
		fecha: toISO(r.date),
		exId: r.exId,
		weight: r.weight,
		reps: r.reps,
		sesion: r.session,
		totals: r.totals,
		sets: r.sets,
	};
}

/* ---------- Cálculo de días ---------- */

function construirCache(historial) {
	if (!historial.length) return;

	cacheDias = new Map();

	// Agrupar por fecha ISO.
	const regsPorFecha = new Map();

	for (const r of historial) {
		if (!regsPorFecha.has(r.fecha)) {
			regsPorFecha.set(r.fecha, []);
		}

		regsPorFecha.get(r.fecha).push(r);
	}

	// Último registro por ejercicio.
	const ultimoPorEj = new Map();

	// YYYY-MM-DD se puede ordenar directamente como texto porque su orden lexicográfico coincide con el cronológico.
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
		const epley = (peso, reps) => peso * (1 + reps / 30);
		const detalles = new Map();

		for (const [exId, r] of mejorPorEj) {
			const ant = ultimoPorEj.get(exId);

			if (!ant) continue;

			const actual = epley(r.weight, r.reps);
			const anterior = epley(ant.weight, ant.reps);
			const tipo = actual > anterior ? "up" : actual < anterior ? "down" : null;

			// Por volumen total (peso * reps) también se podría detectar progreso, pero es menos preciso que Epley.
			// let tipo = null;
			// if (r.weight * r.reps > ant.weight * ant.reps) {
			// 	tipo = "up";
			// } else if (r.weight * r.reps < ant.weight * ant.reps) {
			// 	tipo = "down";
			// }

			// Por peso y repeticiones también se podría detectar progreso, pero es menos preciso que Epley.
			// let tipo = null;
			// if (r.peso !== ant.peso) {
			// 	tipo = r.peso > ant.peso ? "up" : "down";
			// } else if (r.reps !== ant.reps) {
			// 	tipo = r.reps > ant.reps ? "up" : "down";
			// }

			// Guardar cualquier cambio.
			if (tipo) {
				detalles.set(exId, {
					antes: { ...ant },
					ahora: {
						weight: r.weight,
						reps: r.reps,
					},
					tipo,
				});
			}
		}

		/* 3) Sesión y completitud */

		// Todos los registros del día comparten sesión y totals.
		const { sesion, totals } = regs[0];
		const ejerciciosRealizados = new Set(regs.map((r) => r.exId)).size;
		const sesionCompleta = ejerciciosRealizados >= totals;

		/* 4) Estado del día */

		const estado = !sesionCompleta ? "some" : detalles.size ? "best" : "all";

		cacheDias.set(iso, {
			estado,
			regs,
			sesion,
			detalles,
		});

		/* 5) Actualizar últimos valores */

		for (const [exId, r] of mejorPorEj) {
			ultimoPorEj.set(exId, {
				weight: r.weight,
				reps: r.reps,
			});
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
	const btn = document.getElementById("btnMesSiguiente");
	const siguiente = new Date(mesActual.getFullYear(), mesActual.getMonth() + 1, 1);
	const bloqueado = esMesFuturo(siguiente);

	btn.disabled = bloqueado;
	btn.classList.toggle("btn-disabled", bloqueado);
	btn.setAttribute("aria-disabled", String(bloqueado));
}

/* ---------- Render calendario ---------- */

function renderCalendario(mes) {
	const grid = document.getElementById("calGrid");
	const titulo = document.getElementById("calTitulo");

	// Date solo se utiliza aquí para operaciones de calendario.
	const y = mes.getFullYear();
	const m = mes.getMonth();

	titulo.textContent = `${MESES[m]} ${y}`;
	grid.innerHTML = "";

	const primerDia = new Date(y, m, 1);

	let offset = primerDia.getDay() - 1;

	if (offset < 0) {
		offset = 6;
	}

	const diasEnMes = new Date(y, m + 1, 0).getDate();

	// Desde aquí trabajamos con ISO como identificador del día.
	const hoy = toISO(new Date());

	for (let i = 0; i < offset; i++) {
		const c = document.createElement("div");
		c.className = "cal-day cal-day--empty";
		grid.appendChild(c);
	}

	for (let d = 1; d <= diasEnMes; d++) {
		// Date para calcular el día, ISO para representar el día.
		const iso = toISO(new Date(y, m, d));
		const { estado } = infoDia(iso);

		const btn = document.createElement("button");

		btn.type = "button";
		btn.className = `cal-day cal-day--${estado}`;

		if (iso === hoy) {
			btn.classList.add("cal-day--hoy");
		}

		if (iso === diaSeleccionado) {
			btn.classList.add("cal-day--sel");
		}

		btn.textContent = d;
		btn.dataset.fecha = iso;

		btn.setAttribute("aria-label", `${d} de ${MESES[m]} de ${y}: ${ETIQUETA_ESTADO[estado]}`);

		// La comparación de fechas de negocio se hace directamente entre cadenas ISO.
		if (iso > hoy) {
			btn.disabled = true;
			btn.classList.add("btn-disabled");
			btn.setAttribute("aria-disabled", "true");
		} else {
			btn.addEventListener("click", () => {
				diaSeleccionado = iso; // diaSeleccionado SIEMPRE es ISO.
				mesActual = parseISO(iso); // Para renderizar el mes necesitamos Date.
				renderCalendario(mesActual);
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
	// Date solo para calcular la estructura del mes.
	const year = mes.getFullYear();
	const month = mes.getMonth();

	const diasEnMes = new Date(year, month + 1, 0).getDate();
	const hoy = toISO(new Date());

	const cuenta = {
		none: 0,
		some: 0,
		all: 0,
		best: 0,
	};

	for (let d = 1; d <= diasEnMes; d++) {
		const iso = toISO(new Date(year, month, d));
		const est = infoDia(iso).estado;

		if (iso > hoy && est === "none") {
			continue;
		}

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
	const detalle = document.getElementById("detalleDia");
	if (estado === "none") {
		detalle.hidden = true;
		return;
	}
	detalle.hidden = false;

	// Solo aquí necesitamos convertir ISO -> Date para extraer día/mes/año.
	const date = parseISO(iso);
	document.getElementById("detalleTitulo").textContent =
		`Detalle del ${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;

	document.getElementById("detalleTexto").innerHTML =
		`Sesión: <strong>${sesion}</strong> · Estado: <strong>${ETIQUETA_ESTADO[estado]}</strong>`;

	document.getElementById("detalleFilas").innerHTML = regs
		.map((r) => {
			const nombre = ejerciciosPorId.get(r.exId) ?? String(r.exId);
			const badge = crearBadge(detalles.get(r.exId));

			return `
			<tr>
				<td>${nombre}${badge}</td>
				<td>${r.sets}</td>
				<td>${r.weight}</td>
				<td>${r.reps}</td>
				<td>${r.sets * r.weight * r.reps}</td>
			</tr>
		`;
		})
		.join("");
}

function crearBadge(det) {
	if (!det) return "";

	if (det.ahora.weight !== det.antes.weight) {
		return `<span class="progreso-badge progreso-${det.tipo}">${det.antes.weight}→${det.ahora.weight} kg</span>`;
	}

	if (det.ahora.reps !== det.antes.reps) {
		return `<span class="progreso-badge progreso-${det.tipo}">${det.antes.reps}→${det.ahora.reps} reps</span>`;
	}

	return "";
}

/* ---------- Navegación ---------- */

function irMes(delta) {
	const destino = new Date(mesActual.getFullYear(), mesActual.getMonth() + delta, 1);

	if (delta > 0 && esMesFuturo(destino)) return;

	mesActual = destino;

	// Último día del mes con ejercicios. Si no hay ninguno, el primer día del mes.
	const prefijo = `${mesActual.getFullYear()}-${pad(mesActual.getMonth() + 1)}-`;
	diaSeleccionado = [...cacheDias.keys()].filter((iso) => iso.startsWith(prefijo)).at(-1) ?? prefijo + "01";

	renderCalendario(mesActual);
	renderResumenMes(mesActual);
	renderDetalleDia(diaSeleccionado);
	actualizarNavegacion();
}

/* ---------- Init ---------- */
async function init() {
	try {
		const [ejerciciosDB, historialEjercicios] = await Promise.all([dbLoadExercises(), dbAll()]);

		ejerciciosPorId = new Map(ejerciciosDB.filter((e) => e.id != null).map((e) => [Number(e.id), e.nombre]));

		const historial = (Array.isArray(historialEjercicios) ? historialEjercicios : [])
			.map(normalizarFila)
			.filter(Boolean)
			.sort((a, b) => a.fecha.localeCompare(b.fecha));

		construirCache(historial);

		diaSeleccionado = historial.at(-1)?.fecha ?? toISO(new Date());

		mesActual = parseISO(diaSeleccionado);

		renderCalendario(mesActual);
		renderResumenMes(mesActual);
		renderDetalleDia(diaSeleccionado);
		actualizarNavegacion();

		document.getElementById("btnMesAnterior").addEventListener("click", () => irMes(-1));

		document.getElementById("btnMesSiguiente").addEventListener("click", () => irMes(+1));
	} catch (err) {
		alert(`Error al iniciar: ${err?.message || err}`);
	}
}

init();
