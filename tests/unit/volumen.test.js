// Prueba de la etapa 3: 500 pedidos, búsqueda en menos de 1 s, sin códigos repetidos, restauración idéntica.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { bdDePrueba, cerrarBD } from './ayuda-bd.js';
import { generarPedidos } from '../data/generador.js';
import { crearBaseDeDatos, TABLAS } from '../../src/core/db.js';
import { buscarPedidos } from '../../src/services/pedidos.js';
import { crearRespaldo, restaurarRespaldo, verificarRespaldo } from '../../src/services/respaldo.js';
import { strToU8, unzipSync, zipSync } from 'fflate';

let db;
beforeAll(async () => {
  db = await bdDePrueba();
  await generarPedidos({ cantidad: 500, db });
}, 120000);
afterAll(async () => cerrarBD(db));

async function volcar(base) {
  const out = {};
  for (const t of TABLAS) {
    out[t] = await Promise.all(
      (await base.table(t).toArray()).map(async (f) => {
        if (t !== 'archivos') return f;
        return {
          ...f,
          blob: [...new Uint8Array(await f.blob.arrayBuffer())],
          blobTipo: f.blob.type,
          miniatura: f.miniatura ? [...new Uint8Array(await f.miniatura.arrayBuffer())] : null,
        };
      }),
    );
  }
  return out;
}

describe('500 pedidos', () => {
  it('códigos únicos y continuos', async () => {
    const pedidos = await db.pedidos.toArray();
    expect(pedidos).toHaveLength(500);
    expect(new Set(pedidos.map((p) => p.codigo)).size).toBe(500);
    expect(pedidos.map((p) => p.seq).sort((a, b) => a - b)).toEqual(Array.from({ length: 500 }, (_, i) => i + 1));
  });

  it('totales guardados coinciden con sus prendas', async () => {
    const pedidos = await db.pedidos.toArray();
    const prendas = await db.prendas.toArray();
    for (const p of pedidos) {
      const suma = prendas.filter((x) => x.pedidoId === p.id).reduce((s, x) => s + x.precio * x.cantidad, 0);
      expect(p.totalPrendas).toBe(suma);
      expect(p.total).toBe(suma + p.envio);
    }
  });

  it('búsqueda en menos de 1 segundo', async () => {
    for (const texto of ['LIVE-00250', 'ana', 'maria jose', '7100', 'perez quispe', 'zzz']) {
      const t0 = performance.now();
      await buscarPedidos(texto, { db });
      const ms = performance.now() - t0;
      expect(ms, texto).toBeLessThan(1000);
    }
    expect((await buscarPedidos('LIVE-00250', { db }))[0].codigo).toBe('LIVE-00250');
  });

  it('respaldo y restauración idénticos en otra base', async () => {
    const { blob, conteos } = await crearRespaldo({ db, registrar: false });
    expect(conteos.pedidos).toBe(500);
    const verificado = await verificarRespaldo(blob);
    expect(verificado.ok).toBe(true);

    const otra = crearBaseDeDatos(`restaurada-${Date.now()}`);
    await otra.open();
    try {
      await restaurarRespaldo(verificado, { db: otra, copiaPrevia: false });
      const a = await volcar(db);
      const b = await volcar(otra);
      for (const t of TABLAS) {
        if (t === 'historial') {
          expect(b.historial.slice(0, a.historial.length)).toEqual(a.historial);
          expect(b.historial.at(-1).tipo).toBe('respaldo-restaurado');
        } else if (t === 'ajustes') {
          // Los ajustes del dispositivo (PIN, licencia) no vienen del respaldo
          const sinDispositivo = (l) => l.filter((x) => !x.clave.startsWith('seguridad.') && !['licencia', 'configuracion.completa', 'respaldo.ultimo'].includes(x.clave));
          expect(sinDispositivo(b.ajustes)).toEqual(sinDispositivo(a.ajustes));
        } else {
          expect(b[t], t).toEqual(a[t]);
        }
      }
    } finally {
      otra.close();
      await Dexie.delete(otra.name);
    }
  }, 60000);

  it('rechaza respaldos dañados sin tocar nada', async () => {
    const { blob } = await crearRespaldo({ db, registrar: false });
    const entradas = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const foto = Object.keys(entradas).find((k) => k.startsWith('fotos/'));

    const roto = { ...entradas, [foto]: new Uint8Array([1, 2, 3]) };
    expect((await verificarRespaldo(zipSync(roto))).error).toMatch(/dañado/);
    const sinFoto = { ...entradas };
    delete sinFoto[foto];
    expect((await verificarRespaldo(zipSync(sinFoto))).error).toMatch(/Falta/);
    expect((await verificarRespaldo(new Uint8Array([1, 2, 3]))).ok).toBe(false);
    const nuevo = { ...entradas, 'manifiesto.json': strToU8(JSON.stringify({ ...JSON.parse(new TextDecoder().decode(entradas['manifiesto.json'])), versionEsquema: 99 })) };
    expect((await verificarRespaldo(zipSync(nuevo))).error).toMatch(/más nueva/);
  }, 60000);
});
