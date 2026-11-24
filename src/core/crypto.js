// Utilidades criptográficas con WebCrypto (navegador y Node 20+).

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('Este navegador no permite funciones de seguridad (WebCrypto). Abre la app con https.');
  return s;
};

export function bytesAleatorios(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

export function aBase64Url(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < b.length; i += 1) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function desdeBase64Url(texto) {
  if (typeof texto !== 'string' || !/^[A-Za-z0-9_-]*$/.test(texto)) {
    throw new TypeError('Texto base64url no válido');
  }
  const b64 = texto.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(texto.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function textoABytes(texto) {
  return new TextEncoder().encode(texto);
}

export function bytesATexto(bytes) {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** SHA-256 en hexadecimal (para huellas de archivos). */
export async function sha256Hex(datos) {
  const buf = datos instanceof Blob ? await datos.arrayBuffer() : datos;
  const hash = new Uint8Array(await subtle().digest('SHA-256', buf));
  return [...hash].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export const PBKDF2_ITERACIONES = 300000;

/**
 * Deriva un hash PBKDF2-SHA256 (32 bytes).
 * Devuelve { algoritmo, iteraciones, sal, hash } con sal y hash en base64url.
 */
export async function derivarPBKDF2(secreto, { sal = bytesAleatorios(16), iteraciones = PBKDF2_ITERACIONES } = {}) {
  const clave = await subtle().importKey('raw', textoABytes(secreto), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteraciones }, clave, 256);
  return {
    algoritmo: 'PBKDF2-SHA256',
    iteraciones,
    sal: aBase64Url(sal),
    hash: aBase64Url(new Uint8Array(bits)),
  };
}

/** Compara un secreto con un hash guardado por derivarPBKDF2. */
export async function verificarPBKDF2(secreto, guardado) {
  if (!guardado || guardado.algoritmo !== 'PBKDF2-SHA256') return false;
  const calculado = await derivarPBKDF2(secreto, {
    sal: desdeBase64Url(guardado.sal),
    iteraciones: guardado.iteraciones,
  });
  return igualesTiempoConstante(desdeBase64Url(calculado.hash), desdeBase64Url(guardado.hash));
}

export function igualesTiempoConstante(a, b) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i += 1) dif |= a[i] ^ b[i];
  return dif === 0;
}
