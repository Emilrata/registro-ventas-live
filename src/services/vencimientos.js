// Vencimientos: calculados por la fecha límite (30 días por defecto; avisos los días 25 y 28).
import { obtenerBD } from '../core/db.js';
import { diasEntre } from '../core/dates.js';
import { saldoPendiente } from '../core/calculos.js';

/**
 * Clasifica un pedido pendiente.
 * 'vencido' (pasó la fecha límite) · 'aviso' (alcanzó un día de aviso) · 'ok'.
 * diasAviso = días desde la creación, por ejemplo [25, 28].
 */
export function clasificarVencimiento(pedido, { ahora = new Date(), diasAviso = [25, 28] } = {}) {
  if (pedido.estado !== 'pendiente') return { estado: 'no-aplica' };
  const restantes = diasEntre(ahora, pedido.fechaLimite);
  const transcurridos = diasEntre(pedido.creadoEn, ahora);
  if (restantes < 0) return { estado: 'vencido', restantes, transcurridos };
  const primerAviso = Math.min(...diasAviso);
  if (transcurridos >= primerAviso) return { estado: 'aviso', restantes, transcurridos };
  return { estado: 'ok', restantes, transcurridos };
}

/** Pedidos pendientes vencidos y por vencer (con clienta), los más urgentes primero. */
export async function pedidosPorVencer({ ahora = new Date(), db = obtenerBD() } = {}) {
  const diasAviso = (await db.ajustes.get('pedidos.diasAviso'))?.valor ?? [25, 28];
  const pendientes = await db.pedidos.where('estado').equals('pendiente').toArray();
  const lista = pendientes
    .map((p) => ({ ...p, venc: clasificarVencimiento(p, { ahora, diasAviso }) }))
    .filter((p) => p.venc.estado === 'vencido' || p.venc.estado === 'aviso')
    .sort((a, b) => a.venc.restantes - b.venc.restantes);
  const clientes = await db.clientes.bulkGet([...new Set(lista.map((p) => p.clienteId))]);
  const porId = new Map(clientes.filter(Boolean).map((c) => [c.id, c]));
  const conCliente = lista.map((p) => ({ ...p, cliente: porId.get(p.clienteId) ?? null, saldo: saldoPendiente(p) }));
  return {
    vencidos: conCliente.filter((p) => p.venc.estado === 'vencido'),
    porVencer: conCliente.filter((p) => p.venc.estado === 'aviso'),
  };
}
