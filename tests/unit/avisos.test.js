import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bdDePrueba, cerrarBD } from './ayuda-bd.js';
import { crearPedido } from '../../src/services/pedidos.js';
import { registrarPago } from '../../src/services/pagos.js';
import { cancelarPedido, registrarEntrega } from '../../src/services/entregas.js';
import { cambiarDiasRecordatorio, clasificarAviso, clientasPorAvisar, registrarAviso } from '../../src/services/avisos.js';
import { esAjusteDelDispositivo } from '../../src/services/respaldo.js';

let db;
beforeEach(async () => {
  db = await bdDePrueba({ pagoCompleto: true });
});
afterEach(async () => cerrarBD(db));

const T0 = new Date('2026-11-01T15:00:00Z');
const dias = (n) => new Date(T0.getTime() + n * 86400000);
let k = 0;
async function pedido({ whatsapp = '71234567', nombre = 'Ana Pérez', modalidad = 'recojo', ahora = T0, precio = 10000 } = {}) {
  k += 1;
  const r = await crearPedido(
    {
      whatsapp, nombre, modalidad, envio: modalidad === 'envio' ? 1500 : 0,
      prendas: [{ descripcion: `Blusa ${k}`, precio, cantidad: 1 }],
      pago: { metodo: 'efectivo' },
    },
    { db, ahora },
  );
  expect(r.ok).toBe(true);
  return r.id;
}

describe('clasificarAviso', () => {
  const p = { creadoEn: T0.toISOString() };
  it('sin aviso: toca avisar que está listo', () => {
    expect(clasificarAviso(p, null, { ahora: T0 })).toMatchObject({ toca: true, tipo: 'listo', veces: 0 });
  });
  it('con aviso: vuelve a tocar a los N días', () => {
    const aviso = { fechaHora: dias(2).toISOString(), veces: 1 };
    expect(clasificarAviso(p, aviso, { ahora: dias(8), dias: 7 }).toca).toBe(false);
    expect(clasificarAviso(p, aviso, { ahora: dias(9), dias: 7 })).toMatchObject({ toca: true, tipo: 'recordatorio', diasReservado: 9 });
  });
});

describe('clientas por avisar', () => {
  it('agrupa por clienta, solo pendientes de recojo, y desaparece al avisar', async () => {
    const a1 = await pedido();
    const a2 = await pedido({ ahora: dias(1) });
    await pedido({ whatsapp: '76543210', nombre: 'Bea Rojas', modalidad: 'envio' }); // envío: no es para recoger
    const c = await pedido({ whatsapp: '67777777', nombre: 'Carla Soto' });
    await cancelarPedido(c, { motivo: 'Se arrepintió', db });

    let r = await clientasPorAvisar({ db, ahora: dias(1) });
    expect(r.grupos).toHaveLength(1);
    expect(r.grupos[0]).toMatchObject({ tipo: 'listo', cliente: { nombre: 'Ana Pérez' }, saldo: 0 });
    expect(r.grupos[0].pedidos.map((p) => p.id)).toEqual([a1, a2]);

    await registrarAviso({ pedidoIds: [a1, a2], tipo: 'listo', db, ahora: dias(1) });
    r = await clientasPorAvisar({ db, ahora: dias(3) });
    expect(r.grupos).toHaveLength(0);

    // A los 7 días del aviso, si sigue sin recoger: recordatorio.
    r = await clientasPorAvisar({ db, ahora: dias(8) });
    expect(r.grupos).toHaveLength(1);
    expect(r.grupos[0]).toMatchObject({ tipo: 'recordatorio', diasReservado: 8 });
    expect(r.grupos[0].ultimoAviso).toBe(dias(1).toISOString());
  });

  it('un pedido nuevo de la misma clienta vuelve a pedir «listo»', async () => {
    const a1 = await pedido();
    await registrarAviso({ pedidoIds: [a1], tipo: 'listo', db, ahora: T0 });
    await pedido({ ahora: dias(2) });
    const r = await clientasPorAvisar({ db, ahora: dias(2) });
    expect(r.grupos).toHaveLength(1);
    expect(r.grupos[0].tipo).toBe('listo');
    expect(r.grupos[0].pedidos).toHaveLength(2);
  });

  it('al entregar sale de la lista; el aviso queda en el historial', async () => {
    const id = await pedido();
    await registrarAviso({ pedidoIds: [id], tipo: 'listo', medio: 'manual', db, ahora: T0 });
    expect((await registrarEntrega({ pedidoId: id, modalidad: 'recojo' }, { db, ahora: dias(10) })).ok).toBe(true);
    expect((await clientasPorAvisar({ db, ahora: dias(10) })).grupos).toHaveLength(0);
    const h = await db.historial.where('tipo').equals('aviso-clienta').toArray();
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ entidad: 'pedido', entidadId: id, despues: { mensaje: 'listo', medio: 'manual' } });
  });

  it('cambiar los días de recordatorio y la agenda para el Service Worker', async () => {
    const id = await pedido();
    await registrarAviso({ pedidoIds: [id], tipo: 'listo', db, ahora: T0 });
    await cambiarDiasRecordatorio(3, db);
    const r = await clientasPorAvisar({ db, ahora: dias(3) });
    expect(r.dias).toBe(3);
    expect(r.grupos).toHaveLength(1);
    expect(r.agenda).toHaveLength(1);
    expect(r.agenda[0]).toBeLessThanOrEqual(dias(3).getTime());
    await expect(cambiarDiasRecordatorio(4, db)).rejects.toThrow();
  });

  it('pedido vencido: recordatorio, nunca «puedes recoger hasta» una fecha pasada', async () => {
    await pedido();
    const r = await clientasPorAvisar({ db, ahora: dias(31) });
    expect(r.grupos[0].tipo).toBe('recordatorio');
    const { armarMensaje } = await import('../../src/services/mensajes.js');
    const texto = armarMensaje('listo', { negocio: 'X', cliente: r.grupos[0].cliente, pedidos: r.grupos[0].pedidos, ahora: dias(31) });
    expect(texto).toContain('venció el');
    expect(texto).not.toContain('Puedes recoger');
  });

  it('las notificaciones son del dispositivo: no viajan en los respaldos', () => {
    expect(esAjusteDelDispositivo('notificaciones.activas')).toBe(true);
    expect(esAjusteDelDispositivo('notificaciones.agenda')).toBe(true);
    expect(esAjusteDelDispositivo('avisos.diasRecordatorio')).toBe(false);
  });
});
