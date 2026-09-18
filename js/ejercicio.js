import { dbAll, dbAdd, loadExercises } from './database.js';

let seriesStartTime = Date.now();
let reps;
const params = new URLSearchParams(location.search);
const exerciseId      = Number(params.get("exId"));
const sesionNumber    = Number(params.get("curSes"));
const sesionExercices = Number(params.get("tot"));

if (!Number.isInteger(exerciseId) || exerciseId <= 0 ||
    !Number.isInteger(sesionNumber) || sesionNumber <= 0) {
  alert("Error: la URL debe incluir 'exId' y 'curSes'.\nEj: ejercicio.html?exId=3&curSes=2&tot=6");
  location.replace("index.html");
  throw new Error("Parámetros de URL inválidos");
}

let exercise;
let seriesDone = 0;
let timerInterval = null;

/* ---------------- Carga del ejercicio ---------------- */
async function loadExercise(ejerciciosDB, id) {
  // const list = await loadExercises();
  exercise = ejerciciosDB.find(x => Number(x.id) === id) ?? ejerciciosDB[0];

  document.getElementById("exerciseTitle").textContent        = exercise.nombre;
  document.getElementById("exerciseImage").src                = exercise.imagen;
  document.getElementById("exerciseImage").alt                = exercise.nombre;
  document.getElementById("exerciseDescription").textContent  = exercise.descripcion;
  document.getElementById("exerciseSeries").textContent       = exercise.numero_series;
  document.getElementById("exerciseRepeticiones").textContent = `${exercise.repeticiones_minimas}-${exercise.repeticiones_maximas}`;
  document.getElementById("exerciseRIR").textContent          = exercise.rir;
  document.getElementById("exerciseDescanso").textContent     = exercise.segundos_descanso;
}

/* ---------------- Última marca del ejercicio ---------------- */
function lastPerformance(history, id) {
  return history
    .filter(x => Number(x.exId) === Number(id))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .at(-1);
}

/* ---------------- Objetivos (peso / reps) ---------------- */
function loadTargets(history) {
  const last = lastPerformance(history, exercise.id);

  let weight;
  if (!last) {
    weight = null;
    reps   = exercise.repeticiones_minimas;
  } else {
    weight = Number(last.weight);
    reps   = Number(last.reps);

    if (reps >= exercise.repeticiones_maximas) {        // subir peso, bajar reps
      weight += Number(exercise.incremento_peso);
      reps = exercise.repeticiones_minimas;
    } else if (reps < exercise.repeticiones_minimas) {  // bajar peso, subir reps
      weight -= Number(exercise.incremento_peso);
      reps = exercise.repeticiones_maximas;
    } else {                                            // subir 1 rep
      reps++;
    }
  }

  document.getElementById("targetReps").textContent   = reps;
  document.getElementById("targetWeight").textContent = weight == null ? "—" : `${weight} kg`;
  document.getElementById("finalWeight").value        = weight ?? "";
  document.getElementById("finalReps").value          = reps;
}

/* ---------------- Descanso ---------------- */
function startRest(seconds) {
  const btn = document.getElementById("seriesBtn");
  btn.classList.add("btn-disabled");
  clearInterval(timerInterval);

  const paint = () => {
    btn.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  };
  paint();

  timerInterval = setInterval(() => {
    seconds--;
    paint();
    if (seconds <= 0) {
      clearInterval(timerInterval);
      btn.classList.remove("btn-disabled");
      btn.textContent = `Terminé la serie ${seriesDone + 1}`;
    }
  }, 1000);
}

/* ---------------- Fin de serie ---------------- */
function seriesFinished() {
    // Tiempo transcurrido desde el inicio de la serie
  const elapsedSeconds = Math.floor((Date.now() - seriesStartTime) / 1000);

  const targetSeconds = reps * 6;  // 2s Concéntrica + 1s Retención + 3s Excéntrica.

  // Comprobar si se ha terminado demasiado rápido
  if (elapsedSeconds < targetSeconds) {
    const tooFast = targetSeconds - elapsedSeconds;

    alert(`Has ido ${tooFast} segundo${tooFast !== 1 ? "s" : ""} demasiado rápido.`);
  }

  // Serie completada
  seriesDone++;

  // Si es la última serie quitamos el contador y ponemos el boton de finalizar.
  if (seriesDone >= exercise.numero_series) {
    document.getElementById("seriesBtn").classList.add("hidden");
    document.getElementById("finishCard").classList.remove("hidden");
    return;
  }

  // Descanso antes de la siguiente serie
  startRest(Number(exercise.segundos_descanso));

  // El contador se reinicia después del descanso
  setTimeout(() => {
    seriesStartTime = Date.now();
  }, Number(exercise.segundos_descanso) * 1000);
}

/* ---------------- Guardar ---------------- */
async function saveWorkout() {
  const weight = Number(document.getElementById("finalWeight").value);
  const reps   = Number(document.getElementById("finalReps").value);

  if (!Number.isFinite(weight) || !Number.isFinite(reps)) {
    return alert("Introduce peso y repeticiones válidos.");
  }

  await dbAdd({
    exId:    Number(exercise.id),
    session: sesionNumber,
    totals:  sesionExercices,
    date:    new Date(),
    sets:    exercise.numero_series,
    weight,
    reps,
  });

  location.href = `sesion.html?sesion=${sesionNumber}`;
}

/* ---------------- Listeners ---------------- */
document.getElementById("seriesBtn").onclick = seriesFinished;
document.getElementById("saveBtn").onclick   = saveWorkout;
document.getElementById("exitBtn").href      = `sesion.html?sesion=${sesionNumber}`;

/* ---------------- Init ---------------- */
try {
  // Cargamos los ejercicios y el historial
  const [ejerciciosDB, historialEjercicios] = await Promise.all([
      loadExercises(),
      dbAll()
  ]);
  await loadExercise(ejerciciosDB, exerciseId);
  // const historialEjercicios = await dbAll();
  loadTargets(historialEjercicios);
} catch (error) {
  alert(`Error al iniciar: ${error?.message || error}`);
}