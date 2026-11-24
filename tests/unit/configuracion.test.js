import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bdDePrueba, cerrarBD } from './ayuda-bd.js';
import { firmarLicencia, importarClavePrivada } from '../../src/core/licencia-formato.js';
import { activarLicencia } from '../../src/services/licencia.js';
import { estadoConfiguracion, guardarMarca, obtenerMarca } from '../../src/services/configuracion.js';
import {
  _usarIteraciones,
  crearPinInicial,
  finalizarConfiguracion,
  generarCodigoRecuperacion,
} from '../../src/services/seguridad.js';

let db;
let opcionesLicencia;
let privada;
beforeAll(async () => {
  _usarIteraciones(1000);
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  privada = await importarClavePrivada(await crypto.subtle.exportKey('jwk', k.privateKey));
  opcionesLicencia = { clavePublicaJwk: await crypto.subtle.exportKey('jwk', k.publicKey) };
});
beforeEach(async () => {
  db = await bdDePrueba();
});
afterEach(async () => cerrarBD(db));

describe('configuración inicial', () => {
  it('avanza paso a paso: licencia → marca → pin → recuperación → lista', async () => {
    const paso = async () => (await estadoConfiguracion({ db, opcionesLicencia })).paso;
    expect(await paso()).toBe('licencia');

    const codigo = await firmarLicencia({ id: 'L-0002', negocio: 'Tienda Sol', emitida: '2026-11-24' }, privada);
    await activarLicencia(codigo, { ...opcionesLicencia, db });
    expect(await paso()).toBe('marca');

    expect((await guardarMarca({ nombre: '  Tienda   Sol ', whatsapp: '71234567' }, db)).ok).toBe(true);
    expect(await obtenerMarca(db)).toEqual({ nombre: 'Tienda Sol', whatsapp: '+59171234567', logoId: null });
    expect(await paso()).toBe('pin');

    await crearPinInicial('482915', db);
    expect(await paso()).toBe('recuperacion');

    await finalizarConfiguracion(generarCodigoRecuperacion(), db);
    expect(await paso()).toBe('lista');
  });

  it('valida la marca', async () => {
    expect(await guardarMarca({ nombre: '', whatsapp: '71234567' }, db)).toMatchObject({ ok: false, campo: 'nombre' });
    expect(await guardarMarca({ nombre: 'X', whatsapp: '123' }, db)).toMatchObject({ ok: false, campo: 'whatsapp' });
    expect(await obtenerMarca(db)).toBeNull();
  });

  it('el logo se guarda en archivos; cambiarlo no borra el anterior', async () => {
    const logo1 = { blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), ancho: 10, alto: 10 };
    const logo2 = { blob: new Blob([new Uint8Array([4, 5, 6])], { type: 'image/png' }), ancho: 20, alto: 20 };
    await guardarMarca({ nombre: 'Tienda', whatsapp: '71234567', logo: logo1 }, db);
    const id1 = (await obtenerMarca(db)).logoId;
    await guardarMarca({ nombre: 'Tienda', whatsapp: '71234567' }, db); // sin logo nuevo: conserva
    expect((await obtenerMarca(db)).logoId).toBe(id1);
    await guardarMarca({ nombre: 'Tienda', whatsapp: '71234567', logo: logo2 }, db);
    const id2 = (await obtenerMarca(db)).logoId;
    expect(id2).not.toBe(id1);
    expect(await db.archivos.count()).toBe(2);
    const a1 = await db.archivos.get(id1);
    expect(a1).toMatchObject({ tipo: 'logo', mime: 'image/png', bytes: 3, refTipo: 'negocio' });
    expect(a1.sha256).toMatch(/^[0-9a-f]{64}$/);
    const { historialDe } = await import('../../src/repositories/historial.repo.js');
    const h = await historialDe('negocio', 0, db);
    expect(h.map((x) => x.tipo)).toEqual(['marca-creada', 'marca-actualizada', 'marca-actualizada']);
    expect(h[2].antes.logoId).toBe(id1);
    expect(h[2].despues.logoId).toBe(id2);
    expect(h.every((x) => x.actor === 'usuario' && x.fechaHora)).toBe(true);
    expect(await db.historial.where('tipo').anyOf('marca-creada', 'marca-actualizada').count()).toBe(3);
  });
});
