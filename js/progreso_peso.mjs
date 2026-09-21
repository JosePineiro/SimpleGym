/* =========================================================
   progreso.html
   Evolución del peso estimado para una máquina concreta.
   ========================================================= */
import { dbAll, dbLoadExercises } from "./database.mjs";

/* ---------- Utilidades ---------- */
const pad = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function normalizarFila(r) {
	if (!(r.date instanceof Date) || Number.isNaN(r.date.getTime())) return null;
	return {
		fecha: toISO(r.date),
		exId: r.exId,
		peso: r.weight,
		reps: r.reps,
		sesion: r.session,
	};
}

async function cargarHistorial() {
	try {
		const arr = await dbAll();
		if (!Array.isArray(arr)) return [];
		return arr.map(normalizarFila).filter(Boolean);
	} catch (err) {
		console.error("[progreso] Error leyendo IndexedDB:", err);
		return [];
	}
}

/* ---------- Chart zoom (por si el UMD no lo registró) ---------- */
if (window.ChartZoom && !window.Chart.registry.plugins.get("zoom")) {
	window.Chart.register(window.ChartZoom);
}

/* ---------- Contexto ---------- */
const params = new URLSearchParams(location.search);
const idMaquina = Number(params.get("id"));
if (!Number.isInteger(idMaquina) || idMaquina <= 0) {
	alert("Error: la URL debe incluir 'id'.\nEj: progreso_peso.html?id=3");
	location.replace("estadisticas_peso.html");
	throw new Error("Parámetros de URL inválidos");
}

let chart = null;

/* ---------- Formato ---------- */
const fmtFecha = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const fmtFechaCorta = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`;
const fmtPeso = (n) => (Number.isFinite(n) ? `${n.toFixed(1)}` : "—");

function parseISO(s) {
	const [y, m, d] = s.split("-").map(Number);
	return new Date(y, m - 1, d);
}

/* ---------- Peso estimado ---------- */
function calcularPesoEstimado(peso, reps, maquina) {
	const inc = Number(maquina.incremento_peso) || 0;
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
		.filter((r) => r.exId === idBuscado)
		.map((r) => {
			const fecha = parseISO(r.fecha);
			const estimado = calcularPesoEstimado(r.peso, r.reps, maquina);
			if (!Number.isFinite(estimado)) return null;
			return {
				fecha,
				peso: r.peso,
				reps: r.reps,
				sesion: r.sesion,
				estimado,
			};
		})
		.filter(Boolean)
		.sort((a, b) => a.fecha - b.fecha);
}

/* ---------- Render ---------- */
function mostrarVacio(msg) {
	document.getElementById("tituloMaquina").textContent = msg;
	document.getElementById("cardGrafico").style.display = "none";
	document.getElementById("cardStats").style.display = "none";
}

function setText(id, txt) {
	const el = document.getElementById(id);
	if (el) el.textContent = txt;
}

function renderStats(puntos) {
	// Si no hay puntos, dejamos los "—" que vienen por defecto en el HTML.
	if (!Array.isArray(puntos) || puntos.length === 0) return;

	const primero = puntos[0];
	const ultimo = puntos[puntos.length - 1];
	const mejor = puntos.reduce((acc, p) => (p.estimado > acc.estimado ? p : acc), puntos[0]);

	// Campos simples
	setText("statPesoActual", fmtPeso(ultimo.estimado));
	setText("statMejorMarca", fmtPeso(mejor.estimado));
	setText("statMejorFecha", fmtFecha(mejor.fecha));
	setText("statSesiones", String(puntos.length));
	setText("statPrimera", fmtFechaCorta(primero.fecha));
	setText("statUltima", fmtFechaCorta(ultimo.fecha));

	// Píldora de tendencia
	const elTrend = document.getElementById("statTendencia");
	if (elTrend) {
		if (puntos.length > 1) {
			const diff = ultimo.estimado - primero.estimado;
			const cls = diff > 0.05 ? "up" : diff < -0.05 ? "down" : "same";
			const signo = diff > 0 ? "+" : "";
			elTrend.textContent = `${signo}${diff.toFixed(1)} kg vs inicio`;
			elTrend.className = `stat-trend ${cls}`;
		} else {
			elTrend.textContent = "Primera sesión";
			elTrend.className = "stat-trend";
		}
	}
}

/* ---------- Gráfico ---------- */
function crearGrafico(puntos) {
	if (chart) {
		chart.destroy();
		chart = null;
	}

	const data = puntos.map((p) => ({ x: p.fecha.getTime(), y: p.estimado }));

	chart = new Chart(document.getElementById("grafico"), {
		type: "line",
		data: {
			datasets: [
				{
					label: "Peso estimado",
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
			// animation: { duration: 400 },
			animation: false,
			interaction: { mode: "index", intersect: false },
			plugins: {
				legend: { display: false },
				tooltip: {
					callbacks: {
						title: (items) => {
							const t = items[0]?.parsed?.x;
							return t ? fmtFecha(new Date(t)) : "";
						},
						label: (item) => {
							const p = puntos[item.dataIndex];
							if (!p) return "";
							return `Estimado: ${fmtPeso(p.estimado)} (${p.reps} reps, ${p.peso} kg)`;
						},
					},
				},
				zoom: {
					pan: { enabled: true, mode: "x", threshold: 8 },
					zoom: {
						wheel: { enabled: true, speed: 0.08 },
						pinch: { enabled: true },
						mode: "x",
					},
					limits: {
						x: {
							min: "original",
							max: "original",
							minRange: 24 * 60 * 60 * 1000,
						},
					},
				},
			},
			scales: {
				x: {
					type: "linear",
					// title: { display: true, text: "Fecha" },
					ticks: {
						autoSkip: true,
						maxTicksLimit: 6,
						maxRotation: 0,
						callback: (v) => fmtFechaCorta(new Date(v)),
					},
					grid: { color: "rgba(0,0,0,0.05)" },
				},
				y: {
					// title: { display: true, text: "Peso (kg)" },
					beginAtZero: false,
					ticks: { callback: (v) => fmtPeso(v) },
					grid: { color: "rgba(0,0,0,0.05)" },
				},
			},
		},
	});
}

/* ---------- Init ---------- */
(async function init() {
	window.addEventListener("unhandledrejection", (e) => {
		if (/zoom|chart/i.test(String(e.reason))) {
			console.warn("Rechazo ignorado del plugin:", e.reason);
			e.preventDefault();
		}
	});

	let ejercicios = [];
	let historial = [];
	try {
		[ejercicios, historial] = await Promise.all([dbLoadExercises(), cargarHistorial()]);
	} catch (error) {
		console.error("[progreso] Error cargando datos:", error);
	}

	const maquina = (Array.isArray(ejercicios) ? ejercicios : []).find((e) => e.id === idMaquina);
	if (!maquina) {
		mostrarVacio(`No se encontró la máquina con id "${idMaquina}".`);
		return;
	}

	const nombre = maquina.nombre || `Máquina ${idMaquina}`;
	document.getElementById("tituloMaquina").textContent = nombre;
	document.title = `SIMPLEGYM - ${nombre}`;

	const puntos = construirPuntos(maquina, historial);
	if (!puntos.length) {
		mostrarVacio(`${nombre} sin hitórico.`);
		return;
	}

	renderStats(puntos);
	crearGrafico(puntos);
})();
