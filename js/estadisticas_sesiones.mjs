import { dbLoadExercises } from "./database.mjs";

/* ---------- Creación de tarjetas ---------- */

function crearTarjetaSesion(numeroSesion) {
	const enlace = document.createElement("a");

	enlace.className = "card";
	enlace.href = `progreso_esfuerzo.html?sesion=${encodeURIComponent(numeroSesion)}`;
	enlace.setAttribute("aria-label", `Ver progreso de esfuerzo de la sesión ${numeroSesion}`);

	const div = document.createElement("div");
	div.className = "card-name";
	div.textContent = `Sesión ${numeroSesion}`;

	enlace.appendChild(div);

	return enlace;
}

/* ---------- Estado vacío ---------- */

function mostrarVacio(contenedor, mensaje) {
	const vacio = document.createElement("div");

	vacio.className = "empty-state";
	vacio.textContent = mensaje;

	contenedor.replaceWith(vacio);
}

/* ---------- Carga de datos ---------- */

async function cargarSesiones() {
	const ejercicios = await dbLoadExercises();

	const sesiones = new Set();

	for (const ejercicio of ejercicios) {
		if (!Array.isArray(ejercicio.sesion)) continue;

		for (const numeroSesion of ejercicio.sesion) {
			sesiones.add(numeroSesion);
		}
	}

	return [...sesiones].sort((a, b) => a - b);
}

/* ---------- Inicialización ---------- */

(async function init() {
	const contenedor = document.getElementById("contenedorSesiones");

	try {
		const sesiones = await cargarSesiones();

		if (!sesiones.length) {
			mostrarVacio(contenedor, "Todavía no hay sesiones registradas.");
			return;
		}

		document.getElementById("subtituloPagina").textContent = `${sesiones.length} sesiones`;

		const fragmento = document.createDocumentFragment();

		for (const numeroSesion of sesiones) {
			fragmento.appendChild(crearTarjetaSesion(numeroSesion));
		}

		contenedor.appendChild(fragmento);
	} catch (error) {
		console.error("[estadisticas_sesiones]", error);

		mostrarVacio(contenedor, "No se pudieron cargar las sesiones.");
	}
})();
