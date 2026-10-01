import { cargarEjercicios, cargarRegistrosEjercicio } from "./database.mjs";
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

function detectarNuevoRecord(valor, recordAnterior) {
	return valor > recordAnterior ? valor : null;
}

function epley(peso, repeticiones) {
	if (repeticiones > 29) repeticiones = 30;
	return peso * (1 + repeticiones / 30);
}

// ---------------------------------------------------------
// Serie temporal
// ---------------------------------------------------------

function construirPuntosEjercicio(ejercicioId, registrosEjercicio) {
	return registrosEjercicio
		.filter((registroEjercicio) => registroEjercicio.idEjercicio === ejercicioId)
		.map((registroEjercicio) => {
			const fecha = registroEjercicio.fecha;
			const peso = registroEjercicio.peso;
			const repeticiones = registroEjercicio.repeticiones;
			const numeroSeries = registroEjercicio.numeroSeries;
			const pesoEpley = epley(peso, repeticiones);

			return {
				fecha,
				peso,
				repeticiones,
				numeroSeries,
				pesoEpley,
				volumen: peso * numeroSeries * repeticiones,
			};
		})
		.filter(Boolean)
		.sort((a, b) => a.fecha - b.fecha);
}

// ---------------------------------------------------------
// Estadísticas
// ---------------------------------------------------------

function calcularFrecuenciaMedia(puntosEjercicio) {
	if (puntosEjercicio.length < 2) return "Primera sesión";

	let sumaDias = 0;

	for (let indice = 1; indice < puntosEjercicio.length; indice++) {
		const diferencia = puntosEjercicio[indice].fecha - puntosEjercicio[indice - 1].fecha;
		sumaDias += diferencia / MILISEGUNDOS_DIA;
	}

	const mediaDias = sumaDias / (puntosEjercicio.length - 1);

	return `cada ${formatearNumero(mediaDias)} días`;
}

function calcularPendienteEpley(puntosEjercicio) {
	const numeroPuntos = puntosEjercicio.length;
	let sumaX = 0;
	let sumaY = 0;
	let sumaXY = 0;
	let sumaXX = 0;

	puntosEjercicio.forEach((punto, indice) => {
		sumaX += indice;
		sumaY += punto.pesoEpley;
		sumaXY += indice * punto.pesoEpley;
		sumaXX += indice * indice;
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
	const ultimoPunto = puntosEjercicio[puntosEjercicio.length - 1];
	const pesoEstimadoActual = ultimoPunto.pesoEpley;
	const mejorPesoEstimado = obtenerMaximo(puntosEjercicio, "pesoEpley");
	const elementoTendencia = document.getElementById("tendencia-ejercicio");

	document.getElementById("peso-estimado-actual").textContent = formatearPeso(pesoEstimadoActual);
	document.getElementById("porcentaje-mejor-1pr").textContent = `${(pesoEstimadoActual / mejorPesoEstimado) * 100}%`;
	document.getElementById("frecuencia-media").textContent = calcularFrecuenciaMedia(puntosEjercicio);
	document.getElementById("volumen-total").textContent = calcularVolumenTotal(puntosEjercicio);
	document.getElementById("repeticiones-totales").textContent = calcularRepeticionesTotales(puntosEjercicio);

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

function calcularRecordsHistoricos(puntosEjercicio) {
	return {
		pesoEpley: obtenerMaximo(puntosEjercicio, "pesoEpley"),
		peso: obtenerMaximo(puntosEjercicio, "peso"),
		repeticiones: obtenerMaximo(puntosEjercicio, "repeticiones"),
		numeroSeries: obtenerMaximo(puntosEjercicio, "numeroSeries"),
		volumen: obtenerMaximo(puntosEjercicio, "volumen"),
	};
}

function calcularRecordsAnteriores(puntosEjercicio) {
	if (puntosEjercicio.length <= 1) {
		return null;
	}

	return calcularRecordsHistoricos(puntosEjercicio.slice(0, -1));
}

function calcularNuevosRecordsUltimoRegistro(puntosEjercicio) {
	const ultimoPunto = puntosEjercicio.at(-1);
	const recordsAnteriores = calcularRecordsAnteriores(puntosEjercicio);

	if (!recordsAnteriores) {
		// en la primera sesión todo es "récord"
		return {
			pesoEpley: ultimoPunto.pesoEpley,
			peso: ultimoPunto.peso,
			repeticiones: ultimoPunto.repeticiones,
			numeroSeries: ultimoPunto.numeroSeries,
			volumen: ultimoPunto.volumen,
		};
	}

	return {
		pesoEpley: detectarNuevoRecord(ultimoPunto.pesoEpley, recordsAnteriores.pesoEpley),
		peso: detectarNuevoRecord(ultimoPunto.peso, recordsAnteriores.peso),
		repeticiones: detectarNuevoRecord(ultimoPunto.repeticiones, recordsAnteriores.repeticiones),
		numeroSeries: detectarNuevoRecord(ultimoPunto.numeroSeries, recordsAnteriores.numeroSeries),
		volumen: detectarNuevoRecord(ultimoPunto.volumen, recordsAnteriores.volumen),
	};
}

function mostrarRecordsHistoricos(recordsHistoricos) {
	document.getElementById("record-1pr-epley").textContent = formatearPeso(recordsHistoricos.pesoEpley);
	document.getElementById("record-peso").textContent = formatearPeso(recordsHistoricos.peso);
	document.getElementById("record-repeticiones").textContent = recordsHistoricos.repeticiones;
	document.getElementById("record-series").textContent = recordsHistoricos.numeroSeries;
	document.getElementById("record-volumen").textContent = recordsHistoricos.volumen;
}

function mostrarNuevosRecords(nuevosRecords) {
	const CONFIG_RECORDS = [
		{ id: "record-ultimo-1pr-epley", key: "pesoEpley", formatear: formatearPeso },
		{ id: "record-ultimo-peso", key: "peso", formatear: formatearPeso },
		{ id: "record-ultimo-repeticiones", key: "repeticiones" },
		{ id: "record-ultimo-series", key: "numeroSeries" },
		{ id: "record-ultimo-volumen", key: "volumen" },
	];
	let numeroRecordsNuevos = 0;

	for (const { id, key, formatear } of CONFIG_RECORDS) {
		const valor = nuevosRecords[key];
		const el = document.getElementById(id);
		const ocultar = valor === null;

		el.classList.toggle("hidden", ocultar);
		if (!ocultar) {
			el.querySelector("dd").textContent = formatear ? formatear(valor) : String(valor);
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
		if (puntosEjercicio[indice].pesoEpley <= puntosEjercicio[indice - 1].pesoEpley) {
			break;
		}

		racha++;
	}

	return racha;
}

function obtenerInicioSemana(fecha) {
	const inicioSemana = new Date(fecha);

	inicioSemana.setHours(0, 0, 0, 0);

	const diaSemana = inicioSemana.getDay();
	const diasDesdeLunes = (diaSemana + 6) % 7;

	inicioSemana.setDate(inicioSemana.getDate() - diasDesdeLunes);

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

	const semanas = new Set(puntosEjercicio.map((punto) => obtenerInicioSemana(punto.fecha)));
	const semanasOrdenadas = [...semanas].sort((a, b) => a - b);

	let racha = 1;
	let semanaActual = semanasOrdenadas.at(-1);

	for (let indice = semanasOrdenadas.length - 2; indice >= 0; indice--) {
		const semanaAnterior = semanasOrdenadas[indice];

		if (semanaActual - semanaAnterior !== MILISEGUNDOS_SEMANA) {
			break;
		}

		racha++;
		semanaActual = semanaAnterior;
	}

	return racha;
}

function mostrarRacha(puntosEjercicio) {
	document.getElementById("racha-sesiones-mejora").textContent = calcularRachaMejora(puntosEjercicio);
	document.getElementById("racha-semanas").textContent = calcularRachaSemanas(puntosEjercicio);
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
		const [idEjercicio] = obtenerParametrosURL({ clave: "idEjercicio", validar: (n) => n > 0 });
		const [ejercicios, registrosEjercicio] = await Promise.all([cargarEjercicios(), cargarRegistrosEjercicio()]);
		const ejercicio = (Array.isArray(ejercicios) ? ejercicios : []).find((item) => item.id === idEjercicio);
		if (!ejercicio) {
			throw new Error(`No se encontró el ejercicio con id "${idEjercicio}".`);
		}

		const nombreEjercicio = ejercicio.nombre;
		titulo.textContent = `${nombreEjercicio}`;
		document.title = `SIMPLEGYM - ${nombreEjercicio}`;

		const puntosEjercicio = construirPuntosEjercicio(ejercicio.id, registrosEjercicio);

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
		console.error(error);
		titulo.textContent = "Error";
		subtitulo.textContent = error.message || "No se pudo cargar el histórico.";
		document.getElementById("main-container").style.display = "none";
	}
}

inicializar();
