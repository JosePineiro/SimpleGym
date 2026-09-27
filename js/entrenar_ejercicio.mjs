import { cargarEjercicios, cargarRegistrosEjercicio, guardarRegistroEjercicio } from "./database.mjs";

const EJERCICIOS_INICIO_SESION = 2;
const IMAGEN_PLACEHOLDER = "images/placeholder.svg";

/* =========================================================
   Series de aproximación
   ========================================================= */

function calcularSeriesAproximacion(ejercicio, pesoObjetivo, pesoUltimoRegistro, numeroEjerciciosCompletados) {
	let numeroSeries = ejercicio.series_aproximacion;

	// Después de los primeros ejercicios de la sesión, si no subimos peso, hacemos una aproximación menos.
	if (numeroEjerciciosCompletados >= EJERCICIOS_INICIO_SESION && pesoObjetivo <= pesoUltimoRegistro) {
		numeroSeries--;
	}

	if (numeroSeries < 1) {
		return [];
	}

	const limitar = (valor, minimo, maximo) => Math.min(Math.max(valor, minimo), maximo);

	const calcularPeso = (porcentaje, redondear) =>
		Math.max(
			ejercicio.incremento_peso,
			redondear((porcentaje * pesoObjetivo) / (100 * ejercicio.incremento_peso)) * ejercicio.incremento_peso,
		);

	const descanso = limitar(Math.round(ejercicio.descanso / 2), 60, 90);

	const series = [];

	// Primera aproximación: 50 %.
	const peso1 = calcularPeso(50, Math.trunc);

	// Si el peso de la primera aproximación es mayor o igual al peso objetivo, no hacemos series de aproximación.
	if (peso1 >= pesoObjetivo) {
		return [];
	}

	series.push({
		peso: peso1,
		repeticiones: limitar(Math.round((ejercicio.repeticiones_min + ejercicio.repeticiones_max) / 2), 8, 13) - 1,
		descanso,
	});

	// Segunda aproximación: 70 %.
	if (numeroSeries >= 2) {
		const peso2 = calcularPeso(70, Math.round);

		// Si el peso de la segunda aproximación es mayor o igual al peso objetivo o que el de la primera, no hacemos la segunda aproximación.
		if (peso2 > peso1 && peso2 < pesoObjetivo) {
			series.push({
				peso: peso2,
				repeticiones: limitar(Math.trunc(ejercicio.repeticiones_min / 2), 3, 5),
				descanso,
			});
		}
	}

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

function mostrarEjercicio(ejercicio) {
	document.getElementById("tituloEjercicio").textContent = ejercicio.nombre;
	document.getElementById("descripcionEjercicio").textContent = ejercicio.descripcion;

	const imagen = document.getElementById("imagenEjercicio");
	imagen.src = ejercicio.imagen || IMAGEN_PLACEHOLDER;
	imagen.alt = ejercicio.nombre;
	imagen.loading = "lazy";
	imagen.decoding = "async";

	imagen.onerror = () => {
		imagen.onerror = null;
		imagen.src = IMAGEN_PLACEHOLDER;
	};

	document.getElementById("numeroSeriesEjercicio").textContent = ejercicio.series_trabajo;
	document.getElementById("rangoRepeticionesEjercicio").textContent = `${ejercicio.repeticiones_min}-${ejercicio.repeticiones_max}`;
	document.getElementById("rirEjercicio").textContent = ejercicio.rir;
	document.getElementById("descansoEjercicio").textContent = ejercicio.descanso;
}

/* =========================================================
   Histórico y objetivos
   ========================================================= */

function obtenerUltimoRegistro(registrosEjercicio, idEjercicio) {
	return registrosEjercicio
		.filter((registro) => registro.idEjercicio === idEjercicio)
		.reduce((ultimo, registro) => (!ultimo || registro.fecha > ultimo.fecha ? registro : ultimo), null);
}

function calcularObjetivos(ejercicio, ultimoRegistro, numeroEjerciciosCompletados) {
	let pesoObjetivo;
	let repeticionesObjetivo;

	if (!ultimoRegistro) {
		// No hay registros previos, usamos los valores mínimos del ejercicio.
		pesoObjetivo = ejercicio.incremento_peso;
		repeticionesObjetivo = ejercicio.repeticiones_min;
	} else {
		pesoObjetivo = Number(ultimoRegistro.peso);
		repeticionesObjetivo = Number(ultimoRegistro.repeticiones) + 1; // Aumentamos las repeticiones en 1.

		if (repeticionesObjetivo > ejercicio.repeticiones_max) {
			// Hemos llegado al máximo de repeticiones, subimos el peso y reiniciamos las repeticiones al mínimo.
			pesoObjetivo += ejercicio.incremento_peso;
			repeticionesObjetivo = ejercicio.repeticiones_min;
		} else if (repeticionesObjetivo < ejercicio.repeticiones_min - 1) {
			// las repeticiones del último registro son menores que el mínimo: Bajamos el peso y ponemos las repeticiones al máximo.
			pesoObjetivo -= ejercicio.incremento_peso;
			repeticionesObjetivo = ejercicio.repeticiones_max;
		}
	}

	const pesoUltimoRegistro = ultimoRegistro ? Number(ultimoRegistro.peso) : pesoObjetivo;

	return {
		pesoObjetivo,
		repeticionesObjetivo,
		seriesDeAproximacion: calcularSeriesAproximacion(ejercicio, pesoObjetivo, pesoUltimoRegistro, numeroEjerciciosCompletados),
	};
}

/* =========================================================
   Interfaz de la serie
   ========================================================= */

function obtenerSerieActual(seriesDeAproximacion, numeroSeriesAproximacionTerminadas) {
	return seriesDeAproximacion[numeroSeriesAproximacionTerminadas] ?? null;
}

function obtenerTextoBotonSerie(estado, seriesDeAproximacion) {
	const serieAproximacion = obtenerSerieActual(seriesDeAproximacion, estado.numeroSeriesAproximacionTerminadas);

	if (serieAproximacion) {
		return `Terminé la serie de aproximación ${estado.numeroSeriesAproximacionTerminadas + 1}`;
	}

	return `Terminé la serie ${estado.numeroSeriesTrabajoTerminadas + 1}`;
}

function mostrarObjetivoSerie(estado, objetivos) {
	const serieAproximacion = obtenerSerieActual(objetivos.seriesDeAproximacion, estado.numeroSeriesAproximacionTerminadas);

	document.getElementById("repeticionesObjetivo").textContent = serieAproximacion?.repeticiones ?? objetivos.repeticionesObjetivo;
	document.getElementById("pesoObjetivo").textContent = `${serieAproximacion?.peso ?? objetivos.pesoObjetivo} kg`;
	document.getElementById("botonSerie").textContent = obtenerTextoBotonSerie(estado, objetivos.seriesDeAproximacion);
}

/* =========================================================
   Estado final
   ========================================================= */

function mostrarEjercicioCompletado() {
	const botonSerie = document.getElementById("botonSerie");
	botonSerie.disabled = true;
	botonSerie.classList.add("hidden");

	document.getElementById("tarjetaFinalizar").classList.remove("hidden");
}

/* =========================================================
   Descanso
   ========================================================= */

function iniciarDescanso(segundos, alTerminar) {
	const boton = document.getElementById("botonSerie");
	const finDescanso = Date.now() + segundos * 1000;

	boton.classList.add("btn-disabled");
	boton.disabled = true;

	function actualizar() {
		const segundosRestantes = Math.max(0, Math.ceil((finDescanso - Date.now()) / 1000));
		const minutos = Math.floor(segundosRestantes / 60);
		const segundos = segundosRestantes % 60;

		boton.textContent = `${String(minutos).padStart(2, "0")}:${String(segundos).padStart(2, "0")}`;

		if (segundosRestantes === 0) {
			boton.classList.remove("btn-disabled");
			boton.disabled = false;
			alTerminar();
			return;
		}

		setTimeout(actualizar, 200);
	}

	actualizar();
}

/* =========================================================
   Finalizar serie
   ========================================================= */

function finalizarSerie(ejercicio, estado, objetivos) {
	const serieAproximacion = obtenerSerieActual(objetivos.seriesDeAproximacion, estado.numeroSeriesAproximacionTerminadas);
	const repeticiones = serieAproximacion?.repeticiones ?? objetivos.repeticionesObjetivo;
	const tiempoTranscurrido = Math.trunc((Date.now() - estado.inicioSerie) / 1000);

	let tiempoObjetivo = repeticiones * 6;

	if (serieAproximacion) {
		tiempoObjetivo /= 2;
	}

	if (tiempoTranscurrido < tiempoObjetivo) {
		const diferencia = Math.trunc(tiempoObjetivo - tiempoTranscurrido);
		alert(`Has ido ${diferencia} segundo${diferencia !== 1 ? "s" : ""} demasiado rápido.`);
	}

	/* ---------- Serie de aproximación ---------- */

	if (serieAproximacion) {
		estado.numeroSeriesAproximacionTerminadas++;

		iniciarDescanso(serieAproximacion.descanso, () => {
			estado.inicioSerie = Date.now();
			mostrarObjetivoSerie(estado, objetivos);
		});

		return;
	}

	/* ---------- Serie de trabajo ---------- */

	estado.numeroSeriesTrabajoTerminadas++;
	if (estado.numeroSeriesTrabajoTerminadas >= ejercicio.series_trabajo) {
		mostrarEjercicioCompletado();
		return;
	}

	iniciarDescanso(ejercicio.descanso, () => {
		estado.inicioSerie = Date.now();
		mostrarObjetivoSerie(estado, objetivos);
	});
}

/* =========================================================
   Guardar registro de ejercicio
   ========================================================= */

async function guardarResultado(ejercicio, numeroSesion, totalEjerciciosSesion) {
	const peso = Number(document.getElementById("pesoFinal").value);
	const repeticiones = Number(document.getElementById("repeticionesFinal").value);

	if (!Number.isFinite(peso) || !Number.isFinite(repeticiones)) {
		throw new Error("Introduce peso y repeticiones válidos.");
	}

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
	const numeroEjerciciosCompletados = Number(parametros.get("numeroEjerciciosCompletados"));

	if (!Number.isInteger(idEjercicio) || idEjercicio <= 0) throw new Error("La URL debe incluir un idEjercicio válido.");
	if (!Number.isInteger(numeroSesion) || numeroSesion <= 0) throw new Error("La URL debe incluir un numeroSesion válido.");
	if (!Number.isInteger(totalEjerciciosSesion) || totalEjerciciosSesion < 0)
		throw new Error("La URL debe incluir un totalEjerciciosSesion válido.");
	if (!Number.isInteger(numeroEjerciciosCompletados) || numeroEjerciciosCompletados < 0)
		throw new Error("La URL debe incluir un numeroEjerciciosCompletados válido.");

	return { idEjercicio, numeroSesion, totalEjerciciosSesion, numeroEjerciciosCompletados };
}

/* =========================================================
   Inicialización
   ========================================================= */

async function inicializar() {
	try {
		const parametros = obtenerParametros();
		const [ejercicios, registrosEjercicio] = await Promise.all([cargarEjercicios(), cargarRegistrosEjercicio()]);
		const ejercicio = obtenerEjercicio(ejercicios, parametros.idEjercicio);
		mostrarEjercicio(ejercicio);

		const ultimoRegistro = obtenerUltimoRegistro(registrosEjercicio, ejercicio.id);
		const objetivos = calcularObjetivos(ejercicio, ultimoRegistro, parametros.numeroEjerciciosCompletados);
		document.getElementById("pesoFinal").value = objetivos.pesoObjetivo;
		document.getElementById("repeticionesFinal").value = objetivos.repeticionesObjetivo;

		const estado = {
			numeroSeriesAproximacionTerminadas: 0,
			numeroSeriesTrabajoTerminadas: 0,
			inicioSerie: Date.now(),
		};
		mostrarObjetivoSerie(estado, objetivos);

		/* ---------- Botón de serie ---------- */
		const botonSerie = document.getElementById("botonSerie");
		botonSerie.addEventListener("click", () => {
			// Protección contra dobles clics.
			botonSerie.disabled = true;
			finalizarSerie(ejercicio, estado, objetivos);
		});

		/* ---------- Botón guardar ---------- */
		const botonGuardar = document.getElementById("botonGuardar");
		botonGuardar.addEventListener("click", async () => {
			botonGuardar.disabled = true;
			try {
				await guardarResultado(ejercicio, parametros.numeroSesion, parametros.totalEjerciciosSesion);
			} catch (error) {
				botonGuardar.disabled = false;
				console.error(error);
				alert(error?.message || error);
			}
		});

		/* ---------- Salir ---------- */
		document.getElementById("enlaceSalir").href = `sesion.html?numeroSesion=${parametros.numeroSesion}`;
	} catch (error) {
		console.error(error);
		alert(`Error al iniciar: ${error?.message || error}`);
	}
}

inicializar();
