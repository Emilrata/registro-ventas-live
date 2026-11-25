// Piezas de interfaz de pedidos: chips de estado y tarjeta de lista.
import { h } from './dom.js';
import { formatearMonto } from '../core/money.js';
import { diasEntre, formatearFecha } from '../core/dates.js';
import { miniatura } from './fotos.js';

const TEXTO_ESTADO = { pendiente: 'Pendiente', entregado: 'Entregado', cancelado: 'Cancelado' };
const TEXTO_PAGO = { 'sin-pago': 'Sin pago', parcial: 'Pago parcial', pagado: 'Pagado' };

export function chipEstado(estado) {
  return h('span', { class: `chip chip--${estado}` }, TEXTO_ESTADO[estado] ?? estado);
}

export function chipPago(estadoPago) {
  return h('span', { class: `chip chip--pago-${estadoPago}` }, TEXTO_PAGO[estadoPago] ?? estadoPago);
}

/** "Vence en 12 días" / "Vence hoy" / "Venció hace 3 días" (rojo solo si venció). */
export function textoVencimiento(fechaLimite, ahora = new Date()) {
  const d = diasEntre(ahora, fechaLimite);
  if (d > 1) return { texto: `Vence en ${d} días`, urgente: false };
  if (d === 1) return { texto: 'Vence mañana', urgente: false };
  if (d === 0) return { texto: 'Vence hoy', urgente: false };
  return { texto: `Venció hace ${-d} ${d === -1 ? 'día' : 'días'}`, urgente: true };
}

/** Tarjeta compacta de un pedido para las listas. p incluye `cliente` y opcionalmente `fotoId`. */
export function tarjetaPedido(p, galeria) {
  return h(
    'a',
    { class: 'tarjeta-pedido', href: `#/pedidos/ver?id=${p.id}` },
    miniatura(galeria, p.fotoId, { clase: 'mini' }),
    h(
      'span',
      { class: 'tarjeta-pedido__cuerpo' },
      h(
        'span',
        { class: 'tarjeta-pedido__fila' },
        h('span', { class: 'tarjeta-pedido__codigo numero' }, p.codigo),
        h('span', { class: 'tarjeta-pedido__total numero' }, formatearMonto(p.total)),
      ),
      h('span', { class: 'tarjeta-pedido__cliente' }, p.cliente?.nombre ?? '—'),
      h(
        'span',
        { class: 'tarjeta-pedido__fila tarjeta-pedido__meta' },
        h('span', { class: 'texto-secundario numero' }, formatearFecha(p.creadoEn)),
        h('span', { class: 'chips' }, p.grupoId ? h('span', { class: 'chip' }, 'En grupo') : null, p.estado !== 'pendiente' ? chipEstado(p.estado) : null, chipPago(p.estadoPago)),
      ),
    ),
  );
}

/** Agrega `fotoId` (foto de la primera prenda con foto) a cada pedido de la lista. */
export async function agregarFotoPrincipal(pedidos, db) {
  if (!pedidos.length) return pedidos;
  const prendas = await db.prendas.where('pedidoId').anyOf(pedidos.map((p) => p.id)).toArray();
  const porPedido = new Map();
  for (const pr of prendas.sort((a, b) => a.orden - b.orden)) {
    if (pr.fotoId && !porPedido.has(pr.pedidoId)) porPedido.set(pr.pedidoId, pr.fotoId);
  }
  return pedidos.map((p) => ({ ...p, fotoId: porPedido.get(p.id) ?? null }));
}
