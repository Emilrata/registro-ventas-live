import { describe, expect, it, beforeAll } from 'vitest';
import { derARaw, verificarAsercion } from '../../src/services/biometria.js';
import { aBase64Url, textoABytes } from '../../src/core/crypto.js';

const ORIGEN = 'https://registro-ventas-live.pages.dev';
const RP = 'registro-ventas-live.pages.dev';
const sha = async (b) => new Uint8Array(await crypto.subtle.digest('SHA-256', b));
const unir = (...partes) => {
  const r = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of partes) { r.set(p, o); o += p.length; }
  return r;
};
/** r||s → DER, como lo entrega un autenticador real. */
function rawADer(raw) {
  const entero = (v) => {
    let i = 0;
    while (i < v.length - 1 && v[i] === 0) i += 1;
    let x = v.subarray(i);
    if (x[0] & 0x80) x = unir(new Uint8Array([0]), x);
    return unir(new Uint8Array([0x02, x.length]), x);
  };
  const cuerpo = unir(entero(raw.subarray(0, 32)), entero(raw.subarray(32)));
  return unir(new Uint8Array([0x30, cuerpo.length]), cuerpo);
}

let claves;
let credencial;
beforeAll(async () => {
  claves = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  credencial = { alg: -7, clavePublica: aBase64Url(new Uint8Array(await crypto.subtle.exportKey('spki', claves.publicKey))), rpId: RP };
});

async function asercion({ desafio, origen = ORIGEN, rpId = RP, banderas = 0x05, tipo = 'webauthn.get', claveFirma = claves.privateKey }) {
  const clientDataJSON = textoABytes(JSON.stringify({ type: tipo, challenge: aBase64Url(desafio), origin: origen }));
  const authenticatorData = unir(await sha(textoABytes(rpId)), new Uint8Array([banderas, 0, 0, 0, 1]));
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, claveFirma, unir(authenticatorData, await sha(clientDataJSON))));
  return { clientDataJSON, authenticatorData, signature: rawADer(raw) };
}

describe('huella / Face ID (WebAuthn)', () => {
  it('DER ↔ raw', () => {
    const raw = new Uint8Array(64).map((_, i) => (i === 0 || i === 32 ? 0x80 : i));
    expect(derARaw(rawADer(raw))).toEqual(raw);
    const conCeros = new Uint8Array(64).map((_, i) => (i < 3 ? 0 : i));
    expect(derARaw(rawADer(conCeros))).toEqual(conCeros);
  });

  it('acepta una respuesta auténtica con verificación de usuario', async () => {
    const desafio = crypto.getRandomValues(new Uint8Array(32));
    const respuesta = await asercion({ desafio });
    expect(await verificarAsercion({ credencial, respuesta, desafio, origen: ORIGEN, rpId: RP })).toBe(true);
  });

  it('rechaza: otro desafío, otro origen, otro sitio, sin verificación, tipo incorrecto, otra clave o firma alterada', async () => {
    const desafio = crypto.getRandomValues(new Uint8Array(32));
    const otro = crypto.getRandomValues(new Uint8Array(32));
    const otraClave = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])).privateKey;
    const casos = [
      await asercion({ desafio: otro }),
      await asercion({ desafio, origen: 'https://falso.example' }),
      await asercion({ desafio, rpId: 'falso.example' }),
      await asercion({ desafio, banderas: 0x01 }), // presencia sin verificación (sin huella / PIN del teléfono)
      await asercion({ desafio, banderas: 0x04 }),
      await asercion({ desafio, tipo: 'webauthn.create' }),
      await asercion({ desafio, claveFirma: otraClave }),
    ];
    for (const [i, respuesta] of casos.entries()) {
      expect(await verificarAsercion({ credencial, respuesta, desafio, origen: ORIGEN, rpId: RP }), `caso ${i}`).toBe(false);
    }
    const buena = await asercion({ desafio });
    buena.signature[buena.signature.length - 1] ^= 1;
    expect(await verificarAsercion({ credencial, respuesta: buena, desafio, origen: ORIGEN, rpId: RP })).toBe(false);
    expect(await verificarAsercion({ credencial, respuesta: { clientDataJSON: new Uint8Array([1]), authenticatorData: new Uint8Array(), signature: new Uint8Array() }, desafio, origen: ORIGEN, rpId: RP })).toBe(false);
  });
});
