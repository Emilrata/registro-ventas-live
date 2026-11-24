import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as archivos from '../../src/repositories/archivos.repo.js';

describe('archivos.repo', () => {
  it('no tiene ninguna función de borrado', () => {
    const nombres = Object.keys(archivos);
    expect(nombres.some((n) => /borr|elimin|delete|remove|clear|quitar/i.test(n))).toBe(false);
    const fuente = readFileSync(new URL('../../src/repositories/archivos.repo.js', import.meta.url), 'utf8');
    expect(fuente).not.toMatch(/\.(delete|bulkDelete|clear)\(/);
  });
});
