import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { bdDePrueba, cerrarBD } from './ayuda-bd.js';
import { crearPedido } from '../../src/services/pedidos.js';
import { crearTransmision } from '../../src/services/transmisiones.js';
import { anularPago, registrarPago } from '../../src/services/pagos.js';
import { cancelarPedido, registrarEntrega } from '../../src/services/entregas.js';
import { registrarDevolucion } from '../../src/services/devoluciones.js';
import { calcularEstadisticas, listaDias, periodoPredefinido } from '../../src/services/estadisticas.js';
import { crearInformeExcel } from '../../src/services/excel.js';
import { escaparXml, letraColumna, serieExcel } from '../../src/core/xlsx.js';

let db;
beforeEach(async () => {
  db = await bdDePrueba();
});
afterEach(async () => cerrarBD(db));

// Horas de Bolivia (UTC−4): 15:00 local = 19:00 UTC
const HOY = new Date('2026-11-24T19:00:00Z');
const MANANA = new Date('2026-11-25T19:00:00Z');
const pedido = async (precio, ahora, extra = {}) =>
  (await crearPedido({ whatsapp: extra.whatsapp ?? '71234567', nombre: extra.nombre ?? 'Ana', transmisionId: extra.transmisionId, prendas: [{ descripcion: 'Blusa', precio, cantidad: 1 }] }, { db, ahora })).id;
const stats = (desde, hasta, extra = {}) => calcularEstadisticas({ desde, hasta, ...extra }, { db, ahora: extra.ahora ?? MANANA });

describe('PRUEBA DE LA ETAPA 6: venta de Bs 200 hoy y cobro mañana', () => {
  it('la venta cuenta hoy, el cobro mañana; la deuda baja recién mañana', async () => {
    const id = await pedido(20000, HOY);
    // Al final de hoy
    const hoy1 = await calcularEstadisticas({ desde: '2026-11-24', hasta: '2026-11-24' }, { db, ahora: HOY });
    expect(hoy1.ventas).toMatchObject({ total: 20000, pedidos: 1 });
    expect(hoy1.cobros.total).toBe(0);
    expect(hoy1.deudas.total).toBe(20000);

    await registrarPago({ pedidoId: id, monto: 20000, metodo: 'qr' }, { db, ahora: MANANA });

    const hoy = await stats('2026-11-24', '2026-11-24');
    const manana = await stats('2026-11-25', '2026-11-25');
    const ambos = await stats('2026-11-24', '2026-11-25');
    expect([hoy.ventas.total, hoy.cobros.total]).toEqual([20000, 0]);
    expect([manana.ventas.total, manana.cobros.total, manana.cobros.qr]).toEqual([0, 20000, 20000]);
    expect([ambos.ventas.total, ambos.cobros.total]).toEqual([20000, 20000]);
    expect(manana.deudas.total).toBe(0);
    expect(ambos.serie).toEqual([
      { dia: '2026-11-24', ventas: 20000, cobros: 0, devoluciones: 0, pedidos: 1 },
      { dia: '2026-11-25', ventas: 0, cobros: 20000, devoluciones: 0, pedidos: 0 },
    ]);
  });

  it('una venta a las 23:30 de Bolivia es del mismo día (no del siguiente en UTC)', async () => {
    await pedido(10000, new Date('2026-11-25T03:30:00Z')); // 24/11 23:30 en Bolivia
    expect((await stats('2026-11-24', '2026-11-24')).ventas.total).toBe(10000);
    expect((await stats('2026-11-25', '2026-11-25')).ventas.total).toBe(0);
  });
});

describe('estadísticas', () => {
  it('cancelación: resta del día original y aparece en el día en que se canceló', async () => {
    const a = await pedido(20000, HOY);
    await pedido(5000, HOY, { whatsapp: '62223333' });
    await cancelarPedido(a, { motivo: 'No vino', db, ahora: MANANA });
    const hoy = await stats('2026-11-24', '2026-11-24');
    const manana = await stats('2026-11-25', '2026-11-25');
    expect(hoy.ventas).toMatchObject({ total: 5000, pedidos: 1 });
    expect(hoy.cancelaciones).toEqual({ pedidos: 0, total: 0 });
    expect(manana.cancelaciones).toEqual({ pedidos: 1, total: 20000 });
  });

  it('cobros por método, anulaciones y devoluciones; neto cobrado', async () => {
    const a = await pedido(10000, HOY);
    const b = await pedido(8000, HOY, { whatsapp: '62223333' });
    const p1 = await registrarPago({ pedidoId: a, monto: 10000, metodo: 'efectivo' }, { db, ahora: HOY });
    await registrarPago({ pedidoId: b, monto: 8000, metodo: 'qr' }, { db, ahora: HOY });
    await anularPago(p1.id, { motivo: 'Billete falso', db, ahora: MANANA });
    await cancelarPedido(b, { motivo: 'x', db, ahora: MANANA });
    await registrarDevolucion({ pedidoId: b, monto: 8000, metodo: 'qr', motivo: 'Cancelado' }, { db, ahora: MANANA });
    const hoy = await stats('2026-11-24', '2026-11-24');
    expect(hoy.cobros).toEqual({ total: 18000, efectivo: 10000, qr: 8000, cantidad: 2 });
    const manana = await stats('2026-11-25', '2026-11-25');
    expect(manana.cobros).toEqual({ total: -10000, efectivo: -10000, qr: 0, cantidad: 0 });
    expect(manana.devoluciones.total).toBe(8000);
    const todo = await stats('2026-11-24', '2026-11-25');
    expect(todo.netoCobrado).toBe(18000 - 10000 - 8000);
    expect(todo.deudas.total).toBe(10000); // a vuelve a deber todo; b está cancelado
  });

  it('entregas del período y pendientes de hoy', async () => {
    const a = await pedido(10000, HOY);
    await pedido(5000, HOY, { whatsapp: '62223333' });
    await registrarEntrega({ pedidoId: a, modalidad: 'recojo', aceptarSaldo: true }, { db, ahora: MANANA });
    const e = await stats('2026-11-25', '2026-11-25');
    expect(e.entregas).toEqual({ pedidos: 1, recojo: 1, envio: 0, vencidos: 0 });
    expect(e.pendientesEntrega.pedidos).toBe(1);
    expect((await stats('2026-11-24', '2026-11-24')).entregas.pedidos).toBe(0);
  });

  it('deudas por antigüedad', async () => {
    await pedido(1000, new Date('2026-11-23T15:00:00Z'));
    await pedido(2000, new Date('2026-11-05T15:00:00Z'), { whatsapp: '62223333' });
    await pedido(3000, new Date('2026-09-01T15:00:00Z'), { whatsapp: '75556666' });
    const e = await stats('2026-11-25', '2026-11-25');
    expect(e.deudas).toEqual({ total: 6000, pedidos: 3, tramos: { '0-7': 1000, '8-30': 2000, '31+': 3000 } });
  });

  it('filtro por transmisión', async () => {
    const t1 = await crearTransmision({ nombre: 'Lunes' }, db);
    const t2 = await crearTransmision({ nombre: 'Martes' }, db);
    const a = await pedido(10000, HOY, { transmisionId: t1.id });
    await pedido(7000, HOY, { transmisionId: t2.id, whatsapp: '62223333' });
    await registrarPago({ pedidoId: a, monto: 4000, metodo: 'qr' }, { db, ahora: HOY });
    const e1 = await stats('2026-11-24', '2026-11-24', { transmisionId: t1.id });
    expect([e1.ventas.total, e1.cobros.total, e1.deudas.total]).toEqual([10000, 4000, 6000]);
    const e2 = await stats('2026-11-24', '2026-11-24', { transmisionId: t2.id });
    expect([e2.ventas.total, e2.cobros.total, e2.deudas.total]).toEqual([7000, 0, 7000]);
  });

  it('clientas con más ventas y ticket promedio', async () => {
    await pedido(10000, HOY);
    await pedido(5000, HOY);
    await pedido(9000, HOY, { whatsapp: '62223333', nombre: 'Lucía' });
    const e = await stats('2026-11-24', '2026-11-24');
    expect(e.topClientas.map((c) => [c.nombre, c.total, c.pedidos])).toEqual([['Ana', 15000, 2], ['Lucía', 9000, 1]]);
    expect(e.ventas.ticketPromedio).toBe(8000);
  });

  it('períodos predefinidos (días locales)', () => {
    const ahora = new Date('2026-03-01T15:00:00Z');
    expect(periodoPredefinido('hoy', ahora)).toEqual({ desde: '2026-03-01', hasta: '2026-03-01' });
    expect(periodoPredefinido('ayer', ahora)).toEqual({ desde: '2026-02-28', hasta: '2026-02-28' });
    expect(periodoPredefinido('7dias', ahora)).toEqual({ desde: '2026-02-23', hasta: '2026-03-01' });
    expect(periodoPredefinido('mes', ahora)).toEqual({ desde: '2026-03-01', hasta: '2026-03-01' });
    expect(periodoPredefinido('mesPasado', ahora)).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' });
    expect(listaDias('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    expect(() => periodoPredefinido('nunca')).toThrow();
  });

  it('rechaza períodos inválidos', async () => {
    await expect(stats('2026-11-25', '2026-11-24')).rejects.toThrow();
  });
});

describe('Excel', () => {
  it('utilidades del generador', () => {
    expect([0, 25, 26, 51, 701, 702].map(letraColumna)).toEqual(['A', 'Z', 'AA', 'AZ', 'ZZ', 'AAA']);
    expect(serieExcel('2026-11-25T02:00:00.000Z')).toBeCloseTo(46350 + 22 / 24, 6); // 24/11/2026 22:00 en Bolivia
    expect(serieExcel('no')).toBeNull();
    expect(escaparXml('a<b>&"c"\u0001')).toBe('a&lt;b&gt;&amp;&quot;c&quot;');
  });

  it('informe del período con todas las hojas y los montos en Bs', async () => {
    const id = await pedido(20000, HOY, { nombre: 'María <José> & Cía' });
    await registrarPago({ pedidoId: id, monto: 20000, metodo: 'qr' }, { db, ahora: MANANA });
    const { bytes, nombre } = await crearInformeExcel({ desde: '2026-11-24', hasta: '2026-11-25' }, { db, ahora: MANANA });
    expect(nombre).toBe('informe-ventas-2026-11-24-al-2026-11-25.xlsx');
    const z = unzipSync(bytes);
    const libro = strFromU8(z['xl/workbook.xml']);
    for (const h of ['Resumen', 'Por día', 'Pedidos', 'Prendas', 'Pagos', 'Devoluciones', 'Entregas', 'Por cobrar (hoy)', 'Clientas']) {
      expect(libro).toContain(`name="${h}"`);
    }
    const pedidos = strFromU8(z['xl/worksheets/sheet3.xml']);
    expect(pedidos).toContain('LIVE-00001');
    expect(pedidos).toContain('María &lt;José&gt; &amp; Cía');
    expect(pedidos).toContain('<v>200</v>');
    const resumen = strFromU8(z['xl/worksheets/sheet1.xml']);
    expect(resumen).toContain('Ventas (Bs)');
    expect(resumen).toContain('s="2"><v>200</v>'); // formato de dinero
  });
});
