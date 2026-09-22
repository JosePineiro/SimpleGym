import { dbAll, dbLoadExercises } from "./database.mjs";

const pad = (n) => String(n).padStart(2, "0");
const toISO = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const parseISO = (value) => {
	const [year, month, day] = value.split("-").map(Number);
	return new Date(year, month - 1, day);
};

const fmtFecha = (date) => `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
const fmtFechaCorta = (date) => `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${String(date.getFullYear()).slice(-2)}`;

const fmtNumero = (value) =>
	Number.isFinite(value)
		? value.toLocaleString("es-ES", {
				maximumFractionDigits: 2,
			})
		: "—";

/* ---------- Contexto ---------- */

const params = new URLSearchParams(location.search);
const sesion = Number(params.get("sesion"));

if (!Number.isInteger(sesion) || sesion <= 0) {
	alert("Error: la URL debe incluir 'sesion'.\nEj: progreso_esfuerzo.html?sesion=1");

	location.replace("estadisticas_sesiones.html");

	throw new Error("Parámetros de URL inválidos");
}

let chart = null;

/* ---------- Carga de datos ---------- */

async function cargarEsfuerzo() {
	const [historial, ejercicios] = await Promise.all([dbAll(), dbLoadExercises()]);

	const ejerciciosPorId = new Map((Array.isArray(ejercicios) ? ejercicios : []).map((ejercicio) => [ejercicio.id, ejercicio]));

	const porDia = new Map();

	for (const row of Array.isArray(historial) ? historial : []) {
		const normalizada = normalizarFila(row, ejerciciosPorId);

		if (!normalizada) continue;

		porDia.set(normalizada.fecha, (porDia.get(normalizada.fecha) || 0) + normalizada.esfuerzo);
	}

	return [...porDia.entries()]
		.map(([fecha, esfuerzo]) => ({
			fecha: parseISO(fecha),
			esfuerzo,
		}))
		.sort((a, b) => a.fecha - b.fecha);
}

/* ---------- Normalización ---------- */

function normalizarFila(row, ejerciciosPorId) {
	if (!(row.date instanceof Date) || Number.isNaN(row.date.getTime())) {
		return null;
	}

	const peso = Number(row.weight);
	const repeticiones = Number(row.reps);
	const sesionFila = Number(row.session);
	const ejercicio = ejerciciosPorId.get(row.exId);

	if (sesionFila !== sesion) return null;
	if (!ejercicio) return null;

	const series = Number(ejercicio.numero_series);

	if (!Number.isFinite(peso) || !Number.isFinite(series) || !Number.isFinite(repeticiones)) {
		return null;
	}

	return {
		fecha: toISO(row.date),
		esfuerzo: peso * series * repeticiones,
	};
}

/* ---------- Render ---------- */

function setText(id, text) {
	const element = document.getElementById(id);
	if (element) element.textContent = text;
}

function mostrarVacio(message) {
	setText("tituloSesion", message);
	document.getElementById("cardGrafico").style.display = "none";
	document.getElementById("cardStats").style.display = "none";
}

function renderStats(points) {
	if (!points.length) return;

	const first = points[0];
	const last = points[points.length - 1];
	const best = points.reduce((max, point) => (point.esfuerzo > max.esfuerzo ? point : max), first);
	const diff = last.esfuerzo - first.esfuerzo;
	const trend = points.length > 1 ? `${diff > 0 ? "+" : ""}${fmtNumero(diff)}` : "Primera sesión";
	setText("statEsfuerzoActual", fmtNumero(last.esfuerzo));
	setText("statMejorEsfuerzo", `${fmtNumero(best.esfuerzo)} el ${fmtFecha(best.fecha)}`);
	setText("statDias", String(points.length));
	setText("statTendencia", trend);
}

/* ---------- Gráfico ---------- */

function crearGrafico(points) {
	const data = points.map((point) => ({
		x: point.fecha.getTime(),
		y: point.esfuerzo,
	}));

	chart = new Chart(document.getElementById("grafico"), {
		type: "line",
		data: {
			datasets: [
				{
					// label: "Esfuerzo",
					data,
					borderColor: "#007bff",
					backgroundColor: "rgba(0, 123, 255, 0.12)",
					borderWidth: 2.5,
					tension: 0.25,
					pointRadius: 3,
					pointHoverRadius: 6,
					pointBackgroundColor: "#007bff",
					pointBorderColor: "#fff",
					pointBorderWidth: 1.5,
					fill: true,
					spanGaps: true,
				},
			],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			animation: false,
			interaction: {
				mode: "index",
				intersect: false,
			},
			plugins: {
				legend: { display: false },
				tooltip: {
					callbacks: {
						title: (items) => (items[0]?.parsed?.x ? fmtFecha(new Date(items[0].parsed.x)) : ""),
						label: (item) => `Esfuerzo: ${fmtNumero(item.parsed.y)}`,
					},
				},
				zoom: {
					pan: {
						enabled: true,
						mode: "x",
						threshold: 8,
					},
					zoom: {
						wheel: { enabled: true, speed: 0.08 },
						pinch: { enabled: true },
						mode: "x",
					},
				},
			},
			scales: {
				x: {
					type: "linear",
					ticks: {
						autoSkip: true,
						maxTicksLimit: 6,
						maxRotation: 0,
						callback: (value) => fmtFechaCorta(new Date(value)),
					},
					grid: { color: "rgba(0,0,0,0.05)" },
				},
				y: {
					beginAtZero: true,
					ticks: { callback: (value) => fmtNumero(value) },
					grid: { color: "rgba(0,0,0,0.05)" },
				},
			},
		},
	});
}

/* ---------- Inicialización ---------- */
async function init() {
	try {
		const points = await cargarEsfuerzo();

		setText("tituloSesion", `Sesión ${sesion}`);
		setText("subtituloSesion", `${points.length} día${points.length === 1 ? "" : "s"} registrado${points.length === 1 ? "" : "s"}`);

		if (!points.length) {
			mostrarVacio(`${nombre} sin histórico.`);
		} else {
			crearGrafico(points);
			renderStats(points);
		}
	} catch (error) {
		console.error("[progreso_esfuerzo]", error);

		mostrarVacio("No se pudo cargar el esfuerzo.");
	}
}

init();
