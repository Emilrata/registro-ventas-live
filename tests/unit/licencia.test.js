import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bdDePrueba, cerrarBD } from './ayuda-bd.js';
import { aBase64Url, desdeBase64Url } from '../../src/core/crypto.js';
import { firmarLicencia, importarClavePrivada } from '../../src/core/licencia-formato.js';
import { activarLicencia, licenciaActual, verificarCodigo } from '../../src/services/licencia.js';

let privada;
let publicaJwk;
let otraPrivada;
beforeAll(async () => {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  privada = await importarClavePrivada(await crypto.subtle.exportKey('jwk', k.privateKey));
  publicaJwk = await crypto.subtle.exportKey('jwk', k.publicKey);
  const k2 = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  otraPrivada = k2.privateKey;
});

const DATOS = { id: 'L-0001', negocio: 'Boutique Ana', emitida: '2026-11-24', vence: null };
const opc = () => ({ clavePublicaJwk: publicaJwk, ahora: new Date('2026-11-24T15:00:00Z') });

describe('código de licencia', () => {
  it('firma y verifica sin internet', async () => {
    const codigo = await firmarLicencia(DATOS, privada);
    expect(codigo.startsWith('RVL1.')).toBe(true);
    const r = await verificarCodigo(codigo, opc());
    expect(r).toMatchObject({ ok: true, datos: { ...DATOS, v: 1 } });
  });

  it('acepta el código con espacios y saltos de línea (copiado de WhatsApp)', async () => {
    const codigo = await firmarLicencia(DATOS, privada);
    const roto = `  ${codigo.slice(0, 30)}\n${codigo.slice(30, 70)} ${codigo.slice(70)}\n`;
    expect((await verificarCodigo(roto, opc())).ok).toBe(true);
  });

  it('rechaza códigos alterados, de otra clave, incompletos o basura', async () => {
    const codigo = await firmarLicencia(DATOS, privada);
    const [p, datos, firma] = codigo.split('.');
    const otrosDatos = aBase64Url(new TextEncoder().encode(JSON.stringify({ ...DATOS, v: 1, negocio: 'Otra' })));
    const firmaMala = desdeBase64Url(firma);
    firmaMala[5] ^= 1;
    const casos = [
      `${p}.${otrosDatos}.${firma}`,
      `${p}.${datos}.${aBase64Url(firmaMala)}`,
      await firmarLicencia(DATOS, otraPrivada),
      codigo.slice(0, -5),
      `RVL2.${datos}.${firma}`,
      'hola',
      '',
      'RVL1.@@@.###',
    ];
    for (const c of casos) {
      const r = await verificarCodigo(c, opc());
      expect(r.ok, c).toBe(false);
      expect(r.error).toBeTruthy();
    }
  });

  it('respeta el vencimiento', async () => {
    const codigo = await firmarLicencia({ ...DATOS, vence: '2026-12-31' }, privada);
    expect((await verificarCodigo(codigo, { ...opc(), ahora: new Date('2026-12-31T20:00:00Z') })).ok).toBe(true);
    const r = await verificarCodigo(codigo, { ...opc(), ahora: new Date('2027-01-01T15:00:00Z') });
    expect(r).toMatchObject({ ok: false, error: 'La licencia venció el 31/12/2026.' });
  });

  it('no firma datos inválidos', async () => {
    await expect(firmarLicencia({ ...DATOS, negocio: '' }, privada)).rejects.toThrow();
    await expect(firmarLicencia({ ...DATOS, id: 'x' }, privada)).rejects.toThrow();
  });
});

describe('activación', () => {
  let db;
  beforeEach(async () => {
    db = await bdDePrueba();
  });
  afterEach(async () => cerrarBD(db));

  it('guarda la licencia válida y la vuelve a verificar al leerla', async () => {
    expect((await licenciaActual({ ...opc(), db })).ok).toBe(false);
    const codigo = await firmarLicencia(DATOS, privada);
    expect((await activarLicencia('mal', { ...opc(), db })).ok).toBe(false);
    expect(await db.ajustes.get('licencia')).toBeUndefined();

    expect((await activarLicencia(codigo, { ...opc(), db })).ok).toBe(true);
    expect((await licenciaActual({ ...opc(), db })).datos.negocio).toBe('Boutique Ana');
    expect(await db.historial.where('tipo').equals('licencia-activada').count()).toBe(1);

    // Si alguien altera la licencia guardada, deja de valer
    const fila = await db.ajustes.get('licencia');
    await db.ajustes.put({ ...fila, valor: { ...fila.valor, codigo: fila.valor.codigo.replace('RVL1.', 'RVL1.x') } });
    expect((await licenciaActual({ ...opc(), db })).ok).toBe(false);
  });
});

describe('clave pública', () => {
  it('el emisor HTML usa la misma clave pública que la app', async () => {
    const { readFileSync } = await import('node:fs');
    const { CLAVE_PUBLICA_LICENCIAS } = await import('../../src/core/licencia-clave-publica.js');
    const html = readFileSync(new URL('../../public/emisor/index.html', import.meta.url), 'utf8');
    expect(html).toContain(`x: '${CLAVE_PUBLICA_LICENCIAS.x}'`);
    expect(html).toContain(`y: '${CLAVE_PUBLICA_LICENCIAS.y}'`);
  });

  it('la licencia de prueba emitida con la clave real es válida en la app', async () => {
    const codigo =
      'RVL1.eyJ2IjoxLCJ2ZW5jZSI6bnVsbCwiaWQiOiJMLVBSVUVCQS0wMDAxIiwibmVnb2NpbyI6Ik1pIE5lZ29jaW8gKHBydWViYSkiLCJlbWl0aWRhIjoiMjAyNi0xMS0yNCJ9.SzJAxw9rKGlIIWi6DKMV7fFRIEzkDXyESYgGhH1F1_d4A9fC-nVpxfmzS-ihWeQeXhxbeUiU6Iyt0lBW0efiiQ';
    const r = await verificarCodigo(codigo);
    expect(r).toMatchObject({ ok: true, datos: { negocio: 'Mi Negocio (prueba)', id: 'L-PRUEBA-0001' } });
  });
});
