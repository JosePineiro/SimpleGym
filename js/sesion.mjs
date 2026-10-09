import { cargarEjercicios, cargarHistorial } from "./database.mjs";
import { obtenerParametrosURL, setText } from "./utils.mjs";

const IMAGEN_PLACEHOLDER = "images/placeholder.svg";

function crearTarjetaEjercicio(ejercicio, completado, numeroSesion, totalEjerciciosSesion) {
	const imagen = document.createElement("img");
	imagen.src = ejercicio.imagen || IMAGEN_PLACEHOLDER;
	imagen.alt = ejercicio.nombre;
	imagen.loading = "lazy";
	imagen.decoding = "async";
	imagen.addEventListener("error", () => { imagen.src = IMAGEN_PLACEHOLDER; }, { once: true });

	const span = document.createElement("span");
	span.className = "card-name";
	span.textContent = ejercicio.nombre;

	const tarjeta = document.createElement("a");
	tarjeta.href = `entrenar-ejercicio.html?numeroSesion=${numeroSesion}&idEjercicio=${ejercicio.id}&totalEjerciciosSesion=${totalEjerciciosSesion}`;
	tarjeta.className = completado ? "card completado" : "card";

	if (completado) tarjeta.setAttribute("aria-label", `${ejercicio.nombre} (completado)`);

	tarjeta.append(imagen, span);
	return tarjeta;
}

async function inicializar() {
	try {
		const [numeroSesion] = obtenerParametrosURL({ clave: "numeroSesion", validar: (n) => n > 0 });

		const [ejercicios, historial] = await Promise.all([cargarEjercicios(), cargarHistorial()]);

		const claveHoy = new Date().setHours(0, 0, 0, 0);

		const ejerciciosCompletadosHoy = new Set();
		for (let i = historial.length - 1; i >= 0; i--) {
			const clave = historial[i].fecha.getTime();
			if (clave < claveHoy) break;

			if (clave === claveHoy && historial[i].numeroSesion === numeroSesion) {
				ejerciciosCompletadosHoy.add(historial[i].idEjercicio);
			}
		}

		const ejerciciosSesion = ejercicios
			.filter((ejercicio) => ejercicio.sesiones.includes(numeroSesion))
			.sort((a, b) => a.orden - b.orden);

		if (ejerciciosSesion.length === 0) {
			throw new Error("No hay ejercicios para esta sesión");
		}

		const completados = ejerciciosSesion.filter((e) => ejerciciosCompletadosHoy.has(e.id)).length;

		setText("titulo", `Sesión ${numeroSesion}`);
		setText("subtitulo", `${completados} de ${ejerciciosSesion.length} ejercicios completados`);

		document.getElementById("contenedor-ejercicios").replaceChildren(
			...ejerciciosSesion.map((ejercicio) =>
				crearTarjetaEjercicio(
					ejercicio,
					ejerciciosCompletadosHoy.has(ejercicio.id),
					numeroSesion,
					ejerciciosSesion.length,
				),
			),
		);
	} catch (error) {
		setText("titulo", "Error");
		setText("subtitulo", error.message || "Error inicializando la sesión");
		console.error(error);
	}
}

window.addEventListener("pageshow", (evento) => {
	if (evento.persisted) inicializar();
});

inicializar();