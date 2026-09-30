import {
	borrarRegistrosEjercicio,
	cargarEjercicios,
	cargarRegistrosEjercicio,
	guardarEjercicios,
	guardarRegistroEjercicio,
} from "./database.mjs";

/*
Definiciones:
Semana / ciclo
└── Sesión
	└── Ejercicio
		└── Registro de ejercicio
			└── Series
				└── Repeticiones
*/

function esMismoDia(fecha1, fecha2) {
	return fecha1.getFullYear() === fecha2.getFullYear() && fecha1.getMonth() === fecha2.getMonth() && fecha1.getDate() === fecha2.getDate();
}

// ---- Importar / Exportar historial en CSV ----

function parseCSV(text) {
	const lineas = text
		.replace(/^\uFEFF/, "")
		.replaceAll("\r", "")
		.replaceAll(",", ".")
		.trim()
		.split("\n");

	// Saltar cabecera
	if (lineas[0]?.toLowerCase().includes("id_ejercicio")) {
		lineas.shift();
	}

	const registros = [];
	let omitidos = 0;

	for (const linea of lineas) {
		if (!linea.trim()) continue;

		const partes = linea.split(";").map((parte) => parte.trim());

		if (partes.length < 7) {
			omitidos++;
			continue;
		}

		const [idEjercicioTexto, numeroSesionTexto, totalEjerciciosTexto, fechaTexto, numeroSeriesTexto, pesoTexto, repeticionesTexto] = partes;
		const idEjercicio = Number(idEjercicioTexto);
		const numeroSesion = Number(numeroSesionTexto);
		const totalEjercicios = Number(totalEjerciciosTexto);
		const [anio, mes, dia] = fechaTexto.split(/[/-]/).map(Number);
		const fecha = new Date(anio, mes - 1, dia);
		const numeroSeries = Number(numeroSeriesTexto);
		const peso = Number(pesoTexto);
		const repeticiones = Number(repeticionesTexto);

		const registroValido =
			idEjercicioTexto &&
			!Number.isNaN(idEjercicio) &&
			numeroSesionTexto &&
			!Number.isNaN(numeroSesion) &&
			totalEjerciciosTexto &&
			!Number.isNaN(totalEjercicios) &&
			!Number.isNaN(fecha.getTime()) &&
			numeroSeriesTexto &&
			!Number.isNaN(numeroSeries) &&
			pesoTexto &&
			!Number.isNaN(peso) &&
			repeticionesTexto &&
			!Number.isNaN(repeticiones);

		if (!registroValido) {
			omitidos++;
			continue;
		}

		registros.push({ idEjercicio, numeroSesion, totalEjercicios, fecha, numeroSeries, peso, repeticiones });
	}

	return { registros, omitidos };
}

async function importarCSV(event) {
	const file = event.target.files[0];
	if (!file) return;

	try {
		const text = await file.text();
		const { registros, omitidos } = parseCSV(text);

		if (registros.length === 0) {
			throw new Error("El CSV no contiene filas válidas.");
		}

		await borrarRegistrosEjercicio();

		for (const registro of registros) {
			await guardarRegistroEjercicio(registro);
		}

		alert(`${registros.length} registros de ejercicio importados${omitidos ? `, ${omitidos} omitidos.` : "."}`);

		await inicializar();
	} catch (error) {
		alert(`Error al procesar el archivo CSV: ${error?.message || error}`);
		console.error(error);
	} finally {
		event.target.value = "";
	}
}

async function exportarCSV() {
	const registros = await cargarRegistrosEjercicio();

	if (registros.length === 0) {
		alert("No hay datos en el historial para exportar.");
		return;
	}

	const filas = [
		"id_ejercicio;numero_sesion;total_ejercicios;fecha;numero_series;peso;repeticiones",

		...registros.map((registro) => {
			const fecha = `${registro.fecha.getFullYear()}/${String(registro.fecha.getMonth() + 1).padStart(2, "0")}/${String(
				registro.fecha.getDate(),
			).padStart(2, "0")}`;

			return [
				registro.idEjercicio,
				registro.numeroSesion,
				registro.totalEjercicios,
				fecha,
				registro.numeroSeries,
				registro.peso,
				registro.repeticiones,
			].join(";");
		}),
	];

	const blob = new Blob(["\uFEFF" + filas.join("\r\n")], {
		type: "text/csv;charset=utf-8",
	});

	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");

	link.href = url;
	link.download = "historico.csv";
	link.click();

	setTimeout(() => URL.revokeObjectURL(url), 100);
}

// ---- Importar / Exportar ejercicios en JSON ----

async function importarJSON(event) {
	const file = event.target.files[0];
	if (!file) return;

	try {
		const text = await file.text();

		let ejercicios;

		try {
			ejercicios = JSON.parse(text);
		} catch {
			throw new Error("El archivo no contiene un JSON válido.");
		}

		if (!Array.isArray(ejercicios) || ejercicios.length === 0) {
			throw new Error("El JSON no contiene ningún ejercicio.");
		}

		const esValido = (ejercicio) =>
			typeof ejercicio.id === "number" &&
			typeof ejercicio.orden === "number" &&
			typeof ejercicio.imagen === "string" &&
			typeof ejercicio.nombre === "string" &&
			ejercicio.nombre.trim() !== "" &&
			typeof ejercicio.descripcion === "string" &&
			typeof ejercicio.incremento_peso === "number" &&
			Array.isArray(ejercicio.sesiones) &&
			ejercicio.sesiones.every((sesion) => typeof sesion === "number") &&
			typeof ejercicio.series_trabajo === "number" &&
			typeof ejercicio.series_aproximacion === "number" &&
			typeof ejercicio.repeticiones_min === "number" &&
			typeof ejercicio.repeticiones_max === "number" &&
			typeof ejercicio.rir === "number" &&
			typeof ejercicio.descanso === "number";

		const indiceInvalido = ejercicios.findIndex((ejercicio) => !esValido(ejercicio));

		if (indiceInvalido !== -1) {
			const ejercicio = ejercicios[indiceInvalido];
			const id = ejercicio && typeof ejercicio.id !== "undefined"
				? ejercicio.id
				: `(posición ${indiceInvalido + 1})`;
			throw new Error(
				`El JSON no tiene el formato esperado. Ejercicio inválido con id: ${id}.`,
			);
		}

		const blob = new Blob([text], {
			type: "application/json",
		});

		await guardarEjercicios(blob);
		await inicializar();

		alert(`${ejercicios.length} ejercicios importados correctamente.`);
	} catch (error) {
		alert(`Error al procesar el archivo JSON: ${error?.message || error}`);
		console.error(error);
	} finally {
		event.target.value = "";
	}
}
async function exportarJSON() {
	try {
		const ejercicios = await cargarEjercicios();
		const blob = new Blob([JSON.stringify(ejercicios, null, 2)], { type: "application/json" });
		const url = URL.createObjectURL(blob);

		const link = document.createElement("a");
		link.href = url;
		link.download = "ejercicios.json";
		link.click();

		setTimeout(() => URL.revokeObjectURL(url), 100);
	} catch (error) {
		alert(error?.message || error);
		console.error(error);
	}
}

// ---- Inicializar pantalla ----

function getSesionActual(maxNumeroSesion, registros) {
	if (!registros.length || !maxNumeroSesion) {
		return 1;
	}

	const ultimoRegistro = registros.reduce((a, b) => (a.fecha > b.fecha ? a : b));

	// Si el último entrenamiento fue hoy, mantenemos la misma sesión.
	if (esMismoDia(ultimoRegistro.fecha, new Date())) {
		return ultimoRegistro.numeroSesion;
	}

	// Si fue otro día, avanzamos una sesión.
	return (ultimoRegistro.numeroSesion % maxNumeroSesion) + 1;
}

function getNumeroEjerciciosPendientes(ejercicios, registros, numeroSesion) {
	const ejerciciosHechosHoy = new Set(
		registros.filter((registro) => esMismoDia(registro.fecha, new Date())).map((registro) => registro.idEjercicio),
	);

	return ejercicios.filter((ejercicio) => ejercicio.sesiones.includes(numeroSesion) && !ejerciciosHechosHoy.has(ejercicio.id)).length;
}

async function inicializar() {
	try {
		const [ejercicios, registros] = await Promise.all([cargarEjercicios(), cargarRegistrosEjercicio()]);
		const maxNumeroSesion = Math.max(1, ...ejercicios.flatMap((ejercicio) => ejercicio.sesiones));
		const numeroSesionDeHoy = getSesionActual(maxNumeroSesion, registros);
		const btnIrSesion = document.getElementById("btn-ir-sesion");
		btnIrSesion.textContent = `Comenzar sesión ${numeroSesionDeHoy}`;
		btnIrSesion.href = `sesion.html?numeroSesion=${numeroSesionDeHoy}`;

		const infoSesion = document.getElementById("info-sesion");
		const numeroEjerciciosPendientes = getNumeroEjerciciosPendientes(ejercicios, registros, numeroSesionDeHoy);
		if (numeroEjerciciosPendientes === 0) {
			infoSesion.textContent = "Todos los ejercicios de hoy completados";
		} else {
			infoSesion.textContent = `Hoy tienes ${numeroEjerciciosPendientes} ejercicios pendientes.`;
		}
	} catch (error) {
		console.error(error);
		alert(`Error inicializando: ${error?.message || error}`);
	}
}

// ---- Eventos ----

document.getElementById("btn-importar-CSV").addEventListener("change", importarCSV);
document.getElementById("btn-exportar-CSV").addEventListener("click", exportarCSV);
document.getElementById("btn-importar-JSON").addEventListener("change", importarJSON);
document.getElementById("btn-exportar-JSON").addEventListener("click", exportarJSON);

inicializar();
