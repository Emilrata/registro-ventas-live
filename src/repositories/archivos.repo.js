// Archivos (fotos, comprobantes, logo) guardados como Blob.
// REGLA: este repositorio NO tiene función de borrado. Nunca agregar una.
import { obtenerBD } from '../core/db.js';
import { ahoraISO } from '../core/dates.js';

const TIPOS = new Set(['foto', 'comprobante', 'logo']);

/** Agrega un archivo y devuelve su id. */
export function agregarArchivo(
  { tipo, mime, bytes, ancho = null, alto = null, blob, miniatura = null, sha256, refTipo = null, refId = null },
  db = obtenerBD(),
) {
  if (!TIPOS.has(tipo)) throw new TypeError(`Tipo de archivo no válido: ${tipo}`);
  if (!(blob instanceof Blob)) throw new TypeError('El archivo debe ser un Blob');
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) throw new TypeError('Falta la huella SHA-256');
  return db.archivos.add({
    tipo,
    mime: mime ?? blob.type,
    bytes: bytes ?? blob.size,
    ancho,
    alto,
    blob,
    miniatura,
    sha256,
    refTipo,
    refId,
    creadoEn: ahoraISO(),
  });
}

export function obtenerArchivo(id, db = obtenerBD()) {
  return db.archivos.get(id);
}
