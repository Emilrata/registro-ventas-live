// Huella / Face ID con WebAuthn (autenticador del propio teléfono, verificación de usuario obligatoria).
// - Solo se ofrece si el teléfono tiene un autenticador de plataforma (si no, queda oculto).
// - Se guarda la clave PÚBLICA de la credencial; cada desbloqueo se verifica con su firma,
//   sin internet. El PIN sigue siendo el acceso principal y de respaldo.
import { obtenerBD } from '../core/db.js';
import { ahoraISO } from '../core/dates.js';
import { aBase64Url, bytesAleatorios, bytesATexto, desdeBase64Url, textoABytes } from '../core/crypto.js';
import { registrarHistorial } from '../repositories/historial.repo.js';

const CLAVE = 'seguridad.biometria';
const ALG_ES256 = -7;
const ALG_RS256 = -257;

const sha256 = async (bytes) => new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
const concatenar = (a, b) => {
  const r = new Uint8Array(a.length + b.length);
  r.set(a, 0);
  r.set(b, a.length);
  return r;
};

/** ¿El teléfono permite huella / Face ID para esta app? */
export async function biometriaDisponible() {
  try {
    if (!globalThis.isSecureContext || !globalThis.PublicKeyCredential) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function biometriaActiva(db = obtenerBD()) {
  return Boolean((await db.ajustes.get(CLAVE))?.valor?.credencialId);
}

/** Firma ECDSA en DER (la que entrega WebAuthn) → formato r||s de 64 bytes (el que usa WebCrypto). */
export function derARaw(der) {
  if (der[0] !== 0x30) throw new Error('Firma no válida');
  let p = 2;
  if (der[1] & 0x80) p = 2 + (der[1] & 0x7f);
  const leerEntero = () => {
    if (der[p] !== 0x02) throw new Error('Firma no válida');
    const largo = der[p + 1];
    let valor = der.subarray(p + 2, p + 2 + largo);
    p += 2 + largo;
    while (valor.length > 32 && valor[0] === 0) valor = valor.subarray(1);
    if (valor.length > 32) throw new Error('Firma no válida');
    const salida = new Uint8Array(32);
    salida.set(valor, 32 - valor.length);
    return salida;
  };
  return concatenar(leerEntero(), leerEntero());
}

/**
 * Verifica una respuesta de navigator.credentials.get() contra la credencial guardada.
 * respuesta = { clientDataJSON, authenticatorData, signature } (Uint8Array)
 * Devuelve true solo si todo coincide: tipo, desafío, origen, rpId, presencia y VERIFICACIÓN del usuario, y la firma.
 */
export async function verificarAsercion({ credencial, respuesta, desafio, origen, rpId }) {
  try {
    const cliente = JSON.parse(bytesATexto(respuesta.clientDataJSON));
    if (cliente.type !== 'webauthn.get') return false;
    if (cliente.challenge !== aBase64Url(desafio)) return false;
    if (cliente.origin !== origen) return false;
    const auth = respuesta.authenticatorData;
    if (auth.length < 37) return false;
    const hashRp = await sha256(textoABytes(rpId));
    for (let i = 0; i < 32; i += 1) if (auth[i] !== hashRp[i]) return false;
    const banderas = auth[32];
    if (!(banderas & 0x01) || !(banderas & 0x04)) return false; // presencia (UP) y verificación (UV)
    const firmado = concatenar(auth, await sha256(respuesta.clientDataJSON));
    const spki = desdeBase64Url(credencial.clavePublica);
    if (credencial.alg === ALG_ES256) {
      const clave = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, clave, derARaw(respuesta.signature), firmado);
    }
    if (credencial.alg === ALG_RS256) {
      const clave = await crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', clave, respuesta.signature, firmado);
    }
    return false;
  } catch {
    return false;
  }
}

/** Registra la huella / Face ID de este teléfono. Llamar después de comprobar el PIN. */
export async function activarBiometria({ nombreNegocio = 'Ventas LIVE', db = obtenerBD() } = {}) {
  if (!(await biometriaDisponible())) return { ok: false, error: 'Este teléfono no permite usar huella o Face ID en la app.' };
  const actual = (await db.ajustes.get(CLAVE))?.valor;
  let credencial;
  try {
    credencial = await navigator.credentials.create({
      publicKey: {
        rp: { name: 'Ventas LIVE', id: location.hostname },
        user: { id: bytesAleatorios(16), name: 'principal', displayName: nombreNegocio },
        challenge: bytesAleatorios(32),
        pubKeyCredParams: [{ type: 'public-key', alg: ALG_ES256 }, { type: 'public-key', alg: ALG_RS256 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
        excludeCredentials: actual?.credencialId ? [{ type: 'public-key', id: desdeBase64Url(actual.credencialId) }] : [],
        attestation: 'none',
        timeout: 60000,
      },
    });
  } catch (err) {
    if (err?.name === 'NotAllowedError') return { ok: false, error: 'Se canceló o no se reconoció la huella / Face ID.' };
    if (err?.name === 'InvalidStateError') return { ok: false, error: 'La huella / Face ID ya estaba activada en este teléfono.' };
    return { ok: false, error: 'No se pudo activar la huella / Face ID.' };
  }
  const r = credencial?.response;
  const spki = r?.getPublicKey?.();
  const alg = r?.getPublicKeyAlgorithm?.();
  if (!spki || ![ALG_ES256, ALG_RS256].includes(alg)) return { ok: false, error: 'Este teléfono no es compatible con el desbloqueo por huella / Face ID.' };
  const auth = new Uint8Array(r.getAuthenticatorData());
  if (!(auth[32] & 0x04)) return { ok: false, error: 'El teléfono no verificó tu identidad (huella / Face ID).' };
  const valor = { credencialId: aBase64Url(new Uint8Array(credencial.rawId)), clavePublica: aBase64Url(new Uint8Array(spki)), alg, rpId: location.hostname, creadoEn: ahoraISO() };
  await db.transaction('rw', db.ajustes, db.historial, async () => {
    await db.ajustes.put({ clave: CLAVE, valor, actualizadoEn: ahoraISO() });
    await registrarHistorial({ entidad: 'seguridad', tipo: 'biometria-activada' }, db);
  });
  return { ok: true };
}

export async function desactivarBiometria(db = obtenerBD()) {
  await db.transaction('rw', db.ajustes, db.historial, async () => {
    await db.ajustes.put({ clave: CLAVE, valor: null, actualizadoEn: ahoraISO() });
    await registrarHistorial({ entidad: 'seguridad', tipo: 'biometria-desactivada' }, db);
  });
  return { ok: true };
}

/** Pide la huella / Face ID y la verifica. Devuelve { ok } o { ok:false, error }. */
export async function desbloquearConBiometria(db = obtenerBD()) {
  const credencial = (await db.ajustes.get(CLAVE))?.valor;
  if (!credencial?.credencialId) return { ok: false, error: 'La huella / Face ID no está activada.' };
  const desafio = bytesAleatorios(32);
  let asercion;
  try {
    asercion = await navigator.credentials.get({
      publicKey: {
        challenge: desafio,
        rpId: credencial.rpId,
        allowCredentials: [{ type: 'public-key', id: desdeBase64Url(credencial.credencialId) }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
  } catch {
    return { ok: false, error: 'No se reconoció. Usa tu PIN.' };
  }
  const r = asercion?.response;
  const valido = r && (await verificarAsercion({
    credencial,
    respuesta: {
      clientDataJSON: new Uint8Array(r.clientDataJSON),
      authenticatorData: new Uint8Array(r.authenticatorData),
      signature: new Uint8Array(r.signature),
    },
    desafio,
    origen: location.origin,
    rpId: credencial.rpId,
  }));
  return valido ? { ok: true } : { ok: false, error: 'No se pudo verificar la huella / Face ID. Usa tu PIN.' };
}
