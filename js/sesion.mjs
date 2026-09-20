import { dbAll, dbLoadExercises, esMismoDia } from "./database.mjs";

/* =========================================================
   sesion.js
   Muestra una ficha por cada máquina/ejercicio que hay en esa sesion.
   La muestra desactivada si ya se ha realizado esa ficha.
   Al pulsar una ficha → ejercicio.html?curSes=<sesion>&exId=<id>2&tot=<totales>
   ========================================================= */

const IMG_PLACEHOLDER = "images/placeholder.svg";

function crearTarjeta(ejercicio, completado, sesionActual, totales, hechos) {
	const img = document.createElement("img");
	img.src = ejercicio.imagen || IMG_PLACEHOLDER;
	img.alt = ejercicio.nombre;
	img.loading = "lazy";
	img.decoding = "async";
	img.addEventListener(
		"error",
		() => {
			img.src = IMG_PLACEHOLDER;
		},
		{ once: true },
	);

	const span = document.createElement("span");
	span.className = "card-name";
	span.textContent = ejercicio.nombre;

	const a = document.createElement("a");
	a.href = `ejercicio.html?curSes=${sesionActual}&exId=${ejercicio.id}&tot=${totales}&made=${hechos}`;
	a.className = completado ? "card completado" : "card";
	if (completado) a.setAttribute("aria-label", `${ejercicio.nombre} (completado)`);

	a.append(img, span);
	return a;
}

async function inicializarPantalla() {
	const titulo = document.getElementById("tituloSesion");
	const subtitulo = document.getElementById("subtituloSesion");
	const contenedor = document.getElementById("contenedorEjercicios");

	const mostrarVacio = (texto) => {
		const div = document.createElement("div");
		div.className = "empty-state";
		div.textContent = texto;
		contenedor.replaceChildren(div);
	};

	try {
		const sesion = parseInt(new URLSearchParams(location.search).get("sesion"), 10);
		if (!(sesion > 0)) throw new Error("Falta el parámetro sesion o no es válido.");

		const [ejerciciosDB, historial] = await Promise.all([dbLoadExercises(), dbAll()]);

		const hoy = new Date();
		const hechosHoy = new Set(historial.filter((h) => h.date && esMismoDia(h.date, hoy)).map((h) => h.exId));

		const ejerciciosDeHoy = ejerciciosDB
			.filter((e) => e.sesion.includes(sesion))
			.sort((a, b) => (a.orden ?? Infinity) - (b.orden ?? Infinity) || a.id - b.id);

		const total = ejerciciosDeHoy.length;
		const hechos = ejerciciosDeHoy.filter((e) => hechosHoy.has(e.id)).length;

		titulo.textContent = `Sesión ${sesion}`;

		if (!total) {
			subtitulo.textContent = "No hay ejercicios para esta sesión";
			return mostrarVacio("No hay ejercicios que mostrar.");
		}

		subtitulo.textContent = `${hechos} de ${total} ejercicios completados`;

		contenedor.replaceChildren(...ejerciciosDeHoy.map((e) => crearTarjeta(e, hechosHoy.has(e.id), sesion, total, hechos)));
	} catch (error) {
		console.error(error);
		titulo.textContent = "Error";
		subtitulo.textContent = error.message || "Error inicializando la sesión";
		mostrarVacio("No se pudo cargar la sesión.");
	}
}

// Al volver con "atrás" el navegador puede restaurar la página desde la bfcache
// sin ejecutar el script, y el estado "completado" quedaría obsoleto.
window.addEventListener("pageshow", (e) => {
	if (e.persisted) inicializarPantalla();
});

inicializarPantalla();
