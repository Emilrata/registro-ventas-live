// Registro de cambios importantes. Solo se agregan filas; nunca se editan ni borran.
// entidadId = 0 para cosas únicas sin id propio (negocio, seguridad, licencia).
import { obtenerBD } from '../core/db.js';
import { ahoraISO } from '../core/dates.js';

export const ACTOR_USUARIO = 'usuario';
export const ACTOR_SISTEMA = 'sistema';

/**
 * Agrega una fila al historial. Llamar dentro de la misma transacción que el cambio
 * (incluir db.historial en la transacción).
 */
export function registrarHistorial(
  { entidad, entidadId = 0, tipo, antes = null, despues = null, actor = ACTOR_USUARIO, fechaHora = ahoraISO() },
  db = obtenerBD(),
) {
  if (!entidad || !tipo) throw new TypeError('El historial necesita entidad y tipo');
  return db.historial.add({ entidad, entidadId, tipo, antes, despues, fechaHora, actor });
}

export function historialDe(entidad, entidadId, db = obtenerBD()) {
  return db.historial.where('[entidad+entidadId]').equals([entidad, entidadId]).sortBy('fechaHora');
}
