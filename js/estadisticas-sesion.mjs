import { cargarRegistrosEjercicio } from "./database.mjs";

// Definiciones:
// Semana / ciclo
// └── Sesión
//     └── Ejercicio
//         └── Registro de ejercicio
//             └── Series
//                 └── Repeticiones

const MILISEGUNDOS_DIA = 24 * 60 * 60 * 1000;
const MILISEGUNDOS_SEMANA = 7 * MILISEGUNDOS_DIA;

// ---------------------------------------------------------
// Formateo
// ---------------------------------------------------------

function dosDigitos(valor) {
	return String(valor).padStart(2, "0");
}

function formatearFecha(fecha) {
	return `${dosDigitos(fecha.getDate())}/${dosDigitos(fecha.getMonth() + 1)}/${fecha.getFullYear()}`;
}

function formatearFechaCorta(fecha) {
	return `${dosDigitos(fecha.getDate())}/${dosDigitos(fecha.getMonth() + 1)}/${String(fecha.getFullYear()).slice(-2)}`;
}

function formatearNumero(valor, maximoDecimales = 2, minimoDecimales = 0) {
	return Number.isFinite(valor)
		? valor.toLocaleString("es-ES", {
			maximumFractionDigits: maximoDecimales,
			minimumFractionDigits: minimoDecimales,
		})
		: "—";
}

function obtenerClaveFecha(fecha) {
	return `${fecha.getFullYear()}-${dosDigitos(fecha.getMonth() + 1)}-${dosDigitos(fecha.getDate())}`;
}

function mostrarTexto(id, valor) {
	document.getElementById(id).textContent = valor;
}

function obtenerMaximo(realizaciones, propiedad) {
	return Math.max(...realizaciones.map((realizacion) => realizacion[propiedad]));
}

function obtenerNuevoRecord(valor, recordAnterior) {
	return valor > recordAnterior ? valor : null;
}

// ---------------------------------------------------------
// Un registro
// ---------------------------------------------------------

function calcularDatosRegistro(registro, numeroSesion) {
	if (!(registro.fecha instanceof Date) || Number.isNaN(registro.fecha.getTime())) {
		return null;
	}

	if (registro.numeroSesion !== numeroSesion) {
		return null;
	}

	if (!Number.isFinite(registro.peso) || !Number.isFinite(registro.numeroSeries) || !Number.isFinite(registro.repeticiones)) {
		return null;
	}

	return {
		fecha: new Date(registro.fecha),
		idEjercicio: registro.idEjercicio,
		totalEjerciciosSesion: Number.isFinite(registro.totalEjercicios) ? registro.totalEjercicios : 0,
		numeroSeries: registro.numeroSeries,
		repeticiones: registro.repeticiones,
		volumen: registro.peso * registro.numeroSeries * registro.repeticiones,
	};
}

// ---------------------------------------------------------
// Todas las realizaciones de la sesión
// ---------------------------------------------------------

async function obtenerRealizacionesSesion(numeroSesion) {
	const registros = await cargarRegistrosEjercicio();
	const realizacionesPorFecha = new Map();

	for (const registro of registros) {
		const datosRegistro = calcularDatosRegistro(registro, numeroSesion);

		if (!datosRegistro) {
			continue;
		}

		const claveFecha = obtenerClaveFecha(datosRegistro.fecha);

		if (!realizacionesPorFecha.has(claveFecha)) {
			realizacionesPorFecha.set(claveFecha, {
				fecha: datosRegistro.fecha,
				idsEjercicio: new Set(),
				totalEjerciciosSesion: 0,
				numeroSeries: 0,
				repeticiones: 0,
				volumen: 0,
			});
		}

		const realizacion = realizacionesPorFecha.get(claveFecha);

		realizacion.idsEjercicio.add(datosRegistro.idEjercicio);
		realizacion.totalEjerciciosSesion = Math.max(realizacion.totalEjerciciosSesion, datosRegistro.totalEjerciciosSesion);
		realizacion.numeroSeries += datosRegistro.numeroSeries;
		realizacion.repeticiones += datosRegistro.repeticiones;
		realizacion.volumen += datosRegistro.volumen;
	}

	return [...realizacionesPorFecha.values()]
		.map((realizacion) => ({
			fecha: realizacion.fecha,
			numeroEjercicios: realizacion.idsEjercicio.size,
			totalEjerciciosSesion: realizacion.totalEjerciciosSesion,
			numeroSeries: realizacion.numeroSeries,
			repeticiones: realizacion.repeticiones,
			volumen: realizacion.volumen,
			completada: realizacion.totalEjerciciosSesion > 0 && realizacion.idsEjercicio.size >= realizacion.totalEjerciciosSesion,
		}))
		.sort((a, b) => a.fecha - b.fecha);
}

// ---------------------------------------------------------
// Estadísticas derivadas
// ---------------------------------------------------------

function calcularFrecuenciaMedia(realizaciones) {
	if (realizaciones.length < 2) {
		return "Primera sesión";
	}

	let sumaDias = 0;

	for (let indice = 1; indice < realizaciones.length; indice++) {
		const diferencia = realizaciones[indice].fecha - realizaciones[indice - 1].fecha;
		sumaDias += diferencia / MILISEGUNDOS_DIA;
	}

	const mediaDias = sumaDias / (realizaciones.length - 1);

	return `cada ${formatearNumero(mediaDias, 1, 1)} días`;
}

function calcularTendenciaVolumen(realizaciones) {
	if (realizaciones.length < 2) {
		return "Primera sesión";
	}

	const numeroRealizaciones = realizaciones.length;
	let sumaX = 0;
	let sumaY = 0;
	let sumaXY = 0;
	let sumaXX = 0;

	realizaciones.forEach((realizacion, indice) => {
		sumaX += indice;
		sumaY += realizacion.volumen;
		sumaXY += indice * realizacion.volumen;
		sumaXX += indice * indice;
	});

	const denominador = numeroRealizaciones * sumaXX - sumaX * sumaX;
	const pendiente = denominador === 0 ? 0 : (numeroRealizaciones * sumaXY - sumaX * sumaY) / denominador;

	return `${pendiente >= 0 ? "+" : ""}${formatearNumero(pendiente)} por sesión`;
}

function calcularRachaSesionesCompletadas(realizaciones) {
	let racha = 0;
	let semanaAnterior = null;

	for (let indice = realizaciones.length - 1; indice >= 0; indice--) {
		const realizacion = realizaciones[indice];

		if (!realizacion.completada) {
			break;
		}

		const semana = obtenerInicioSemana(realizacion.fecha);

		if (semanaAnterior !== null && semanaAnterior - semana > MILISEGUNDOS_SEMANA) {
			break;
		}

		racha++;
		semanaAnterior = semana;
	}

	return racha;
}

function calcularRachaSesionesConMejora(realizaciones) {
	if (realizaciones.length < 2) {
		return 0;
	}

	let racha = 0;

	for (let indice = realizaciones.length - 1; indice > 0; indice--) {
		if (realizaciones[indice].volumen <= realizaciones[indice - 1].volumen) {
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

function calcularRachaSemanas(realizaciones) {
	if (!realizaciones.length) {
		return 0;
	}

	const inicioSemanaActual = obtenerInicioSemana(new Date());
	const inicioSemanaUltimaRealizacion = obtenerInicioSemana(realizaciones.at(-1).fecha);

	if (inicioSemanaUltimaRealizacion !== inicioSemanaActual) {
		return 0;
	}

	const semanas = new Set(realizaciones.map((realizacion) => obtenerInicioSemana(realizacion.fecha)));

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

function calcularRecordsHistoricos(realizaciones) {
	return {
		numeroEjercicios: obtenerMaximo(realizaciones, "numeroEjercicios"),
		numeroSeries: obtenerMaximo(realizaciones, "numeroSeries"),
		repeticiones: obtenerMaximo(realizaciones, "repeticiones"),
		volumen: obtenerMaximo(realizaciones, "volumen"),
	};
}

function calcularRecordsAnteriores(realizaciones) {
	return realizaciones.length > 1
		? calcularRecordsHistoricos(realizaciones.slice(0, -1))
		: {
			numeroEjercicios: 0,
			numeroSeries: 0,
			repeticiones: 0,
			volumen: 0,
		};
}

function calcularNuevosRecordsUltimaRealizacion(realizaciones) {
	const ultimaRealizacion = realizaciones.at(-1);
	const recordsAnteriores = calcularRecordsAnteriores(realizaciones);

	return {
		volumen: obtenerNuevoRecord(ultimaRealizacion.volumen, recordsAnteriores.volumen),
		numeroSeries: obtenerNuevoRecord(ultimaRealizacion.numeroSeries, recordsAnteriores.numeroSeries),
		repeticiones: obtenerNuevoRecord(ultimaRealizacion.repeticiones, recordsAnteriores.repeticiones),
		numeroEjercicios: obtenerNuevoRecord(ultimaRealizacion.numeroEjercicios, recordsAnteriores.numeroEjercicios),
	};
}

function calcularEstadisticasSesion(realizaciones) {
	const ultimaRealizacion = realizaciones.at(-1);
	const recordsHistoricos = calcularRecordsHistoricos(realizaciones);
	const mejorVolumen = recordsHistoricos.volumen;

	return {
		volumenActual: ultimaRealizacion.volumen,
		porcentajeMejorVolumen: (ultimaRealizacion.volumen / mejorVolumen) * 100,
		recordsHistoricos,
		frecuenciaMedia: calcularFrecuenciaMedia(realizaciones),
		tendenciaVolumen: calcularTendenciaVolumen(realizaciones),
		nuevosRecords: calcularNuevosRecordsUltimaRealizacion(realizaciones),
		rachaSesionesCompletadas: calcularRachaSesionesCompletadas(realizaciones),
		rachaSesionesConMejora: calcularRachaSesionesConMejora(realizaciones),
		rachaSemanas: calcularRachaSemanas(realizaciones),
	};
}

// ---------------------------------------------------------
// Mostrar estadísticas
// ---------------------------------------------------------

function mostrarNuevosRecords(nuevosRecords) {
	const records = [
		{
			id: "record-ultima-sesion-volumen",
			valor: nuevosRecords.volumen,
			formatear: (valor) => `${formatearNumero(valor)}`,
		},
		{
			id: "record-ultima-sesion-series",
			valor: nuevosRecords.numeroSeries,
			formatear: (valor) => formatearNumero(valor),
		},
		{
			id: "record-ultima-sesion-repeticiones",
			valor: nuevosRecords.repeticiones,
			formatear: (valor) => formatearNumero(valor),
		},
		{
			id: "record-ultima-sesion-ejercicios",
			valor: nuevosRecords.numeroEjercicios,
			formatear: (valor) => formatearNumero(valor),
		},
	];

	let numeroRecordsNuevos = 0;

	for (const record of records) {
		const elemento = document.getElementById(record.id);

		if (record.valor !== null) {
			elemento.classList.remove("hidden");
			elemento.querySelector("dd").textContent = record.formatear(record.valor);
			numeroRecordsNuevos++;
		} else {
			elemento.classList.add("hidden");
		}
	}

	const mensajeSinRecords = document.getElementById("sin-nuevos-records");

	if (numeroRecordsNuevos === 0) {
		mensajeSinRecords.classList.remove("hidden");
	} else {
		mensajeSinRecords.classList.add("hidden");
	}
}

function mostrarEstadisticas(estadisticas) {
	const {
		volumenActual,
		porcentajeMejorVolumen,
		recordsHistoricos,
		frecuenciaMedia,
		tendenciaVolumen,
		nuevosRecords,
		rachaSesionesCompletadas,
		rachaSesionesConMejora,
		rachaSemanas,
	} = estadisticas;

	mostrarTexto("volumen-actual", formatearNumero(volumenActual));
	mostrarTexto("porcentaje-mejor-volumen", `${formatearNumero(porcentajeMejorVolumen, 1)}%`);
	mostrarTexto("frecuencia-media", frecuenciaMedia);
	mostrarTexto("tendencia-volumen", tendenciaVolumen);
	mostrarTexto("record-ejercicios", formatearNumero(recordsHistoricos.numeroEjercicios));
	mostrarTexto("record-series", formatearNumero(recordsHistoricos.numeroSeries));
	mostrarTexto("record-repeticiones", formatearNumero(recordsHistoricos.repeticiones));
	mostrarTexto("record-volumen", `${formatearNumero(recordsHistoricos.volumen)}`);
	mostrarTexto("racha-sesiones-completadas", formatearNumero(rachaSesionesCompletadas));
	mostrarTexto("racha-sesiones-mejora", formatearNumero(rachaSesionesConMejora));
	mostrarTexto("racha-semanas", formatearNumero(rachaSemanas));

	mostrarNuevosRecords(nuevosRecords);
}

// ---------------------------------------------------------
// Gráfico
// ---------------------------------------------------------

function crearGraficoVolumen(realizaciones) {
	const datos = realizaciones.map((realizacion) => ({
		x: realizacion.fecha.getTime(),
		y: realizacion.volumen,
	}));

	new Chart(document.getElementById("grafico-volumen"), {
		type: "line",

		data: {
			datasets: [
				{
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
						label: (elemento) => `Volumen: ${formatearNumero(elemento.parsed.y)}`,
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
					beginAtZero: true,
					ticks: {
						callback: (valor) => formatearNumero(valor),
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
		// Leee los parámetros de la URL para obtener el número de sesión
		const parametros = new URLSearchParams(location.search);
		const numeroSesion = Number(parametros.get("numeroSesion"));
		if (!Number.isInteger(numeroSesion) || numeroSesion <= 0) {
			throw new Error("La URL debe incluir un 'numeroSesion' válido.");
		}
		titulo.textContent = `Sesion ${numeroSesion}`;
		document.title = `SIMPLEGYM - Sesion ${numeroSesion}`;

		const realizaciones = await obtenerRealizacionesSesion(numeroSesion);
		if (!realizaciones.length) {
			throw new Error("No hay histórico de la sesión.");
		}

		subtitulo.textContent = `${realizaciones.length} ${realizaciones.length === 1 ? "realización registrada" : "realizaciones registradas"
			}`;
		crearGraficoVolumen(realizaciones);

		const estadisticas = calcularEstadisticasSesion(realizaciones);
		mostrarEstadisticas(estadisticas);
	} catch (error) {
		console.error(error);
		titulo.textContent = "Error";
		subtitulo.textContent = error.message || "No se pudo cargar el progreso de volumen.";
		document.getElementById("main-container").style.display = "none";
	}
}

inicializar();
