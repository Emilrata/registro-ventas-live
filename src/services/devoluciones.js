// Devoluciones de dinero a la clienta. Reglas:
//  - Solo se agregan. Un error se corrige con una ANULACIÓN (registro nuevo negativo con `anulaA`).
//  - No se devuelve más de lo que la clienta pagó (pagado − ya devuelto).
//  - En un pedido NO cancelado, la devolución es una excepción y exige explicar por qué.
//  - `pedido.reembolsado` se recalcula siempre sumando la tabla `devoluciones`.
import { obtenerBD } from '../core/db.js';
import { ahoraISO } from '../core/dates.js';
import { limpiarTexto } from '../core/validation.js';
import { formatearMonto } from '../core/money.js';
import { calcularEstadoPago } from '../core/calculos.js';
import { agregarArchivo } from '../repositories/archivos.repo.js';
import { registrarHistorial } from '../repositories/historial.repo.js';
import { METODOS } from './pagos.js';

const TABLAS = (db) => [db.pedidos, db.devoluciones, db.archivos, db.historial];

async function actualizarPedido(db, pedidoId) {
  const p = await db.pedidos.get(pedidoId);
  const reembolsado = (await db.devoluciones.where('pedidoId').equals(pedidoId).toArray()).reduce((s, d) => s + d.monto, 0);
  const cambios = {
    reembolsado,
    estadoPago: calcularEstadoPago({ total: p.total, pagado: p.pagado, reembolsado }),
    actualizadoEn: ahoraISO(),
  };
  await db.pedidos.update(pedidoId, cambios);
  return { ...p, ...cambios };
}

/** Lo que se le puede devolver a la clienta (pagado − ya devuelto). */
export const disponibleParaDevolver = (p) => Math.max(0, p.pagado - p.reembolsado);

/**
 * datos = { pedidoId, monto, metodo, motivo, observaciones?, excepcion?, comprobante? }
 * `excepcion` (texto) es obligatorio si el pedido no está cancelado.
 */
export async function registrarDevolucion(datos, { ahora = new Date(), db = obtenerBD() } = {}) {
  if (!Number.isSafeInteger(datos.monto) || datos.monto <= 0) return { ok: false, error: 'El monto debe ser mayor a cero.' };
  if (!METODOS.includes(datos.metodo)) return { ok: false, error: 'Elige efectivo o QR.' };
  const motivo = limpiarTexto(datos.motivo ?? '');
  if (!motivo) return { ok: false, campo: 'motivo', error: 'Escribe el motivo de la devolución.' };
  const observaciones = limpiarTexto(datos.observaciones ?? '');
  const excepcion = limpiarTexto(datos.excepcion ?? '');
  if (motivo.length > 200 || observaciones.length > 300 || excepcion.length > 200) return { ok: false, error: 'Algún texto es muy largo.' };

  return db.transaction('rw', TABLAS(db), async () => {
    const p = await db.pedidos.get(datos.pedidoId);
    if (!p) return { ok: false, error: 'El pedido no existe.' };
    if (p.estado !== 'cancelado' && !excepcion) {
      return { ok: false, campo: 'excepcion', error: 'El pedido no está cancelado: explica por qué se devuelve dinero (excepción).' };
    }
    const disponible = disponibleParaDevolver(p);
    if (disponible === 0) return { ok: false, error: 'La clienta no tiene dinero pagado para devolver.' };
    if (datos.monto > disponible) return { ok: false, error: `No se puede devolver más de lo pagado (${formatearMonto(disponible)}).` };

    const fila = {
      pedidoId: p.id,
      monto: datos.monto,
      metodo: datos.metodo,
      fechaHora: ahora.toISOString(),
      motivo,
      observaciones,
      excepcion: p.estado === 'cancelado' ? null : excepcion,
      comprobanteId: null,
      anulaA: null,
      actor: 'usuario',
    };
    const id = await db.devoluciones.add(fila);
    if (datos.comprobante) {
      fila.comprobanteId = await agregarArchivo(
        {
          tipo: 'comprobante', blob: datos.comprobante.blob, ancho: datos.comprobante.ancho ?? null, alto: datos.comprobante.alto ?? null,
          miniatura: datos.comprobante.miniatura ?? null, sha256: datos.comprobante.sha256, refTipo: 'devolucion', refId: id,
        },
        db,
      );
      await db.devoluciones.update(id, { comprobanteId: fila.comprobanteId });
    }
    const despues = await actualizarPedido(db, p.id);
    await registrarHistorial(
      {
        entidad: 'pedido', entidadId: p.id, tipo: 'devolucion-registrada',
        antes: { reembolsado: p.reembolsado, estadoPago: p.estadoPago },
        despues: { devolucion: { ...fila, id }, reembolsado: despues.reembolsado, estadoPago: despues.estadoPago },
      },
      db,
    );
    return { ok: true, id };
  });
}

/** Anula una devolución registrada por error (registro nuevo negativo). */
export async function anularDevolucion(devolucionId, { motivo, ahora = new Date(), db = obtenerBD() } = {}) {
  const m = limpiarTexto(motivo ?? '');
  if (!m) return { ok: false, error: 'Escribe el motivo de la anulación.' };
  return db.transaction('rw', TABLAS(db), async () => {
    const d = await db.devoluciones.get(devolucionId);
    if (!d) return { ok: false, error: 'La devolución no existe.' };
    if (d.anulaA) return { ok: false, error: 'Una anulación no se puede anular.' };
    const ya = await db.devoluciones.where('pedidoId').equals(d.pedidoId).filter((x) => x.anulaA === d.id).count();
    if (ya) return { ok: false, error: 'Esta devolución ya fue anulada.' };
    const fila = {
      pedidoId: d.pedidoId, monto: -d.monto, metodo: d.metodo, fechaHora: ahora.toISOString(), motivo: m,
      observaciones: '', excepcion: null, comprobanteId: null, anulaA: d.id, actor: 'usuario',
    };
    const p = await db.pedidos.get(d.pedidoId);
    const id = await db.devoluciones.add(fila);
    const despues = await actualizarPedido(db, d.pedidoId);
    await registrarHistorial(
      {
        entidad: 'pedido', entidadId: d.pedidoId, tipo: 'devolucion-anulada',
        antes: { devolucion: d, reembolsado: p.reembolsado }, despues: { anulacion: { ...fila, id }, reembolsado: despues.reembolsado },
      },
      db,
    );
    return { ok: true, id };
  });
}

export async function devolucionesDePedido(pedidoId, db = obtenerBD()) {
  const lista = (await db.devoluciones.where('pedidoId').equals(pedidoId).toArray()).sort((a, b) => a.fechaHora.localeCompare(b.fechaHora) || a.id - b.id);
  const anuladas = new Set(lista.filter((d) => d.anulaA).map((d) => d.anulaA));
  return lista.map((d) => ({ ...d, anulada: anuladas.has(d.id) }));
}
