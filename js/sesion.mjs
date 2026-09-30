import { cargarEjercicios, cargarRegistrosEjercicio } from "./database.mjs";

/* =========================================================
   sesión de entrenamiento

   Semana / ciclo
   └── Sesión
	   └── Ejercicio
		   └── Registro de ejercicio
			   └── Series
				   └── Repeticiones

   Esta pantalla muestra un ejercicio por cada ejercicio programado para la sesión.
   El ejercicio se muestra como completado si existe un registro de ejercicio realizado hoy.
   ========================================================= */

const IMAGEN_PLACEHOLDER = "images/placeholder.svg";

function esMismoDia(fecha1, fecha2) {
	return fecha1.getFullYear() === fecha2.getFullYear() && fecha1.getMonth() === fecha2.getMonth() && fecha1.getDate() === fecha2.getDate();
}

function crearTarjetaEjercicio(ejercicio, completado, numeroSesion, totalEjerciciosSesion) {
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

	const span = document.createElement("span");
	span.className = "card-name";
	span.textContent = ejercicio.nombre;

	const tarjeta = document.createElement("a");
	tarjeta.href =
		`entrenar_ejercicio.html?numeroSesion=${numeroSesion}` +
		`&idEjercicio=${ejercicio.id}` +
		`&totalEjerciciosSesion=${totalEjerciciosSesion}`;
	tarjeta.className = completado ? "card completado" : "card";

	if (completado) {
		tarjeta.setAttribute("aria-label", `${ejercicio.nombre} (completado)`);
	}

	tarjeta.append(imagen, span);

	return tarjeta;
}

async function inicializar() {
	const titulo = document.getElementById("titulo");
	const subtitulo = document.getElementById("subtitulo");

	try {
		const parametros = new URLSearchParams(location.search);
		const numeroSesion = Number(parametros.get("numeroSesion"));
		if (!(numeroSesion > 0)) {
			throw new Error("Falta el parámetro 'numeroSesion' o no es válido.");
		}

		const [ejercicios, registros] = await Promise.all([cargarEjercicios(), cargarRegistrosEjercicio()]);
		const hoy = new Date();
		const ejerciciosCompletadosHoy = new Set(
			registros.filter((registro) => esMismoDia(registro.fecha, hoy)).map((registro) => registro.idEjercicio),
		);

		const ejerciciosSesion = ejercicios
			.filter((ejercicio) => ejercicio.sesiones.includes(numeroSesion))
			.sort((a, b) => (a.orden ?? Infinity) - (b.orden ?? Infinity) || a.id - b.id);

		const totalEjerciciosSesion = ejerciciosSesion.length;
		const numeroEjerciciosCompletados = ejerciciosSesion.filter((ejercicio) => ejerciciosCompletadosHoy.has(ejercicio.id)).length;

		titulo.textContent = `Sesión ${numeroSesion}`;

		if (totalEjerciciosSesion === 0) {
			throw new Error("No hay ejercicios para esta sesión");
		}

		subtitulo.textContent = `${numeroEjerciciosCompletados} de ` + `${totalEjerciciosSesion} ejercicios completados`;

		const tarjetasEjercicio = ejerciciosSesion.map((ejercicio) =>
			crearTarjetaEjercicio(
				ejercicio,
				ejerciciosCompletadosHoy.has(ejercicio.id),
				numeroSesion,
				totalEjerciciosSesion
			),
		);

		document.getElementById("contenedor-ejercicios").replaceChildren(...tarjetasEjercicio);
	} catch (error) {
		console.error(error);
		titulo.textContent = "Error";
		subtitulo.textContent = error.message || "Error inicializando la sesión";
	}
}

// Al volver con "atrás", el navegador puede restaurar
// la página desde la bfcache sin volver a ejecutar el
// script. En ese caso actualizamos el estado.
window.addEventListener("pageshow", (evento) => {
	if (evento.persisted) {
		inicializar();
	}
});

inicializar();
