import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bdDePrueba, cerrarBD } from './ayuda-bd.js';
import { fotoFalsa } from '../data/generador.js';
import { crearPedido, editarPedido } from '../../src/services/pedidos.js';
import { crearGrupo, obtenerGrupo } from '../../src/services/grupos.js';
import { anularPago, pagarGrupo, registrarPago } from '../../src/services/pagos.js';
import { cancelarPedido, confirmarRecepcion, deshacerEntrega, registrarEntrega, validarDatosEntrega } from '../../src/services/entregas.js';
import { anularDevolucion, devolucionesDePedido, registrarDevolucion } from '../../src/services/devoluciones.js';
import { clasificarVencimiento, pedidosPorVencer } from '../../src/services/vencimientos.js';
import { saldoPendiente } from '../../src/core/calculos.js';

let db;
beforeEach(async () => {
  db = await bdDePrueba();
});
afterEach(async () => cerrarBD(db));

const T0 = new Date('2026-11-01T15:00:00Z');
const dias = (n) => new Date(T0.getTime() + n * 86400000);
let k = 0;
async function pedido(precio = 10000, { ahora = T0, whatsapp = '71234567', foto = true, modalidad = 'recojo' } = {}) {
  k += 1;
  const r = await crearPedido(
    { whatsapp, nombre: 'Ana Pérez', modalidad, envio: modalidad === 'envio' ? 1500 : 0, prendas: [{ descripcion: `Blusa ${k}`, talla: 'M', color: 'Negro', precio, cantidad: 1, foto: foto ? await fotoFalsa(k) : null }] },
    { db, ahora },
  );
  return r.id;
}

describe('entregar', () => {
  it('recojo con todo pagado: queda entregado, con entrega e historial', async () => {
    const id = await pedido();
    await registrarPago({ pedidoId: id, monto: 10000, metodo: 'qr' }, { db, ahora: dias(1) });
    const r = await registrarEntrega({ pedidoId: id, modalidad: 'recojo', destinatario: 'Su hermana' }, { db, ahora: dias(2) });
    expect(r.ok).toBe(true);
    const p = await db.pedidos.get(id);
    expect(p).toMatchObject({ estado: 'entregado', entregaId: r.id, estadoPago: 'pagado' });
    expect(await db.entregas.get(r.id)).toMatchObject({
      pedidoId: id, modalidad: 'recojo', destinatario: 'Su hermana', entregadoEn: dias(2).toISOString(), fechaDespacho: null, vencido: false, saldoAlEntregar: 0,
    });
    expect(await db.historial.where('tipo').equals('pedido-entregado').count()).toBe(1);
    expect((await registrarEntrega({ pedidoId: id, modalidad: 'recojo' }, { db })).ok).toBe(false); // no dos veces
  });

  it('con saldo pendiente pide confirmación; luego se puede cobrar después de entregar', async () => {
    const id = await pedido();
    await registrarPago({ pedidoId: id, monto: 4000, metodo: 'efectivo' }, { db });
    const r1 = await registrarEntrega({ pedidoId: id, modalidad: 'recojo' }, { db });
    expect(r1).toEqual({ ok: false, requiereConfirmacion: 'saldo', saldo: 6000 });
    expect((await db.pedidos.get(id)).estado).toBe('pendiente');
    const r2 = await registrarEntrega({ pedidoId: id, modalidad: 'recojo', aceptarSaldo: true }, { db });
    expect(r2.ok).toBe(true);
    expect((await db.entregas.get(r2.id)).saldoAlEntregar).toBe(6000);
    // Estado de pago independiente del estado del pedido
    expect(await db.pedidos.get(id)).toMatchObject({ estado: 'entregado', estadoPago: 'parcial' });
    expect((await registrarPago({ pedidoId: id, monto: 6000, metodo: 'qr' }, { db })).ok).toBe(true);
    expect(await db.pedidos.get(id)).toMatchObject({ estado: 'entregado', estadoPago: 'pagado' });
  });

  it('recoger vencido está permitido y queda registrado', async () => {
    const id = await pedido(10000, { ahora: T0 });
    await registrarPago({ pedidoId: id, monto: 10000, metodo: 'efectivo' }, { db });
    const r = await registrarEntrega({ pedidoId: id, modalidad: 'recojo' }, { db, ahora: dias(31) });
    expect(r).toMatchObject({ ok: true, vencidos: ['LIVE-00001'] });
    expect((await db.entregas.get(r.id)).vencido).toBe(true);
    const h = await db.historial.where('tipo').equals('pedido-entregado').first();
    expect(h.despues.vencido).toBe(true);
    // El día 30 (fecha límite) todavía no está vencido
    const id2 = await pedido(10000, { ahora: T0, whatsapp: '62223333' });
    await registrarPago({ pedidoId: id2, monto: 10000, metodo: 'efectivo' }, { db });
    expect((await registrarEntrega({ pedidoId: id2, modalidad: 'recojo' }, { db, ahora: dias(30) })).vencidos).toEqual([]);
  });

  it('envío: valida datos, despacha y luego confirma recepción', async () => {
    const id = await pedido(10000, { modalidad: 'envio' });
    expect(validarDatosEntrega({ modalidad: 'envio', destinatario: '', ciudad: 'Cochabamba' }).ok).toBe(false);
    expect(validarDatosEntrega({ modalidad: 'envio', destinatario: 'Ana', ciudad: '' }).ok).toBe(false);
    expect(validarDatosEntrega({ modalidad: 'envio', destinatario: 'Ana', ciudad: 'Cbba', telefono: '123' }).ok).toBe(false);
    const r = await registrarEntrega(
      { pedidoId: id, modalidad: 'envio', destinatario: 'Ana Pérez', telefono: '71234567', ciudad: 'Cochabamba', direccion: 'Terminal', transportista: 'Trans Copacabana', seguimiento: 'ABC-123', costoEnvio: 2000, aceptarSaldo: true },
      { db, ahora: dias(1) },
    );
    expect(r.ok).toBe(true);
    const e = await db.entregas.get(r.id);
    expect(e).toMatchObject({ modalidad: 'envio', telefono: '+59171234567', fechaDespacho: dias(1).toISOString(), entregadoEn: null, costoEnvio: 2000 });
    expect((await confirmarRecepcion(r.id, { db, ahora: dias(3) })).ok).toBe(true);
    expect((await db.entregas.get(r.id)).entregadoEn).toBe(dias(3).toISOString());
    expect((await confirmarRecepcion(r.id, { db })).ok).toBe(false);
  });

  it('grupo: entrega todos los pendientes con un solo costo de envío', async () => {
    const a = await pedido(10000, { ahora: dias(0) });
    const b = await pedido(5000, { ahora: dias(1) });
    const g = await crearGrupo([a, b], {}, db);
    await pagarGrupo({ grupoId: g.id, monto: 15000, metodo: 'qr' }, { db });
    const r = await registrarEntrega({ grupoId: g.id, modalidad: 'envio', destinatario: 'Ana', ciudad: 'Sucre', costoEnvio: 2500 }, { db });
    expect(r.ok).toBe(true);
    const e = await db.entregas.get(r.id);
    expect(e).toMatchObject({ grupoId: g.id, pedidoId: null, pedidos: [a, b], costoEnvio: 2500 });
    expect((await db.pedidos.bulkGet([a, b])).map((p) => p.estado)).toEqual(['entregado', 'entregado']);
    expect((await db.grupos.get(g.id)).estado).toBe('entregado');
    // Los totales de los pedidos no cambian por el costo de envío del grupo
    expect((await db.pedidos.bulkGet([a, b])).map((p) => p.total)).toEqual([10000, 5000]);
  });

  it('deshacer entrega: vuelve a pendiente y la entrega queda anulada, no borrada', async () => {
    const id = await pedido();
    await registrarPago({ pedidoId: id, monto: 10000, metodo: 'qr' }, { db });
    const r = await registrarEntrega({ pedidoId: id, modalidad: 'recojo' }, { db });
    expect((await deshacerEntrega(r.id, { motivo: '', db })).ok).toBe(false);
    expect((await deshacerEntrega(r.id, { motivo: 'Me equivoqué de pedido', db })).ok).toBe(true);
    expect(await db.pedidos.get(id)).toMatchObject({ estado: 'pendiente', entregaId: null });
    expect((await db.entregas.get(r.id)).anulada.motivo).toBe('Me equivoqué de pedido');
    expect((await deshacerEntrega(r.id, { motivo: 'x', db })).ok).toBe(false);
    expect((await registrarEntrega({ pedidoId: id, modalidad: 'recojo' }, { db })).ok).toBe(true);
  });
});

describe('cancelar y devolver', () => {
  it('cancelar exige motivo, no borra nada y deja el dinero pagado como "a devolver"', async () => {
    const id = await pedido();
    await registrarPago({ pedidoId: id, monto: 6000, metodo: 'qr' }, { db });
    expect((await cancelarPedido(id, { motivo: ' ', db })).ok).toBe(false);
    const r = await cancelarPedido(id, { motivo: 'La clienta ya no la quiere', db, ahora: dias(2) });
    expect(r).toEqual({ ok: true, aDevolver: 6000 });
    const p = await db.pedidos.get(id);
    expect(p).toMatchObject({ estado: 'cancelado', pagado: 6000, cancelacion: { motivo: 'La clienta ya no la quiere', actor: 'usuario', fecha: dias(2).toISOString() } });
    expect(await db.prendas.where('pedidoId').equals(id).count()).toBe(1);
    expect((await cancelarPedido(id, { motivo: 'x', db })).ok).toBe(false);
    expect((await registrarPago({ pedidoId: id, monto: 100, metodo: 'qr' }, { db })).ok).toBe(false);
    expect((await editarPedido(id, { prendas: [] }, { db })).ok).toBe(false);
    expect((await registrarEntrega({ pedidoId: id, modalidad: 'recojo' }, { db })).ok).toBe(false);
  });

  it('un pedido entregado no se cancela', async () => {
    const id = await pedido();
    await registrarEntrega({ pedidoId: id, modalidad: 'recojo', aceptarSaldo: true }, { db });
    expect((await cancelarPedido(id, { motivo: 'x', db })).ok).toBe(false);
  });

  it('devolución: no más de lo pagado; anulación sin borrar', async () => {
    const id = await pedido();
    await registrarPago({ pedidoId: id, monto: 6000, metodo: 'qr' }, { db });
    // Sin cancelar: es una excepción y hay que explicarla
    expect((await registrarDevolucion({ pedidoId: id, monto: 1000, metodo: 'efectivo', motivo: 'Falla' }, { db })).campo).toBe('excepcion');
    await cancelarPedido(id, { motivo: 'Cancelado', db });
    expect((await registrarDevolucion({ pedidoId: id, monto: 6001, metodo: 'efectivo', motivo: 'Cancelado' }, { db })).ok).toBe(false);
    expect((await registrarDevolucion({ pedidoId: id, monto: 1000, metodo: 'efectivo', motivo: '' }, { db })).ok).toBe(false);
    const comprobante = await fotoFalsa(77);
    const d1 = await registrarDevolucion({ pedidoId: id, monto: 4000, metodo: 'qr', motivo: 'Cancelado', comprobante }, { db });
    expect(d1.ok).toBe(true);
    expect(await db.pedidos.get(id)).toMatchObject({ reembolsado: 4000, estadoPago: 'parcial' });
    const d2 = await registrarDevolucion({ pedidoId: id, monto: 2000, metodo: 'efectivo', motivo: 'Resto' }, { db });
    expect(await db.pedidos.get(id)).toMatchObject({ pagado: 6000, reembolsado: 6000, estadoPago: 'sin-pago' });
    expect((await registrarDevolucion({ pedidoId: id, monto: 1, metodo: 'efectivo', motivo: 'x' }, { db })).ok).toBe(false);
    // No se puede anular el pago si ya se devolvió
    const [pago] = await db.pagos.where('pedidoId').equals(id).toArray();
    expect((await anularPago(pago.id, { motivo: 'x', db })).ok).toBe(false);
    // Anular una devolución
    const original = await db.devoluciones.get(d2.id);
    expect((await anularDevolucion(d2.id, { motivo: 'No se entregó el dinero', db })).ok).toBe(true);
    expect(await db.devoluciones.get(d2.id)).toEqual(original);
    expect((await anularDevolucion(d2.id, { motivo: 'x', db })).ok).toBe(false);
    expect((await db.pedidos.get(id)).reembolsado).toBe(4000);
    const lista = await devolucionesDePedido(id, db);
    expect(lista.map((d) => [d.monto, d.anulada])).toEqual([[4000, false], [2000, true], [-2000, false]]);
    expect(await db.archivos.get(lista[0].comprobanteId)).toMatchObject({ tipo: 'comprobante', refTipo: 'devolucion' });
  });

  it('devolución por excepción en pedido entregado', async () => {
    const id = await pedido();
    await registrarPago({ pedidoId: id, monto: 10000, metodo: 'qr' }, { db });
    await registrarEntrega({ pedidoId: id, modalidad: 'recojo' }, { db });
    const r = await registrarDevolucion({ pedidoId: id, monto: 2000, metodo: 'efectivo', motivo: 'Prenda con falla', excepcion: 'Descuento por mancha' }, { db });
    expect(r.ok).toBe(true);
    expect((await db.devoluciones.get(r.id)).excepcion).toBe('Descuento por mancha');
    expect(await db.pedidos.get(id)).toMatchObject({ estado: 'entregado', reembolsado: 2000, estadoPago: 'parcial' });
    expect(saldoPendiente(await db.pedidos.get(id))).toBe(2000);
  });

  it('los cancelados no suman al total del grupo', async () => {
    const a = await pedido(10000);
    const b = await pedido(5000);
    const g = await crearGrupo([a, b], {}, db);
    await cancelarPedido(b, { motivo: 'x', db });
    expect((await obtenerGrupo(g.id, db)).total).toBe(10000);
  });
});

describe('vencimientos', () => {
  it('clasifica por fecha límite y días de aviso', () => {
    const p = { estado: 'pendiente', creadoEn: T0.toISOString(), fechaLimite: dias(30).toISOString() };
    expect(clasificarVencimiento(p, { ahora: dias(24) }).estado).toBe('ok');
    expect(clasificarVencimiento(p, { ahora: dias(25) }).estado).toBe('aviso');
    expect(clasificarVencimiento(p, { ahora: dias(30) })).toMatchObject({ estado: 'aviso', restantes: 0 });
    expect(clasificarVencimiento(p, { ahora: dias(31) })).toMatchObject({ estado: 'vencido', restantes: -1 });
    expect(clasificarVencimiento({ ...p, estado: 'entregado' }, { ahora: dias(40) }).estado).toBe('no-aplica');
  });

  it('lista vencidos y por vencer (solo pendientes)', async () => {
    const viejo = await pedido(10000, { ahora: dias(-40) });
    const medio = await pedido(10000, { ahora: dias(-26), whatsapp: '62223333' });
    await pedido(10000, { ahora: dias(-3) });
    const entregado = await pedido(10000, { ahora: dias(-50) });
    await registrarEntrega({ pedidoId: entregado, modalidad: 'recojo', aceptarSaldo: true }, { db, ahora: dias(-45) });
    const r = await pedidosPorVencer({ db, ahora: T0 });
    expect(r.vencidos.map((p) => p.id)).toEqual([viejo]);
    expect(r.porVencer.map((p) => p.id)).toEqual([medio]);
    expect(r.vencidos[0].cliente.nombre).toBe('Ana Pérez');
  });
});

describe('PRUEBA DE LA ETAPA 5: nada borra fotos ni pagos', () => {
  it('ninguna operación quita ni cambia fotos, pagos, devoluciones o historial', async () => {
    const volcar = async () => ({
      archivos: await Promise.all((await db.archivos.toArray()).map(async (a) => ({ ...a, blob: [...new Uint8Array(await a.blob.arrayBuffer())], miniatura: null }))),
      pagos: await db.pagos.toArray(),
      devoluciones: await db.devoluciones.toArray(),
      historial: await db.historial.toArray(),
    });
    const conservaTodo = (antes, despues) => {
      for (const t of Object.keys(antes)) {
        const porId = new Map(despues[t].map((x) => [x.id, x]));
        for (const fila of antes[t]) expect(porId.get(fila.id), `${t} ${fila.id}`).toEqual(fila);
      }
    };
    const pasos = [];
    const a = await pedido(10000);
    const b = await pedido(8000);
    const c = await pedido(6000);
    const d = await pedido(4000);
    const pa = await registrarPago({ pedidoId: a, monto: 10000, metodo: 'qr', comprobante: await fotoFalsa(500) }, { db });
    pasos.push(['pagar', pa]);
    let antes = await volcar();
    const acciones = [
      () => registrarEntrega({ pedidoId: a, modalidad: 'recojo' }, { db }),
      async () => deshacerEntrega((await db.pedidos.get(a)).entregaId, { motivo: 'error', db }),
      () => registrarEntrega({ pedidoId: a, modalidad: 'recojo' }, { db }),
      () => registrarPago({ pedidoId: b, monto: 3000, metodo: 'efectivo' }, { db }),
      () => cancelarPedido(b, { motivo: 'Ya no la quiere', db }),
      () => registrarDevolucion({ pedidoId: b, monto: 3000, metodo: 'efectivo', motivo: 'Cancelado' }, { db }),
      async () => anularDevolucion((await db.devoluciones.toArray())[0].id, { motivo: 'error', db }),
      () => crearGrupo([c, d], {}, db),
      async () => pagarGrupo({ grupoId: (await db.pedidos.get(c)).grupoId, monto: 7000, metodo: 'qr' }, { db }),
      async () => registrarEntrega({ grupoId: (await db.pedidos.get(c)).grupoId, modalidad: 'envio', destinatario: 'Ana', ciudad: 'Oruro', aceptarSaldo: true }, { db }),
      async () => anularPago((await db.pagos.where('pedidoId').equals(d).first()).id, { motivo: 'error', db }),
      async () => editarPedido(c, { prendas: [] }, { db }), // falla (entregado), no debe tocar nada
    ];
    for (const accion of acciones) {
      await accion();
      const despues = await volcar();
      conservaTodo(antes, despues);
      expect(despues.archivos.length).toBeGreaterThanOrEqual(antes.archivos.length);
      expect(despues.pagos.length).toBeGreaterThanOrEqual(antes.pagos.length);
      expect(despues.historial.length).toBeGreaterThanOrEqual(antes.historial.length);
      antes = despues;
    }
    // Las 4 fotos de prendas y el comprobante siguen ahí
    expect(await db.archivos.where('tipo').equals('foto').count()).toBe(4);
    expect(await db.archivos.where('tipo').equals('comprobante').count()).toBe(1);
    expect(await db.prendas.count()).toBe(4);
  });
});
