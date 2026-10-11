import { cargarEjercicios, cargarHistorial, guardarHistorial } from "./database.mjs";
import { formatearNumero, obtenerParametrosURL } from "./utils.mjs";

const IMAGEN_PLACEHOLDER = "images/placeholder.svg";

const limitar = (valor, minimo, maximo) => Math.min(Math.max(valor, minimo), maximo);

/* =========================================================
   Progreso local (localStorage)
   ========================================================= */

// Guarda en el navegador las series ya hechas de un ejercicio, para no perderlas si el
// navegador del móvil descarga la página mientras está en segundo plano.
// La clave incluye el día (hora local): al cambiar de día el progreso anterior ya no
// se encuentra y, además, se limpia con `limpiarProgresoAntiguo`.

const PREFIJO_PROGRESO = "simplegym:progreso:";
const VERSION_PROGRESO = 1;

function fechaLocal() {
	// No usamos toISOString(): devuelve la fecha en UTC y cerca de medianoche daría el día equivocado.
	const ahora = new Date();
	const mes = String(ahora.getMonth() + 1).padStart(2, "0");
	const dia = String(ahora.getDate()).padStart(2, "0");
	return `${ahora.getFullYear()}-${mes}-${dia}`;
}

const claveProgreso = (idEjercicio) => `${PREFIJO_PROGRESO}${idEjercicio}:${fechaLocal()}`;

function guardarProgreso(idEjercicio, estado) {
	try {
		localStorage.setItem(
			claveProgreso(idEjercicio),
			JSON.stringify({
				version: VERSION_PROGRESO,
				numeroSeriesAproximacionTerminadas: estado.numeroSeriesAproximacionTerminadas,
				numeroSeriesTrabajoTerminadas: estado.numeroSeriesTrabajoTerminadas,
				inicioSerie: estado.inicioSerie,
				finDescanso: estado.finDescanso,
				borrador: estado.borrador,
			}),
		);
	} catch (error) {
		// Modo privado, almacenamiento lleno o bloqueado: la app sigue funcionando sin persistencia.
		console.warn("No se pudo guardar el progreso:", error);
	}
}

// Devuelve el progreso guardado hoy para este ejercicio o `null` si no hay (o está corrupto).
function leerProgreso(idEjercicio) {
	try {
		const datos = JSON.parse(localStorage.getItem(claveProgreso(idEjercicio)));
		if (!datos || datos.version !== VERSION_PROGRESO) return null;

		const esContador = (n) => Number.isInteger(n) && n >= 0;
		if (!esContador(datos.numeroSeriesAproximacionTerminadas) || !esContador(datos.numeroSeriesTrabajoTerminadas)) {
			return null;
		}

		const borrador =
			datos.borrador && typeof datos.borrador.peso === "string" && typeof datos.borrador.repeticiones === "string"
				? { peso: datos.borrador.peso, repeticiones: datos.borrador.repeticiones }
				: null;

		return {
			numeroSeriesAproximacionTerminadas: datos.numeroSeriesAproximacionTerminadas,
			numeroSeriesTrabajoTerminadas: datos.numeroSeriesTrabajoTerminadas,
			inicioSerie: Number.isFinite(datos.inicioSerie) ? datos.inicioSerie : Date.now(),
			finDescanso: Number.isFinite(datos.finDescanso) ? datos.finDescanso : 0,
			borrador,
		};
	} catch (error) {
		console.warn("No se pudo leer el progreso:", error);
		return null;
	}
}

function borrarProgreso(idEjercicio) {
	try {
		localStorage.removeItem(claveProgreso(idEjercicio));
	} catch (error) {
		console.warn("No se pudo borrar el progreso:", error);
	}
}

// Elimina el progreso de cualquier ejercicio que no sea de hoy.
function limpiarProgresoAntiguo() {
	try {
		const sufijoHoy = `:${fechaLocal()}`;
		const obsoletas = [];

		for (let i = 0; i < localStorage.length; i++) {
			const clave = localStorage.key(i);
			if (clave?.startsWith(PREFIJO_PROGRESO) && !clave.endsWith(sufijoHoy)) obsoletas.push(clave);
		}

		// Borramos después de recorrer: eliminar durante el recorrido altera los índices.
		for (const clave of obsoletas) localStorage.removeItem(clave);
	} catch (error) {
		console.warn("No se pudo limpiar el progreso antiguo:", error);
	}
}

// Vuelca el progreso guardado sobre `estado`, validándolo contra el ejercicio actual
// (por si la rutina o el histórico han cambiado desde que se guardó).
function restaurarProgreso(elementosDom, ejercicio, estado, objetivos) {
	const guardado = leerProgreso(ejercicio.id);
	if (!guardado) return;

	estado.numeroSeriesAproximacionTerminadas = limitar(
		guardado.numeroSeriesAproximacionTerminadas,
		0,
		objetivos.seriesDeAproximacion.length,
	);
	estado.numeroSeriesTrabajoTerminadas = limitar(guardado.numeroSeriesTrabajoTerminadas, 0, ejercicio.series_trabajo);
	estado.inicioSerie = guardado.inicioSerie;
	estado.finDescanso = guardado.finDescanso;
	estado.borrador = guardado.borrador;

	if (guardado.borrador) {
		elementosDom.pesoFinal.value = guardado.borrador.peso;
		elementosDom.repeticionesFinal.value = guardado.borrador.repeticiones;
	}
}

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

function obtenerUltimoRegistro(historial, idEjercicio) {
	// El histórico está ordenado por fecha ascendente, así que el último registro
	// coincidente es el más reciente (aunque haya varios con la misma fecha, que es
	// lo habitual porque la fecha solo guarda el día).
	return historial.findLast((r) => r.idEjercicio === idEjercicio) ?? null;
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
   Fase actual (aproximación o trabajo)
   ========================================================= */

function obtenerFase(estado, objetivos, ejercicio) {
	const aprox = objetivos.seriesDeAproximacion[estado.numeroSeriesAproximacionTerminadas];

	return aprox
		? {
			esAproximacion: true,
			peso: aprox.peso,
			repeticiones: aprox.repeticiones,
			descanso: aprox.descanso,
		}
		: {
			esAproximacion: false,
			peso: objetivos.pesoObjetivo,
			repeticiones: objetivos.repeticionesObjetivo,
			descanso: ejercicio.descanso,
		};
}

/* =========================================================
   Interfaz de la serie
   ========================================================= */

// Muestra las repeticiones y el peso objetivo de la serie que toca a continuación.
function mostrarObjetivoSerie(elementosDom, fase) {
	elementosDom.repeticionesObjetivo.textContent = fase.repeticiones;
	elementosDom.pesoObjetivo.textContent = formatearNumero(fase.peso, 1);
}

// Restaura el texto del botón de la serie (al terminar el descanso).
function mostrarTextoBotonSerie(elementosDom, estado, fase) {
	elementosDom.btnSerie.textContent = fase.esAproximacion
		? `Terminé la serie de aproximación ${estado.numeroSeriesAproximacionTerminadas + 1}`
		: `Terminé la serie ${estado.numeroSeriesTrabajoTerminadas + 1}`;
}

/* =========================================================
   Estado final
   ========================================================= */

function mostrarEjercicioCompletado(elementosDom) {
	const { btnSerie, tarjetaFinalizar } = elementosDom;
	btnSerie.disabled = true;
	btnSerie.hidden = true;
	tarjetaFinalizar.hidden = false;
}

/* =========================================================
   Sonido y vibración
   ========================================================= */

let audioContexto = null;

function reproducirPitido() {
	try {
		// Creamos el contexto de audio sólo la primera vez (los navegadores
		// requieren que se cree tras una interacción del usuario).
		if (!audioContexto) {
			audioContexto = new (window.AudioContext || window.webkitAudioContext)();
		}

		// Reanudamos el contexto por si el navegador lo suspendió.
		if (audioContexto.state === "suspended") {
			audioContexto.resume();
		}

		const ahora = audioContexto.currentTime;

		// Tres pitidos cortos (más audible que uno solo).
		const pitidos = [0, 0.25, 0.5];

		for (const retardo of pitidos) {
			const oscilador = audioContexto.createOscillator();
			const ganancia = audioContexto.createGain();

			oscilador.type = "sine";
			oscilador.frequency.value = 880; // La 5 (A5), agradable y clara.

			// Envolvente para que no haga "clic" al empezar/terminar.
			const inicio = ahora + retardo;
			const fin = inicio + 0.15;

			ganancia.gain.setValueAtTime(0, inicio);
			ganancia.gain.linearRampToValueAtTime(0.3, inicio + 0.01);
			ganancia.gain.linearRampToValueAtTime(0, fin);

			oscilador.connect(ganancia);
			ganancia.connect(audioContexto.destination);

			oscilador.start(inicio);
			oscilador.stop(fin + 0.02);
		}

		// navigator.vibrate sólo existe en navegadores móviles compatibles
		// (Chrome Android, Firefox Android, Edge Android, Samsung Internet...).
		// En iOS Safari NO existe, así que simplemente no hace nada.
		if (navigator.vibrate) {
			// Patrón: 3 pulsos de 200 ms separados por 100 ms de silencio.
			// Coincide con los 3 pitidos para que se sientan sincronizados.
			navigator.vibrate([200, 100, 200, 100, 200]);
		}
	} catch (error) {
		// Si falla el audio, no queremos romper el flujo de la app.
		console.warn("No se pudo reproducir el pitido:", error);
	}
}

/* =========================================================
   Descanso
   ========================================================= */

let intervaloDescanso = null;

// El descanso termina en `estado.finDescanso` (timestamp). Al depender de una hora absoluta
// y no de una cuenta atrás, sigue siendo correcto aunque el navegador pause los temporizadores
// en segundo plano o la página se recargue.
function iniciarDescanso(elementosDom, estado, objetivos, ejercicio) {
	const { btnSerie } = elementosDom;

	btnSerie.classList.add("btn-disabled");
	btnSerie.disabled = true;

	clearInterval(intervaloDescanso);

	const actualizar = () => {
		const restantes = Math.max(0, Math.ceil((estado.finDescanso - Date.now()) / 1000));
		btnSerie.textContent = `${String(Math.floor(restantes / 60)).padStart(2, "0")}:${String(restantes % 60).padStart(2, "0")}`;

		if (restantes === 0) {
			clearInterval(intervaloDescanso);
			btnSerie.classList.remove("btn-disabled");
			btnSerie.disabled = false;
			mostrarTextoBotonSerie(elementosDom, estado, obtenerFase(estado, objetivos, ejercicio));
			reproducirPitido();
		}
	};

	actualizar();
	intervaloDescanso = setInterval(actualizar, 200);
}

/* =========================================================
   Finalizar serie
   ========================================================= */

function finalizarSerie(elementosDom, ejercicio, estado, objetivos) {
	// Fase que acabamos de terminar (antes de tocar los contadores).
	const faseTerminada = obtenerFase(estado, objetivos, ejercicio);

	const tiempoTranscurrido = Math.trunc((Date.now() - estado.inicioSerie) / 1000);
	const tiempoObjetivo = faseTerminada.repeticiones * 6;

	if (tiempoTranscurrido < tiempoObjetivo) {
		const diferencia = Math.trunc(tiempoObjetivo - tiempoTranscurrido);
		alert(`Has ido ${diferencia} segundo${diferencia !== 1 ? "s" : ""} demasiado rápido.`);
	}

	// Avanzamos el contador correspondiente.
	if (faseTerminada.esAproximacion) {
		estado.numeroSeriesAproximacionTerminadas++;
	} else {
		estado.numeroSeriesTrabajoTerminadas++;
	}

	// El descanso acaba en `finDescanso` y en ese mismo instante empieza la siguiente serie.
	estado.finDescanso = Date.now() + faseTerminada.descanso * 1000;
	estado.inicioSerie = estado.finDescanso;

	// Guardamos el progreso en cada pulsación, antes de cualquier otra cosa.
	guardarProgreso(ejercicio.id, estado);

	if (estado.numeroSeriesTrabajoTerminadas >= ejercicio.series_trabajo) {
		mostrarEjercicioCompletado(elementosDom);
		return;
	}

	// Mostramos ya el objetivo de la siguiente serie para poder preparar el peso durante el descanso.
	mostrarObjetivoSerie(elementosDom, obtenerFase(estado, objetivos, ejercicio));
	iniciarDescanso(elementosDom, estado, objetivos, ejercicio);
}

/* =========================================================
   Guardar registro de ejercicio
   ========================================================= */

async function guardarResultado(elementosDom, historial, ejercicio, numeroSesion, totalEjerciciosSesion) {
	const pesoStr = elementosDom.pesoFinal.value.trim();
	const repStr = elementosDom.repeticionesFinal.value.trim();
	if (!pesoStr || !repStr) throw new Error("Introduce peso y repeticiones.");
	const peso = Number(pesoStr);
	const repeticiones = Number(repStr);
	if (!Number.isFinite(peso) || peso <= 0) throw new Error("Peso inválido.");
	if (!Number.isInteger(repeticiones) || repeticiones <= 0) throw new Error("Repeticiones inválidas.");

	// El nuevo registro va al final: el histórico queda ordenado por fecha ascendente.
	// No mutamos `historial`: creamos un array nuevo. Si `guardarHistorial` falla,
	// el histórico en memoria queda intacto y un reintento no duplica el registro.
	const historialActualizado = [
		...historial,
		{
			idEjercicio: ejercicio.id,
			numeroSesion,
			totalEjercicios: totalEjerciciosSesion,
			fecha: new Date(),
			numeroSeries: ejercicio.series_trabajo,
			peso,
			repeticiones,
		},
	];

	await guardarHistorial(historialActualizado);

	// El ejercicio ya está registrado en el histórico: descartamos el progreso temporal.
	borrarProgreso(ejercicio.id);

	location.href = `sesion.html?numeroSesion=${numeroSesion}`;
}

/* =========================================================
   Inicialización
   ========================================================= */

function obtenerElementosDom() {
	return {
		titulo: document.getElementById("titulo"),
		subtitulo: document.getElementById("subtitulo"),
		enlaceVolver: document.getElementById("enlace-volver"),
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
		formFinalizar: document.getElementById("form-finalizar"),
	};
}

async function inicializar() {
	const elementosDom = obtenerElementosDom();

	try {
		const [idEjercicio, numeroSesion, totalEjerciciosSesion] = obtenerParametrosURL(
			{ clave: "idEjercicio", validar: (n) => n > 0 },
			{ clave: "numeroSesion", validar: (n) => n > 0 },
			{ clave: "totalEjerciciosSesion", validar: (n) => n >= 0 }
		);

		// ---------- Volver ----------
		elementosDom.enlaceVolver.href = `sesion.html?numeroSesion=${numeroSesion}`;

		const [ejercicios, historial] = await Promise.all([cargarEjercicios(), cargarHistorial()]);
		const ejercicio = obtenerEjercicio(ejercicios, idEjercicio);

		elementosDom.titulo.textContent = ejercicio.nombre;

		mostrarEjercicio(elementosDom, ejercicio);

		const ultimoRegistro = obtenerUltimoRegistro(historial, ejercicio.id);
		const objetivos = calcularObjetivos(ejercicio, ultimoRegistro);
		elementosDom.pesoFinal.value = objetivos.pesoObjetivo;
		elementosDom.repeticionesFinal.value = objetivos.repeticionesObjetivo;

		const estado = {
			numeroSeriesAproximacionTerminadas: 0,
			numeroSeriesTrabajoTerminadas: 0,
			inicioSerie: Date.now(),
			finDescanso: 0,
			borrador: null,
		};

		// Recuperamos lo que ya se hizo hoy en este ejercicio (si el navegador recargó la página).
		limpiarProgresoAntiguo();
		restaurarProgreso(elementosDom, ejercicio, estado, objetivos);

		const faseActual = obtenerFase(estado, objetivos, ejercicio);
		mostrarObjetivoSerie(elementosDom, faseActual);

		if (estado.numeroSeriesTrabajoTerminadas >= ejercicio.series_trabajo) {
			mostrarEjercicioCompletado(elementosDom);
		} else if (estado.finDescanso > Date.now()) {
			// Seguimos en pleno descanso: retomamos la cuenta atrás con el tiempo que queda.
			iniciarDescanso(elementosDom, estado, objetivos, ejercicio);
		} else {
			// Sin descanso en curso (o ya terminó mientras la página estaba en segundo plano).
			mostrarTextoBotonSerie(elementosDom, estado, faseActual);
		}

		/* ---------- Botón de serie ---------- */
		elementosDom.btnSerie.addEventListener("click", () => {
			// Protección contra dobles clics.
			elementosDom.btnSerie.disabled = true;
			finalizarSerie(elementosDom, ejercicio, estado, objetivos);
		});

		/* ---------- Formulario de guardado ---------- */
		// Conservamos lo que se esté escribiendo en el formulario por si se pierde la página.
		elementosDom.formFinalizar.addEventListener("input", () => {
			estado.borrador = {
				peso: elementosDom.pesoFinal.value,
				repeticiones: elementosDom.repeticionesFinal.value,
			};
			guardarProgreso(ejercicio.id, estado);
		});

		elementosDom.formFinalizar.addEventListener("submit", async (evento) => {
			// Sin esto, el navegador recarga la página y cancela el guardado asíncrono.
			evento.preventDefault();

			elementosDom.btnGuardar.disabled = true;
			try {
				await guardarResultado(elementosDom, historial, ejercicio, numeroSesion, totalEjerciciosSesion);
			} catch (error) {
				elementosDom.btnGuardar.disabled = false;
				console.error(error);
				alert(error?.message || error);
			}
		});
	} catch (error) {
		elementosDom.mainContainer.hidden = true;
		elementosDom.titulo.textContent = "Error";
		elementosDom.subtitulo.textContent = error.message || "No se pudo cargar el ejercicio.";
		console.error(error);
	}
}

inicializar();