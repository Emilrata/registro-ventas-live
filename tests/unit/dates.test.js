import { describe, expect, it } from 'vitest';
import {
  ahoraISO,
  calcularFechaLimite,
  claveDia,
  diasEntre,
  formatearFecha,
  formatearFechaHora,
  sumarDias,
} from '../../src/core/dates.js';

// Las pruebas corren con TZ=America/La_Paz (UTC−4), ver vite.config.js.

describe('fechas', () => {
  it('la zona horaria de prueba es Bolivia', () => {
    expect(new Date('2026-11-24T12:00:00Z').getTimezoneOffset()).toBe(240);
  });

  it('ahoraISO devuelve ISO UTC', () => {
    expect(ahoraISO(new Date('2026-11-24T22:58:00Z'))).toBe('2026-11-24T22:58:00.000Z');
  });

  it('claveDia usa el día local (una venta a las 22:00 en Bolivia es de ese día)', () => {
    // 2026-11-25 02:00 UTC = 2026-11-24 22:00 en Bolivia
    expect(claveDia('2026-11-25T02:00:00.000Z')).toBe('2026-11-24');
    expect(claveDia('2026-11-25T04:00:00.000Z')).toBe('2026-11-25');
  });

  it('fecha límite: 30 días de calendario', () => {
    expect(calcularFechaLimite('2026-11-24T14:00:00.000Z')).toBe('2026-12-24T14:00:00.000Z');
    expect(calcularFechaLimite('2026-01-31T14:00:00.000Z', 30)).toBe('2026-03-02T14:00:00.000Z');
  });

  it('sumarDias cruza fin de año', () => {
    expect(sumarDias('2026-12-20T12:00:00.000Z', 15)).toBe('2027-01-04T12:00:00.000Z');
    expect(() => sumarDias('2026-12-20T12:00:00.000Z', 1.5)).toThrow();
  });

  it('diasEntre cuenta días locales, no horas', () => {
    // 23:30 del 24 y 00:30 del 25 (hora Bolivia) son días distintos
    expect(diasEntre('2026-11-25T03:30:00.000Z', '2026-11-25T04:30:00.000Z')).toBe(1);
    expect(diasEntre('2026-11-24T14:00:00.000Z', '2026-12-24T14:00:00.000Z')).toBe(30);
    expect(diasEntre('2026-12-24T14:00:00.000Z', '2026-11-24T14:00:00.000Z')).toBe(-30);
  });

  it('formatos en español', () => {
    expect(formatearFecha('2026-11-25T02:05:00.000Z')).toBe('24/11/2026');
    expect(formatearFechaHora('2026-11-25T02:05:00.000Z')).toBe('24/11/2026 22:05');
  });

  it('rechaza fechas no válidas', () => {
    expect(() => claveDia('no es fecha')).toThrow(TypeError);
  });
});
