// Política por defecto: el pedido se guarda con su pago completo, sin adelantos,
// y no se entrega nada con deuda.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bdDePrueba, cerrarBD } from './ayuda-bd.js';
import { fotoFalsa } from '../data/generador.js';
import { crearPedido, editarPedido, obtenerPedido } from '../../src/services/pedidos.js';
import { anularPago, pagarGrupo, registrarPago } from '../../src/services/pagos.js';
import { registrarEntrega } from '../../src/services/entregas.js';
import { crearGrupo } from '../../src/services/grupos.js';
import { crearBaseDeDatos } from '../../src/core/db.js';

let db;
beforeEach(async () => {
  db = await bdDePrueba({ pagoCompleto: true });
});
afterEach(async () => cerrarBD(db));

const prenda = (precio = 10000) => ({ descripcion: 'Blusa', precio, cantidad: 1 });
const crear = (extra = {}) => crearPedido({ whatsapp: '71234567', nombre: 'Ana', prendas: [prenda()], ...extra }, { db });

describe('pago completo al reservar (política por defecto)', () => {
  it('viene activada en una base nueva', async () => {
    const nueva = crearBaseDeDatos(`politica-${Date.now()}`);
    await nueva.open();
    expect((await nueva.ajustes.get('pedidos.exigirPagoCompleto')).valor).toBe(true);
    nueva.close();
  });

  it('sin pago no se guarda nada', async () => {
    const r = await crear();
    expect(r).toMatchObject({ ok: false, campo: 'pago' });
    expect(await db.pedidos.count()).toBe(0);
    expect(await db.clientes.count()).toBe(0);
    expect((await db.ajustes.get('codigos.ultimoSeq')).valor).toBe(0);
  });

  it('con pago: pedido, pago por el total (con envío) y comprobante en una sola operación', async () => {
    const comprobante = await fotoFalsa(3);
    const r = await crear({ modalidad: 'envio', envio: 1500, pago: { metodo: 'qr', comprobante } });
    expect(r).toMatchObject({ ok: true, codigo: 'LIVE-00001' });
    const p = await db.pedidos.get(r.id);
    expect(p).toMatchObject({ total: 11500, pagado: 11500, estadoPago: 'pagado' });
    const [pago] = await db.pagos.toArray();
    expect(pago).toMatchObject({ pedidoId: r.id, monto: 11500, metodo: 'qr' });
    expect(await db.archivos.get(pago.comprobanteId)).toMatchObject({ tipo: 'comprobante' });
  });

  it('no acepta adelantos', async () => {
    const r = await crear({ pago: { metodo: 'efectivo' } });
    const [pago] = await db.pagos.toArray();
    await anularPago(pago.id, { motivo: 'QR rechazado', db });
    expect((await registrarPago({ pedidoId: r.id, monto: 4000, metodo: 'qr' }, { db })).ok).toBe(false);
    expect((await registrarPago({ pedidoId: r.id, monto: 10000, metodo: 'qr' }, { db })).ok).toBe(true);
  });

  it('no se entrega con deuda (ni confirmando)', async () => {
    const r = await crear({ pago: { metodo: 'efectivo' } });
    const [pago] = await db.pagos.toArray();
    await anularPago(pago.id, { motivo: 'Billete falso', db });
    const e = await registrarEntrega({ pedidoId: r.id, modalidad: 'recojo', aceptarSaldo: true }, { db });
    expect(e).toMatchObject({ ok: false, faltaPago: 10000 });
    expect((await db.pedidos.get(r.id)).estado).toBe('pendiente');
    await registrarPago({ pedidoId: r.id, monto: 10000, metodo: 'qr' }, { db });
    expect((await registrarEntrega({ pedidoId: r.id, modalidad: 'recojo' }, { db })).ok).toBe(true);
  });

  it('editar: si sube el total se cobra la diferencia; no se puede bajar de lo pagado', async () => {
    const r = await crear({ pago: { metodo: 'efectivo' } });
    const { prendas } = await obtenerPedido(r.id, db);
    const mas = [...prendas, { descripcion: 'Falda', precio: 5000, cantidad: 1 }];
    const sinPago = await editarPedido(r.id, { prendas: mas }, { db });
    expect(sinPago).toMatchObject({ ok: false, campo: 'pago', diferencia: 5000 });
    expect(await db.prendas.count()).toBe(1); // no cambió nada
    expect((await editarPedido(r.id, { prendas: mas, pago: { metodo: 'qr' } }, { db })).ok).toBe(true);
    expect(await db.pedidos.get(r.id)).toMatchObject({ total: 15000, pagado: 15000, estadoPago: 'pagado' });
    expect((await db.pagos.toArray()).map((p) => [p.monto, p.metodo])).toEqual([[10000, 'efectivo'], [5000, 'qr']]);
    // Bajar el total por debajo de lo pagado: bloqueado
    const { prendas: ahora } = await obtenerPedido(r.id, db);
    expect((await editarPedido(r.id, { prendas: [ahora[0]] }, { db })).ok).toBe(false);
    // Cambiar solo textos (mismo total): no pide pago
    expect((await editarPedido(r.id, { prendas: ahora.map((p) => ({ ...p, color: 'Rojo' })), observaciones: 'x' }, { db })).ok).toBe(true);
  });

  it('pago de grupo: solo el total', async () => {
    const a = await crear({ pago: { metodo: 'efectivo' } });
    const b = await crear({ pago: { metodo: 'efectivo' } });
    for (const p of await db.pagos.toArray()) await anularPago(p.id, { motivo: 'error', db });
    const g = await crearGrupo([a.id, b.id], {}, db);
    expect((await pagarGrupo({ grupoId: g.id, monto: 15000, metodo: 'qr' }, { db })).ok).toBe(false);
    expect((await pagarGrupo({ grupoId: g.id, monto: 20000, metodo: 'qr' }, { db })).ok).toBe(true);
  });
});
