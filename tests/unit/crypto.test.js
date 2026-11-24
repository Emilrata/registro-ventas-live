import { describe, expect, it } from 'vitest';
import {
  aBase64Url,
  derivarPBKDF2,
  desdeBase64Url,
  igualesTiempoConstante,
  sha256Hex,
  verificarPBKDF2,
} from '../../src/core/crypto.js';

describe('crypto', () => {
  it('base64url ida y vuelta', () => {
    for (let largo = 0; largo < 40; largo += 1) {
      const b = Uint8Array.from({ length: largo }, (_, i) => (i * 37 + largo) % 256);
      const t = aBase64Url(b);
      expect(t).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(desdeBase64Url(t)).toEqual(b);
    }
    expect(() => desdeBase64Url('no válido!')).toThrow();
  });

  it('SHA-256 conocido', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(await sha256Hex(new Blob(['abc']))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('PBKDF2: vector de prueba RFC 7914 (sha256, 1 iteración)', async () => {
    const r = await derivarPBKDF2('passwd', { sal: new TextEncoder().encode('salt'), iteraciones: 1 });
    const hex = [...desdeBase64Url(r.hash)].map((x) => x.toString(16).padStart(2, '0')).join('');
    expect(hex).toBe('55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc');
  });

  it('PBKDF2 con 300.000 iteraciones y sal de 16 bytes por defecto', async () => {
    const r = await derivarPBKDF2('482915');
    expect(r.iteraciones).toBe(300000);
    expect(desdeBase64Url(r.sal)).toHaveLength(16);
    expect(await verificarPBKDF2('482915', r)).toBe(true);
    expect(await verificarPBKDF2('482916', r)).toBe(false);
    const otra = await derivarPBKDF2('482915');
    expect(otra.sal).not.toBe(r.sal); // sal aleatoria
    expect(otra.hash).not.toBe(r.hash);
  });

  it('comparación', () => {
    expect(igualesTiempoConstante(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(igualesTiempoConstante(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(igualesTiempoConstante(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });
});
