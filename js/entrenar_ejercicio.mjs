import { cargarEjercicios, cargarRegistrosEjercicio, guardarRegistroEjercicio } from "./database.mjs";

const IMAGEN_PLACEHOLDER = "images/placeholder.svg";

/* =========================================================
   Series de aproximación
   ========================================================= */

function calcularSeriesAproximacion(ejercicio, pesoObjetivo) {
	const numeroSeries = ejercicio.series_aproximacion;

	const series = [];

	if (numeroSeries < 1) return series;

	const limitar = (valor, minimo, maximo) => Math.min(Math.max(valor, minimo), maximo);
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

function mostrarEjercicio(ejercicio) {
	const imagen = document.getElementById("imagenEjercicio");
	imagen.src = ejercicio.imagen || IMAGEN_PLACEHOLDER;
	imagen.alt = ejercicio.nombre;
	imagen.loading = "lazy";
	imagen.decoding = "async";
	imagen.onerror = () => {
		imagen.onerror = null;
		imagen.src = IMAGEN_PLACEHOLDER;
	};

	document.getElementById("descripcionEjercicio").textContent = ejercicio.descripcion;
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

// Muestra las repeticiones y el peso objetivo de la serie que toca a continuación.
function mostrarObjetivoSerie(estado, objetivos) {
	const serieAproximacion = obtenerSerieActual(objetivos.seriesDeAproximacion, estado.numeroSeriesAproximacionTerminadas);

	document.getElementById("repeticionesObjetivo").textContent = serieAproximacion?.repeticiones ?? objetivos.repeticionesObjetivo;
	document.getElementById("pesoObjetivo").textContent = `${serieAproximacion?.peso ?? objetivos.pesoObjetivo}`;
}

// Restaura el texto del botón de la serie (al terminar el descanso).
function mostrarTextoBotonSerie(estado, objetivos) {
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

	const tiempoObjetivo = repeticiones * 6;

	if (tiempoTranscurrido < tiempoObjetivo) {
		const diferencia = Math.trunc(tiempoObjetivo - tiempoTranscurrido);
		alert(`Has ido ${diferencia} segundo${diferencia !== 1 ? "s" : ""} demasiado rápido.`);
	}

	/* ---------- Serie de aproximación ---------- */

	if (serieAproximacion) {
		estado.numeroSeriesAproximacionTerminadas++;

		// Mostramos ya el objetivo de la siguiente serie para poder preparar el peso durante el descanso.
		mostrarObjetivoSerie(estado, objetivos);

		iniciarDescanso(serieAproximacion.descanso, () => {
			estado.inicioSerie = Date.now();
			mostrarTextoBotonSerie(estado, objetivos);
		});

		return;
	}

	/* ---------- Serie de trabajo ---------- */

	estado.numeroSeriesTrabajoTerminadas++;
	if (estado.numeroSeriesTrabajoTerminadas >= ejercicio.series_trabajo) {
		mostrarEjercicioCompletado();
		return;
	}

	// Mostramos ya el objetivo de la siguiente serie para poder preparar el peso durante el descanso.
	mostrarObjetivoSerie(estado, objetivos);

	iniciarDescanso(ejercicio.descanso, () => {
		estado.inicioSerie = Date.now();
		mostrarTextoBotonSerie(estado, objetivos);
	});
}

/* =========================================================
   Guardar registro de ejercicio
   ========================================================= */

async function guardarResultado(ejercicio, numeroSesion, totalEjerciciosSesion) {
	const pesoStr = document.getElementById("pesoFinal").value.trim();
	const repStr = document.getElementById("repeticionesFinal").value.trim();
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

async function inicializar() {
	const titulo = document.getElementById("titulo");
	const subtitulo = document.getElementById("subtitulo");

	try {
		const parametros = obtenerParametros();

		// ---------- Salir ----------
		document.getElementById("enlaceSalir").href = `sesion.html?numeroSesion=${parametros.numeroSesion}`;

		const [ejercicios, registrosEjercicio] = await Promise.all([cargarEjercicios(), cargarRegistrosEjercicio()]);
		const ejercicio = obtenerEjercicio(ejercicios, parametros.idEjercicio);

		titulo.textContent = ejercicio.nombre;

		mostrarEjercicio(ejercicio);

		const ultimoRegistro = obtenerUltimoRegistro(registrosEjercicio, ejercicio.id);
		const objetivos = calcularObjetivos(ejercicio, ultimoRegistro);
		document.getElementById("pesoFinal").value = objetivos.pesoObjetivo;
		document.getElementById("repeticionesFinal").value = objetivos.repeticionesObjetivo;

		const estado = {
			numeroSeriesAproximacionTerminadas: 0,
			numeroSeriesTrabajoTerminadas: 0,
			inicioSerie: Date.now(),
		};
		mostrarObjetivoSerie(estado, objetivos);
		mostrarTextoBotonSerie(estado, objetivos);

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
	} catch (error) {
		console.error(error);
		titulo.textContent = "Error";
		subtitulo.textContent = error.message || "No se pudo cargar el ejercicio.";
		document.getElementById("main-container").style.display = "none";
	}
}

inicializar();
