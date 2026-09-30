import { cargarEjercicios } from "./database.mjs";

/* =========================================================
   Estadísticas por sesión
   ========================================================= */

/* ---------------- Creación de tarjetas ---------------- */

function crearTarjetaSesion(numeroSesion) {
	const tarjeta = document.createElement("a");
	tarjeta.className = "card";
	tarjeta.href = `estadisticas-sesion.html?numeroSesion=${encodeURIComponent(numeroSesion)}`;
	tarjeta.setAttribute("aria-label", `Ver estadísticas de la sesión ${numeroSesion}`);

	const nombreSesion = document.createElement("div");
	nombreSesion.className = "card-name";
	nombreSesion.textContent = `Sesión ${numeroSesion}`;

	tarjeta.appendChild(nombreSesion);

	return tarjeta;
}

/* ---------------- Obtener sesiones ---------------- */

async function obtenerSesionesDisponibles() {
	const ejercicios = await cargarEjercicios();
	const numerosSesion = new Set();

	for (const ejercicio of ejercicios) {
		if (!Array.isArray(ejercicio.sesiones)) {
			continue;
		}
		for (const numeroSesion of ejercicio.sesiones) {
			numerosSesion.add(numeroSesion);
		}
	}

	return [...numerosSesion].sort((a, b) => a - b);
}

/* ---------------- Inicialización ---------------- */

async function inicializar() {
	const contenedorSesiones = document.getElementById("contenedor-sesiones");
	const subtitulo = document.getElementById("subtitulo");

	try {
		const sesiones = await obtenerSesionesDisponibles();
		if (sesiones.length === 0) {
			throw new Error("No hay sesiones configuradas.");
		}

		subtitulo.textContent = `${sesiones.length} ${sesiones.length === 1 ? "sesión" : "sesiones"}`;

		const fragmento = document.createDocumentFragment();
		for (const numeroSesion of sesiones) {
			fragmento.appendChild(crearTarjetaSesion(numeroSesion));
		}

		contenedorSesiones.appendChild(fragmento);
	} catch (error) {
		console.error(error);
		document.getElementById("titulo").textContent = "Error";
		subtitulo.textContent = error.message || "No se pudieron cargar las sesiones.";
	}
}

inicializar();
