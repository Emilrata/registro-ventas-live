import { describe, expect, it } from 'vitest';
import {
  asegurarCentavos,
  formatearMonto,
  multiplicarCentavos,
  parsearMonto,
  sumarCentavos,
} from '../../src/core/money.js';

describe('parsearMonto', () => {
  it.each([
    ['80', 8000],
    ['80,5', 8050],
    ['80,50', 8050],
    ['80.50', 8050],
    ['80.5', 8050],
    [',50', 50],
    ['0', 0],
    ['0,01', 1],
    ['1.250', 125000],
    ['80,505', 8050500],
    ['1.250', 125000],
    ['80,505', 8050500],
    ['1.250,50', 125050],
    ['1,250.50', 125050],
    ['12.345.678,90', 1234567890],
    ['Bs 80,50', 8050],
    ['bs. 1.000', 100000],
    ['  200 ', 20000],
    ['007', 700],
    [80.5, 8050],
    [200, 20000],
  ])('%s → %i', (entrada, esperado) => {
    expect(parsearMonto(entrada)).toBe(esperado);
  });

  it.each([
    [''],
    ['   '],
    ['abc'],
    ['-5'],
    ['80,5050'],
    ['80.5,5'],
    ['1.2.3'],
    ['1.25.000'],
    ['12,34,56'],
    ['1,250,50'],
    ['1e5'],
    [-1],
    [Number.NaN],
    [null],
    [undefined],
    ['99999999999999999999'],
  ])('rechaza %s', (entrada) => {
    expect(parsearMonto(entrada)).toBeNull();
  });
});

describe('formatearMonto', () => {
  it.each([
    [0, 'Bs 0,00'],
    [5, 'Bs 0,05'],
    [8050, 'Bs 80,50'],
    [20000, 'Bs 200,00'],
    [125050, 'Bs 1.250,50'],
    [123456789, 'Bs 1.234.567,89'],
    [-8050, '−Bs 80,50'],
  ])('%i → %s', (c, texto) => {
    expect(formatearMonto(c)).toBe(texto);
  });

  it('sin símbolo', () => {
    expect(formatearMonto(8050, { simbolo: false })).toBe('80,50');
  });

  it('ida y vuelta conserva el valor', () => {
    for (const c of [0, 1, 99, 100, 8050, 125050, 99999999]) {
      expect(parsearMonto(formatearMonto(c))).toBe(c);
    }
  });

  it('rechaza decimales', () => {
    expect(() => formatearMonto(80.5)).toThrow(TypeError);
  });
});

describe('operaciones', () => {
  it('suma enteros exactos (sin errores de coma flotante)', () => {
    expect(sumarCentavos([10, 20])).toBe(30); // 0,10 + 0,20 = 0,30 exacto
    expect(sumarCentavos([])).toBe(0);
  });

  it('suma rechaza valores no enteros', () => {
    expect(() => sumarCentavos([100, 0.5])).toThrow(TypeError);
    expect(() => sumarCentavos([100, '5'])).toThrow(TypeError);
  });

  it('multiplica precio por cantidad', () => {
    expect(multiplicarCentavos(8050, 3)).toBe(24150);
    expect(() => multiplicarCentavos(8050, 1.5)).toThrow(TypeError);
    expect(() => multiplicarCentavos(8050, -1)).toThrow(TypeError);
  });

  it('asegurarCentavos', () => {
    expect(asegurarCentavos(5)).toBe(5);
    expect(() => asegurarCentavos(Number.NaN)).toThrow();
  });
});
