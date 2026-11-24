// Configuración inicial y marca del negocio (nombre, logo, WhatsApp).
import { obtenerBD } from '../core/db.js';
import { ahoraISO } from '../core/dates.js';
import { sha256Hex } from '../core/crypto.js';
import { limpiarTexto, normalizarWhatsapp } from '../core/validation.js';
import { agregarArchivo } from '../repositories/archivos.repo.js';
import { registrarHistorial } from '../repositories/historial.repo.js';
import { licenciaActual } from './licencia.js';
import { tienePin } from './seguridad.js';

/** Paso en el que debe continuar la configuración inicial. */
export async function estadoConfiguracion({ db = obtenerBD(), opcionesLicencia } = {}) {
  const licencia = await licenciaActual({ db, ...opcionesLicencia });
  const marca = await obtenerMarca(db);
  const pin = await tienePin(db);
  const completa = (await db.ajustes.get('configuracion.completa'))?.valor === true;
  let paso;
  if (!licencia.ok) paso = 'licencia';
  else if (!marca) paso = 'marca';
  else if (!pin) paso = 'pin';
  else if (!completa) paso = 'recuperacion';
  else paso = 'lista';
  return { paso, licencia, marca, completa };
}

export async function obtenerMarca(db = obtenerBD()) {
  return (await db.ajustes.get('marca'))?.valor ?? null;
}

export function validarMarca({ nombre, whatsapp, codigoPais = '591' }) {
  const n = limpiarTexto(nombre);
  if (n.length === 0) return { ok: false, campo: 'nombre', error: 'Escribe el nombre del negocio.' };
  if (n.length > 60) return { ok: false, campo: 'nombre', error: 'El nombre no puede pasar de 60 caracteres.' };
  const w = normalizarWhatsapp(whatsapp ?? '', codigoPais);
  if (!w.ok) return { ok: false, campo: 'whatsapp', error: w.error };
  return { ok: true, nombre: n, whatsapp: w.valor };
}

/**
 * Guarda nombre, WhatsApp y (opcional) logo del negocio.
 * logo = { blob, ancho, alto } ya procesado; si no se manda, se conserva el anterior.
 * Los logos anteriores no se borran (archivos nunca se borran).
 */
export async function guardarMarca({ nombre, whatsapp, codigoPais, logo = null }, db = obtenerBD()) {
  const v = validarMarca({ nombre, whatsapp, codigoPais });
  if (!v.ok) return v;
  const sha256 = logo ? await sha256Hex(logo.blob) : null;

  await db.transaction('rw', db.ajustes, db.archivos, db.historial, async () => {
    const anterior = (await db.ajustes.get('marca'))?.valor ?? null;
    let logoId = anterior?.logoId ?? null;
    if (logo) {
      logoId = await agregarArchivo(
        { tipo: 'logo', blob: logo.blob, ancho: logo.ancho, alto: logo.alto, sha256, refTipo: 'negocio' },
        db,
      );
    }
    const nueva = { nombre: v.nombre, whatsapp: v.whatsapp, logoId };
    await db.ajustes.put({ clave: 'marca', valor: nueva, actualizadoEn: ahoraISO() });
    await registrarHistorial(
      { entidad: 'negocio', tipo: anterior ? 'marca-actualizada' : 'marca-creada', antes: anterior, despues: nueva },
      db,
    );
  });
  return { ok: true };
}
