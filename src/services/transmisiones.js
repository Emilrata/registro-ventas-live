// Transmisiones LIVE: agrupan los pedidos de cada en vivo.
import { obtenerBD } from '../core/db.js';
import { ahoraISO, formatearFecha } from '../core/dates.js';
import { limpiarTexto } from '../core/validation.js';
import { registrarHistorial } from '../repositories/historial.repo.js';

const CLAVE_ACTIVA = 'transmisiones.activaId';

export async function crearTransmision({ nombre, notas = '' } = {}, db = obtenerBD()) {
  const fecha = ahoraISO();
  const n = limpiarTexto(nombre) || `LIVE ${formatearFecha(fecha)}`;
  if (n.length > 60) return { ok: false, error: 'El nombre no puede pasar de 60 caracteres.' };
  return db.transaction('rw', db.transmisiones, db.ajustes, db.historial, async () => {
    const fila = { nombre: n, fecha, notas: limpiarTexto(notas) };
    const id = await db.transmisiones.add(fila);
    await db.ajustes.put({ clave: CLAVE_ACTIVA, valor: id, actualizadoEn: fecha });
    await registrarHistorial({ entidad: 'transmision', entidadId: id, tipo: 'transmision-creada', despues: fila }, db);
    return { ok: true, id };
  });
}

export async function listarTransmisiones(db = obtenerBD()) {
  return db.transmisiones.orderBy('fecha').reverse().toArray();
}

/** Transmisión elegida para los pedidos nuevos (o null). */
export async function transmisionActiva(db = obtenerBD()) {
  const id = (await db.ajustes.get(CLAVE_ACTIVA))?.valor;
  return id ? ((await db.transmisiones.get(id)) ?? null) : null;
}

export async function elegirTransmision(id, db = obtenerBD()) {
  if (id !== null && !(await db.transmisiones.get(id))) return { ok: false, error: 'La transmisión no existe.' };
  await db.ajustes.put({ clave: CLAVE_ACTIVA, valor: id, actualizadoEn: ahoraISO() });
  return { ok: true };
}
