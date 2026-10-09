import { cargarEjercicios, cargarHistorial } from "./database.mjs";
import { epley, formatearFecha, formatearFechaCorta, formatearNumero, obtenerInicioSemana, obtenerParametrosURL, setText } from "./utils.mjs";

/*
Semana / ciclo
└── Sesión
	└── Ejercicio
		└── Registro de ejercicio
			└── Serie
				└── Repetición
*/

const MILISEGUNDOS_DIA = 24 * 60 * 60 * 1000;
const MILISEGUNDOS_SEMANA = 7 * MILISEGUNDOS_DIA;

// ---------------------------------------------------------
// Utilidades
// ---------------------------------------------------------

function formatearPeso(peso) {
	return `${formatearNumero(peso, 1, 0)} kg`;
}

function obtenerMaximo(realizaciones, propiedad) {
	return Math.max(...realizaciones.map((realizacion) => realizacion[propiedad]));
}

// ---------------------------------------------------------
// Serie temporal
// ---------------------------------------------------------

function construirRealizacionesEjercicio(ejercicioId, registrosEjercicio) {
	// historial ya viene ordenado por fecha ascendente; filter conserva el orden
	return registrosEjercicio
		.filter((registroEjercicio) => registroEjercicio.idEjercicio === ejercicioId)
		.map(({ fecha, peso, repeticiones, numeroSeries }) => ({
			fecha,
			peso,
			repeticiones,
			numeroSeries,
			pesoEpley: epley(peso, repeticiones),
			volumen: peso * numeroSeries * repeticiones,
		}));
}

// ---------------------------------------------------------
// Estadísticas
// ---------------------------------------------------------

function calcularFrecuenciaMedia(realizaciones) {
	if (realizaciones.length < 2) return "Primera sesión";

	const mediaDias = (realizaciones.at(-1).fecha - realizaciones[0].fecha) / MILISEGUNDOS_DIA / (realizaciones.length - 1);
	return `cada ${formatearNumero(mediaDias, 1)} días`;
}

function calcularPendienteEpley(realizaciones) {
	const numeroRealizaciones = realizaciones.length;
	if (numeroRealizaciones < 2) return 0;

	const sumaX = ((numeroRealizaciones - 1) * numeroRealizaciones) / 2;
	const sumaXX = ((numeroRealizaciones - 1) * numeroRealizaciones * (2 * numeroRealizaciones - 1)) / 6;
	let sumaY = 0;
	let sumaXY = 0;

	realizaciones.forEach((punto, indice) => {
		sumaY += punto.pesoEpley;
		sumaXY += indice * punto.pesoEpley;
	});

	const denominador = numeroRealizaciones * sumaXX - sumaX * sumaX;
	return denominador === 0 ? 0 : (numeroRealizaciones * sumaXY - sumaX * sumaY) / denominador;
}

function calcularVolumenTotal(realizaciones) {
	return realizaciones.reduce((total, punto) => total + punto.volumen, 0);
}

function calcularRepeticionesTotales(realizaciones) {
	return realizaciones.reduce((total, punto) => total + punto.numeroSeries * punto.repeticiones, 0);
}

function mostrarEstadisticasEjercicio(realizaciones) {
	const ultimoPunto = realizaciones.at(-1);
	const pesoEstimadoActual = ultimoPunto.pesoEpley;
	const mejorPesoEstimado = obtenerMaximo(realizaciones, "pesoEpley");

	setText("peso-estimado-actual", formatearPeso(pesoEstimadoActual));
	setText("porcentaje-mejor-1pr", `${formatearNumero((pesoEstimadoActual / mejorPesoEstimado) * 100, 1)}%`);
	setText("frecuencia-media", calcularFrecuenciaMedia(realizaciones));
	setText("volumen-total", formatearNumero(calcularVolumenTotal(realizaciones), 1));
	setText("repeticiones-totales", calcularRepeticionesTotales(realizaciones));

	if (realizaciones.length === 1) {
		setText("tendencia-ejercicio", "Primera sesión");
		return;
	}

	const pendienteEpley = calcularPendienteEpley(realizaciones);
	const signo = pendienteEpley > 0 ? "+" : "";
	setText("tendencia-ejercicio", `${signo}${formatearNumero(pendienteEpley, 2)} kg/sesión`);
}

// ---------------------------------------------------------
// Récords históricos y de la última sesión
// ---------------------------------------------------------

const CONFIG_RECORDS = [
	{ id: "1pr-epley", campo: "pesoEpley", formatear: formatearPeso },
	{ id: "peso", campo: "peso", formatear: formatearPeso },
	{ id: "repeticiones", campo: "repeticiones" },
	{ id: "series", campo: "numeroSeries" },
	{ id: "volumen", campo: "volumen" },
];

function calcularRecordsHistoricos(realizaciones) {
	return Object.fromEntries(
		CONFIG_RECORDS.map(({ campo }) => [campo, obtenerMaximo(realizaciones, campo)]),
	);
}

function calcularNuevosRecordsUltimoRegistro(realizaciones) {
	const recordsAnteriores = realizaciones.length > 1 ? calcularRecordsHistoricos(realizaciones.slice(0, -1)) : null;
	const ultimoPunto = realizaciones.at(-1);

	return Object.fromEntries(
		CONFIG_RECORDS.map(({ campo }) => [
			campo,
			!recordsAnteriores || ultimoPunto[campo] > recordsAnteriores[campo] ? ultimoPunto[campo] : null,
		]),
	);
}

function mostrarRecordsHistoricos(recordsHistoricos) {
	for (const { id, campo, formatear } of CONFIG_RECORDS) {
		const valor = recordsHistoricos[campo];
		setText(`record-${id}`, formatear ? formatear(valor) : valor);
	}
}

function mostrarNuevosRecords(nuevosRecords) {
	let numeroRecordsNuevos = 0;

	for (const { id, campo, formatear } of CONFIG_RECORDS) {
		const valor = nuevosRecords[campo];
		const el = document.getElementById(`record-ultimo-${id}`);
		const ocultar = valor === null;

		el.hidden = ocultar;
		if (!ocultar) {
			el.querySelector("dd").textContent = formatear ? formatear(valor) : valor;
			numeroRecordsNuevos++;
		}
	}

	document.getElementById("sin-nuevos-records").classList.toggle("hidden", numeroRecordsNuevos > 0);
}

// ---------------------------------------------------------
// Rachas
// ---------------------------------------------------------

function calcularRachaMejora(realizaciones) {
	let racha = 0;

	for (let indice = realizaciones.length - 1; indice > 0; indice--) {
		if (realizaciones[indice].pesoEpley <= realizaciones[indice - 1].pesoEpley) break;

		racha++;
	}

	return racha;
}

function calcularRachaSemanas(realizaciones) {
	if (!realizaciones.length) return 0;

	const inicioSemanaActual = obtenerInicioSemana(new Date());
	const inicioSemanaUltimoPunto = obtenerInicioSemana(realizaciones.at(-1).fecha);

	// La semana en curso aún no ha terminado: si la última sesión fue
	// esta semana o la anterior, la racha sigue viva. Se rompe sólo si
	// hay una semana completa sin ninguna sesión (≥ 2 semanas de distancia).
	const diferenciaSemanas = (inicioSemanaActual - inicioSemanaUltimoPunto) / MILISEGUNDOS_SEMANA;
	if (diferenciaSemanas > 1) return 0;

	// realizaciones está ordenado por fecha, así que las semanas ya salen ordenadas
	const semanas = [...new Set(realizaciones.map((r) => obtenerInicioSemana(r.fecha)))];

	let racha = 1;
	let semanaActual = semanas.at(-1);

	for (let indice = semanas.length - 2; indice >= 0; indice--) {
		const semanaAnterior = semanas[indice];

		if (semanaActual - semanaAnterior !== MILISEGUNDOS_SEMANA) break;

		racha++;
		semanaActual = semanaAnterior;
	}

	return racha;
}

function mostrarRacha(realizaciones) {
	setText("racha-sesiones-mejora", calcularRachaMejora(realizaciones));
	setText("racha-semanas", calcularRachaSemanas(realizaciones));
}

// ---------------------------------------------------------
// Gráfico
// ---------------------------------------------------------

let graficoPeso = null;

function crearGraficoPeso(realizaciones) {
	if (graficoPeso) {
		graficoPeso.destroy();
		graficoPeso = null;
	}

	const datosGrafico = realizaciones.map((punto) => ({
		x: punto.fecha.getTime(),
		y: punto.pesoEpley,
	}));

	graficoPeso = new Chart(document.getElementById("grafico-peso"), {
		type: "line",
		data: {
			datasets: [
				{
					label: "Peso 1PR (Epley)",
					data: datosGrafico,
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
				mode: "nearest",
				intersect: false,
			},
			plugins: {
				legend: {
					display: false,
				},
				tooltip: {
					displayColors: false,

					callbacks: {
						title: (elementos) => formatearFecha(new Date(elementos[0].parsed.x)),
						label: (elemento) => {
							const punto = realizaciones[elemento.dataIndex];
							return `${formatearPeso(punto.pesoEpley)} ` + `(${punto.repeticiones} reps, ` + `${formatearPeso(punto.peso)})`;
						},
					},
				},
				zoom: {
					pan: {
						enabled: true,
						mode: "x",
						threshold: 8,
					},
					zoom: {
						wheel: {
							enabled: true,
							speed: 0.08,
						},
						pinch: {
							enabled: true,
						},

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
					ticks: {
						autoSkip: true,
						maxTicksLimit: 6,
						maxRotation: 0,
						callback: (valor) => formatearFechaCorta(new Date(valor)),
					},
					grid: {
						color: "rgba(0,0,0,0.05)",
					},
				},
				y: {
					beginAtZero: false,
					ticks: {
						callback: (valor) => formatearPeso(valor),
					},
					grid: {
						color: "rgba(0,0,0,0.05)",
					},
				},
			},
		},
	});
}

// ---------------------------------------------------------
// Inicialización
// ---------------------------------------------------------

async function inicializar() {
	try {
		const referrer = document.referrer;
		if (referrer && new URL(referrer).origin === window.location.origin) {
			document.getElementById("enlace-volver").href = referrer;
		}

		const [idEjercicio] = obtenerParametrosURL({ clave: "idEjercicio", validar: (n) => n > 0 });
		const [ejercicios, historial] = await Promise.all([cargarEjercicios(), cargarHistorial()]);
		const ejercicio = ejercicios.find((item) => item.id === idEjercicio);
		if (!ejercicio) {
			throw new Error(`No se encontró el ejercicio con id "${idEjercicio}".`);
		}

		const nombreEjercicio = ejercicio.nombre;
		setText("titulo", `${nombreEjercicio}`);
		document.title = `SIMPLEGYM - ${nombreEjercicio}`;

		const realizaciones = construirRealizacionesEjercicio(ejercicio.id, historial);
		if (realizaciones.length === 0) {
			throw new Error(`No hay historial para ${nombreEjercicio}.`);
		}

		setText("subtitulo", `${realizaciones.length} ${realizaciones.length === 1 ? "sesión registrada" : "sesiones registradas"}`);

		crearGraficoPeso(realizaciones);
		mostrarEstadisticasEjercicio(realizaciones);
		mostrarRecordsHistoricos(calcularRecordsHistoricos(realizaciones));
		mostrarNuevosRecords(calcularNuevosRecordsUltimoRegistro(realizaciones));
		mostrarRacha(realizaciones);
	} catch (error) {
		document.getElementById("main-container").hidden = true;
		setText("titulo", "Error");
		setText("subtitulo", error.message || "No se pudo cargar el histórico.");
		console.error(error);
	}
}

inicializar();