import { describe, expect, it } from 'vitest';
import { calcularEstadoPago, calcularTotales, formatearCodigo, leerCodigo, saldoPendiente } from '../../src/core/calculos.js';

describe('códigos', () => {
  it('formato LIVE-00001 sin cortar números grandes', () => {
    expect(formatearCodigo(1)).toBe('LIVE-00001');
    expect(formatearCodigo(12345)).toBe('LIVE-12345');
    expect(formatearCodigo(123456)).toBe('LIVE-123456');
    expect(() => formatearCodigo(0)).toThrow();
    expect(() => formatearCodigo(1.5)).toThrow();
  });
  it('lee lo que escribe la persona', () => {
    for (const t of ['LIVE-00012', 'live-12', 'live 12', '12', '#12', '00012', ' LIVE12 ']) expect(leerCodigo(t)).toBe(12);
    for (const t of ['', 'ana', 'LIVE-', '12a', 'LIVE-1-2']) expect(leerCodigo(t)).toBeNull();
  });
});

describe('totales y estado de pago', () => {
  it('suma prendas por cantidad más envío', () => {
    expect(calcularTotales([{ precio: 8050, cantidad: 2 }, { precio: 12000, cantidad: 1 }], 1500)).toEqual({
      totalPrendas: 28100,
      total: 29600,
    });
    expect(() => calcularTotales([{ precio: 80.5, cantidad: 1 }])).toThrow();
    expect(() => calcularTotales([{ precio: 100, cantidad: 1 }], -1)).toThrow();
  });
  it('estado de pago calculado e independiente', () => {
    expect(calcularEstadoPago({ total: 10000, pagado: 0 })).toBe('sin-pago');
    expect(calcularEstadoPago({ total: 10000, pagado: 4000 })).toBe('parcial');
    expect(calcularEstadoPago({ total: 10000, pagado: 10000 })).toBe('pagado');
    expect(calcularEstadoPago({ total: 10000, pagado: 10000, reembolsado: 10000 })).toBe('sin-pago');
    expect(saldoPendiente({ total: 10000, pagado: 4000 })).toBe(6000);
    expect(saldoPendiente({ total: 10000, pagado: 10000 })).toBe(0);
  });
});
