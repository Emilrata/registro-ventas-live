// Estadísticas. Reglas:
//  - VENTAS = pedidos creados en el período (por su fecha de creación), sin los cancelados.
//    Una cancelación resta del día ORIGINAL del pedido y se muestra aparte como
//    "cancelaciones del período" (por la fecha en que se canceló).
//  - COBROS = dinero recibido en el período (por la fecha del pago; las anulaciones restan el día
//    en que se hacen). NUNCA se mezclan ventas con cobros.
//  - DEVOLUCIONES = dinero devuelto en el período. Neto cobrado = cobros − devoluciones.
//  - DEUDAS y PENDIENTES son una foto de HOY (no dependen del período).
//  Los días son días locales del dispositivo.
import { obtenerBD } from '../core/db.js';
import { claveDia, diasEntre } from '../core/dates.js';
import { saldoPendiente } from '../core/calculos.js';

/** Inicio (inclusive) del día local "AAAA-MM-DD" en ISO. */
export function inicioDia(clave) {
  const [a, m, d] = clave.split('-').map(Number);
  return new Date(a, m - 1, d).toISOString();
}

/** Día siguiente a "AAAA-MM-DD". */
export function diaSiguiente(clave) {
  const [a, m, d] = clave.split('-').map(Number);
  return claveDia(new Date(a, m - 1, d + 1));
}

/** Lista de días entre dos claves (inclusive). */
export function listaDias(desde, hasta) {
  const dias = [];
  for (let d = desde; d <= hasta && dias.length < 3700; d = diaSiguiente(d)) dias.push(d);
  return dias;
}

export const PERIODOS = {
  hoy: 'Hoy',
  ayer: 'Ayer',
  '7dias': 'Últimos 7 días',
  '30dias': 'Últimos 30 días',
  mes: 'Este mes',
  mesPasado: 'Mes pasado',
};

/** Período predefinido → { desde, hasta } en claves de día (ambos inclusive). */
export function periodoPredefinido(tipo, ahora = new Date()) {
  const hoy = claveDia(ahora);
  const y = ahora.getFullYear();
  const m = ahora.getMonth();
  const dia = (yy, mm, dd) => claveDia(new Date(yy, mm, dd));
  switch (tipo) {
    case 'hoy': return { desde: hoy, hasta: hoy };
    case 'ayer': { const a = dia(y, m, ahora.getDate() - 1); return { desde: a, hasta: a }; }
    case '7dias': return { desde: dia(y, m, ahora.getDate() - 6), hasta: hoy };
    case '30dias': return { desde: dia(y, m, ahora.getDate() - 29), hasta: hoy };
    case 'mes': return { desde: dia(y, m, 1), hasta: hoy };
    case 'mesPasado': return { desde: dia(y, m - 1, 1), hasta: dia(y, m, 0) };
    default: throw new TypeError(`Período desconocido: ${tipo}`);
  }
}

const enRango = (iso, ini, fin) => typeof iso === 'string' && iso >= ini && iso < fin;

/**
 * Calcula todo lo del período.
 * filtro = { desde: 'AAAA-MM-DD', hasta: 'AAAA-MM-DD' (inclusive), transmisionId? }
 */
export async function calcularEstadisticas({ desde, hasta, transmisionId = null }, { ahora = new Date(), db = obtenerBD() } = {}) {
  if (!desde || !hasta || desde > hasta) throw new RangeError('Período no válido');
  const ini = inicioDia(desde);
  const fin = inicioDia(diaSiguiente(hasta));
  const deTransmision = (p) => !transmisionId || p?.transmisionId === transmisionId;

  // Pedidos creados en el período
  const creados = (await db.pedidos.where('creadoEn').between(ini, fin, true, false).toArray()).filter(deTransmision);
  const activos = creados.filter((p) => p.estado !== 'cancelado');

  // Cancelaciones hechas en el período (por la fecha de cancelación)
  const cancelados = (await db.pedidos.where('estado').equals('cancelado').toArray()).filter(
    (p) => deTransmision(p) && enRango(p.cancelacion?.fecha, ini, fin),
  );

  // Pagos y devoluciones del período (con su pedido, para filtrar por transmisión)
  const pagos = await db.pagos.where('fechaHora').between(ini, fin, true, false).toArray();
  const devoluciones = await db.devoluciones.where('fechaHora').between(ini, fin, true, false).toArray();
  const idsPedidos = [...new Set([...pagos, ...devoluciones].map((x) => x.pedidoId))];
  const pedidosDe = new Map((await db.pedidos.bulkGet(idsPedidos)).filter(Boolean).map((p) => [p.id, p]));
  const pagosF = pagos.filter((x) => deTransmision(pedidosDe.get(x.pedidoId)));
  const devolucionesF = devoluciones.filter((x) => deTransmision(pedidosDe.get(x.pedidoId)));

  const cobros = { total: 0, efectivo: 0, qr: 0, cantidad: 0 };
  for (const p of pagosF) {
    cobros.total += p.monto;
    cobros[p.metodo] += p.monto;
    if (p.anulaA === null) cobros.cantidad += 1;
  }
  const devuelto = devolucionesF.reduce((s, d) => s + d.monto, 0);

  // Entregas del período (no anuladas), por fecha de entrega o de despacho
  const entregas = (await db.entregas.toArray()).filter((e) => !e.anulada && enRango(e.entregadoEn ?? e.fechaDespacho, ini, fin));
  const pedidosEntregados = await db.pedidos.bulkGet(entregas.flatMap((e) => e.pedidos));
  const entregadosF = pedidosEntregados.filter((p) => p && deTransmision(p));
  const idsEntregadosF = new Set(entregadosF.map((p) => p.id));
  const entregasF = entregas.filter((e) => e.pedidos.some((id) => idsEntregadosF.has(id)));

  // Foto de hoy: deudas y pendientes de entrega
  const noCancelados = (await db.pedidos.where('estado').anyOf('pendiente', 'entregado').toArray()).filter(deTransmision);
  const conDeuda = noCancelados.filter((p) => saldoPendiente(p) > 0);
  const tramos = { '0-7': 0, '8-30': 0, '31+': 0 };
  for (const p of conDeuda) {
    const d = diasEntre(p.creadoEn, ahora);
    tramos[d <= 7 ? '0-7' : d <= 30 ? '8-30' : '31+'] += saldoPendiente(p);
  }
  const pendientes = noCancelados.filter((p) => p.estado === 'pendiente');

  // Serie por día: ventas (por día de creación) frente a cobros (por día de pago)
  const dias = listaDias(desde, hasta);
  const serie = new Map(dias.map((d) => [d, { dia: d, ventas: 0, cobros: 0, devoluciones: 0, pedidos: 0 }]));
  for (const p of activos) {
    const s = serie.get(claveDia(p.creadoEn));
    if (s) { s.ventas += p.total; s.pedidos += 1; }
  }
  for (const p of pagosF) { const s = serie.get(claveDia(p.fechaHora)); if (s) s.cobros += p.monto; }
  for (const d of devolucionesF) { const s = serie.get(claveDia(d.fechaHora)); if (s) s.devoluciones += d.monto; }

  // Clientas con más ventas en el período
  const porCliente = new Map();
  for (const p of activos) {
    const c = porCliente.get(p.clienteId) ?? { clienteId: p.clienteId, total: 0, pedidos: 0 };
    c.total += p.total;
    c.pedidos += 1;
    porCliente.set(p.clienteId, c);
  }
  const top = [...porCliente.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  const nombres = new Map((await db.clientes.bulkGet(top.map((t) => t.clienteId))).filter(Boolean).map((c) => [c.id, c.nombre]));

  return {
    periodo: { desde, hasta, transmisionId },
    ventas: {
      total: activos.reduce((s, p) => s + p.total, 0),
      pedidos: activos.length,
      ticketPromedio: activos.length ? Math.round(activos.reduce((s, p) => s + p.total, 0) / activos.length) : 0,
    },
    cancelaciones: { pedidos: cancelados.length, total: cancelados.reduce((s, p) => s + p.total, 0) },
    cobros,
    devoluciones: { total: devuelto, cantidad: devolucionesF.filter((d) => !d.anulaA).length },
    netoCobrado: cobros.total - devuelto,
    entregas: {
      pedidos: entregadosF.length,
      recojo: entregasF.filter((e) => e.modalidad === 'recojo').length,
      envio: entregasF.filter((e) => e.modalidad === 'envio').length,
      vencidos: entregasF.filter((e) => e.vencido).length,
    },
    deudas: { total: conDeuda.reduce((s, p) => s + saldoPendiente(p), 0), pedidos: conDeuda.length, tramos },
    pendientesEntrega: {
      pedidos: pendientes.length,
      vencidos: pendientes.filter((p) => diasEntre(ahora, p.fechaLimite) < 0).length,
    },
    serie: [...serie.values()],
    topClientas: top.map((t) => ({ ...t, nombre: nombres.get(t.clienteId) ?? '—' })),
    // Para el informe de Excel
    _detalle: { creados, pagos: pagosF, devoluciones: devolucionesF, entregas: entregasF, conDeuda, pedidosDe },
  };
}
