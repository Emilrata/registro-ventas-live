// Fechas. Se guardan como texto ISO 8601 en UTC ("2026-11-24T22:58:00.000Z"),
// que ordena correctamente en IndexedDB. Los cálculos por día usan la hora local
// del dispositivo (Bolivia: UTC−4, sin horario de verano).

export const PLAZO_DIAS_POR_DEFECTO = 30;

/** Momento actual en ISO UTC. */
export function ahoraISO(ahora = new Date()) {
  return aFecha(ahora).toISOString();
}

/** Convierte ISO, número o Date a Date válido; lanza error si no es válido. */
export function aFecha(valor) {
  const d = valor instanceof Date ? new Date(valor.getTime()) : new Date(valor);
  if (Number.isNaN(d.getTime())) throw new TypeError(`Fecha no válida: ${String(valor)}`);
  return d;
}

const dos = (n) => String(n).padStart(2, '0');

/** Día local "AAAA-MM-DD" de una fecha (para agrupar ventas por día). */
export function claveDia(valor) {
  const d = aFecha(valor);
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/**
 * Suma días de calendario en hora local, conservando la hora del día.
 * Devuelve ISO UTC.
 */
export function sumarDias(valor, dias) {
  if (!Number.isInteger(dias)) throw new TypeError('Los días deben ser un número entero');
  const d = aFecha(valor);
  d.setDate(d.getDate() + dias);
  return d.toISOString();
}

/** Número de días de calendario locales entre dos fechas (b − a). */
export function diasEntre(a, b) {
  const da = aFecha(a);
  const db = aFecha(b);
  const ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((ub - ua) / 86400000);
}

/** Fecha límite de un pedido creado en `creadoEn` con un plazo en días. */
export function calcularFechaLimite(creadoEn, plazoDias = PLAZO_DIAS_POR_DEFECTO) {
  return sumarDias(creadoEn, plazoDias);
}

/** "24/11/2026" */
export function formatearFecha(valor) {
  const d = aFecha(valor);
  return `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** "24/11/2026 18:58" */
export function formatearFechaHora(valor) {
  const d = aFecha(valor);
  return `${formatearFecha(d)} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
}
