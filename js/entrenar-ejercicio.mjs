import { cargarEjercicios, cargarHistorial, guardarHistorial } from "./database.mjs";
import { formatearNumero, obtenerParametrosURL } from "./utils.mjs";

const IMAGEN_PLACEHOLDER = "images/placeholder.svg";

/**
 * @brief Limita un valor numérico al rango [minimo, maximo].
 * @param {number} valor - Valor a limitar.
 * @param {number} minimo - Cota inferior permitida.
 * @param {number} maximo - Cota superior permitida.
 * @returns {number} El valor acotado al rango indicado.
 * @example
 * limitar(150, 0, 100); // 100
 * limitar(-5, 0, 100);  // 0
 * limitar(42, 0, 100);  // 42
 */
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

/**
 * @brief Fecha local en formato ISO corto "YYYY-MM-DD".
 *
 * No se usa `toISOString()` porque devuelve la fecha en UTC y cerca de medianoche
 * podría devolver el día equivocado.
 *
 * @returns {string} Fecha local en formato ISO corto (p. ej. "2025-01-15").
 * @example
 * fechaLocal(); // "2025-01-15"
 */
function fechaLocal() {
	const ahora = new Date();
	const mes = String(ahora.getMonth() + 1).padStart(2, "0");
	const dia = String(ahora.getDate()).padStart(2, "0");
	return `${ahora.getFullYear()}-${mes}-${dia}`;
}

/**
 * @brief Construye la clave de localStorage para el progreso de un ejercicio hoy.
 * @param {number|string} idEjercicio - Identificador del ejercicio.
 * @returns {string} Clave con el formato `simplegym:progreso:<id>:<fecha>`.
 * @example
 * claveProgreso(3); // "simplegym:progreso:3:2025-01-15"
 */
const claveProgreso = (idEjercicio) => `${PREFIJO_PROGRESO}${idEjercicio}:${fechaLocal()}`;

/**
 * @brief Guarda el estado de progreso del ejercicio en localStorage.
 *
 * No lanza excepción si el almacenamiento falla (modo privado, cuota llena, bloqueo);
 * en tal caso sólo se emite un warning y la app sigue funcionando sin persistencia.
 *
 * @param {number|string} idEjercicio - Identificador del ejercicio.
 * @param {Object} estado - Estado actual del ejercicio.
 * @param {number} estado.indiceSerie - Índice de la serie que toca ahora.
 * @param {number} estado.inicioSerie - Timestamp del inicio de la serie actual.
 * @param {number} estado.finDescanso - Timestamp del fin del descanso actual.
 * @param {{peso:string, repeticiones:string}|null} estado.borrador - Borrador del formulario final.
 * @returns {void}
 * @example
 * guardarProgreso(3, { indiceSerie: 2, inicioSerie: Date.now(), finDescanso: 0, borrador: null });
 */
function guardarProgreso(idEjercicio, estado) {
	try {
		localStorage.setItem(
			claveProgreso(idEjercicio),
			JSON.stringify({
				version: VERSION_PROGRESO,
				indiceSerie: estado.indiceSerie,
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

/**
 * @brief Lee el progreso guardado hoy para un ejercicio.
 * @param {number|string} idEjercicio - Identificador del ejercicio.
 * @returns {{indiceSerie:number, inicioSerie:number, finDescanso:number, borrador:{peso:string,repeticiones:string}|null}|null}
 *   Objeto con el progreso validado, o `null` si no existe, está corrupto o la versión no coincide.
 * @example
 * const progreso = leerProgreso(3);
 * if (progreso) console.log(progreso.indiceSerie);
 */
function leerProgreso(idEjercicio) {
	try {
		const datos = JSON.parse(localStorage.getItem(claveProgreso(idEjercicio)));
		if (!datos || datos.version !== VERSION_PROGRESO) return null;

		if (!Number.isInteger(datos.indiceSerie) || datos.indiceSerie < 0) return null;

		const borrador =
			datos.borrador && typeof datos.borrador.peso === "string" && typeof datos.borrador.repeticiones === "string"
				? { peso: datos.borrador.peso, repeticiones: datos.borrador.repeticiones }
				: null;

		return {
			indiceSerie: datos.indiceSerie,
			inicioSerie: Number.isFinite(datos.inicioSerie) ? datos.inicioSerie : Date.now(),
			finDescanso: Number.isFinite(datos.finDescanso) ? datos.finDescanso : 0,
			borrador,
		};
	} catch (error) {
		console.warn("No se pudo leer el progreso:", error);
		return null;
	}
}

/**
 * @brief Elimina la entrada de progreso del ejercicio actual en localStorage.
 * @param {number|string} idEjercicio - Identificador del ejercicio.
 * @returns {void}
 * @example
 * borrarProgreso(3);
 */
function borrarProgreso(idEjercicio) {
	try {
		localStorage.removeItem(claveProgreso(idEjercicio));
	} catch (error) {
		console.warn("No se pudo borrar el progreso:", error);
	}
}

/**
 * @brief Elimina de localStorage el progreso de cualquier ejercicio que no sea de hoy.
 *
 * Se invoca al arrancar la pantalla para mantener limpio el almacenamiento local.
 *
 * @returns {void}
 * @example
 * limpiarProgresoAntiguo();
 */
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

/**
 * @brief Vuelca el progreso guardado sobre `estado`, validándolo contra la sesión actual.
 *
 * La validación evita incoherencias si la rutina o el histórico han cambiado desde
 * que se guardó el progreso (por ejemplo, si hoy hay más o menos series).
 *
 * @param {Object} elementosDom - Referencias a los elementos del DOM.
 * @param {Object} ejercicio - Datos del ejercicio actual.
 * @param {Object} estado - Estado mutable del ejercicio que se va a restaurar.
 * @param {Object} sesion - Sesión calculada para hoy (con `sesion.series`).
 * @returns {void}
 * @example
 * restaurarProgreso(elementosDom, ejercicio, estado, sesion);
 */
function restaurarProgreso(elementosDom, ejercicio, estado, sesion) {
	const guardado = leerProgreso(ejercicio.id);
	if (!guardado) return;

	estado.indiceSerie = limitar(guardado.indiceSerie, 0, sesion.series.length);
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

/**
 * @brief Calcula las series de aproximación (calentamiento) previas al trabajo efectivo.
 *
 * Genera hasta dos series de aproximación:
 *  - Primera: 50 % del peso objetivo, redondeado hacia abajo.
 *  - Segunda: 70 % del peso objetivo, redondeada al múltiplo más cercano.
 *
 * Se omiten series de aproximación cuya carga sea mayor o igual al peso objetivo.
 *
 * @param {Object} ejercicio - Datos del ejercicio (incremento_peso, series_aproximacion, etc.).
 * @param {number} pesoObjetivo - Peso objetivo de las series de trabajo.
 * @returns {Array<{peso:number, repeticiones:number, descanso:number}>} Lista de series de aproximación.
 * @example
 * const aprox = calcularSeriesAproximacion({ series_aproximacion: 2, incremento_peso: 2.5, ... }, 100);
 * // [{peso:50, repeticiones:11, descanso:60}, {peso:70, repeticiones:5, descanso:90}]
 */
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

/**
 * @brief Busca un ejercicio por su identificador en la lista cargada.
 * @param {Array<Object>} ejercicios - Lista completa de ejercicios disponibles.
 * @param {number} idEjercicio - Identificador del ejercicio buscado.
 * @returns {Object} El ejercicio encontrado.
 * @throws {Error} Si no existe ningún ejercicio con ese identificador.
 * @example
 * const ej = obtenerEjercicio(ejercicios, 7);
 */
function obtenerEjercicio(ejercicios, idEjercicio) {
	const ejercicio = ejercicios.find((ejercicio) => Number(ejercicio.id) === idEjercicio);

	if (!ejercicio) {
		throw new Error(`No se encontró el ejercicio ${idEjercicio}.`);
	}

	return ejercicio;
}

/**
 * @brief Rellena el DOM con la información visual del ejercicio (imagen, título y descripción).
 *
 * Aplica carga perezosa, decodificación asíncrona y una imagen de respaldo si falla la carga.
 *
 * @param {Object} elementosDom - Referencias a los elementos del DOM.
 * @param {Object} ejercicio - Datos del ejercicio a mostrar.
 * @returns {void}
 * @example
 * mostrarEjercicio(elementosDom, ejercicio);
 */
function mostrarEjercicio(elementosDom, ejercicio) {
	const { imagenEjercicio, descripcionEjercicio, titulo } = elementosDom;

	imagenEjercicio.src = ejercicio.imagen || IMAGEN_PLACEHOLDER;
	imagenEjercicio.alt = ejercicio.nombre;
	imagenEjercicio.loading = "lazy";
	imagenEjercicio.decoding = "async";
	imagenEjercicio.onerror = () => {
		imagenEjercicio.onerror = null;
		imagenEjercicio.src = IMAGEN_PLACEHOLDER;
	};

	titulo.textContent = ejercicio.nombre;
	descripcionEjercicio.textContent = ejercicio.descripcion;
}

/* =========================================================
   Histórico y sesión del día
   ========================================================= */

/**
 * @brief Obtiene el último registro del histórico (no de descarga) para un ejercicio.
 *
 * El histórico se asume ordenado por fecha ascendente, por lo que el último registro
 * coincidente es el más reciente.
 *
 * @param {Array<Object>} historial - Histórico completo de sesiones.
 * @param {number|string} idEjercicio - Identificador del ejercicio.
 * @returns {Object|null} Último registro válido o `null` si no hay registros previos.
 * @example
 * const ultimo = obtenerUltimoRegistro(historial, 3);
 */
function obtenerUltimoRegistro(historial, idEjercicio) {
	// El histórico está ordenado por fecha ascendente, así que el último registro
	// coincidente es el más reciente (aunque haya varios con la misma fecha, que es
	// lo habitual porque la fecha solo guarda el día).
	// La progresión se calcula sobre el último registro NO de descarga:
	return historial.findLast((r) => r.idEjercicio === idEjercicio && !r.esDescarga) ?? null;
}

/**
 * @brief Calcula la sesión del día para un ejercicio: peso, repeticiones y descansos por serie.
 *
 * Aplica la progresión (subida de repeticiones o de peso) en base al último registro,
 * y si es descarga reduce series, repeticiones objetivo y aumenta el RIR.
 *
 * @param {Object} ejercicio - Datos del ejercicio.
 * @param {Object|null} ultimoRegistro - Último registro no-descarga del ejercicio, o `null`.
 * @param {boolean} esDescarga - `true` si la sesión es de descarga.
 * @returns {{
 *   esDescarga: boolean,
 *   numeroSeriesTrabajo: number,
 *   rangoRepeticiones: string,
 *   rir: number,
 *   series: Array<{peso:number, repeticiones:number, descanso:number, esAproximacion:boolean, numero:number}>
 * }} Sesión calculada.
 * @throws {Error} Si `ejercicio` no contiene los campos requeridos.
 * @example
 * const sesion = calcularSesion(ejercicio, ultimo, false);
 * console.log(sesion.series[0]);
 */
function calcularSesion(ejercicio, ultimoRegistro, esDescarga) {
	let pesoObjetivo;
	let repeticionesObjetivo;

	// Calculamos peso y repeticiones objetivo según el último registro y si es sesión de descarga.
	if (!ultimoRegistro) {
		// No hay registros previos, usamos los valores mínimos del ejercicio.
		pesoObjetivo = ejercicio.incremento_peso;
		repeticionesObjetivo = ejercicio.repeticiones_min;
	} else {
		pesoObjetivo = ultimoRegistro.peso;

		// En descarga bajamos las repeticiones objetivo (más fácil). Si no, subimos las repeticiones objetivo (más difícil).
		repeticionesObjetivo = esDescarga ? ultimoRegistro.repeticiones - 2 : ultimoRegistro.repeticiones + 1;

		if (repeticionesObjetivo > ejercicio.repeticiones_max) {
			// Hemos llegado al máximo de repeticiones, subimos el peso y reiniciamos las repeticiones al mínimo.
			pesoObjetivo += ejercicio.incremento_peso;
			repeticionesObjetivo = ejercicio.repeticiones_min;
		} else if (repeticionesObjetivo < ejercicio.repeticiones_min) {
			// Las repeticiones del último registro son menores que el mínimo: bajamos el peso y ponemos las repeticiones al máximo.
			pesoObjetivo -= ejercicio.incremento_peso;
			pesoObjetivo = Math.max(pesoObjetivo, ejercicio.incremento_peso);
			repeticionesObjetivo = ejercicio.repeticiones_max;
		}
	}

	const aproximacion = calcularSeriesAproximacion(ejercicio, pesoObjetivo);

	// En descarga, reducimos las series de trabajo a la mitad y subimos el RIR (más fácil).
	const numeroSeriesTrabajo = esDescarga ? Math.max(1, Math.round(ejercicio.series_trabajo * 0.6)) : ejercicio.series_trabajo;
	const rir = esDescarga ? Math.min(5, Math.round(ejercicio.rir + 2)) : ejercicio.rir;

	return {
		esDescarga,
		numeroSeriesTrabajo,
		rangoRepeticiones: `${ejercicio.repeticiones_min}-${ejercicio.repeticiones_max}`,
		rir,
		series: [
			// Primero las series de aproximación
			...aproximacion.map((s, i) => ({
				peso: s.peso,
				repeticiones: s.repeticiones,
				descanso: s.descanso,
				esAproximacion: true,
				numero: i + 1,
			})),
			// Series de trabajo. Se solicita llegar al numero de repeticiones maximas
			...Array.from({ length: numeroSeriesTrabajo - 1 }, (_, i) => ({
				peso: pesoObjetivo,
				repeticiones: ejercicio.repeticiones_max,
				descanso: ejercicio.descanso,
				esAproximacion: false,
				numero: i + 1,
			})),
			// Última serie de trabajo: se solicita llegar al número de repeticiones objetivo
			...Array.from({ length: 1 }, (_, i) => ({
				peso: pesoObjetivo,
				repeticiones: repeticionesObjetivo,
				descanso: ejercicio.descanso,
				esAproximacion: false,
				numero: i + 1,
			})),
		],
	};
}

/* =========================================================
   Interfaz de la serie
   ========================================================= */

/**
 * @brief Muestra en el DOM las repeticiones y el peso objetivo de la serie actual.
 * @param {Object} elementosDom - Referencias a los elementos del DOM.
 * @param {{descanso:number, repeticiones:number, peso:number}} serie - Serie a mostrar.
 * @returns {void}
 * @example
 * mostrarObjetivoSerie(elementosDom, sesion.series[0]);
 */
function mostrarObjetivoSerie(elementosDom, serie) {
	elementosDom.descanso.textContent = serie.descanso;
	elementosDom.repeticionesObjetivo.textContent = serie.repeticiones;
	elementosDom.pesoObjetivo.textContent = formatearNumero(serie.peso, 1);
}

/**
 * @brief Restaura el texto del botón de la serie (se usa al terminar el descanso).
 * @param {Object} elementosDom - Referencias a los elementos del DOM.
 * @param {Array<Object>} series - Lista completa de series de la sesión.
 * @param {number} actual - Índice de la serie actual.
 * @returns {void}
 * @example
 * mostrarTextoBotonSerie(elementosDom, sesion.series, 0);
 */
function mostrarTextoBotonSerie(elementosDom, series, actual) {
	if (series[actual].esAproximacion)
		elementosDom.btnSerie.textContent = `Terminé la serie de aproximación ${series[actual].numero}`;
	else if (actual < series.length - 1)
		elementosDom.btnSerie.textContent = `Terminé la serie ${series[actual].numero}`;
	else
		elementosDom.btnSerie.textContent = 'Terminé el ejercicio';
}

/* =========================================================
   Estado final
   ========================================================= */

/**
 * @brief Cambia la interfaz al estado "ejercicio completado".
 *
 * Oculta el botón de serie y muestra la tarjeta de finalización.
 *
 * @param {Object} elementosDom - Referencias a los elementos del DOM.
 * @returns {void}
 * @example
 * mostrarEjercicioCompletado(elementosDom);
 */
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

/**
 * @brief Reproduce tres pitidos cortos y (si está disponible) una vibración sincronizada.
 *
 * En iOS Safari `navigator.vibrate` no existe: en ese caso sólo se reproducen los pitidos.
 * Cualquier fallo de audio se captura y no rompe el flujo de la app.
 *
 * @returns {void}
 * @example
 * reproducirPitido();
 */
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

/**
 * @brief Inicia la cuenta atrás del descanso mostrándola en el botón de serie.
 *
 * El descanso termina en `estado.finDescanso` (timestamp absoluto). Al depender de una
 * hora absoluta y no de una cuenta atrás, la cuenta sigue siendo correcta aunque el
 * navegador pause los temporizadores en segundo plano o la página se recargue.
 *
 * Al llegar a cero: se reactiva el botón, se restaura su texto, se reproduce el pitido
 * y se detiene el intervalo.
 *
 * @param {Object} elementosDom - Referencias a los elementos del DOM.
 * @param {Object} estado - Estado mutable del ejercicio (contiene `finDescanso` e `indiceSerie`).
 * @param {Object} sesion - Sesión calculada para hoy.
 * @returns {void}
 * @example
 * iniciarDescanso(elementosDom, estado, sesion);
 */
function iniciarDescanso(elementosDom, estado, sesion) {
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
			mostrarTextoBotonSerie(elementosDom, sesion.series, estado.indiceSerie);
			reproducirPitido();
		}
	};

	actualizar();
	intervaloDescanso = setInterval(actualizar, 200);
}

/* =========================================================
   Finalizar serie
   ========================================================= */

/**
 * @brief Finaliza la serie actual: valida el tiempo mínimo, avanza el estado y guarda progreso.
 *
 * Si es la última serie, marca el ejercicio como completado. En caso contrario, muestra
 * el objetivo de la siguiente serie y arranca el descanso correspondiente.
 *
 * @param {Object} elementosDom - Referencias a los elementos del DOM.
 * @param {Object} ejercicio - Datos del ejercicio actual.
 * @param {Object} estado - Estado mutable del ejercicio (se modifica).
 * @param {Object} sesion - Sesión calculada para hoy.
 * @returns {void}
 * @example
 * finalizarSerie(elementosDom, ejercicio, estado, sesion);
 */
function finalizarSerie(elementosDom, ejercicio, estado, sesion) {
	// Serie que acabamos de terminar.
	const serieTerminada = sesion.series[estado.indiceSerie];

	const tiempoTranscurrido = Math.trunc((Date.now() - estado.inicioSerie) / 1000);
	const tiempoObjetivo = serieTerminada.repeticiones * 4;

	if (tiempoTranscurrido < tiempoObjetivo) {
		const diferencia = Math.trunc(tiempoObjetivo - tiempoTranscurrido);
		alert(`Has ido ${diferencia} segundo${diferencia !== 1 ? "s" : ""} demasiado rápido.`);
	}

	// Avanzamos al siguiente índice.
	estado.indiceSerie++;

	// El descanso acaba en `finDescanso` y en ese mismo instante empieza la siguiente serie.
	estado.finDescanso = Date.now() + serieTerminada.descanso * 1000;
	estado.inicioSerie = estado.finDescanso;

	// Guardamos el progreso en cada pulsación, antes de cualquier otra cosa.
	guardarProgreso(ejercicio.id, estado);

	if (estado.indiceSerie >= sesion.series.length) {
		mostrarEjercicioCompletado(elementosDom);
		return;
	}

	// Mostramos ya el objetivo de la siguiente serie para poder preparar el peso durante el descanso.
	const serieSiguiente = sesion.series[estado.indiceSerie];
	mostrarObjetivoSerie(elementosDom, serieSiguiente);
	iniciarDescanso(elementosDom, estado, sesion);
}

/* =========================================================
   Guardar registro de ejercicio
   ========================================================= */

/**
 * @brief Valida, guarda en el histórico y navega a la pantalla de sesión.
 *
 * El nuevo registro se añade al final de un array nuevo (no se muta `historial`), de modo
 * que si `guardarHistorial` falla el estado en memoria queda intacto y no se duplica el
 * registro al reintentar. Al guardar con éxito, se borra el progreso temporal y se
 * redirige a `sesion.html`.
 *
 * @param {Object} elementosDom - Referencias a los elementos del DOM.
 * @param {Array<Object>} historial - Histórico completo en memoria.
 * @param {Object} ejercicio - Datos del ejercicio actual.
 * @param {number} numeroSesion - Número de sesión actual.
 * @param {number} totalEjerciciosSesion - Total de ejercicios en esta sesión.
 * @param {Object} sesion - Sesión calculada para hoy.
 * @returns {Promise<void>} Se resuelve cuando el guardado y la navegación han finalizado.
 * @throws {Error} Si peso o repeticiones son inválidos, o si `guardarHistorial` falla.
 * @example
 * try {
 *   await guardarResultado(elementosDom, historial, ejercicio, 12, 5, sesion);
 * } catch (e) {
 *   alert(e.message);
 * }
 */
async function guardarResultado(elementosDom, historial, ejercicio, numeroSesion, totalEjerciciosSesion, sesion) {
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
			numeroSeries: sesion.series.filter((s) => !s.esAproximacion).length,
			peso,
			repeticiones,
			esDescarga: sesion.esDescarga === true,
		},
	];

	await guardarHistorial(historialActualizado);

	// El ejercicio ya está registrado en el histórico: descartamos el progreso temporal.
	borrarProgreso(ejercicio.id);

	location.href = `sesion.html?numeroSesion=${numeroSesion}&descarga=${sesion.esDescarga ? 1 : 0}`;
}

/* =========================================================
   Inicialización
   ========================================================= */

/**
 * @brief Recoge todas las referencias a elementos del DOM utilizadas en esta pantalla.
 * @returns {Object} Objeto con las referencias por nombre lógico.
 * @example
 * const elementosDom = obtenerElementosDom();
 * elementosDom.btnSerie.click();
 */
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

/**
 * @brief Punto de entrada de la pantalla de entrenamiento de un ejercicio.
 *
 * Lee los parámetros de la URL, carga ejercicios e histórico, calcula la sesión del día,
 * restaura el progreso previo (si lo hubiera) y engancha los manejadores del botón de
 * serie y del formulario final. Si algo falla, oculta el contenedor principal y muestra
 * un mensaje de error.
 *
 * @returns {Promise<void>} Se resuelve cuando la inicialización ha finalizado.
 * @throws {Error} Si fallan las cargas de datos o la lectura de parámetros de URL.
 * @example
 * inicializar();
 */
async function inicializar() {
	const elementosDom = obtenerElementosDom();

	try {
		const [idEjercicio, numeroSesion, totalEjerciciosSesion, esDescarga] = obtenerParametrosURL(
			{ clave: "idEjercicio", validar: (n) => n > 0 },
			{ clave: "numeroSesion", validar: (n) => n > 0 },
			{ clave: "totalEjerciciosSesion", validar: (n) => n >= 0 },
			{ clave: "descarga", validar: (n) => n === 1 || n === 0 },
		);

		// ---------- Volver ----------
		elementosDom.enlaceVolver.href = `sesion.html?numeroSesion=${numeroSesion}`;

		const [ejercicios, historial] = await Promise.all([cargarEjercicios(), cargarHistorial()]);
		const ejercicio = obtenerEjercicio(ejercicios, idEjercicio);
		const ultimoRegistro = obtenerUltimoRegistro(historial, ejercicio.id);
		const sesion = calcularSesion(ejercicio, ultimoRegistro, esDescarga === 1);

		mostrarEjercicio(elementosDom, ejercicio);

		elementosDom.seriesTrabajo.textContent = sesion.numeroSeriesTrabajo;
		elementosDom.rangoRepeticiones.textContent = sesion.rangoRepeticiones;
		elementosDom.rir.textContent = sesion.rir;
		elementosDom.repeticionesFinal.value = sesion.series.at(-1).repeticiones;
		elementosDom.pesoFinal.value = sesion.series.at(-1).peso;

		const estado = {
			indiceSerie: 0,
			inicioSerie: Date.now(),
			finDescanso: 0,
			borrador: null,
		};

		// Recuperamos lo que ya se hizo hoy en este ejercicio (si el navegador recargó la página).
		limpiarProgresoAntiguo();
		restaurarProgreso(elementosDom, ejercicio, estado, sesion);

		if (estado.indiceSerie >= sesion.series.length) {
			mostrarEjercicioCompletado(elementosDom);
		} else {
			const serieActual = sesion.series[estado.indiceSerie];
			mostrarObjetivoSerie(elementosDom, serieActual);

			if (estado.finDescanso > Date.now()) {
				// Seguimos en pleno descanso: retomamos la cuenta atrás con el tiempo que queda.
				iniciarDescanso(elementosDom, estado, sesion);
			} else {
				// Sin descanso en curso (o ya terminó mientras la página estaba en segundo plano).
				mostrarTextoBotonSerie(elementosDom, sesion.series, estado.indiceSerie);
			}
		}

		/* ---------- Botón de serie ---------- */
		elementosDom.btnSerie.addEventListener("click", () => {
			// Protección contra dobles clics.
			elementosDom.btnSerie.disabled = true;
			finalizarSerie(elementosDom, ejercicio, estado, sesion);
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
				await guardarResultado(elementosDom, historial, ejercicio, numeroSesion, totalEjerciciosSesion, sesion);
			} catch (error) {
				elementosDom.btnGuardar.disabled = false;
				console.error(error);
				alert(error?.message || error);
			}
		});
	} catch (error) {
		elementosDom.mainContainer.hidden = true;
		elementosDom.titulo.textContent = "Error";
		elementosDom.subtitulo.textContent = error.message || "No se pudo cargar este ejercicio.";
		console.error(error);
	}
}

inicializar();