// =========================================================
// utils.js — Funciones comunes del proyecto
// =========================================================

/**
 * @brief Lee y valida parámetros enteros de la URL.
 *
 * Acepta una lista de claves (strings) o de especificaciones con validador opcional.
 *
 * @param {...(string | { clave: string, validar?: (n: number) => boolean })} especificaciones
 * @returns {number[]} Valores numéricos en el mismo orden que las claves.
 *
 * @example
 *   // Simple
 *   const [id, sesion] = obtenerParametrosURL("idEjercicio", "numeroSesion");
 *
 * @example
 *   // Con validación
 *   const [idEjercicio, numeroSesion, totalEjerciciosSesion] = obtenerParametrosURL(
 *     { clave: "idEjercicio",           validar: (n) => n > 0 },
 *     { clave: "numeroSesion",          validar: (n) => n > 0 },
 *     { clave: "totalEjerciciosSesion", validar: (n) => n >= 0 }
 *   );
 */
export function obtenerParametrosURL(...especificaciones) {
	const parametros = new URLSearchParams(location.search);

	return especificaciones.map((spec) => {
		const { clave, validar } =
			typeof spec === "string"
				? { clave: spec, validar: () => true }
				: spec;

		const valor = parametros.get(clave);
		if (valor === null) {
			throw new Error(`La URL debe incluir el parámetro "${clave}".`);
		}

		const numero = Number(valor);
		if (!Number.isInteger(numero)) {
			throw new Error(`El parámetro "${clave}" debe ser un número entero.`);
		}

		if (!validar(numero)) {
			throw new Error(`El parámetro "${clave}" tiene un valor no válido: ${numero}.`);
		}

		return numero;
	});
}

/**
 * @brief Formatea una fecha en formato largo (dd/mm/aaaa).
 * @param {Date} fecha Objeto Date que se desea formatear.
 * @return {string} Cadena con la fecha formateada como "dd/mm/aaaa".
 * @example
 *   const fecha = new Date(2024, 0, 15);
 *   formatearFecha(fecha); // "15/01/2024"
 */
export function formatearFecha(fecha) {
	return Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(fecha);
}

/**
 * @brief Formatea una fecha en formato corto (dd/mm/aa).
 * @param {Date} fecha Objeto Date que se desea formatear.
 * @return {string} Cadena con la fecha formateada como "dd/mm/aa".
 * @example
 *   const fecha = new Date(2024, 0, 15);
 *   formatearFechaCorta(fecha); // "15/01/24"
 */
export function formatearFechaCorta(fecha) {
	return Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" }).format(fecha);
}

/**
 * @brief Comprueba si dos fechas corresponden al mismo día, ignorando la hora.
 * @param {Date} fecha1 Primera fecha a comparar.
 * @param {Date} fecha2 Segunda fecha a comparar.
 * @return {boolean} true si ambas fechas son el mismo día, false en caso contrario.
 * @example
 *   const f1 = new Date(2024, 0, 15, 10, 30);
 *   const f2 = new Date(2024, 0, 15, 18, 45);
 *   esMismoDia(f1, f2); // true
 */
export function esMismoDia(fecha1, fecha2) {
	return fecha1.getFullYear() === fecha2.getFullYear() && fecha1.getMonth() === fecha2.getMonth() && fecha1.getDate() === fecha2.getDate();
}

export function obtenerInicioSemana(fecha) {
	const inicioSemana = new Date(fecha);
	inicioSemana.setHours(0, 0, 0, 0);
	inicioSemana.setDate(inicioSemana.getDate() - ((inicioSemana.getDay() + 6) % 7));
	return inicioSemana.getTime();
}


export function formatearNumero(valor, maximoDecimales = 2, minimoDecimales = 0) {
	return Number.isFinite(valor)
		? valor.toLocaleString("es-ES", { maximumFractionDigits: maximoDecimales, minimumFractionDigits: minimoDecimales })
		: "—";
}

export const setText = (id, valor) => {
	document.getElementById(id).textContent = valor;
};



export function epley(peso, repeticiones) {
	return peso * (1 + Math.min(repeticiones, 30) / 30);
}
