import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bdDePrueba, cerrarBD } from './ayuda-bd.js';
import { fotoFalsa } from '../data/generador.js';
import { crearPedido, editarPedido, obtenerPedido } from '../../src/services/pedidos.js';
import { crearGrupo } from '../../src/services/grupos.js';
import { anularPago, cobrosEntre, pagarGrupo, pagosDePedido, pedidosPorCobrar, registrarPago } from '../../src/services/pagos.js';
import { saldoPendiente } from '../../src/core/calculos.js';

let db;
beforeEach(async () => {
  db = await bdDePrueba();
});
afterEach(async () => cerrarBD(db));

let n = 0;
async function pedido(precios, { envio = 0, whatsapp = '71234567', ahora } = {}) {
  n += 1;
  const r = await crearPedido(
    {
      whatsapp,
      nombre: 'Ana',
      modalidad: envio ? 'envio' : 'recojo',
      envio,
      prendas: precios.map((precio, i) => ({ descripcion: `P${n}-${i}`, precio, cantidad: 1 })),
    },
    { db, ahora },
  );
  if (!r.ok) throw new Error(r.error);
  return r.id;
}
const pagar = (pedidoId, monto, metodo = 'efectivo', extra = {}) => registrarPago({ pedidoId, monto, metodo, ...extra }, { db });
const estado = async (id) => {
  const p = await db.pedidos.get(id);
  return { pagado: p.pagado, saldo: saldoPendiente(p), estadoPago: p.estadoPago };
};

// --- 20 casos de saldo (prueba de la etapa 4) -------------------------------------------
// Cada caso: precios de prendas, envío, operaciones y resultado esperado.
// Operaciones: ['pagar', monto, metodo?] · ['anular', índiceDePagoExitoso, motivo] · ['editar', nuevosPrecios]
const CASOS = [
  { n: 1, precios: [10000], ops: [], esperado: { pagado: 0, saldo: 10000, estadoPago: 'sin-pago' } },
  { n: 2, precios: [10000], ops: [['pagar', 10000]], esperado: { pagado: 10000, saldo: 0, estadoPago: 'pagado' } },
  { n: 3, precios: [10000], ops: [['pagar', 4000]], esperado: { pagado: 4000, saldo: 6000, estadoPago: 'parcial' } },
  { n: 4, precios: [10000], ops: [['pagar', 4000], ['pagar', 6000, 'qr']], esperado: { pagado: 10000, saldo: 0, estadoPago: 'pagado' } },
  { n: 5, precios: [8050, 4550], ops: [['pagar', 12600]], esperado: { pagado: 12600, saldo: 0, estadoPago: 'pagado' } },
  { n: 6, precios: [8050], envio: 1500, ops: [['pagar', 8050]], esperado: { pagado: 8050, saldo: 1500, estadoPago: 'parcial' } },
  { n: 7, precios: [10000], ops: [['pagar', 10001]], falla: [0], esperado: { pagado: 0, saldo: 10000, estadoPago: 'sin-pago' } },
  { n: 8, precios: [10000], ops: [['pagar', 6000], ['pagar', 5000]], falla: [1], esperado: { pagado: 6000, saldo: 4000, estadoPago: 'parcial' } },
  { n: 9, precios: [10000], ops: [['pagar', 10000], ['pagar', 1]], falla: [1], esperado: { pagado: 10000, saldo: 0, estadoPago: 'pagado' } },
  { n: 10, precios: [10000], ops: [['pagar', 0]], falla: [0], esperado: { pagado: 0, saldo: 10000, estadoPago: 'sin-pago' } },
  { n: 11, precios: [10000], ops: [['pagar', -500]], falla: [0], esperado: { pagado: 0, saldo: 10000, estadoPago: 'sin-pago' } },
  { n: 12, precios: [10000], ops: [['pagar', 10000], ['anular', 0, 'Billete falso']], esperado: { pagado: 0, saldo: 10000, estadoPago: 'sin-pago' } },
  { n: 13, precios: [10000], ops: [['pagar', 3000], ['pagar', 7000], ['anular', 1, 'Error']], esperado: { pagado: 3000, saldo: 7000, estadoPago: 'parcial' } },
  { n: 14, precios: [10000], ops: [['pagar', 3000], ['anular', 0, 'Error'], ['anular', 0, 'Otra vez']], falla: [2], esperado: { pagado: 0, saldo: 10000, estadoPago: 'sin-pago' } },
  { n: 15, precios: [10000], ops: [['pagar', 10000], ['anular', 0, 'QR rechazado'], ['pagar', 10000, 'qr']], esperado: { pagado: 10000, saldo: 0, estadoPago: 'pagado' } },
  { n: 16, precios: [10000], ops: [['pagar', 5000], ['editar', [12000]]], esperado: { pagado: 5000, saldo: 7000, estadoPago: 'parcial' } },
  { n: 17, precios: [10000], ops: [['pagar', 5000], ['editar', [5000]]], esperado: { pagado: 5000, saldo: 0, estadoPago: 'pagado' } },
  { n: 18, precios: [10000], ops: [['pagar', 6000], ['editar', [5000]]], falla: [1], esperado: { pagado: 6000, saldo: 4000, estadoPago: 'parcial' } },
  { n: 19, precios: [50, 50, 50], ops: [['pagar', 1], ['pagar', 99], ['pagar', 50]], esperado: { pagado: 150, saldo: 0, estadoPago: 'pagado' } },
  { n: 20, precios: [99999999], ops: [['pagar', 33333333], ['pagar', 33333333, 'qr'], ['pagar', 33333333]], esperado: { pagado: 99999999, saldo: 0, estadoPago: 'pagado' } },
];

describe('20 casos de saldo', () => {
  for (const caso of CASOS) {
    it(`caso ${caso.n}`, async () => {
      const id = await pedido(caso.precios, { envio: caso.envio ?? 0 });
      const exitosos = [];
      for (let i = 0; i < caso.ops.length; i += 1) {
        const [tipo, a, b] = caso.ops[i];
        let r;
        if (tipo === 'pagar') r = await pagar(id, a, b ?? 'efectivo');
        if (tipo === 'anular') r = await anularPago(exitosos[a], { motivo: b, db });
        if (tipo === 'editar') {
          const { prendas } = await obtenerPedido(id, db);
          r = await editarPedido(id, { prendas: a.map((precio, k) => ({ ...(prendas[k] ?? { descripcion: 'x', cantidad: 1 }), precio })) }, { db });
        }
        expect(r.ok, `operación ${i + 1}: ${r.error ?? ''}`).toBe(!(caso.falla ?? []).includes(i));
        if (r.ok && tipo === 'pagar') exitosos.push(r.id);
      }
      expect(await estado(id)).toEqual(caso.esperado);
      // La suma de la tabla pagos siempre coincide con lo guardado en el pedido
      const suma = (await db.pagos.where('pedidoId').equals(id).toArray()).reduce((s, p) => s + p.monto, 0);
      expect(suma).toBe(caso.esperado.pagado);
    });
  }
});

describe('pagos', () => {
  it('guarda el pago con comprobante, historial y no toca el estado del pedido', async () => {
    const id = await pedido([10000]);
    const comprobante = await fotoFalsa(9);
    const r = await pagar(id, 4000, 'qr', { comprobante, nota: 'Yape' });
    const [p] = await pagosDePedido(id, db);
    expect(p).toMatchObject({ monto: 4000, metodo: 'qr', nota: 'Yape', anulaA: null, actor: 'usuario', anulado: false });
    expect(await db.archivos.get(p.comprobanteId)).toMatchObject({ tipo: 'comprobante', refTipo: 'pago', refId: r.id });
    expect((await db.pedidos.get(id)).estado).toBe('pendiente');
    expect(await db.historial.where('tipo').equals('pago-registrado').count()).toBe(1);
  });

  it('la anulación no borra ni modifica el pago original', async () => {
    const id = await pedido([10000]);
    const r = await pagar(id, 10000);
    const original = await db.pagos.get(r.id);
    expect((await anularPago(r.id, { motivo: '', db })).ok).toBe(false); // exige motivo
    const a = await anularPago(r.id, { motivo: 'Me equivoqué de pedido', db });
    expect(await db.pagos.get(r.id)).toEqual(original);
    expect(await db.pagos.get(a.id)).toMatchObject({ monto: -10000, anulaA: r.id, nota: 'Me equivoqué de pedido' });
    expect((await anularPago(a.id, { motivo: 'x', db })).ok).toBe(false); // una anulación no se anula
    const lista = await pagosDePedido(id, db);
    expect(lista.map((p) => [p.monto, p.anulado])).toEqual([[10000, true], [-10000, false]]);
    expect(await db.historial.where('tipo').equals('pago-anulado').count()).toBe(1);
  });

  it('no se paga un pedido cancelado; método inválido rechazado', async () => {
    const id = await pedido([10000]);
    expect((await pagar(id, 100, 'tarjeta')).ok).toBe(false);
    expect((await pagar(id, 100.5)).ok).toBe(false);
    await db.pedidos.update(id, { estado: 'cancelado' });
    expect((await pagar(id, 100)).ok).toBe(false);
    expect((await pagar(999, 100)).ok).toBe(false);
  });

  it('no se anula un pago si quedaría menos de lo ya devuelto', async () => {
    const id = await pedido([10000]);
    const r = await pagar(id, 10000);
    await db.pedidos.update(id, { reembolsado: 5000 });
    expect((await anularPago(r.id, { motivo: 'x', db })).ok).toBe(false);
  });
});

describe('pago de grupo', () => {
  it('reparte del más antiguo al más nuevo, un registro por pedido', async () => {
    const t = (min) => new Date(Date.UTC(2026, 10, 24, 14, min));
    const a = await pedido([10000], { ahora: t(0) });
    const b = await pedido([5000], { ahora: t(5) });
    const c = await pedido([8000], { ahora: t(10) });
    await pagar(a, 4000); // a debe 6000
    const g = await crearGrupo([c, a, b], {}, db);

    expect((await pagarGrupo({ grupoId: g.id, monto: 19001, metodo: 'qr' }, { db })).ok).toBe(false); // pago de más
    const comprobante = await fotoFalsa(3);
    const r = await pagarGrupo({ grupoId: g.id, monto: 12000, metodo: 'qr', comprobante }, { db });
    expect(r.ok).toBe(true);
    expect(r.reparto.map((x) => x.monto)).toEqual([6000, 5000, 1000]);
    expect(await estado(a)).toMatchObject({ saldo: 0, estadoPago: 'pagado' });
    expect(await estado(b)).toMatchObject({ saldo: 0, estadoPago: 'pagado' });
    expect(await estado(c)).toMatchObject({ pagado: 1000, saldo: 7000, estadoPago: 'parcial' });
    const pagosGrupo = await db.pagos.where('pedidoId').anyOf(a, b, c).filter((p) => p.grupoId === g.id).toArray();
    expect(pagosGrupo).toHaveLength(3);
    expect(new Set(pagosGrupo.map((p) => p.comprobanteId)).size).toBe(1); // un comprobante compartido
    expect(await db.archivos.where('tipo').equals('comprobante').count()).toBe(1);

    const r2 = await pagarGrupo({ grupoId: g.id, monto: 7000, metodo: 'efectivo' }, { db });
    expect(r2.reparto).toEqual([{ pedidoId: c, codigo: 'LIVE-00003', monto: 7000 }]);
    expect((await pagarGrupo({ grupoId: g.id, monto: 1, metodo: 'efectivo' }, { db })).ok).toBe(false);
  });
});

describe('consultas de cobros', () => {
  it('cobros del día por método (anulaciones restan el día en que se hacen) y lo que falta cobrar', async () => {
    const a = await pedido([10000]);
    const b = await pedido([20000], { whatsapp: '62223333' });
    const t1 = new Date('2026-11-24T15:00:00Z');
    const t2 = new Date('2026-11-25T15:00:00Z');
    const p1 = await registrarPago({ pedidoId: a, monto: 10000, metodo: 'efectivo' }, { db, ahora: t1 });
    await registrarPago({ pedidoId: b, monto: 5000, metodo: 'qr' }, { db, ahora: t1 });
    await anularPago(p1.id, { motivo: 'error', db, ahora: t2 });

    const dia1 = await cobrosEntre('2026-11-24T04:00:00.000Z', '2026-11-25T04:00:00.000Z', db);
    expect(dia1).toMatchObject({ total: 15000, porMetodo: { efectivo: 10000, qr: 5000 }, cantidad: 2 });
    expect(dia1.pagos[0].cliente.nombre).toBe('Ana');
    const dia2 = await cobrosEntre('2026-11-25T04:00:00.000Z', '2026-11-26T04:00:00.000Z', db);
    expect(dia2).toMatchObject({ total: -10000, porMetodo: { efectivo: -10000, qr: 0 }, cantidad: 0 });

    const porCobrar = await pedidosPorCobrar(db);
    expect(porCobrar.total).toBe(10000 + 15000);
    expect(porCobrar.pedidos.map((p) => p.saldo)).toEqual([10000, 15000]);
  });
});
