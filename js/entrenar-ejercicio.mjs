import { cargarEjercicios, cargarRegistrosEjercicio, guardarRegistroEjercicio } from "./database.mjs";

const IMAGEN_PLACEHOLDER = "images/placeholder.svg";

const limitar = (valor, minimo, maximo) => Math.min(Math.max(valor, minimo), maximo);

/* =========================================================
   Series de aproximación
   ========================================================= */

function calcularSeriesAproximacion(ejercicio, pesoObjetivo) {
	const numeroSeries = ejercicio.series_aproximacion;
	const series = [];
	if (numeroSeries < 1) return series;

	const calcularPeso = (porcentaje, redondear) => {
		const peso = Math.max(
			ejercicio.incremento_peso,
			redondear((porcentaje * pesoObjetivo) / (100 * ejercicio.incremento_peso)) * ejercicio.incremento_peso,
		);
		return limitar(peso, ejercicio.incremento_peso, pesoObjetivo);
	};

	// Primera aproximación: 50 %.
	const peso1 = calcularPeso(50, Math.trunc);

	// Si el peso de la primera aproximación es mayor o igual al peso objetivo, no hacemos series de aproximación.
	if (peso1 >= pesoObjetivo) return series;

	series.push({
		peso: peso1,
		repeticiones: limitar(Math.round((ejercicio.repeticiones_min + ejercicio.repeticiones_max) / 2), 10, 12),
		descanso: limitar(Math.round(ejercicio.descanso / 2), 45, 90),
	});

	// Si solo hay una serie, hemos acabado.
	if (numeroSeries === 1) return series;

	// Segunda aproximación: 70 %.
	const peso2 = calcularPeso(70, Math.round);

	// Si el peso de la segunda aproximación es mayor o igual al peso objetivo o que el de la primera, no hacemos la segunda aproximación.
	if (peso2 >= pesoObjetivo || peso1 >= peso2) return series;

	series.push({
		peso: peso2,
		repeticiones: limitar(Math.trunc(ejercicio.repeticiones_min / 2), 4, 6),
		descanso: limitar(Math.round(ejercicio.descanso * 0.8), 75, 150),
	});

	return series;
}

/* =========================================================
   Ejercicio
   ========================================================= */

function obtenerEjercicio(ejercicios, idEjercicio) {
	const ejercicio = ejercicios.find((ejercicio) => Number(ejercicio.id) === idEjercicio);

	if (!ejercicio) {
		throw new Error(`No se encontró el ejercicio ${idEjercicio}.`);
	}

	return ejercicio;
}

function mostrarEjercicio(elementosDom, ejercicio) {
	const { imagenEjercicio, descripcionEjercicio, seriesTrabajo, rangoRepeticiones, rir, descanso } = elementosDom;

	imagenEjercicio.src = ejercicio.imagen || IMAGEN_PLACEHOLDER;
	imagenEjercicio.alt = ejercicio.nombre;
	imagenEjercicio.loading = "lazy";
	imagenEjercicio.decoding = "async";
	imagenEjercicio.onerror = () => {
		imagenEjercicio.onerror = null;
		imagenEjercicio.src = IMAGEN_PLACEHOLDER;
	};

	descripcionEjercicio.textContent = ejercicio.descripcion;
	seriesTrabajo.textContent = ejercicio.series_trabajo;
	rangoRepeticiones.textContent = `${ejercicio.repeticiones_min}-${ejercicio.repeticiones_max}`;
	rir.textContent = ejercicio.rir;
	descanso.textContent = ejercicio.descanso;
}

/* =========================================================
   Histórico y objetivos
   ========================================================= */

function obtenerUltimoRegistro(registrosEjercicio, idEjercicio) {
	return registrosEjercicio.reduce((ultimo, registro) => {
		if (registro.idEjercicio !== idEjercicio) return ultimo;
		return !ultimo || registro.fecha > ultimo.fecha ? registro : ultimo;
	}, null);
}

function calcularObjetivos(ejercicio, ultimoRegistro) {
	let pesoObjetivo;
	let repeticionesObjetivo;

	if (!ultimoRegistro) {
		// No hay registros previos, usamos los valores mínimos del ejercicio.
		pesoObjetivo = ejercicio.incremento_peso;
		repeticionesObjetivo = ejercicio.repeticiones_min;
	} else {
		pesoObjetivo = Number(ultimoRegistro.peso);
		repeticionesObjetivo = Number(ultimoRegistro.repeticiones) + 1;

		if (repeticionesObjetivo > ejercicio.repeticiones_max) {
			// Hemos llegado al máximo de repeticiones, subimos el peso y reiniciamos las repeticiones al mínimo.
			pesoObjetivo += ejercicio.incremento_peso;
			repeticionesObjetivo = ejercicio.repeticiones_min;
		} else if (repeticionesObjetivo < ejercicio.repeticiones_min) {
			// las repeticiones del último registro son menores que el mínimo: Bajamos el peso y ponemos las repeticiones al máximo.
			pesoObjetivo -= ejercicio.incremento_peso;
			pesoObjetivo = Math.max(pesoObjetivo, ejercicio.incremento_peso);
			repeticionesObjetivo = ejercicio.repeticiones_max;
		}
	}

	return {
		pesoObjetivo,
		repeticionesObjetivo,
		seriesDeAproximacion: calcularSeriesAproximacion(ejercicio, pesoObjetivo),
	};
}

/* =========================================================
   Interfaz de la serie
   ========================================================= */

// Muestra las repeticiones y el peso objetivo de la serie que toca a continuación.
function mostrarObjetivoSerie(elementosDom, estado, objetivos) {
	const serieAproximacion = objetivos.seriesDeAproximacion[estado.numeroSeriesAproximacionTerminadas];

	elementosDom.repeticionesObjetivo.textContent = serieAproximacion?.repeticiones ?? objetivos.repeticionesObjetivo;
	elementosDom.pesoObjetivo.textContent = `${serieAproximacion?.peso ?? objetivos.pesoObjetivo}`;
}

// Restaura el texto del botón de la serie (al terminar el descanso).
function mostrarTextoBotonSerie(elementosDom, estado, objetivos) {
	const serieAproximacion = objetivos.seriesDeAproximacion[estado.numeroSeriesAproximacionTerminadas];

	elementosDom.btnSerie.textContent = serieAproximacion
		? `Terminé la serie de aproximación ${estado.numeroSeriesAproximacionTerminadas + 1}`
		: `Terminé la serie ${estado.numeroSeriesTrabajoTerminadas + 1}`;
}

/* =========================================================
   Estado final
   ========================================================= */

function mostrarEjercicioCompletado(elementosDom) {
	const { btnSerie, tarjetaFinalizar } = elementosDom;
	btnSerie.disabled = true;
	btnSerie.classList.add("hidden");

	tarjetaFinalizar.classList.remove("hidden");
}

/* =========================================================
   Descanso
   ========================================================= */

function iniciarDescanso(elementosDom, segundos, estado, objetivos) {
	const { btnSerie } = elementosDom;
	const finDescanso = Date.now() + segundos * 1000;

	btnSerie.classList.add("btn-disabled");
	btnSerie.disabled = true;

	function actualizar() {
		const segundosRestantes = Math.max(0, Math.ceil((finDescanso - Date.now()) / 1000));
		const minutos = Math.floor(segundosRestantes / 60);
		const segundos = segundosRestantes % 60;

		btnSerie.textContent = `${String(minutos).padStart(2, "0")}:${String(segundos).padStart(2, "0")}`;

		if (segundosRestantes === 0) {
			btnSerie.classList.remove("btn-disabled");
			btnSerie.disabled = false;
			estado.inicioSerie = Date.now();
			mostrarTextoBotonSerie(elementosDom, estado, objetivos);
			return;
		}

		setTimeout(actualizar, 200);
	}

	actualizar();
}

/* =========================================================
   Finalizar serie
   ========================================================= */

function finalizarSerie(elementosDom, ejercicio, estado, objetivos) {
	const serieAproximacion = objetivos.seriesDeAproximacion[estado.numeroSeriesAproximacionTerminadas];
	const repeticiones = serieAproximacion?.repeticiones ?? objetivos.repeticionesObjetivo;
	const tiempoTranscurrido = Math.trunc((Date.now() - estado.inicioSerie) / 1000);
	const tiempoObjetivo = repeticiones * 6;

	if (tiempoTranscurrido < tiempoObjetivo) {
		const diferencia = Math.trunc(tiempoObjetivo - tiempoTranscurrido);
		alert(`Has ido ${diferencia} segundo${diferencia !== 1 ? "s" : ""} demasiado rápido.`);
	}

	// Determinamos qué serie acabamos de terminar y cuánto descansar.
	let descanso;
	if (serieAproximacion) {
		estado.numeroSeriesAproximacionTerminadas++;
		descanso = serieAproximacion.descanso;
	} else {
		estado.numeroSeriesTrabajoTerminadas++;
		if (estado.numeroSeriesTrabajoTerminadas >= ejercicio.series_trabajo) {
			mostrarEjercicioCompletado(elementosDom);
			return;
		}
		descanso = ejercicio.descanso;
	}

	// Mostramos ya el objetivo de la siguiente serie para poder preparar el peso durante el descanso.
	mostrarObjetivoSerie(elementosDom, estado, objetivos);
	iniciarDescanso(elementosDom, descanso, estado, objetivos);
}

/* =========================================================
   Guardar registro de ejercicio
   ========================================================= */

async function guardarResultado(elementosDom, ejercicio, numeroSesion, totalEjerciciosSesion) {
	const pesoStr = elementosDom.pesoFinal.value.trim();
	const repStr = elementosDom.repeticionesFinal.value.trim();
	if (!pesoStr || !repStr) throw new Error("Introduce peso y repeticiones.");
	const peso = Number(pesoStr);
	const repeticiones = Number(repStr);
	if (!Number.isFinite(peso) || peso <= 0) throw new Error("Peso inválido.");
	if (!Number.isInteger(repeticiones) || repeticiones <= 0) throw new Error("Repeticiones inválidas.");

	await guardarRegistroEjercicio({
		idEjercicio: ejercicio.id,
		numeroSesion,
		totalEjercicios: totalEjerciciosSesion,
		fecha: new Date(),
		numeroSeries: ejercicio.series_trabajo,
		peso,
		repeticiones,
	});

	location.href = `sesion.html?numeroSesion=${numeroSesion}`;
}

/* =========================================================
   Parámetros de la URL
   ========================================================= */

function obtenerParametros() {
	const parametros = new URLSearchParams(location.search);
	const idEjercicio = Number(parametros.get("idEjercicio"));
	const numeroSesion = Number(parametros.get("numeroSesion"));
	const totalEjerciciosSesion = Number(parametros.get("totalEjerciciosSesion"));

	if (!Number.isInteger(idEjercicio) || idEjercicio <= 0) throw new Error("La URL debe incluir un idEjercicio válido.");
	if (!Number.isInteger(numeroSesion) || numeroSesion <= 0) throw new Error("La URL debe incluir un numeroSesion válido.");
	if (!Number.isInteger(totalEjerciciosSesion) || totalEjerciciosSesion < 0)
		throw new Error("La URL debe incluir un totalEjerciciosSesion válido.");

	return { idEjercicio, numeroSesion, totalEjerciciosSesion };
}

/* =========================================================
   Inicialización
   ========================================================= */

function obtenerElementosDom() {
	return {
		titulo: document.getElementById("titulo"),
		subtitulo: document.getElementById("subtitulo"),
		enlaceSalir: document.getElementById("enlace-salir"),
		imagenEjercicio: document.getElementById("imagen-ejercicio"),
		descripcionEjercicio: document.getElementById("descripcion-ejercicio"),
		seriesTrabajo: document.getElementById("series-trabajo"),
		rangoRepeticiones: document.getElementById("rango-repeticiones"),
		rir: document.getElementById("rir"),
		descanso: document.getElementById("descanso"),
		repeticionesObjetivo: document.getElementById("repeticiones-objetivo"),
		pesoObjetivo: document.getElementById("peso-objetivo"),
		btnSerie: document.getElementById("btn-serie"),
		btnGuardar: document.getElementById("btn-guardar"),
		tarjetaFinalizar: document.getElementById("tarjeta-finalizar"),
		pesoFinal: document.getElementById("peso-final"),
		repeticionesFinal: document.getElementById("repeticiones-final"),
		mainContainer: document.getElementById("main-container"),
	};
}

async function inicializar() {
	const elementosDom = obtenerElementosDom();

	try {
		const parametros = obtenerParametros();

		// ---------- Salir ----------
		elementosDom.enlaceSalir.href = `sesion.html?numeroSesion=${parametros.numeroSesion}`;

		const [ejercicios, registrosEjercicio] = await Promise.all([cargarEjercicios(), cargarRegistrosEjercicio()]);
		const ejercicio = obtenerEjercicio(ejercicios, parametros.idEjercicio);

		elementosDom.titulo.textContent = ejercicio.nombre;

		mostrarEjercicio(elementosDom, ejercicio);

		const ultimoRegistro = obtenerUltimoRegistro(registrosEjercicio, ejercicio.id);
		const objetivos = calcularObjetivos(ejercicio, ultimoRegistro);
		elementosDom.pesoFinal.value = objetivos.pesoObjetivo;
		elementosDom.repeticionesFinal.value = objetivos.repeticionesObjetivo;

		const estado = {
			numeroSeriesAproximacionTerminadas: 0,
			numeroSeriesTrabajoTerminadas: 0,
			inicioSerie: Date.now(),
		};
		mostrarObjetivoSerie(elementosDom, estado, objetivos);
		mostrarTextoBotonSerie(elementosDom, estado, objetivos);

		/* ---------- Botón de serie ---------- */
		elementosDom.btnSerie.addEventListener("click", () => {
			// Protección contra dobles clics.
			elementosDom.btnSerie.disabled = true;
			finalizarSerie(elementosDom, ejercicio, estado, objetivos);
		});

		/* ---------- Botón guardar ---------- */
		elementosDom.btnGuardar.addEventListener("click", async () => {
			elementosDom.btnGuardar.disabled = true;
			try {
				await guardarResultado(elementosDom, ejercicio, parametros.numeroSesion, parametros.totalEjerciciosSesion);
			} catch (error) {
				elementosDom.btnGuardar.disabled = false;
				console.error(error);
				alert(error?.message || error);
			}
		});
	} catch (error) {
		console.error(error);
		elementosDom.titulo.textContent = "Error";
		elementosDom.subtitulo.textContent = error.message || "No se pudo cargar el ejercicio.";
		elementosDom.mainContainer.style.display = "none";
	}
}

inicializar();