import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ESQUEMAS,
  NOMBRE_BD_MIGRACIONES,
  TABLAS,
  VERSION_ESQUEMA,
  crearBaseDeDatos,
  respaldarAntesDeMigrar,
} from '../../src/core/db.js';
import { contarRegistros, guardarAjuste, obtenerAjuste } from '../../src/repositories/ajustes.repo.js';

let contador = 0;
const abiertas = [];
async function nuevaBD() {
  const nombre = `prueba-${Date.now()}-${contador++}`;
  const db = crearBaseDeDatos(nombre);
  await db.open();
  abiertas.push(db);
  return db;
}

afterEach(async () => {
  for (const db of abiertas.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
  await Dexie.delete(NOMBRE_BD_MIGRACIONES);
});

describe('esquema', () => {
  it('tiene exactamente las 12 tablas acordadas', async () => {
    const db = await nuevaBD();
    const esperadas = [
      'clientes', 'pedidos', 'prendas', 'archivos', 'pagos', 'devoluciones',
      'grupos', 'entregas', 'historial', 'ajustes', 'respaldos', 'transmisiones',
    ];
    expect(TABLAS.sort()).toEqual([...esperadas].sort());
    expect(db.tables.map((t) => t.name).sort()).toEqual([...esperadas].sort());
    expect(db.verno).toBe(VERSION_ESQUEMA);
  });

  it('las versiones del esquema son consecutivas desde 1', () => {
    const versiones = Object.keys(ESQUEMAS).map(Number);
    expect(versiones).toEqual(versiones.map((_, i) => i + 1));
    expect(Math.max(...versiones)).toBe(VERSION_ESQUEMA);
  });

  it('crea los ajustes iniciales una sola vez', async () => {
    const db = await nuevaBD();
    expect(await obtenerAjuste('codigos.ultimoSeq', undefined, db)).toBe(0);
    expect(await obtenerAjuste('pedidos.plazoDias', undefined, db)).toBe(30);
    expect(await obtenerAjuste('pedidos.diasAviso', undefined, db)).toEqual([25, 28]);
    expect(await obtenerAjuste('whatsapp.codigoPais', undefined, db)).toBe('591');
    expect(await obtenerAjuste('no.existe', 'x', db)).toBe('x');

    await guardarAjuste('pedidos.plazoDias', 45, db);
    const nombre = db.name;
    db.close();
    const otra = crearBaseDeDatos(nombre);
    await otra.open();
    abiertas.push(otra);
    expect(await obtenerAjuste('pedidos.plazoDias', undefined, otra)).toBe(45); // no se re-siembra
  });

  it('el código de pedido es único', async () => {
    const db = await nuevaBD();
    await db.pedidos.add({ codigo: 'LIVE-00001', seq: 1, clienteId: 1 });
    await expect(db.pedidos.add({ codigo: 'LIVE-00001', seq: 2, clienteId: 1 })).rejects.toMatchObject({
      name: 'ConstraintError',
    });
    await expect(db.pedidos.add({ codigo: 'LIVE-00002', seq: 1, clienteId: 1 })).rejects.toMatchObject({
      name: 'ConstraintError',
    });
  });

  it('el WhatsApp de la clienta es único', async () => {
    const db = await nuevaBD();
    await db.clientes.add({ nombre: 'Ana', nombreNormalizado: 'ana', whatsapp: '+59171234567' });
    await expect(
      db.clientes.add({ nombre: 'Otra', nombreNormalizado: 'otra', whatsapp: '+59171234567' }),
    ).rejects.toMatchObject({ name: 'ConstraintError' });
  });

  it('una transacción de varias tablas se deshace completa si algo falla', async () => {
    const db = await nuevaBD();
    await db.pedidos.add({ codigo: 'LIVE-00001', seq: 1, clienteId: 1 });
    await expect(
      db.transaction('rw', db.pedidos, db.prendas, db.historial, async () => {
        const id = await db.pedidos.add({ codigo: 'LIVE-00002', seq: 2, clienteId: 1 });
        await db.prendas.add({ pedidoId: id, orden: 1, precio: 8050 });
        await db.historial.add({ entidad: 'pedidos', entidadId: id, tipo: 'creado' });
        await db.pedidos.add({ codigo: 'LIVE-00001', seq: 3, clienteId: 1 }); // repetido → falla
      }),
    ).rejects.toBeTruthy();
    expect(await db.pedidos.count()).toBe(1);
    expect(await db.prendas.count()).toBe(0);
    expect(await db.historial.count()).toBe(0);
  });

  it('guarda y devuelve Blobs (fotos) intactos', async () => {
    const db = await nuevaBD();
    const bytes = new Uint8Array([1, 2, 3, 250, 255]);
    const id = await db.archivos.add({ tipo: 'foto', blob: new Blob([bytes], { type: 'image/jpeg' }) });
    const fila = await db.archivos.get(id);
    expect(new Uint8Array(await fila.blob.arrayBuffer())).toEqual(bytes);
  });

  it('cuenta registros por tabla', async () => {
    const db = await nuevaBD();
    const conteos = await contarRegistros(db);
    expect(Object.keys(conteos)).toHaveLength(12);
    expect(conteos.ajustes).toBeGreaterThan(0);
    expect(conteos.pedidos).toBe(0);
  });
});

describe('copia antes de migrar', () => {
  it('no hace nada si la base no existe', async () => {
    expect(await respaldarAntesDeMigrar({ nombre: 'no-existe-nunca' })).toBeNull();
  });

  it('no hace nada si la base ya está en la versión actual', async () => {
    const db = await nuevaBD();
    db.close();
    expect(await respaldarAntesDeMigrar({ nombre: db.name })).toBeNull();
  });

  it('copia todas las filas (más de un lote) antes de subir de versión', async () => {
    const db = await nuevaBD();
    const pedidos = Array.from({ length: 450 }, (_, i) => ({
      codigo: `LIVE-${String(i + 1).padStart(5, '0')}`,
      seq: i + 1,
      clienteId: 1,
      total: 8050,
    }));
    await db.pedidos.bulkAdd(pedidos);
    await db.archivos.add({ tipo: 'foto', blob: new Blob([new Uint8Array([9, 8, 7])]) });
    const ajustes = await db.ajustes.count();
    db.close();

    const copiaId = await respaldarAntesDeMigrar({ nombre: db.name, versionDestino: VERSION_ESQUEMA + 1 });
    expect(copiaId).toBeTypeOf('number');

    const m = new Dexie(NOMBRE_BD_MIGRACIONES);
    await m.open();
    const copia = await m.table('copias').get(copiaId);
    expect(copia.completa).toBe(1);
    expect(copia.versionOrigen).toBe(VERSION_ESQUEMA);
    expect(copia.conteos.pedidos).toBe(450);
    expect(copia.conteos.archivos).toBe(1);
    expect(copia.conteos.ajustes).toBe(ajustes);

    const filasPedidos = await m.table('filas').where('[copiaId+tabla]').equals([copiaId, 'pedidos']).toArray();
    expect(filasPedidos.map((f) => f.fila.codigo)).toEqual(pedidos.map((p) => p.codigo));
    const [foto] = await m.table('filas').where('[copiaId+tabla]').equals([copiaId, 'archivos']).toArray();
    expect(new Uint8Array(await foto.fila.blob.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7]));
    m.close();
  });

  it('se niega si los datos son de una versión más nueva que la app', async () => {
    const db = await nuevaBD();
    db.close();
    await expect(
      respaldarAntesDeMigrar({ nombre: db.name, versionDestino: VERSION_ESQUEMA - 1 }),
    ).rejects.toMatchObject({ name: 'VersionMasNuevaError' });
  });
});
