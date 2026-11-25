// Pagos (cobros). Reglas:
//  - Los pagos SOLO se agregan. Un error se corrige con una ANULACIÓN: un registro nuevo con
//    monto negativo y `anulaA` = id del pago anulado. Nunca se edita ni se borra un pago.
//  - Pago de más: bloqueado (el monto no puede superar el saldo).
//  - `pedido.pagado` se recalcula SIEMPRE sumando la tabla `pagos` (fuente de verdad).
//  - Pago de un grupo: se reparte del pedido más antiguo al más nuevo, un registro por pedido.
//  - Todo va en una sola transacción, con historial.
import { obtenerBD } from '../core/db.js';
import { ahoraISO } from '../core/dates.js';
import { limpiarTexto } from '../core/validation.js';
import { formatearMonto } from '../core/money.js';
import { calcularEstadoPago, saldoPendiente } from '../core/calculos.js';
import { agregarArchivo } from '../repositories/archivos.repo.js';
import { registrarHistorial } from '../repositories/historial.repo.js';
import { exigePagoCompleto } from './politicas.js';

export const METODOS = ['efectivo', 'qr'];
export const TEXTO_METODO = { efectivo: 'Efectivo', qr: 'QR' };

const TABLAS_PAGO = (db) => [db.pedidos, db.pagos, db.archivos, db.historial, db.grupos, db.ajustes];

/** Recalcula pagado y estadoPago del pedido a partir de sus pagos. Dentro de una transacción. */
async function actualizarPedidoDesdePagos(db, pedidoId) {
  const pedido = await db.pedidos.get(pedidoId);
  const pagos = await db.pagos.where('pedidoId').equals(pedidoId).toArray();
  const pagado = pagos.reduce((s, p) => s + p.monto, 0);
  const cambios = {
    pagado,
    estadoPago: calcularEstadoPago({ total: pedido.total, pagado, reembolsado: pedido.reembolsado }),
    actualizadoEn: ahoraISO(),
  };
  await db.pedidos.update(pedidoId, cambios);
  return { ...pedido, ...cambios };
}

async function guardarComprobante(db, comprobante, refTipo, refId) {
  if (!comprobante) return null;
  return agregarArchivo(
    {
      tipo: 'comprobante',
      blob: comprobante.blob,
      ancho: comprobante.ancho ?? null,
      alto: comprobante.alto ?? null,
      miniatura: comprobante.miniatura ?? null,
      sha256: comprobante.sha256,
      refTipo,
      refId,
    },
    db,
  );
}

function validarEntrada({ monto, metodo, nota = '' }) {
  if (!Number.isSafeInteger(monto) || monto <= 0) return { ok: false, error: 'El monto debe ser mayor a cero.' };
  if (!METODOS.includes(metodo)) return { ok: false, error: 'Elige efectivo o QR.' };
  const n = limpiarTexto(nota);
  if (n.length > 200) return { ok: false, error: 'La nota es muy larga.' };
  return { ok: true, nota: n };
}

/**
 * Registra un pago de un pedido.
 * datos = { pedidoId, monto (centavos), metodo, nota?, comprobante? = { blob, ancho, alto, miniatura, sha256 } }
 * Devuelve { ok, id } o { ok:false, error }.
 */
export async function registrarPago(datos, { ahora = new Date(), db = obtenerBD() } = {}) {
  const v = validarEntrada(datos);
  if (!v.ok) return v;
  return db.transaction('rw', TABLAS_PAGO(db), async () => {
    const pedido = await db.pedidos.get(datos.pedidoId);
    if (!pedido) return { ok: false, error: 'El pedido no existe.' };
    if (pedido.estado === 'cancelado') return { ok: false, error: 'El pedido está cancelado: no se le pueden registrar pagos.' };
    const saldo = saldoPendiente(pedido);
    if (saldo === 0) return { ok: false, error: 'Este pedido ya está pagado.' };
    if (datos.monto > saldo) return { ok: false, error: `El monto supera el saldo pendiente (${formatearMonto(saldo)}). No se puede pagar de más.` };
    if (datos.monto !== saldo && (await exigePagoCompleto(db))) {
      return { ok: false, error: `Se paga el total: ${formatearMonto(saldo)}. No se aceptan adelantos.` };
    }

    const fila = {
      pedidoId: pedido.id,
      monto: datos.monto,
      metodo: datos.metodo,
      fechaHora: ahora.toISOString(),
      comprobanteId: null,
      anulaA: null,
      nota: v.nota,
      grupoId: null,
      actor: 'usuario',
    };
    const id = await db.pagos.add(fila);
    if (datos.comprobante) {
      fila.comprobanteId = await guardarComprobante(db, datos.comprobante, 'pago', id);
      await db.pagos.update(id, { comprobanteId: fila.comprobanteId });
    }
    const despues = await actualizarPedidoDesdePagos(db, pedido.id);
    await registrarHistorial(
      {
        entidad: 'pedido',
        entidadId: pedido.id,
        tipo: 'pago-registrado',
        antes: { pagado: pedido.pagado, estadoPago: pedido.estadoPago },
        despues: { pago: { ...fila, id }, pagado: despues.pagado, estadoPago: despues.estadoPago },
      },
      db,
    );
    return { ok: true, id };
  });
}

/**
 * Anula un pago: agrega un registro con monto negativo que apunta al original.
 * El pago original no se modifica. Un pago se anula una sola vez; una anulación no se anula.
 */
export async function anularPago(pagoId, { motivo, ahora = new Date(), db = obtenerBD() } = {}) {
  const m = limpiarTexto(motivo ?? '');
  if (!m) return { ok: false, error: 'Escribe el motivo de la anulación.' };
  if (m.length > 200) return { ok: false, error: 'El motivo es muy largo.' };
  return db.transaction('rw', TABLAS_PAGO(db), async () => {
    const original = await db.pagos.get(pagoId);
    if (!original) return { ok: false, error: 'El pago no existe.' };
    if (original.anulaA !== null) return { ok: false, error: 'Una anulación no se puede anular. Registra un pago nuevo.' };
    if (await db.pagos.where('anulaA').equals(pagoId).count()) return { ok: false, error: 'Este pago ya fue anulado.' };
    const pedido = await db.pedidos.get(original.pedidoId);
    if (pedido.pagado - original.monto < pedido.reembolsado) {
      return { ok: false, error: 'No se puede anular: el pedido tiene devoluciones que dependen de este pago.' };
    }
    const fila = {
      pedidoId: original.pedidoId,
      monto: -original.monto,
      metodo: original.metodo,
      fechaHora: ahora.toISOString(),
      comprobanteId: null,
      anulaA: original.id,
      nota: m,
      grupoId: original.grupoId ?? null,
      actor: 'usuario',
    };
    const id = await db.pagos.add(fila);
    const despues = await actualizarPedidoDesdePagos(db, original.pedidoId);
    await registrarHistorial(
      {
        entidad: 'pedido',
        entidadId: original.pedidoId,
        tipo: 'pago-anulado',
        antes: { pago: original, pagado: pedido.pagado, estadoPago: pedido.estadoPago },
        despues: { anulacion: { ...fila, id }, pagado: despues.pagado, estadoPago: despues.estadoPago },
      },
      db,
    );
    return { ok: true, id };
  });
}

/**
 * Pago de un grupo: se reparte del pedido más antiguo al más nuevo (un registro por pedido).
 * El comprobante se guarda una vez y todos los registros apuntan a él.
 * Devuelve { ok, ids, reparto: [{ pedidoId, codigo, monto }] }.
 */
export async function pagarGrupo(datos, { ahora = new Date(), db = obtenerBD() } = {}) {
  const v = validarEntrada(datos);
  if (!v.ok) return v;
  return db.transaction('rw', TABLAS_PAGO(db), async () => {
    const grupo = await db.grupos.get(datos.grupoId);
    if (!grupo) return { ok: false, error: 'El grupo no existe.' };
    const pedidos = (await db.pedidos.where('grupoId').equals(grupo.id).toArray())
      .filter((p) => p.estado !== 'cancelado')
      .sort((a, b) => a.creadoEn.localeCompare(b.creadoEn) || a.seq - b.seq);
    const saldoTotal = pedidos.reduce((s, p) => s + saldoPendiente(p), 0);
    if (saldoTotal === 0) return { ok: false, error: 'El grupo ya está pagado.' };
    if (datos.monto > saldoTotal) return { ok: false, error: `El monto supera el saldo del grupo (${formatearMonto(saldoTotal)}). No se puede pagar de más.` };
    if (datos.monto !== saldoTotal && (await exigePagoCompleto(db))) {
      return { ok: false, error: `Se paga el total del grupo: ${formatearMonto(saldoTotal)}. No se aceptan adelantos.` };
    }

    const comprobanteId = await guardarComprobante(db, datos.comprobante, 'grupo', grupo.id);
    let resto = datos.monto;
    const reparto = [];
    const ids = [];
    for (const p of pedidos) {
      if (resto === 0) break;
      const parte = Math.min(resto, saldoPendiente(p));
      if (parte === 0) continue;
      resto -= parte;
      const fila = {
        pedidoId: p.id,
        monto: parte,
        metodo: datos.metodo,
        fechaHora: ahora.toISOString(),
        comprobanteId,
        anulaA: null,
        nota: v.nota,
        grupoId: grupo.id,
        actor: 'usuario',
      };
      const id = await db.pagos.add(fila);
      ids.push(id);
      reparto.push({ pedidoId: p.id, codigo: p.codigo, monto: parte });
      const despues = await actualizarPedidoDesdePagos(db, p.id);
      await registrarHistorial(
        {
          entidad: 'pedido',
          entidadId: p.id,
          tipo: 'pago-registrado',
          antes: { pagado: p.pagado, estadoPago: p.estadoPago },
          despues: { pago: { ...fila, id }, pagado: despues.pagado, estadoPago: despues.estadoPago },
        },
        db,
      );
    }
    await registrarHistorial(
      { entidad: 'grupo', entidadId: grupo.id, tipo: 'grupo-pagado', despues: { monto: datos.monto, metodo: datos.metodo, reparto } },
      db,
    );
    return { ok: true, ids, reparto };
  });
}

// ---------------------------------------------------------------------------
// Consultas

/** Pagos de un pedido (más antiguos primero), marcando cuáles fueron anulados. */
export async function pagosDePedido(pedidoId, db = obtenerBD()) {
  const pagos = (await db.pagos.where('pedidoId').equals(pedidoId).toArray()).sort((a, b) => a.fechaHora.localeCompare(b.fechaHora) || a.id - b.id);
  const anulados = new Set(pagos.filter((p) => p.anulaA !== null).map((p) => p.anulaA));
  return pagos.map((p) => ({ ...p, anulado: anulados.has(p.id) }));
}

/**
 * Cobros entre dos fechas ISO [desde, hasta). Incluye anulaciones (negativas) en la fecha en que se hicieron.
 * Devuelve { pagos (con pedido), total, porMetodo: { efectivo, qr }, cantidad }.
 */
export async function cobrosEntre(desde, hasta, db = obtenerBD()) {
  const pagos = (await db.pagos.where('fechaHora').between(desde, hasta, true, false).toArray()).sort(
    (a, b) => b.fechaHora.localeCompare(a.fechaHora) || b.id - a.id,
  );
  const pedidos = await db.pedidos.bulkGet([...new Set(pagos.map((p) => p.pedidoId))]);
  const porPedido = new Map(pedidos.filter(Boolean).map((p) => [p.id, p]));
  const clientes = await db.clientes.bulkGet([...new Set(pedidos.filter(Boolean).map((p) => p.clienteId))]);
  const porCliente = new Map(clientes.filter(Boolean).map((c) => [c.id, c]));
  const porMetodo = { efectivo: 0, qr: 0 };
  for (const p of pagos) porMetodo[p.metodo] += p.monto;
  return {
    pagos: pagos.map((p) => {
      const pedido = porPedido.get(p.pedidoId);
      return { ...p, pedido, cliente: pedido ? porCliente.get(pedido.clienteId) : null };
    }),
    total: porMetodo.efectivo + porMetodo.qr,
    porMetodo,
    cantidad: pagos.filter((p) => p.anulaA === null).length,
  };
}

/** Pedidos con saldo pendiente (no cancelados), los más antiguos primero. */
export async function pedidosPorCobrar(db = obtenerBD()) {
  const pedidos = await db.pedidos.where('estadoPago').anyOf('sin-pago', 'parcial').toArray();
  const conSaldo = pedidos.filter((p) => p.estado !== 'cancelado' && saldoPendiente(p) > 0).sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));
  const clientes = await db.clientes.bulkGet([...new Set(conSaldo.map((p) => p.clienteId))]);
  const porCliente = new Map(clientes.filter(Boolean).map((c) => [c.id, c]));
  const lista = conSaldo.map((p) => ({ ...p, cliente: porCliente.get(p.clienteId) ?? null, saldo: saldoPendiente(p) }));
  return { pedidos: lista, total: lista.reduce((s, p) => s + p.saldo, 0) };
}
