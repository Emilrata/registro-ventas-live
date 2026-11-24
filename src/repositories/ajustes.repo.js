// Acceso a la tabla `ajustes` (clave/valor).
import { obtenerBD } from '../core/db.js';
import { ahoraISO } from '../core/dates.js';

export async function obtenerAjuste(clave, porDefecto = undefined, db = obtenerBD()) {
  const fila = await db.ajustes.get(clave);
  return fila === undefined ? porDefecto : fila.valor;
}

export async function guardarAjuste(clave, valor, db = obtenerBD()) {
  await db.ajustes.put({ clave, valor, actualizadoEn: ahoraISO() });
}

/** Cantidad de registros por tabla (para la pantalla de estado). */
export async function contarRegistros(db = obtenerBD()) {
  const resultado = {};
  await db.transaction('r', db.tables, async () => {
    for (const t of db.tables) resultado[t.name] = await t.count();
  });
  return resultado;
}
