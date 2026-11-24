// Formato de los códigos de activación (licencias).
//   RVL1.<datos en base64url>.<firma ECDSA P-256 SHA-256 en base64url>
// Se firma el texto "RVL1.<datos>" tal cual, así no depende de cómo se ordene el JSON.
// La firma se hace con la clave privada (solo la tiene quien vende la app);
// la app solo tiene la clave pública y verifica sin internet.

import { aBase64Url, bytesATexto, desdeBase64Url, textoABytes } from './crypto.js';

export const PREFIJO_LICENCIA = 'RVL1';
const ALGORITMO = { name: 'ECDSA', namedCurve: 'P-256' };
const FIRMA = { name: 'ECDSA', hash: 'SHA-256' };

/** Quita espacios y saltos de línea (WhatsApp suele cortar los textos largos). */
export function limpiarCodigoLicencia(texto) {
  return typeof texto === 'string' ? texto.replace(/\s+/g, '') : '';
}

export function validarDatosLicencia(datos) {
  if (!datos || typeof datos !== 'object') return 'Datos vacíos';
  if (datos.v !== 1) return 'Versión de licencia desconocida';
  if (typeof datos.id !== 'string' || !/^[A-Z0-9-]{4,40}$/.test(datos.id)) return 'Identificador no válido';
  if (typeof datos.negocio !== 'string' || datos.negocio.trim() === '' || datos.negocio.length > 80) {
    return 'Nombre de negocio no válido';
  }
  if (typeof datos.emitida !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(datos.emitida)) return 'Fecha no válida';
  if (datos.vence !== null && !(typeof datos.vence === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(datos.vence))) {
    return 'Vencimiento no válido';
  }
  return null;
}

export async function importarClavePublica(jwk) {
  return globalThis.crypto.subtle.importKey('jwk', { ...jwk, ext: true }, ALGORITMO, false, ['verify']);
}

export async function importarClavePrivada(jwk) {
  return globalThis.crypto.subtle.importKey('jwk', { ...jwk, ext: true }, ALGORITMO, false, ['sign']);
}

/** Crea un código firmado. `datos` = { id, negocio, emitida, vence }. */
export async function firmarLicencia(datos, clavePrivada) {
  const completos = { v: 1, vence: null, ...datos };
  const error = validarDatosLicencia(completos);
  if (error) throw new TypeError(error);
  const cuerpo = `${PREFIJO_LICENCIA}.${aBase64Url(textoABytes(JSON.stringify(completos)))}`;
  const firma = await globalThis.crypto.subtle.sign(FIRMA, clavePrivada, textoABytes(cuerpo));
  return `${cuerpo}.${aBase64Url(new Uint8Array(firma))}`;
}

/**
 * Verifica un código. Devuelve { ok: true, datos } o { ok: false, error }.
 * `hoy` = "AAAA-MM-DD" para revisar el vencimiento.
 */
export async function verificarLicencia(texto, clavePublica, hoy) {
  const codigo = limpiarCodigoLicencia(texto);
  const partes = codigo.split('.');
  if (partes.length !== 3 || partes[0] !== PREFIJO_LICENCIA) {
    return { ok: false, error: 'El código no tiene el formato correcto. Cópialo completo.' };
  }
  let datos;
  let firma;
  try {
    datos = JSON.parse(bytesATexto(desdeBase64Url(partes[1])));
    firma = desdeBase64Url(partes[2]);
  } catch {
    return { ok: false, error: 'El código está incompleto o dañado. Cópialo completo.' };
  }
  const valida = await globalThis.crypto.subtle
    .verify(FIRMA, clavePublica, firma, textoABytes(`${partes[0]}.${partes[1]}`))
    .catch(() => false);
  if (!valida) return { ok: false, error: 'El código no es válido.' };
  const error = validarDatosLicencia(datos);
  if (error) return { ok: false, error: 'El código no es válido.' };
  if (datos.vence && hoy && hoy > datos.vence) {
    return { ok: false, error: `La licencia venció el ${datos.vence.split('-').reverse().join('/')}.` };
  }
  return { ok: true, datos, codigo };
}
