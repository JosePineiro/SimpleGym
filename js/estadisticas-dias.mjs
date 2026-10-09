import { cargarEjercicios, cargarHistorial } from "./database.mjs";
import { epley, formatearFecha, formatearNumero, setText } from "./utils.mjs";

let ejerciciosPorId = new Map();
let fechaActual = new Date();
let diaSeleccionado = null; // timestamp (medianoche local)
const cacheDias = new Map(); // clave: timestamp, valor: { estado, regs, sesion, detalles }

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const ETIQUETA_ESTADO = {
	none: "sin entrenamiento",
	some: "algo de ejercicio",
	all: "sesión completa",
	best: "sesión completa con progreso",
};

/* ---------- Utilidades de fecha ---------- */

// Las fechas del historial ya son Date a medianoche LOCAL (ver diasAFecha en
// database.mjs). Su getTime() coincide con el de new Date(y, m, d) para el
// mismo día, así que lo usamos como clave sin ninguna conversión de formato.
const claveDe = (year, month, day) => new Date(year, month, day).getTime();
const claveHoy = () => new Date().setHours(0, 0, 0, 0);

/* ---------- Cálculo de días ---------- */

function construirCache(historial) {
	cacheDias.clear();

	const ultimoPorEj = new Map(); // último mejor registro por ejercicio

	let i = 0;
	while (i < historial.length) {
		// Agrupar los registros consecutivos que comparten fecha.
		const clave = +historial[i].fecha;
		const regs = [];

		while (i < historial.length && +historial[i].fecha === clave) {
			regs.push(historial[i]);
			i++;
		}

		/* 1) Mejor serie del día por ejercicio (mayor 1RM estimado). */
		const mejorPorEj = new Map();
		for (const r of regs) {
			const prev = mejorPorEj.get(r.idEjercicio);
			if (!prev || epley(r.peso, r.repeticiones) > epley(prev.peso, prev.repeticiones)) {
				mejorPorEj.set(r.idEjercicio, r);
			}
		}

		/* 2) Detectar mejoras y descensos. Solo cuenta como "progreso" un "up". */
		const detalles = new Map();
		let hayProgreso = false;

		for (const [exId, r] of mejorPorEj) {
			const ant = ultimoPorEj.get(exId);
			if (!ant) continue;

			const actual = epley(r.peso, r.repeticiones);
			const anterior = epley(ant.peso, ant.repeticiones);
			const tipo = actual > anterior ? "up" : actual < anterior ? "down" : null;

			if (tipo) {
				detalles.set(exId, { antes: ant, ahora: r, tipo });
				if (tipo === "up") hayProgreso = true;
			}
		}

		/* 3) Sesión y completitud */
		const { numeroSesion, totalEjercicios } = regs[0];
		const ejerciciosRealizados = new Set(regs.map((r) => r.idEjercicio)).size;
		const sesionCompleta = ejerciciosRealizados >= totalEjercicios;

		/* 4) Estado del día */
		const estado = !sesionCompleta ? "some" : hayProgreso ? "best" : "all";

		cacheDias.set(clave, { estado, regs, sesion: numeroSesion, detalles });

		/* 5) Actualizar últimos valores */
		for (const [exId, r] of mejorPorEj) {
			ultimoPorEj.set(exId, r);
		}
	}
}

function infoDia(clave) {
	return (
		cacheDias.get(clave) || {
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
	return (
		fecha.getFullYear() > hoy.getFullYear() ||
		(fecha.getFullYear() === hoy.getFullYear() && fecha.getMonth() > hoy.getMonth())
	);
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
	const y = mes.getFullYear();
	const m = mes.getMonth();

	setText("cal-titulo", `${MESES[m]} ${y}`);
	grid.innerHTML = "";

	const primerDia = new Date(y, m, 1);
	let offset = primerDia.getDay() - 1;
	if (offset < 0) offset = 6;

	const diasEnMes = new Date(y, m + 1, 0).getDate();
	const hoy = claveHoy();

	for (let i = 0; i < offset; i++) {
		const c = document.createElement("div");
		c.className = "cal-day cal-day--empty";
		grid.appendChild(c);
	}

	for (let d = 1; d <= diasEnMes; d++) {
		const clave = claveDe(y, m, d);
		const { estado } = infoDia(clave);

		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = `cal-day cal-day--${estado}`;

		if (clave === hoy) btn.classList.add("cal-day--hoy");
		if (clave === diaSeleccionado) btn.classList.add("cal-day--sel");

		btn.textContent = d;
		btn.dataset.clave = clave;
		btn.setAttribute("aria-label", `${d} de ${MESES[m]} de ${y}: ${ETIQUETA_ESTADO[estado]}`);

		if (clave > hoy) {
			btn.disabled = true;
			btn.classList.add("btn-disabled");
			btn.setAttribute("aria-disabled", "true");
		} else {
			btn.addEventListener("click", () => {
				diaSeleccionado = clave;
				fechaActual = new Date(y, m, d);
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
	const hoy = claveHoy();

	const cuenta = { none: 0, some: 0, all: 0, best: 0 };

	for (let d = 1; d <= diasEnMes; d++) {
		const clave = claveDe(year, month, d);
		const est = infoDia(clave).estado;

		if (clave > hoy && est === "none") continue;

		cuenta[est]++;
	}

	setText("descanso", cuenta.none);
	setText("parcial", cuenta.some);
	setText("completo", cuenta.all);
	setText("progreso", cuenta.best);
}

/* ---------- Detalle del día ---------- */

function renderDetalleDia(clave) {
	const { estado, regs, sesion, detalles } = infoDia(clave);
	const tarjetaDetalle = document.getElementById("tarjeta-detalle");

	if (estado === "none") {
		tarjetaDetalle.hidden = true;
		return;
	}
	tarjetaDetalle.hidden = false;

	const date = new Date(clave);
	setText("detalle-titulo", `Detalle del ${formatearFecha(date)}`);

	document.getElementById("detalle-texto").innerHTML =
		`Sesión: <strong>${sesion ?? "—"}</strong> · Estado: <strong>${ETIQUETA_ESTADO[estado]}</strong>`;

	document.getElementById("detalle-filas").innerHTML = regs
		.map((r) => {
			const nombre = ejerciciosPorId.get(Number(r.idEjercicio)) ?? String(r.idEjercicio);

			// Si no hay entrada en `detalles`, usamos el propio registro como "antes"
			// para que se muestre "=" en lugar de una flecha falsa.
			const antes = detalles.get(r.idEjercicio)?.antes ?? r;

			return `
				<tr>
					<td><a href="estadisticas-ejercicio.html?idEjercicio=${encodeURIComponent(r.idEjercicio)}">${nombre}</a></td>
					${getTD(antes.peso, r.peso, 1)}
					${getTD(antes.repeticiones, r.repeticiones, 0)}
					${getTD(epley(antes.peso, antes.repeticiones), epley(r.peso, r.repeticiones), 1)}
				</tr>
			`;
		})
		.join("");
}

const getTD = (anterior, actual, decimales) => {
	const flecha = anterior < actual ? "↑" : anterior > actual ? "↓" : "=";
	const tipo = anterior < actual ? "up" : anterior > actual ? "down" : "equal";
	return `<td class="numero">${formatearNumero(actual, decimales, decimales)}<span class="progreso-badge progreso-${tipo}">${flecha}</span></td>`;
};

/* ---------- Navegación ---------- */

function irMes(delta) {
	const destino = new Date(fechaActual.getFullYear(), fechaActual.getMonth() + delta, 1);
	if (delta > 0 && esMesFuturo(destino)) return;

	fechaActual = destino;

	const y = fechaActual.getFullYear();
	const m = fechaActual.getMonth();
	const inicioMes = claveDe(y, m, 1);
	const inicioSig = claveDe(y, m + 1, 1);

	const clavesDelMes = [...cacheDias.keys()].filter((c) => c >= inicioMes && c < inicioSig).sort((a, b) => a - b);
	diaSeleccionado = clavesDelMes.at(-1) ?? inicioMes;

	renderCalendario(fechaActual);
	renderResumenMes(fechaActual);
	renderDetalleDia(diaSeleccionado);
	actualizarNavegacion();
}

/* ---------- Init ---------- */

async function inicializar() {
	try {
		const [ejercicios, historial] = await Promise.all([cargarEjercicios(), cargarHistorial()]);
		if (historial.length === 0) {
			throw new Error(`No hay historial de entrenamiento`);
		}

		ejerciciosPorId = new Map(ejercicios.map((e) => [e.id, e.nombre]));
		construirCache(Array.isArray(historial) ? historial : []);

		diaSeleccionado = [...cacheDias.keys()].sort((a, b) => a - b).at(-1);
		fechaActual = new Date(diaSeleccionado);

		renderCalendario(fechaActual);
		renderResumenMes(fechaActual);
		renderDetalleDia(diaSeleccionado);
		actualizarNavegacion();

		document.getElementById("btn-mes-anterior").addEventListener("click", () => irMes(-1));
		document.getElementById("btn-mes-siguiente").addEventListener("click", () => irMes(+1));
		document.getElementById("main-container").hidden = false;
	} catch (error) {
		document.getElementById("main-container").hidden = true;
		setText("titulo", "Error");
		setText("subtitulo", error.message || "No se pudo cargar el historial.");
		console.error(error);
	}
}

inicializar();