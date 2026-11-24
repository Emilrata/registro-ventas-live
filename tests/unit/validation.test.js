import { describe, expect, it } from 'vitest';
import {
  normalizarNombre,
  normalizarWhatsapp,
  validarNombreCliente,
} from '../../src/core/validation.js';

describe('normalizarWhatsapp (Bolivia por defecto)', () => {
  it.each([
    ['71234567', '+59171234567'],
    ['6123 4567', '+59161234567'],
    ['712-345-67', '+59171234567'],
    ['+591 71234567', '+59171234567'],
    ['591 71234567', '+59171234567'],
    ['0059171234567', '+59171234567'],
    ['(+591) 7123-4567', '+59171234567'],
  ])('%s → %s', (entrada, esperado) => {
    expect(normalizarWhatsapp(entrada)).toEqual({ ok: true, valor: esperado });
  });

  it.each([
    [''],
    ['   '],
    ['51234567'], // no empieza con 6 o 7
    ['7123456'], // 7 dígitos
    ['712345678'], // 9 dígitos
    ['+591 51234567'],
    ['7123abcd'],
  ])('rechaza %s', (entrada) => {
    expect(normalizarWhatsapp(entrada).ok).toBe(false);
  });

  it('otro país con prefijo internacional', () => {
    expect(normalizarWhatsapp('+54 9 11 2345 6789')).toEqual({ ok: true, valor: '+5491123456789' });
    expect(normalizarWhatsapp('+51 987 654 321')).toEqual({ ok: true, valor: '+51987654321' });
  });

  it('otro código de país elegido', () => {
    expect(normalizarWhatsapp('987654321', '51')).toEqual({ ok: true, valor: '+51987654321' });
    expect(normalizarWhatsapp('987654321', '+51')).toEqual({ ok: true, valor: '+51987654321' });
    expect(normalizarWhatsapp('123', '51').ok).toBe(false);
    expect(normalizarWhatsapp('987654321', 'x').ok).toBe(false);
  });

  it('el mismo número escrito distinto da el mismo resultado (evita clientas duplicadas)', () => {
    const formas = ['71234567', '+59171234567', '591-7123-4567', '0059171234567'];
    const valores = new Set(formas.map((f) => normalizarWhatsapp(f).valor));
    expect(valores.size).toBe(1);
  });
});

describe('nombres', () => {
  it('normaliza para búsqueda', () => {
    expect(normalizarNombre('  María   JOSÉ  Peñaranda ')).toBe('maria jose penaranda');
    expect(normalizarNombre(null)).toBe('');
  });

  it('valida nombre de clienta', () => {
    expect(validarNombreCliente('  Ana   Pérez ')).toEqual({ ok: true, valor: 'Ana Pérez' });
    expect(validarNombreCliente('   ').ok).toBe(false);
    expect(validarNombreCliente('a'.repeat(81)).ok).toBe(false);
  });
});
