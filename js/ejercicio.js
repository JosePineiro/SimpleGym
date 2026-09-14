import { dbAll, dbAdd, hoy } from './database.js';

let exercise, historialEjercicios = [], seriesDone = 0, timerInterval = null;
const $ = id => document.getElementById(id);

/* ------------------------------------------------------------------ */
/*  Parámetros obligatorios de la URL:  ?id=<ejercicio>&sesion=<n>    */
/* ------------------------------------------------------------------ */
const params = new URLSearchParams(location.search);
const rawId     = params.get("ejercicio");
const rawSesion = params.get("sesion");
const exerciseId   = (rawId     !== null && rawId     !== "") ? Number(rawId)     : NaN;
const sesionNumber = (rawSesion !== null && rawSesion !== "") ? Number(rawSesion) : NaN;

if (!Number.isInteger(exerciseId) || exerciseId <= 0 ||
    !Number.isInteger(sesionNumber) || sesionNumber   <= 0) {
  alert("Error: la URL debe incluir el ejercicio y la sesión.\n" +
        "Ejemplo: ejercicio.html?sesion=2&ejercicio=3");
  window.location.replace("index.html");
  // Detenemos la ejecución del módulo: no se cargan datos ni listeners.
  throw new Error("Parámetros de URL inválidos: se requiere 'ejercicio' y 'sesion'.");
}

/* ------------------------------------------------------------------ */
/*  Carga del ejercicio                                               */
/* ------------------------------------------------------------------ */
async function loadExercise(id){
  const response = await fetch("ejercicios.json");
  const list = await response.json();
  exercise = list.find(x => Number(x.id) === id) || list[0];

  document.getElementById("exerciseTitle").textContent       = exercise.nombre;
  document.getElementById("exerciseImage").src               = exercise.imagen;
  document.getElementById("exerciseImage").alt               = exercise.nombre;
  document.getElementById("exerciseDescription").textContent = exercise.descripcion;
  document.getElementById("exerciseSeries").textContent      = exercise.numero_series;
  document.getElementById("exerciseRepeticiones").textContent= exercise.repeticiones_minimas + '-' + exercise.repeticiones_maximas;
  document.getElementById("exerciseRIR").textContent         = exercise.rir;
  document.getElementById("exerciseDescanso").textContent    = exercise.segundos_descanso;

  document.getElementById("exitBtn").onclick = () => {
    window.location.href = `sesion.html?sesion=${sesionNumber}`;
  };
}

function getExerciseHistory(id){
  return historialEjercicios
    .filter(x => x.id_ejercicio === Number(id))
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
}

function loadTargets(){
  const h = getExerciseHistory(exercise.id);
  const last = h.at(-1);
  if (!last){
    $("targetReps").textContent = exercise.repeticiones_minimas;
    $("targetWeight").textContent = "—";
    return;
  }
  let weight = last.peso;
  let reps   = last.repeticiones;

  if (reps >= exercise.repeticiones_maximas){        // Subimos peso, bajamos reps
    weight += Number(exercise.incremento_peso);
    reps = exercise.repeticiones_minimas;
  } else if (reps < exercise.repeticiones_minimas){  // Bajamos peso, subimos reps
    weight -= Number(exercise.incremento_peso);
    reps = exercise.repeticiones_maximas;
  } else {                                           // Subimos reps en 1
    reps++;
  }

  document.getElementById("targetReps").textContent   = reps;
  document.getElementById("targetWeight").textContent = `${weight} kg`;
  document.getElementById("finalWeight").value        = weight;
  document.getElementById("finalReps").value          = reps - 1;
}

function startRest(remaining){
  const seriesBtn = document.getElementById("seriesBtn");
  seriesBtn.classList.add('btn-disabled');
  const paint = () => {
    seriesBtn.textContent = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  };
  paint();
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    remaining--;
    paint();
    if (remaining <= 0){
      clearInterval(timerInterval);
      seriesBtn.classList.remove('btn-disabled');
      seriesBtn.textContent = `Terminé la serie ${seriesDone + 1}`;
    }
  }, 1000);
}

function seriesFinished(){
  seriesDone++;
  if (seriesDone >= exercise.numero_series){
    document.getElementById("seriesBtn").classList.add("hidden");
    document.getElementById("finishForm").classList.remove("hidden");
    document.getElementById("finalWeight").value =
      Number(($("targetWeight").textContent || "").replace(/[^\d.]/g, "")) || "";
    document.getElementById("finalReps").value =
      $("targetReps").textContent === "—" ? "" : $("targetReps").textContent;
    return;
  }
  startRest(exercise.segundos_descanso);
}

async function saveWorkout(){
  const peso        = Number($("finalWeight").value);
  const repeticiones= Number($("finalReps").value);

  if (!Number.isFinite(peso) || !Number.isFinite(repeticiones))
    return alert("Introduce peso y repeticiones válidos.");

  const item = {
    id_ejercicio: exercise.id,
    sesion:       sesionNumber,
    fecha:        hoy(),
    peso,
    repeticiones
  };

  await dbAdd(item);
  historialEjercicios = await dbAll();
  loadTargets();
  document.getElementById("finishForm").innerHTML = "<h2>Entrenamiento guardado ✓</h2>";
}

/* ------------------------------------------------------------------ */
/*  Listeners                                                         */
/* ------------------------------------------------------------------ */
document.getElementById("seriesBtn").onclick = seriesFinished;
document.getElementById("saveBtn").onclick   = saveWorkout;

/* ------------------------------------------------------------------ */
/*  Inicialización                                                    */
/* ------------------------------------------------------------------ */
(async () => {
  try {
    await loadExercise(exerciseId);
    historialEjercicios = await dbAll();
    loadTargets();
  } catch (e) {
    console.error(e);
    alert("No se han podido cargar los ejercicios. Asegúrate de que existe ejercicios.json");
  }
})();