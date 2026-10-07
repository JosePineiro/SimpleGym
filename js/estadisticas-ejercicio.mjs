import { cargarEjercicios, cargarHistorial } from "./database.mjs";
import { formatearFecha, formatearFechaCorta, obtenerParametrosURL } from "./utils.mjs";

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
	return `${peso.toFixed(1)} kg`;
}

function formatearNumero(valor) {
	return valor.toFixed(1).replace(".", ",");
}

function obtenerMaximo(puntos, propiedad) {
	return Math.max(...puntos.map((punto) => punto[propiedad]));
}

function epley(peso, repeticiones) {
	return peso * (1 + Math.min(repeticiones, 30) / 30);
}

const setText = (id, valor) => {
	document.getElementById(id).textContent = valor;
};

// ---------------------------------------------------------
// Serie temporal
// ---------------------------------------------------------

function construirPuntosEjercicio(ejercicioId, registrosEjercicio) {
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

function calcularFrecuenciaMedia(puntosEjercicio) {
	if (puntosEjercicio.length < 2) return "Primera sesión";

	const mediaDias = (puntosEjercicio.at(-1).fecha - puntosEjercicio[0].fecha) / MILISEGUNDOS_DIA / (puntosEjercicio.length - 1);
	return `cada ${formatearNumero(mediaDias)} días`;
}

function calcularPendienteEpley(puntosEjercicio) {
	const numeroPuntos = puntosEjercicio.length;
	if (numeroPuntos < 2) return 0;

	const sumaX = ((numeroPuntos - 1) * numeroPuntos) / 2;
	const sumaXX = ((numeroPuntos - 1) * numeroPuntos * (2 * numeroPuntos - 1)) / 6;
	let sumaY = 0;
	let sumaXY = 0;

	puntosEjercicio.forEach((punto, indice) => {
		sumaY += punto.pesoEpley;
		sumaXY += indice * punto.pesoEpley;
	});

	const denominador = numeroPuntos * sumaXX - sumaX * sumaX;
	return denominador === 0 ? 0 : (numeroPuntos * sumaXY - sumaX * sumaY) / denominador;
}

function calcularVolumenTotal(puntosEjercicio) {
	return puntosEjercicio.reduce((total, punto) => total + punto.volumen, 0);
}

function calcularRepeticionesTotales(puntosEjercicio) {
	return puntosEjercicio.reduce((total, punto) => total + punto.numeroSeries * punto.repeticiones, 0);
}

function mostrarEstadisticasEjercicio(puntosEjercicio) {
	const ultimoPunto = puntosEjercicio.at(-1);
	const pesoEstimadoActual = ultimoPunto.pesoEpley;
	const mejorPesoEstimado = obtenerMaximo(puntosEjercicio, "pesoEpley");
	const elementoTendencia = document.getElementById("tendencia-ejercicio");

	setText("peso-estimado-actual", formatearPeso(pesoEstimadoActual));
	setText("porcentaje-mejor-1pr", `${formatearNumero((pesoEstimadoActual / mejorPesoEstimado) * 100)}%`);
	setText("frecuencia-media", calcularFrecuenciaMedia(puntosEjercicio));
	setText("volumen-total", calcularVolumenTotal(puntosEjercicio));
	setText("repeticiones-totales", calcularRepeticionesTotales(puntosEjercicio));

	if (puntosEjercicio.length === 1) {
		elementoTendencia.textContent = "Primera sesión";
		return;
	}

	const pendienteEpley = calcularPendienteEpley(puntosEjercicio);
	const signo = pendienteEpley > 0 ? "+" : "";
	elementoTendencia.textContent = `${signo}${formatearNumero(pendienteEpley)} kg/sesión`;
}

// ---------------------------------------------------------
// Récords históricos y de la última sesión
// ---------------------------------------------------------

const CAMPOS_RECORD = ["pesoEpley", "peso", "repeticiones", "numeroSeries", "volumen"];

const CONFIG_RECORDS = [
	{ id: "1pr-epley", campo: "pesoEpley", formatear: formatearPeso },
	{ id: "peso", campo: "peso", formatear: formatearPeso },
	{ id: "repeticiones", campo: "repeticiones" },
	{ id: "series", campo: "numeroSeries" },
	{ id: "volumen", campo: "volumen" },
];

function calcularRecordsHistoricos(puntosEjercicio) {
	return {
		pesoEpley: obtenerMaximo(puntosEjercicio, "pesoEpley"),
		peso: obtenerMaximo(puntosEjercicio, "peso"),
		repeticiones: obtenerMaximo(puntosEjercicio, "repeticiones"),
		numeroSeries: obtenerMaximo(puntosEjercicio, "numeroSeries"),
		volumen: obtenerMaximo(puntosEjercicio, "volumen"),
	};
}

function calcularNuevosRecordsUltimoRegistro(puntosEjercicio) {
	const recordsAnteriores = puntosEjercicio.length > 1 ? calcularRecordsHistoricos(puntosEjercicio.slice(0, -1)) : null;
	const ultimoPunto = puntosEjercicio.at(-1);

	return Object.fromEntries(
		CAMPOS_RECORD.map((campo) => [
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

		el.classList.toggle("hidden", ocultar);
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

function calcularRachaMejora(puntosEjercicio) {
	let racha = 0;

	for (let indice = puntosEjercicio.length - 1; indice > 0; indice--) {
		if (puntosEjercicio[indice].pesoEpley <= puntosEjercicio[indice - 1].pesoEpley) break;

		racha++;
	}

	return racha;
}

function obtenerInicioSemana(fecha) {
	const inicioSemana = new Date(fecha);
	inicioSemana.setHours(0, 0, 0, 0);
	inicioSemana.setDate(inicioSemana.getDate() - ((inicioSemana.getDay() + 6) % 7));
	return inicioSemana.getTime();
}

function calcularRachaSemanas(puntosEjercicio) {
	if (!puntosEjercicio.length) {
		return 0;
	}

	const inicioSemanaActual = obtenerInicioSemana(new Date());
	const inicioSemanaUltimoPunto = obtenerInicioSemana(puntosEjercicio.at(-1).fecha);

	if (inicioSemanaUltimoPunto !== inicioSemanaActual) {
		return 0;
	}

	// puntosEjercicio está ordenado por fecha, así que las semanas ya salen ordenadas
	const semanas = [...new Set(puntosEjercicio.map((punto) => obtenerInicioSemana(punto.fecha)))];

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

function mostrarRacha(puntosEjercicio) {
	setText("racha-sesiones-mejora", calcularRachaMejora(puntosEjercicio));
	setText("racha-semanas", calcularRachaSemanas(puntosEjercicio));
}

// ---------------------------------------------------------
// Gráfico
// ---------------------------------------------------------

let graficoPeso = null;

function crearGraficoPeso(puntosEjercicio) {
	if (graficoPeso) {
		graficoPeso.destroy();
		graficoPeso = null;
	}

	const datosGrafico = puntosEjercicio.map((punto) => ({
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
							const punto = puntosEjercicio[elemento.dataIndex];

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
	const titulo = document.getElementById("titulo");
	const subtitulo = document.getElementById("subtitulo");

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
		titulo.textContent = `${nombreEjercicio}`;
		document.title = `SIMPLEGYM - ${nombreEjercicio}`;

		const puntosEjercicio = construirPuntosEjercicio(ejercicio.id, historial);

		if (puntosEjercicio.length === 0) {
			throw new Error(`No hay historial para ${nombreEjercicio}.`);
		}

		subtitulo.textContent = `${puntosEjercicio.length} ${puntosEjercicio.length === 1 ? "sesión registrada" : "sesiones registradas"}`;

		crearGraficoPeso(puntosEjercicio);
		mostrarEstadisticasEjercicio(puntosEjercicio);
		mostrarRecordsHistoricos(calcularRecordsHistoricos(puntosEjercicio));
		mostrarNuevosRecords(calcularNuevosRecordsUltimoRegistro(puntosEjercicio));
		mostrarRacha(puntosEjercicio);
	} catch (error) {
		document.getElementById("main-container").hidden = true;
		titulo.textContent = "Error";
		subtitulo.textContent = error.message || "No se pudo cargar el histórico.";
		console.error(error);
	}
}

inicializar();