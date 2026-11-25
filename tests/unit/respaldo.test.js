import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { bdDePrueba, cerrarBD } from './ayuda-bd.js';
import { crearPedido } from '../../src/services/pedidos.js';
import { crearRespaldo, restaurarRespaldo, verificarRespaldo } from '../../src/services/respaldo.js';
import { NOMBRE_BD_MIGRACIONES } from '../../src/core/db.js';

let db;
beforeEach(async () => {
  db = await bdDePrueba();
});
afterEach(async () => {
  await cerrarBD(db);
  await Dexie.delete(NOMBRE_BD_MIGRACIONES);
});

const pedido = (w, n) => crearPedido({ whatsapp: w, nombre: n, prendas: [{ descripcion: 'Blusa', precio: 8050, cantidad: 1 }] }, { db });

describe('restaurar', () => {
  it('en un teléfono nuevo el contador sigue al del respaldo', async () => {
    await pedido('71234567', 'Ana');
    await pedido('71234567', 'Ana');
    const { blob } = await crearRespaldo({ db, registrar: false });
    const { crearBaseDeDatos } = await import('../../src/core/db.js');
    const nueva = crearBaseDeDatos(`telefono-nuevo-${Date.now()}`);
    await nueva.open();
    await restaurarRespaldo(await verificarRespaldo(blob), { db: nueva, copiaPrevia: false });
    const r = await crearPedido({ whatsapp: '75556666', nombre: 'X', prendas: [{ descripcion: 'a', precio: 100, cantidad: 1 }] }, { db: nueva });
    expect(r.codigo).toBe('LIVE-00003');
    nueva.close();
    await Dexie.delete(nueva.name);
  });

  it('reemplaza los datos, conserva el acceso del dispositivo y guarda copia previa', async () => {
    await pedido('71234567', 'Ana');
    await db.ajustes.put({ clave: 'marca', valor: { nombre: 'Tienda Vieja' } });
    const { blob } = await crearRespaldo({ db });
    expect((await db.ajustes.get('respaldo.ultimo')).valor.fecha).toBeTruthy();
    expect(await db.respaldos.count()).toBe(1);

    // Después del respaldo: más datos y otro PIN en este dispositivo
    await pedido('62223333', 'Lucía');
    await pedido('62223333', 'Lucía');
    await db.ajustes.put({ clave: 'seguridad.pin', valor: { hash: 'PIN-ACTUAL' } });
    await db.ajustes.put({ clave: 'licencia', valor: { codigo: 'LIC-ACTUAL' } });

    const v = await verificarRespaldo(blob);
    await restaurarRespaldo(v, { db });

    expect(await db.pedidos.count()).toBe(1);
    expect(await db.clientes.count()).toBe(1);
    expect((await db.ajustes.get('seguridad.pin')).valor.hash).toBe('PIN-ACTUAL');
    expect((await db.ajustes.get('licencia')).valor.codigo).toBe('LIC-ACTUAL');
    expect((await db.ajustes.get('marca')).valor.nombre).toBe('Tienda Vieja');
    expect((await db.ajustes.get('respaldo.ultimo')).valor.fecha).toBe(v.manifiesto.creadoEn);
    // LIVE-00002 y LIVE-00003 ya se usaron en este teléfono antes de restaurar: no se repiten
    expect((await pedido('75556666', 'Nueva')).codigo).toBe('LIVE-00004');

    const m = new Dexie(NOMBRE_BD_MIGRACIONES);
    await m.open();
    const [copia] = await m.table('copias').toArray();
    expect(copia).toMatchObject({ motivo: 'antes-de-restaurar', completa: 1 });
    expect(copia.conteos.pedidos).toBe(3);
    m.close();
  });
});
