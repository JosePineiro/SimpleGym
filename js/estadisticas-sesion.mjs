import { cargarHistorial } from "./database.mjs";
import { formatearFecha, formatearFechaCorta, obtenerParametrosURL } from "./utils.mjs";

const MILISEGUNDOS_DIA = 24 * 60 * 60 * 1000;
const MILISEGUNDOS_SEMANA = 7 * MILISEGUNDOS_DIA;

const PROPIEDADES_RECORD = [
	{ prop: "volumen", id: "record-ultima-sesion-volumen" },
	{ prop: "numeroSeries", id: "record-ultima-sesion-series" },
	{ prop: "repeticiones", id: "record-ultima-sesion-repeticiones" },
	{ prop: "numeroEjercicios", id: "record-ultima-sesion-ejercicios" },
];

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------

function formatearNumero(valor, maximoDecimales = 2, minimoDecimales = 0) {
	return Number.isFinite(valor)
		? valor.toLocaleString("es-ES", { maximumFractionDigits: maximoDecimales, minimumFractionDigits: minimoDecimales })
		: "—";
}

const mostrarTexto = (id, valor) => {
	document.getElementById(id).textContent = valor;
};

function obtenerInicioSemana(fecha) {
	const inicio = new Date(fecha);
	inicio.setHours(0, 0, 0, 0);
	inicio.setDate(inicio.getDate() - ((inicio.getDay() + 6) % 7));
	return inicio.getTime();
}

// ---------------------------------------------------------
// Realizaciones de la sesión
// ---------------------------------------------------------

function obtenerRealizacionesSesion(numeroSesion, historial) {
	const porFecha = new Map();

	for (const registro of historial) {
		if (registro.numeroSesion !== numeroSesion) continue;

		const clave = registro.fecha.getTime();
		let realizacion = porFecha.get(clave);

		if (!realizacion) {
			realizacion = {
				fecha: registro.fecha,
				idsEjercicio: new Set(),
				totalEjerciciosSesion: 0,
				numeroSeries: 0,
				repeticiones: 0,
				volumen: 0,
			};
			porFecha.set(clave, realizacion);
		}

		realizacion.idsEjercicio.add(registro.idEjercicio);
		realizacion.totalEjerciciosSesion = Math.max(realizacion.totalEjerciciosSesion, registro.totalEjercicios);
		realizacion.numeroSeries += registro.numeroSeries;
		realizacion.repeticiones += registro.repeticiones;
		realizacion.volumen += registro.peso * registro.numeroSeries * registro.repeticiones;
	}

	return [...porFecha.values()].map(({ fecha, idsEjercicio, totalEjerciciosSesion, numeroSeries, repeticiones, volumen }) => ({
		fecha,
		numeroEjercicios: idsEjercicio.size,
		numeroSeries,
		repeticiones,
		volumen,
		completada: totalEjerciciosSesion > 0 && idsEjercicio.size >= totalEjerciciosSesion,
	}));
}

// ---------------------------------------------------------
// Estadísticas derivadas
// ---------------------------------------------------------

function calcularFrecuenciaMedia(realizaciones) {
	if (realizaciones.length < 2) return "Primera sesión";

	// Σ(rᵢ − rᵢ₋₁) = último − primero
	const diasTotales = (realizaciones.at(-1).fecha - realizaciones[0].fecha) / MILISEGUNDOS_DIA;
	const mediaDias = diasTotales / (realizaciones.length - 1);

	return `cada ${formatearNumero(mediaDias, 1, 1)} días`;
}

function calcularTendenciaVolumen(realizaciones) {
	const n = realizaciones.length;
	if (n < 2) return "Primera sesión";

	// Índices 0..n−1 → fórmulas cerradas
	const sumaX = (n * (n - 1)) / 2;
	const sumaXX = (n * (n - 1) * (2 * n - 1)) / 6;
	let sumaY = 0;
	let sumaXY = 0;

	realizaciones.forEach((r, i) => {
		sumaY += r.volumen;
		sumaXY += i * r.volumen;
	});

	const pendiente = (n * sumaXY - sumaX * sumaY) / (n * sumaXX - sumaX * sumaX);

	return `${pendiente > 0 ? "+" : ""}${formatearNumero(pendiente)} por sesión`;
}

function calcularRachaSesionesCompletadas(realizaciones) {
	let racha = 0;
	let semanaAnterior = null;

	for (let i = realizaciones.length - 1; i >= 0; i--) {
		const r = realizaciones[i];
		if (!r.completada) break;

		const semana = obtenerInicioSemana(r.fecha);
		if (semanaAnterior !== null && semanaAnterior - semana > MILISEGUNDOS_SEMANA) break;

		racha++;
		semanaAnterior = semana;
	}

	return racha;
}

function calcularRachaSesionesConMejora(realizaciones) {
	let racha = 0;
	for (
		let i = realizaciones.length - 1;
		i > 0 && realizaciones[i].volumen > realizaciones[i - 1].volumen;
		i--
	) {
		racha++;
	}
	return racha;
}

function calcularRachaSemanas(realizaciones) {
	if (!realizaciones.length) return 0;

	const inicioSemanaActual = obtenerInicioSemana(new Date());
	const inicioSemanaUltima = obtenerInicioSemana(realizaciones.at(-1).fecha);

	// La semana en curso aún no ha terminado: si la última sesión fue
	// esta semana o la anterior, la racha sigue viva. Se rompe sólo si
	// hay una semana completa sin ninguna sesión (≥ 2 semanas de distancia).
	const diferenciaSemanas = (inicioSemanaActual - inicioSemanaUltima) / MILISEGUNDOS_SEMANA;
	if (diferenciaSemanas > 1) return 0;

	const semanas = [...new Set(realizaciones.map((r) => obtenerInicioSemana(r.fecha)))];

	let racha = 1;
	for (
		let i = semanas.length - 2;
		i >= 0 && semanas[i + 1] - semanas[i] === MILISEGUNDOS_SEMANA;
		i--
	) {
		racha++;
	}
	return racha;
}

function calcularRecords(realizaciones) {
	const ultima = realizaciones.at(-1);
	const historicos = {};
	const nuevos = {};

	for (const { prop } of PROPIEDADES_RECORD) {
		let maxAnterior = 0;
		for (let i = 0; i < realizaciones.length - 1; i++) {
			if (realizaciones[i][prop] > maxAnterior) maxAnterior = realizaciones[i][prop];
		}
		historicos[prop] = Math.max(maxAnterior, ultima[prop]);
		nuevos[prop] = ultima[prop] > maxAnterior ? ultima[prop] : null;
	}

	return { historicos, nuevos };
}

function calcularEstadisticasSesion(realizaciones) {
	const ultima = realizaciones.at(-1);
	const { historicos: recordsHistoricos, nuevos: nuevosRecords } = calcularRecords(realizaciones);

	return {
		volumenActual: ultima.volumen,
		porcentajeMejorVolumen: (ultima.volumen / recordsHistoricos.volumen) * 100,
		recordsHistoricos,
		frecuenciaMedia: calcularFrecuenciaMedia(realizaciones),
		tendenciaVolumen: calcularTendenciaVolumen(realizaciones),
		nuevosRecords,
		rachaSesionesCompletadas: calcularRachaSesionesCompletadas(realizaciones),
		rachaSesionesConMejora: calcularRachaSesionesConMejora(realizaciones),
		rachaSemanas: calcularRachaSemanas(realizaciones),
	};
}

// ---------------------------------------------------------
// Mostrar estadísticas
// ---------------------------------------------------------

function mostrarNuevosRecords(nuevosRecords) {
	let numeroRecordsNuevos = 0;

	for (const { prop, id } of PROPIEDADES_RECORD) {
		const elemento = document.getElementById(id);
		const valor = nuevosRecords[prop];

		elemento.hidden = valor === null;

		if (valor !== null) {
			elemento.querySelector("dd").textContent = formatearNumero(valor);
			numeroRecordsNuevos++;
		}
	}

	document.getElementById("sin-nuevos-records").hidden = numeroRecordsNuevos > 0;
}

function mostrarEstadisticas(estadisticas) {
	const {
		volumenActual, porcentajeMejorVolumen, recordsHistoricos,
		frecuenciaMedia, tendenciaVolumen, nuevosRecords,
		rachaSesionesCompletadas, rachaSesionesConMejora, rachaSemanas,
	} = estadisticas;

	mostrarTexto("volumen-actual", formatearNumero(volumenActual));
	mostrarTexto("porcentaje-mejor-volumen", `${formatearNumero(porcentajeMejorVolumen, 1)}%`);
	mostrarTexto("frecuencia-media", frecuenciaMedia);
	mostrarTexto("tendencia-volumen", tendenciaVolumen);
	mostrarTexto("record-ejercicios", formatearNumero(recordsHistoricos.numeroEjercicios));
	mostrarTexto("record-series", formatearNumero(recordsHistoricos.numeroSeries));
	mostrarTexto("record-repeticiones", formatearNumero(recordsHistoricos.repeticiones));
	mostrarTexto("record-volumen", formatearNumero(recordsHistoricos.volumen));
	mostrarTexto("racha-sesiones-completadas", formatearNumero(rachaSesionesCompletadas));
	mostrarTexto("racha-sesiones-mejora", formatearNumero(rachaSesionesConMejora));
	mostrarTexto("racha-semanas", formatearNumero(rachaSemanas));

	mostrarNuevosRecords(nuevosRecords);
}

// ---------------------------------------------------------
// Gráfico
// ---------------------------------------------------------

function crearGraficoVolumen(realizaciones) {
	const datos = realizaciones.map(({ fecha, volumen }) => ({
		x: fecha.getTime(),
		y: volumen,
	}));

	new Chart(document.getElementById("grafico-volumen"), {
		type: "line",
		data: {
			datasets: [{
				data: datos,
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
			}],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			animation: false,
			interaction: { mode: "nearest", intersect: false },
			plugins: {
				legend: { display: false },
				tooltip: {
					displayColors: false,
					callbacks: {
						title: (elementos) => formatearFecha(new Date(elementos[0].parsed.x)),
						label: (elemento) => `Volumen: ${formatearNumero(elemento.parsed.y)}`,
					},
				},
				zoom: {
					pan: { enabled: true, mode: "x", threshold: 8 },
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
						callback: (valor) => formatearFechaCorta(new Date(valor)),
					},
					grid: { color: "rgba(0,0,0,0.05)" },
				},
				y: {
					beginAtZero: true,
					ticks: { callback: (valor) => formatearNumero(valor) },
					grid: { color: "rgba(0,0,0,0.05)" },
				},
			},
		},
	});
}

// ---------------------------------------------------------
// Inicialización
// ---------------------------------------------------------

async function inicializar() {
	const titulo = document.getElementById("titulo");
	const subtitulo = document.getElementById("subtitulo");

	try {
		const [numeroSesion] = obtenerParametrosURL({ clave: "numeroSesion", validar: (n) => n > 0 });

		const historial = await cargarHistorial();
		if (historial.length === 0) throw new Error("No hay historial de entrenamiento");

		const realizaciones = obtenerRealizacionesSesion(numeroSesion, historial);
		if (!realizaciones.length) throw new Error("No hay histórico de la sesión.");

		titulo.textContent = `Sesión ${numeroSesion}`;
		document.title = `SIMPLEGYM - Sesión ${numeroSesion}`;
		subtitulo.textContent = `${realizaciones.length} ${realizaciones.length === 1 ? "realización registrada" : "realizaciones registradas"}`;

		crearGraficoVolumen(realizaciones);
		mostrarEstadisticas(calcularEstadisticasSesion(realizaciones));

		document.getElementById("main-container").hidden = false;
	} catch (error) {
		document.getElementById("main-container").hidden = true;
		titulo.textContent = "Error";
		subtitulo.textContent = error.message || "No se pudo cargar el progreso de volumen.";
		console.error(error);
	}
}

inicializar();