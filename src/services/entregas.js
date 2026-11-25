// Entregas (recojo o envío) y cancelaciones.
// Reglas:
//  - Entregar o cancelar NUNCA borra fotos, pagos ni historial: solo cambia el estado del pedido
//    y agrega registros (entrega, historial).
//  - Recoger un pedido vencido está permitido y queda registrado (`vencido: true`).
//  - Entregar con saldo pendiente exige confirmación explícita (`aceptarSaldo`).
//  - Un error al entregar se corrige con `deshacerEntrega` (la entrega queda marcada como anulada).
//  - Envío en grupo: un solo costo por entrega del grupo, guardado en la entrega.
import { obtenerBD } from '../core/db.js';
import { diasEntre } from '../core/dates.js';
import { limpiarTexto, normalizarWhatsapp } from '../core/validation.js';
import { saldoPendiente } from '../core/calculos.js';
import { registrarHistorial } from '../repositories/historial.repo.js';

const TABLAS = (db) => [db.pedidos, db.entregas, db.grupos, db.historial, db.clientes];

const texto = (v, max, nombre) => {
  const t = limpiarTexto(v ?? '');
  if (t.length > max) throw Object.assign(new Error(`${nombre}: texto muy largo.`), { esValidacion: true });
  return t;
};

/** Limpia y valida los datos de la entrega según la modalidad. */
export function validarDatosEntrega(datos) {
  try {
    const modalidad = datos.modalidad;
    if (!['recojo', 'envio'].includes(modalidad)) return { ok: false, error: 'Elige recojo o envío.' };
    const base = {
      modalidad,
      destinatario: texto(datos.destinatario, 80, 'Quién recibe'),
      nota: texto(datos.nota, 300, 'Nota'),
      telefono: '',
      ciudad: '',
      direccion: '',
      transportista: '',
      seguimiento: '',
      costoEnvio: 0,
    };
    if (modalidad === 'envio') {
      base.ciudad = texto(datos.ciudad, 60, 'Ciudad');
      base.direccion = texto(datos.direccion, 200, 'Dirección');
      base.transportista = texto(datos.transportista, 60, 'Transportista');
      base.seguimiento = texto(datos.seguimiento, 60, 'Seguimiento');
      if (!base.destinatario) return { ok: false, campo: 'destinatario', error: 'Escribe a nombre de quién va el envío.' };
      if (!base.ciudad) return { ok: false, campo: 'ciudad', error: 'Escribe la ciudad de destino.' };
      if (datos.telefono) {
        const w = normalizarWhatsapp(datos.telefono, datos.codigoPais ?? '591');
        if (!w.ok) return { ok: false, campo: 'telefono', error: w.error };
        base.telefono = w.valor;
      }
      const costo = datos.costoEnvio ?? 0;
      if (!Number.isSafeInteger(costo) || costo < 0) return { ok: false, campo: 'costoEnvio', error: 'El costo de envío no es válido.' };
      base.costoEnvio = costo;
    }
    return { ok: true, datos: base };
  } catch (err) {
    if (err.esValidacion) return { ok: false, error: err.message };
    throw err;
  }
}

/**
 * Entrega un pedido o un grupo (todos sus pedidos pendientes).
 * datos = { pedidoId | grupoId, modalidad, destinatario, nota, ciudad, direccion, transportista,
 *           seguimiento, telefono, costoEnvio, aceptarSaldo }
 * Devuelve { ok, id } · { ok:false, requiereConfirmacion:'saldo', saldo } · { ok:false, error }.
 */
export async function registrarEntrega(datos, { ahora = new Date(), db = obtenerBD() } = {}) {
  const v = validarDatosEntrega(datos);
  if (!v.ok) return v;
  const fecha = ahora.toISOString();

  return db.transaction('rw', TABLAS(db), async () => {
    let pedidos;
    let grupo = null;
    if (datos.grupoId) {
      grupo = await db.grupos.get(datos.grupoId);
      if (!grupo) return { ok: false, error: 'El grupo no existe.' };
      pedidos = (await db.pedidos.where('grupoId').equals(grupo.id).toArray()).filter((p) => p.estado === 'pendiente');
    } else {
      const p = await db.pedidos.get(datos.pedidoId);
      if (!p) return { ok: false, error: 'El pedido no existe.' };
      if (p.estado !== 'pendiente') return { ok: false, error: p.estado === 'entregado' ? 'El pedido ya fue entregado.' : 'El pedido está cancelado.' };
      pedidos = [p];
    }
    if (!pedidos.length) return { ok: false, error: 'No hay pedidos pendientes para entregar.' };
    pedidos.sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));

    const saldo = pedidos.reduce((s, p) => s + saldoPendiente(p), 0);
    if (saldo > 0 && !datos.aceptarSaldo) return { ok: false, requiereConfirmacion: 'saldo', saldo };
    // Vencido = ya pasó el día de la fecha límite (por día local, igual que en la pantalla).
    const vencidos = pedidos.filter((p) => diasEntre(ahora, p.fechaLimite) < 0).map((p) => p.codigo);

    const entrega = {
      pedidoId: grupo ? null : pedidos[0].id,
      grupoId: grupo ? grupo.id : null,
      pedidos: pedidos.map((p) => p.id),
      ...v.datos,
      // Recojo: se entrega en el acto. Envío: se despacha ahora; la recepción se confirma después.
      fechaDespacho: v.datos.modalidad === 'envio' ? fecha : null,
      entregadoEn: v.datos.modalidad === 'recojo' ? fecha : null,
      saldoAlEntregar: saldo,
      vencido: vencidos.length > 0,
      anulada: null,
      creadoEn: fecha,
      actor: 'usuario',
    };
    const id = await db.entregas.add(entrega);
    for (const p of pedidos) {
      await db.pedidos.update(p.id, { estado: 'entregado', entregaId: id, actualizadoEn: fecha });
      await registrarHistorial(
        {
          entidad: 'pedido',
          entidadId: p.id,
          tipo: entrega.modalidad === 'envio' ? 'pedido-enviado' : 'pedido-entregado',
          antes: { estado: p.estado },
          despues: { estado: 'entregado', entregaId: id, vencido: vencidos.includes(p.codigo), saldo: saldoPendiente(p) },
        },
        db,
      );
    }
    if (grupo) {
      const quedan = (await db.pedidos.where('grupoId').equals(grupo.id).toArray()).some((p) => p.estado === 'pendiente');
      if (!quedan) await db.grupos.update(grupo.id, { estado: 'entregado' });
    }
    return { ok: true, id, vencidos };
  });
}

/** Envío: confirma que la clienta lo recibió. */
export async function confirmarRecepcion(entregaId, { ahora = new Date(), db = obtenerBD() } = {}) {
  return db.transaction('rw', TABLAS(db), async () => {
    const e = await db.entregas.get(entregaId);
    if (!e || e.anulada) return { ok: false, error: 'La entrega no existe.' };
    if (e.entregadoEn) return { ok: false, error: 'Ya estaba marcada como recibida.' };
    const fecha = ahora.toISOString();
    await db.entregas.update(entregaId, { entregadoEn: fecha });
    for (const pid of e.pedidos) {
      await registrarHistorial({ entidad: 'pedido', entidadId: pid, tipo: 'envio-recibido', despues: { entregadoEn: fecha } }, db);
    }
    return { ok: true };
  });
}

/**
 * Corrige una entrega registrada por error: los pedidos vuelven a "pendiente".
 * La entrega NO se borra: queda marcada como anulada con su motivo.
 */
export async function deshacerEntrega(entregaId, { motivo, ahora = new Date(), db = obtenerBD() } = {}) {
  const m = limpiarTexto(motivo ?? '');
  if (!m) return { ok: false, error: 'Escribe el motivo.' };
  return db.transaction('rw', TABLAS(db), async () => {
    const e = await db.entregas.get(entregaId);
    if (!e) return { ok: false, error: 'La entrega no existe.' };
    if (e.anulada) return { ok: false, error: 'Esta entrega ya fue deshecha.' };
    const pedidos = await db.pedidos.bulkGet(e.pedidos);
    if (pedidos.some((p) => !p || p.estado !== 'entregado' || p.entregaId !== entregaId)) {
      return { ok: false, error: 'Algún pedido de esta entrega cambió después; no se puede deshacer.' };
    }
    const fecha = ahora.toISOString();
    await db.entregas.update(entregaId, { anulada: { fecha, motivo: m, actor: 'usuario' } });
    for (const p of pedidos) {
      await db.pedidos.update(p.id, { estado: 'pendiente', entregaId: null, actualizadoEn: fecha });
      await registrarHistorial(
        { entidad: 'pedido', entidadId: p.id, tipo: 'entrega-deshecha', antes: { estado: 'entregado', entregaId }, despues: { estado: 'pendiente', motivo: m } },
        db,
      );
    }
    if (e.grupoId) {
      const g = await db.grupos.get(e.grupoId);
      if (g?.estado === 'entregado') await db.grupos.update(g.id, { estado: 'abierto' });
    }
    return { ok: true };
  });
}

/**
 * Cancela un pedido pendiente. No borra fotos, prendas, pagos ni historial.
 * Si la clienta ya pagó algo, ese dinero queda "a devolver" (se registra con una devolución).
 */
export async function cancelarPedido(pedidoId, { motivo, ahora = new Date(), db = obtenerBD() } = {}) {
  const m = limpiarTexto(motivo ?? '');
  if (!m) return { ok: false, error: 'Escribe el motivo de la cancelación.' };
  if (m.length > 200) return { ok: false, error: 'El motivo es muy largo.' };
  return db.transaction('rw', TABLAS(db), async () => {
    const p = await db.pedidos.get(pedidoId);
    if (!p) return { ok: false, error: 'El pedido no existe.' };
    if (p.estado !== 'pendiente') {
      return { ok: false, error: p.estado === 'cancelado' ? 'El pedido ya está cancelado.' : 'Un pedido entregado no se cancela: registra una devolución.' };
    }
    const cancelacion = { fecha: ahora.toISOString(), motivo: m, actor: 'usuario' };
    await db.pedidos.update(pedidoId, { estado: 'cancelado', cancelacion, actualizadoEn: cancelacion.fecha });
    await registrarHistorial(
      { entidad: 'pedido', entidadId: pedidoId, tipo: 'pedido-cancelado', antes: { estado: p.estado }, despues: { estado: 'cancelado', cancelacion, aDevolver: p.pagado - p.reembolsado } },
      db,
    );
    return { ok: true, aDevolver: p.pagado - p.reembolsado };
  });
}

export async function obtenerEntrega(id, db = obtenerBD()) {
  return (await db.entregas.get(id)) ?? null;
}
