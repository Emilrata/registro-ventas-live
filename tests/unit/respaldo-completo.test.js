import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { bdDePrueba, cerrarBD } from './ayuda-bd.js';
import { fotoFalsa } from '../data/generador.js';
import { crearPedido } from '../../src/services/pedidos.js';
import { crearRespaldo, fotosSinRespaldar, restaurarRespaldo, verificarRespaldo } from '../../src/services/respaldo.js';
import { crearBaseDeDatos, NOMBRE_BD_MIGRACIONES, TABLAS } from '../../src/core/db.js';
import { blobDeEntrada, leerIndiceZip } from '../../src/core/zip-lector.js';
import { sha256Hex } from '../../src/core/crypto.js';

let db;
let otras = [];
beforeEach(async () => {
  db = await bdDePrueba();
});
afterEach(async () => {
  await cerrarBD(db);
  for (const o of otras) {
    o.close();
    await Dexie.delete(o.name);
  }
  otras = [];
  await Dexie.delete(NOMBRE_BD_MIGRACIONES);
});

async function telefonoNuevo() {
  const nueva = crearBaseDeDatos(`telefono-${Date.now()}-${Math.random()}`);
  await nueva.open();
  otras.push(nueva);
  return nueva;
}
const T = (min) => new Date(Date.UTC(2026, 10, 24, 14, min));
let n = 0;
async function pedidoConFoto(ahora) {
  n += 1;
  return crearPedido({ whatsapp: '71234567', nombre: 'Ana', prendas: [{ descripcion: `P${n}`, precio: 1000, cantidad: 1, foto: await fotoFalsa(n) }] }, { db, ahora });
}
const fotosDe = async (base) => Promise.all((await base.archivos.toArray()).map(async (a) => [a.id, await sha256Hex(a.blob)]));

describe('lector de ZIP por partes', () => {
  it('lee entradas sin comprimir (como trozos) y comprimidas', async () => {
    const z = zipSync({ 'a.txt': strToU8('hola'), 'b/c.bin': [new Uint8Array([1, 2, 3]), { level: 0 }], 'grande.txt': strToU8('x'.repeat(5000)) });
    const blob = new Blob([z]);
    const indice = await leerIndiceZip(blob);
    expect([...indice.keys()].sort()).toEqual(['a.txt', 'b/c.bin', 'grande.txt']);
    expect(new Uint8Array(await (await blobDeEntrada(blob, indice.get('b/c.bin'))).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(await (await blobDeEntrada(blob, indice.get('grande.txt'))).text()).toBe('x'.repeat(5000));
    await expect(leerIndiceZip(new Blob([z.slice(0, z.length - 30)]))).rejects.toThrow();
  });
});

describe('tipos de respaldo', () => {
  it('datos (sin fotos), fotos nuevas (solo las nuevas) y completo', async () => {
    await pedidoConFoto(T(0));
    await pedidoConFoto(T(1));
    expect(await fotosSinRespaldar(db)).toBe(2);

    const completo = await crearRespaldo({ tipo: 'completo', db, ahora: T(2) });
    expect(completo.archivos).toBe(2);
    expect(await fotosSinRespaldar(db)).toBe(0);

    await pedidoConFoto(T(3));
    const datos = await crearRespaldo({ tipo: 'datos', db, ahora: T(4) });
    expect(datos.archivos).toBe(0);
    expect([...(await leerIndiceZip(datos.blob)).keys()].sort()).toEqual(['datos.json', 'manifiesto.json']);
    expect(await fotosSinRespaldar(db)).toBe(1); // el de datos no cuenta como respaldo de fotos

    const fotos = await crearRespaldo({ tipo: 'fotos', db, ahora: T(5) });
    expect(fotos.archivos).toBe(1);
    expect(await fotosSinRespaldar(db)).toBe(0);
    expect((await db.ajustes.get('respaldo.ultimo')).valor.tipo).toBe('datos');
    expect((await db.respaldos.toArray()).map((r) => r.tipo)).toEqual(['completo', 'datos', 'fotos']);

    // Solo fotos: no se puede restaurar sin datos
    expect((await verificarRespaldo(fotos.blob)).error).toMatch(/solo tiene fotos/);
    // Solo datos: faltan las 3 fotos
    const v = await verificarRespaldo(datos.blob);
    expect(v).toMatchObject({ ok: false, faltantes: 3, puedeContinuar: true });
    // Datos + completo + fotos nuevas: todo completo e idéntico
    const todo = await verificarRespaldo([datos.blob, completo.blob, fotos.blob]);
    expect(todo).toMatchObject({ ok: true, faltantes: 0, archivosElegidos: 3 });
    const nuevo = await telefonoNuevo();
    await restaurarRespaldo(todo, { db: nuevo, copiaPrevia: false });
    expect(await nuevo.pedidos.count()).toBe(3);
    expect(await fotosDe(nuevo)).toEqual(await fotosDe(db));
  });

  it('restaurar aceptando fotos faltantes: quedan marcadas como perdidas y no rompen respaldos futuros', async () => {
    await pedidoConFoto(T(0));
    const datos = await crearRespaldo({ tipo: 'datos', db, ahora: T(1) });
    const v = await verificarRespaldo(datos.blob, { permitirFaltantes: true });
    expect(v).toMatchObject({ ok: true, faltantes: 1 });
    const nuevo = await telefonoNuevo();
    await restaurarRespaldo(v, { db: nuevo, copiaPrevia: false });
    const [a] = await nuevo.archivos.toArray();
    expect(a).toMatchObject({ perdido: true, blob: null });
    const r2 = await crearRespaldo({ tipo: 'completo', db: nuevo, registrar: false });
    expect(r2.archivos).toBe(0);
    const v2 = await verificarRespaldo(r2.blob);
    expect(v2.ok).toBe(true); // la foto perdida no se reclama otra vez
  });
});

describe('contraseña (AES-GCM)', () => {
  it('cifra todo, exige la contraseña correcta y restaura idéntico', async () => {
    await pedidoConFoto(T(0));
    await expect(crearRespaldo({ db, contrasena: '123' })).rejects.toThrow(/6 caracteres/);
    const r = await crearRespaldo({ tipo: 'completo', db, contrasena: 'secreto-123', registrar: false });
    // Nada legible dentro del ZIP: ni el nombre de la clienta ni la foto
    const crudo = new TextDecoder('latin1').decode(new Uint8Array(await r.blob.arrayBuffer()));
    expect(crudo).not.toContain('Ana');
    expect(crudo).not.toContain('LIVE-00001');
    expect((await verificarRespaldo(r.blob)).necesitaContrasena).toBe(true);
    expect((await verificarRespaldo(r.blob, { contrasena: 'otra-clave' })).error).toMatch(/no es correcta/);
    const v = await verificarRespaldo(r.blob, { contrasena: 'secreto-123' });
    expect(v.ok).toBe(true);
    const nuevo = await telefonoNuevo();
    await restaurarRespaldo(v, { db: nuevo, copiaPrevia: false });
    expect(await fotosDe(nuevo)).toEqual(await fotosDe(db));
    expect((await nuevo.pedidos.toArray())[0].codigo).toBe('LIVE-00001');
  });

  it('un archivo cifrado alterado se detecta', async () => {
    await pedidoConFoto(T(0));
    const r = await crearRespaldo({ db, contrasena: 'secreto-123', registrar: false });
    const bytes = new Uint8Array(await r.blob.arrayBuffer());
    const indice = await leerIndiceZip(r.blob);
    const foto = [...indice.values()].find((e) => e.nombre.startsWith('fotos/') && !e.nombre.includes('mini'));
    bytes[foto.desdeLocal + 30 + foto.nombre.length + 40] ^= 0xff;
    expect((await verificarRespaldo(new Blob([bytes]), { contrasena: 'secreto-123' })).error).toMatch(/dañado/);
  });
});

describe('compatibilidad', () => {
  it('lee respaldos del formato anterior (etapa 3)', async () => {
    const datos = { tablas: Object.fromEntries(TABLAS.map((t) => [t, []])) };
    datos.tablas.clientes = [{ id: 1, nombre: 'Vieja', nombreNormalizado: 'vieja', whatsapp: '+59171234567', notas: '', creadoEn: '2026-11-01T00:00:00.000Z' }];
    const datosBytes = strToU8(JSON.stringify(datos));
    const manifiesto = {
      formato: 'registro-ventas-live/respaldo', versionFormato: 1, versionEsquema: 1, app: '0.3.0', creadoEn: '2026-11-20T00:00:00.000Z',
      conteos: Object.fromEntries(TABLAS.map((t) => [t, datos.tablas[t].length])), sha256: { 'datos.json': await sha256Hex(datosBytes) },
    };
    const zip = zipSync({ 'manifiesto.json': strToU8(JSON.stringify(manifiesto)), 'datos.json': datosBytes });
    const v = await verificarRespaldo(zip);
    expect(v.ok).toBe(true);
    expect(v.tablas.clientes[0].nombre).toBe('Vieja');
  });
});

describe('PRUEBA DE LA ETAPA 7: respaldo grande restaurado en otro teléfono', () => {
  it('300 fotos (~45 MB), con contraseña, restauradas idénticas', async () => {
    const fotoGrande = async (i) => {
      const bytes = new Uint8Array(150 * 1024);
      for (let k = 0; k < bytes.length; k += 4096) bytes[k] = (i * 7 + k) % 256;
      bytes[0] = i % 256;
      bytes[1] = Math.floor(i / 256);
      return { blob: new Blob([bytes], { type: 'image/jpeg' }), ancho: 1280, alto: 960, miniatura: new Blob([bytes.slice(0, 8000)], { type: 'image/jpeg' }), sha256: await sha256Hex(bytes) };
    };
    for (let i = 0; i < 300; i += 1) {
      await crearPedido({ whatsapp: `7${String(1000000 + (i % 50))}`, nombre: `Clienta ${i % 50}`, prendas: [{ descripcion: `Prenda ${i}`, precio: 5000 + i, cantidad: 1, foto: await fotoGrande(i) }] }, { db, ahora: T(i) });
    }
    const r = await crearRespaldo({ tipo: 'completo', db, contrasena: 'clave-larga-1', registrar: false });
    expect(r.archivos).toBe(300);
    expect(r.bytes).toBeGreaterThan(45 * 1024 * 1024);
    const v = await verificarRespaldo(r.blob, { contrasena: 'clave-larga-1' });
    expect(v.ok).toBe(true);
    const nuevo = await telefonoNuevo();
    await restaurarRespaldo(v, { db: nuevo, copiaPrevia: false });
    for (const t of ['pedidos', 'prendas', 'clientes', 'pagos']) {
      expect(await nuevo.table(t).count(), t).toBe(await db.table(t).count());
    }
    expect(await nuevo.historial.count()).toBe((await db.historial.count()) + 1); // + «respaldo restaurado»
    expect(await fotosDe(nuevo)).toEqual(await fotosDe(db));
    const nombres = new Set((await nuevo.pedidos.toArray()).map((p) => p.codigo));
    expect(nombres.size).toBe(300);
  }, 180000);
});
