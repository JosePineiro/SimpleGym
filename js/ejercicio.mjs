import { dbAdd, dbAll, dbLoadExercises } from "./database.mjs";

/* ---------------- Series de aproximación ---------------- */
const EJERCICIOS_INICIO_SESION = 2; // los 2 primeros ejercicios hechos cuentan como "inicio de sesión"
const IMG_PLACEHOLDER = "images/placeholder.svg";

// Devuelve un array (vacío, 1 o 2 series) con { peso, reps, descanso }
function calcularAproximaciones(exercise, pesoObjetivo, pesoUltimaSesion, ejerciciosHechosEnSesion) {
	//  - Al inicio de la sesión, o si sube el peso: todas las previstas (series_aproximacion).
	//  - Con el músculo ya caliente y sin subir peso: una menos.
	let seriesAproximacion = exercise.series_aproximacion;
	if (ejerciciosHechosEnSesion >= EJERCICIOS_INICIO_SESION && pesoObjetivo <= pesoUltimaSesion) seriesAproximacion--;
	if (seriesAproximacion < 1) return [];

	// Porcentaje como entero: evita errores de coma flotante (0.7 * 180 / 2 = 62.999…)
	const miRedondeo = (pct, redondeo) =>
		Math.max(exercise.incremento_peso, redondeo((pct * pesoObjetivo) / (100 * exercise.incremento_peso)) * exercise.incremento_peso);
	const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

	const descanso = clamp(Math.round(Number(exercise.segundos_descanso) / 2), 60, 90);
	const series = [];

	// 1ª aproximación (~50 %, redondeo hacia abajo)
	const peso1 = miRedondeo(50, Math.trunc);
	if (peso1 >= pesoObjetivo) return [];
	series.push({
		peso: peso1,
		reps: clamp(Math.round((exercise.repeticiones_minimas + exercise.repeticiones_maximas) / 2), 8, 12),
		descanso,
	});

	// 2ª aproximación (~70 %, redondeo al más cercano para que no quede pegada a la 1ª)
	if (seriesAproximacion >= 2) {
		const peso2 = miRedondeo(70, Math.round);
		if (peso2 > peso1 && peso2 < pesoObjetivo) {
			series.push({
				peso: peso2,
				reps: clamp(Math.trunc(exercise.repeticiones_minimas / 2), 4, 5),
				descanso,
			});
		}
	}
	return series;
}

/* ---------------- Estado ---------------- */
let seriesStartTime = Date.now();
let reps; // repeticiones objetivo de las series de trabajo
let workWeight = null; // peso objetivo de las series de trabajo
let approachSets = []; // series de aproximación de este ejercicio
let approachDone = 0;

const params = new URLSearchParams(location.search);
const exerciseId = Number(params.get("exId"));
const sesionNumber = Number(params.get("curSes"));
const sesionExercices = Number(params.get("tot"));
const madeSesionExercices = Number(params.get("made"));

if (
	!Number.isInteger(exerciseId) ||
	exerciseId <= 0 ||
	!Number.isInteger(sesionNumber) ||
	sesionNumber <= 0 ||
	!Number.isInteger(sesionExercices) ||
	sesionExercices < 0 ||
	!Number.isInteger(madeSesionExercices) ||
	madeSesionExercices < 0
) {
	alert("Error: la URL debe incluir 'exId' y 'curSes'.\nEj: ejercicio.html?exId=3&curSes=2&tot=6&made=0");
	location.replace("index.html");
	throw new Error("Parámetros de URL inválidos");
}

let exercise;
let seriesDone = 0;
let timerInterval = null;

/* ---------------- Carga del ejercicio ---------------- */
async function loadExercise(ejerciciosDB, id) {
	exercise = ejerciciosDB.find((x) => Number(x.id) === id) ?? ejerciciosDB[0];

	document.getElementById("exerciseTitle").textContent = exercise.nombre;
	document.getElementById("exerciseDescription").textContent = exercise.descripcion;
	const img = document.getElementById("exerciseImage");
	img.src = exercise.imagen || IMG_PLACEHOLDER;
	img.onerror = () => {
		img.onerror = null;
		img.src = IMG_PLACEHOLDER;
	};
	img.alt = exercise.nombre;
	img.loading = "lazy";
	img.decoding = "async";

	document.getElementById("exerciseSeries").textContent = exercise.numero_series;
	document.getElementById("exerciseRepeticiones").textContent = `${exercise.repeticiones_minimas}-${exercise.repeticiones_maximas}`;
	document.getElementById("exerciseRIR").textContent = exercise.rir;
	document.getElementById("exerciseDescanso").textContent = exercise.segundos_descanso;
}

/* ---------------- Última marca del ejercicio ---------------- */
function lastPerformance(history, id) {
	return history
		.filter((x) => Number(x.exId) === Number(id))
		.sort((a, b) => new Date(a.date) - new Date(b.date))
		.at(-1);
}

/* ---------------- Serie actual (aproximación o trabajo) ---------------- */
function currentApproach() {
	return approachSets[approachDone] ?? null;
}

// Muestra el peso y las repeticiones objetivo de la serie que toca ahora
function renderSetTargets() {
	const approach = currentApproach();
	const setWeight = approach ? approach.peso : workWeight;
	const setReps = approach ? approach.reps : reps;

	document.getElementById("targetReps").textContent = setReps;
	document.getElementById("targetWeight").textContent = setWeight == null ? "—" : `${setWeight} kg`;
}

function seriesButtonLabel() {
	return currentApproach() ? `Terminé la serie de aproximación ${approachDone + 1}` : `Terminé la serie ${seriesDone + 1}`;
}

/* ---------------- Objetivos (peso / reps) ---------------- */
function loadTargets(history) {
	const last = lastPerformance(history, exercise.id);

	let weight;
	if (!last) {
		weight = exercise.incremento_peso;
		reps = exercise.repeticiones_minimas;
	} else {
		weight = Number(last.weight);
		reps = Number(last.reps);

		if (reps >= exercise.repeticiones_maximas) {
			// subir peso, bajar reps
			weight += Number(exercise.incremento_peso);
			reps = exercise.repeticiones_minimas;
		} else if (reps < exercise.repeticiones_minimas) {
			// bajar peso, subir reps
			weight -= Number(exercise.incremento_peso);
			reps = exercise.repeticiones_maximas;
		} else {
			// subir 1 rep
			reps++;
		}
	}

	workWeight = weight;

	// Series de aproximación
	approachSets = calcularAproximaciones(exercise, weight, last ? last.weight : weight, madeSesionExercices);
	approachDone = 0;

	renderSetTargets();
	document.getElementById("seriesBtn").textContent = seriesButtonLabel();
	document.getElementById("finalWeight").value = weight;
	document.getElementById("finalReps").value = reps;
}

/* ---------------- Descanso ---------------- */
function startRest(seconds) {
	const btn = document.getElementById("seriesBtn");
	btn.classList.add("btn-disabled");
	clearInterval(timerInterval);

	const paint = () => {
		btn.textContent = `${String(Math.trunc(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
	};
	paint();

	timerInterval = setInterval(() => {
		seconds--;
		paint();
		if (seconds <= 0) {
			clearInterval(timerInterval);
			btn.classList.remove("btn-disabled");
			btn.textContent = seriesButtonLabel();
		}
	}, 1000);
}

/* ---------------- Fin de serie ---------------- */
function seriesFinished() {
	const approach = currentApproach();
	const setReps = approach ? approach.reps : reps;

	// Tiempo transcurrido desde el inicio de la serie
	const elapsedSeconds = Math.trunc((Date.now() - seriesStartTime) / 1000);

	let targetSeconds = setReps * 6; // 2s Concéntrica + 1s Retención + 3s Excéntrica.
	if (approach) targetSeconds /= 2;
	// Comprobar si se ha terminado demasiado rápido
	if (elapsedSeconds < targetSeconds) {
		const tooFast = targetSeconds - elapsedSeconds;

		alert(`Has ido ${tooFast} segundo${tooFast !== 1 ? "s" : ""} demasiado rápido.`);
	}

	let restSeconds;

	if (approach) {
		// Serie de aproximación completada (no cuenta como serie de trabajo)
		approachDone++;
		restSeconds = approach.descanso;
	} else {
		// Serie de trabajo completada
		seriesDone++;

		// Si es la última serie quitamos el contador y ponemos el boton de finalizar.
		if (seriesDone >= exercise.numero_series) {
			document.getElementById("seriesBtn").classList.add("hidden");
			document.getElementById("finishCard").classList.remove("hidden");
			return;
		}
		restSeconds = Number(exercise.segundos_descanso);
	}

	// Durante el descanso ya se muestra el objetivo de la siguiente serie
	renderSetTargets();

	// Descanso antes de la siguiente serie
	startRest(restSeconds);

	// El contador se reinicia después del descanso
	setTimeout(() => {
		seriesStartTime = Date.now();
	}, restSeconds * 1000);
}

/* ---------------- Guardar ---------------- */
async function saveWorkout() {
	const weight = Number(document.getElementById("finalWeight").value);
	const reps = Number(document.getElementById("finalReps").value);

	if (!Number.isFinite(weight) || !Number.isFinite(reps)) {
		return alert("Introduce peso y repeticiones válidos.");
	}

	// Solo se guardan las series de trabajo (las de aproximación no)
	await dbAdd({
		exId: Number(exercise.id),
		session: sesionNumber,
		totals: sesionExercices,
		date: new Date(),
		sets: exercise.numero_series,
		weight,
		reps,
	});

	location.href = `sesion.html?sesion=${sesionNumber}`;
}

/* ---------------- Listeners ---------------- */
document.getElementById("seriesBtn").onclick = seriesFinished;
document.getElementById("saveBtn").onclick = saveWorkout;
document.getElementById("exitBtn").href = `sesion.html?sesion=${sesionNumber}`;

/* ---------------- Init ---------------- */
try {
	// Cargamos los ejercicios y el historial
	const [ejerciciosDB, historialEjercicios] = await Promise.all([dbLoadExercises(), dbAll()]);
	await loadExercise(ejerciciosDB, exerciseId);
	loadTargets(historialEjercicios);
} catch (error) {
	alert(`Error al iniciar: ${error?.message || error}`);
}
