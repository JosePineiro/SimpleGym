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

/* ---------- Carga de datos ---------- */

async function cargarVolumen() {
	const [historial, ejercicios] = await Promise.all([dbAll(), dbLoadExercises()]);

	const ejerciciosPorId = new Map((Array.isArray(ejercicios) ? ejercicios : []).map((ejercicio) => [ejercicio.id, ejercicio]));

	const porDia = new Map();

	for (const row of Array.isArray(historial) ? historial : []) {
		const normalizada = normalizarFila(row, ejerciciosPorId);

		if (!normalizada) continue;

		porDia.set(normalizada.fecha, (porDia.get(normalizada.fecha) || 0) + normalizada.volumen);
	}

	return [...porDia.entries()]
		.map(([fecha, volumen]) => ({
			fecha: parseISO(fecha),
			volumen,
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
		volumen: peso * series * repeticiones,
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

	const n = points.length;
	const best = points.reduce((max, point) => (point.volumen > max.volumen ? point : max), points[0]);
	const last = points[n - 1];
	// Media móvil de las últimas 3 sesiones (o menos si no hay)
	const ultimas = points.slice(-3);
	const mediaReciente = ultimas.reduce((s, p) => s + p.volumen, 0) / ultimas.length;

	// Tendencia: pendiente por regresión lineal
	let tendencia = "Primera sesión";
	if (n > 1) {
		let sumX = 0,
			sumY = 0,
			sumXY = 0,
			sumXX = 0;
		points.forEach((p, i) => {
			sumX += i;
			sumY += p.volumen;
			sumXY += i * p.volumen;
			sumXX += i * i;
		});
		const m = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
		tendencia = `${m >= 0 ? "+" : ""}${fmtNumero(m)} kg/sesión`;
	}

	setText("statVolumenActual", fmtNumero(mediaReciente));
	setText("statMejorVolumen", `${fmtNumero(best.volumen)} el ${fmtFechaCorta(best.fecha)}`);
	setText("prSesion", `${fmtNumero((last.volumen / best.volumen) * 100, 1)}%`);
	setText("statTendencia", tendencia);
}

/* ---------- Gráfico ---------- */

function crearGrafico(points) {
	const data = points.map((point) => ({
		x: point.fecha.getTime(),
		y: point.volumen,
	}));

	new Chart(document.getElementById("grafico"), {
		type: "line",
		data: {
			datasets: [
				{
					// label: "Volumen",
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
					displayColors: false,
					callbacks: {
						title: (items) => fmtFecha(new Date(items[0].parsed.x)),
						label: (item) => `Volumen: ${fmtNumero(item.parsed.y)}`,
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
		const points = await cargarVolumen();

		setText("tituloSesion", `Sesión ${sesion}`);
		setText("subtituloSesion", `${points.length} ${points.length === 1 ? "sesión registrada" : "sesiones registradas"}`);

		if (!points.length) {
			document.getElementById("cardGrafico").style.display = "none";
			document.getElementById("cardStats").style.display = "none";
		} else {
			crearGrafico(points);
			renderStats(points);
		}
	} catch (error) {
		console.error("[progreso_volumen]", error);

		mostrarVacio("No se pudo cargar el volumen.");
	}
}

init();
