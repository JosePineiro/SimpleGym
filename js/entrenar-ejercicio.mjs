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

// Devuelve el progreso guardado hoy para este ejercicio o `null` si no hay (o está corrupto).
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

// Vuelca el progreso guardado sobre `estado`, validándolo contra la sesión actual
// (por si la rutina o el histórico han cambiado desde que se guardó).
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

function obtenerUltimoRegistro(historial, idEjercicio) {
	// El histórico está ordenado por fecha ascendente, así que el último registro
	// coincidente es el más reciente (aunque haya varios con la misma fecha, que es
	// lo habitual porque la fecha solo guarda el día).
	// La progresión se calcula sobre el último registro NO de descarga:
	return historial.findLast((r) => r.idEjercicio === idEjercicio && !r.esDescarga) ?? null;
}

// Devuelve la sesión del día como una lista plana de series a realizar.
// Cada serie tiene: { peso, repeticiones, descanso, esAproximacion, numero }.
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
	const numeroSeriesTrabajo = esDescarga ? Math.max(1, Math.round(ejercicio.series_trabajo / 2)) : ejercicio.series_trabajo;
	const rir = esDescarga ? Math.min(5, Math.round(ejercicio.rir + 2)) : ejercicio.rir;

	return {
		esDescarga,
		numeroSeriesTrabajo,
		rangoRepeticiones: `${ejercicio.repeticiones_min}-${ejercicio.repeticiones_max}`,
		rir,
		series: [
			...aproximacion.map((s, i) => ({
				peso: s.peso,
				repeticiones: s.repeticiones,
				descanso: s.descanso,
				esAproximacion: true,
				numero: i + 1,
			})),
			...Array.from({ length: numeroSeriesTrabajo }, (_, i) => ({
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

// Muestra las repeticiones y el peso objetivo de la serie que toca a continuación.
function mostrarObjetivoSerie(elementosDom, serie) {
	elementosDom.descanso.textContent = serie.descanso;
	elementosDom.repeticionesObjetivo.textContent = serie.repeticiones;
	elementosDom.pesoObjetivo.textContent = formatearNumero(serie.peso, 1);
}

// Restaura el texto del botón de la serie (al terminar el descanso).
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
		elementosDom.subtitulo.textContent = error.message || "No se pudo cargar el ejercicio.";
		console.error(error);
	}
}

inicializar();