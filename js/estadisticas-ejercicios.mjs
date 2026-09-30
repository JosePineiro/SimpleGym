import { cargarEjercicios } from "./database.mjs";

/* =========================================================
   Estadísticas por ejercicio
   ========================================================= */

const IMAGEN_PLACEHOLDER = "images/placeholder.svg";

/* ---------------- Creación de tarjetas ---------------- */

function crearTarjetaEjercicio(ejercicio) {
	const tarjeta = document.createElement("a");
	tarjeta.className = "card";
	tarjeta.href = `estadisticas-ejercicio.html?idEjercicio=${encodeURIComponent(ejercicio.id)}`;
	tarjeta.setAttribute("aria-label", `Ver estadísticas de ${ejercicio.nombre}`);

	const imagen = document.createElement("img");
	imagen.src = ejercicio.imagen || IMAGEN_PLACEHOLDER;
	imagen.alt = ejercicio.nombre;
	imagen.loading = "lazy";
	imagen.decoding = "async";
	imagen.addEventListener(
		"error",
		() => {
			imagen.src = IMAGEN_PLACEHOLDER;
		},
		{ once: true },
	);

	const nombre = document.createElement("div");
	nombre.className = "card-name";
	nombre.textContent = ejercicio.nombre;
	tarjeta.append(imagen, nombre);

	return tarjeta;
}

/* ---------------- Inicialización ---------------- */

async function inicializar() {
	const subtitulo = document.getElementById("subtitulo");
	const contenedorEjercicios = document.getElementById("contenedor-ejercicios");

	try {
		const ejercicios = [...(await cargarEjercicios())].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
		if (ejercicios.length === 0) {
			throw new Error("No hay ejercicios registrados.");
		}

		subtitulo.textContent = `${ejercicios.length} ejercicio${ejercicios.length === 1 ? "" : "s"}`;

		contenedorEjercicios.replaceChildren(...ejercicios.map(crearTarjetaEjercicio));
	} catch (error) {
		console.error(error);
		document.getElementById("titulo").textContent = "Error";
		subtitulo.textContent = error.message || "No se pudieron cargar los ejercicios.";
	}
}

inicializar();
