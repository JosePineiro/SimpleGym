import { dbAll, dbAdd, hoy } from './js/database.js';

let exercise, historialEjercicios = [], seriesDone = 0, timerInterval = null;
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const exerciseId = Number(params.get("id") || 1);

/**
 * Carga el ejercicio desde ejercicios.json y lo renderiza.
 */
async function loadExercise(id){
  const response=await fetch("ejercicios.json");
  const list=await response.json();
  exercise=list.find(x=>Number(x.id)===id) || list[0];

  document.getElementById("exerciseTitle").textContent=exercise.nombre;
  document.getElementById("exerciseImage").src=exercise.imagen;
  document.getElementById("exerciseImage").alt=exercise.nombre;
  document.getElementById("exerciseDescription").textContent=exercise.descripcion;
  document.getElementById("exerciseSeries").textContent=exercise.numero_series;
  document.getElementById("exerciseRepeticiones").textContent=exercise.repeticiones_minimas + '-' + exercise.repeticiones_maximas;
  document.getElementById("exerciseRIR").textContent=exercise.rir;  
  document.getElementById("exerciseDescanso").textContent=exercise.segundos_descanso;  
  // document.getElementById("seriesArea").innerHTML=Array.from({length:exercise.numero_series},(_,i)=> `<span class="series-dot" id="series-${i}">${i+1}</span>`).join("");
}

function getExerciseHistory(id){
  return historialEjercicios.filter(x => x.id_ejercicio===Number(id))
    .sort((a,b)=>new Date(a.fecha)-new Date(b.fecha));
}

function loadTargets(){
  const round=n=>Math.round(n*10)/10;
  const h=getExerciseHistory(exercise.id);
  const last=h.at(-1);
  if(!last){
    $("targetReps").textContent=exercise.repeticiones_minimas;
    $("targetWeight").textContent="—";
    return;
  }
  let weight=last.peso;
  let reps=last.repeticiones;
  if(reps>=exercise.repeticiones_maximas){  // Hemos alcanzado las máximas: subimos el peso y bajamos las repeticiones
    weight+=Number(exercise.incremento_peso);
    reps=exercise.repeticiones_minimas;
  }
  else if(reps<exercise.repeticiones_minimas){ // NO hemos alcanzado las mínimas: bajamos el peso y subimos las repeticiones
    weight-=Number(exercise.incremento_peso);
    reps=exercise.repeticiones_maximas;
  }
  else {                                        // Subimos el objetivo de repeticiones en 1
    reps++;
  }

  document.getElementById("targetReps").textContent = reps;
  document.getElementById("targetWeight").textContent = `${weight} kg`;
  document.getElementById('finalWeight').value = weight;
  document.getElementById('finalReps').value = reps - 1;
}


function startRest(){
  let remaining=exercise.segundos_descanso;
  document.getElementById("timer").classList.remove("hidden");
  // document.getElementById("seriesBtn").disabled=true;
  document.getElementById("seriesBtn").classList.add("hidden");
  const paint=()=>{$("timer").textContent=`${String(Math.floor(remaining/60)).padStart(2,"0")}:${String(remaining%60).padStart(2,"0")}`};
  paint();
  clearInterval(timerInterval);
  timerInterval=setInterval(()=>{
    remaining--;
    paint();
    if(remaining<=0){
      clearInterval(timerInterval);
      document.getElementById("timer").classList.add("hidden");
        document.getElementById("seriesBtn").classList.remove("hidden");
      // document.getElementById("seriesBtn").disabled=false;
      document.getElementById("seriesBtn").textContent=`Terminé la serie ${seriesDone+1}`;
    }
  }, 1000);
}

function seriesFinished(){
  seriesDone++;
  // document.getElementById("series-"+(seriesDone-1)).classList.add("done");
  if(seriesDone>=exercise.numero_series){
    document.getElementById("seriesBtn").classList.add("hidden");
    document.getElementById("finishForm").classList.remove("hidden");
    document.getElementById("finalWeight").value=Number(($("targetWeight").textContent||"").replace(/[^\d.]/g,""))||"";
    document.getElementById("finalReps").value=$("targetReps").textContent==="—"?"":$("targetReps").textContent;
    return;
  }
  startRest();
}

async function saveWorkout(){
  const peso=Number($("finalWeight").value), repeticiones=Number($("finalReps").value);
  if(!Number.isFinite(peso)||!Number.isFinite(repeticiones)) return alert("Introduce peso y repeticiones válidos.");
  const item={id_ejercicio:Number(exercise.id),fecha:hoy(),peso,repeticiones};
  await dbAdd(item);
  historialEjercicios=await dbAll();
  loadTargets();
  document.getElementById("finishForm").innerHTML="<h2>Entrenamiento guardado ✓</h2>";
}

document.getElementById("seriesBtn").onclick=seriesFinished;
document.getElementById("saveBtn").onclick=saveWorkout;
document.getElementById("chartBtn").onclick=()=>{ window.location.href = `chart.html?id={exerciseId}`;};
document.getElementById("exitBtn").onclick=()=>{ if (document.referrer) { window.history.back(); } else { window.location.href = "/sesion.html"; }};

(async()=>{
  try{
    await loadExercise(exerciseId);
    historialEjercicios=await dbAll();
    loadTargets();
  }catch(e){
    console.error(e);
    alert("No se han podido cargar los ejercicios. Asegurate de que existe ejercicios.json");
  }
})();
