// Agrupar pedidos de una misma clienta (para entregar o enviar juntos).
// Agrupar NO altera códigos, fechas, fotos, pagos ni plazos: solo pone grupoId.
// Un grupo nunca se borra: si queda vacío pasa a estado 'deshecho'.
import { obtenerBD } from '../core/db.js';
import { ahoraISO } from '../core/dates.js';
import { limpiarTexto } from '../core/validation.js';
import { registrarHistorial } from '../repositories/historial.repo.js';

async function validarPedidosParaGrupo(db, pedidoIds, { grupoId = null } = {}) {
  const ids = [...new Set(pedidoIds)];
  const pedidos = await db.pedidos.bulkGet(ids);
  if (pedidos.some((p) => !p)) return { ok: false, error: 'Algún pedido no existe.' };
  const clientes = new Set(pedidos.map((p) => p.clienteId));
  if (clientes.size !== 1) return { ok: false, error: 'Solo se pueden agrupar pedidos de la misma clienta.' };
  if (pedidos.some((p) => p.estado !== 'pendiente')) {
    return { ok: false, error: 'Solo se pueden agrupar pedidos pendientes de entrega.' };
  }
  if (pedidos.some((p) => p.grupoId !== null && p.grupoId !== grupoId)) {
    return { ok: false, error: 'Algún pedido ya está en otro grupo. Quítalo de ese grupo primero.' };
  }
  return { ok: true, pedidos, clienteId: [...clientes][0] };
}

/** Crea un grupo con 2 o más pedidos. Devuelve { ok, id }. */
export async function crearGrupo(pedidoIds, { notas = '' } = {}, db = obtenerBD()) {
  if (new Set(pedidoIds).size < 2) return { ok: false, error: 'Elige al menos 2 pedidos.' };
  return db.transaction('rw', db.pedidos, db.grupos, db.historial, async () => {
    const v = await validarPedidosParaGrupo(db, pedidoIds);
    if (!v.ok) return v;
    const fila = { clienteId: v.clienteId, creadoEn: ahoraISO(), estado: 'abierto', notas: limpiarTexto(notas) };
    const id = await db.grupos.add(fila);
    for (const p of v.pedidos) await db.pedidos.update(p.id, { grupoId: id });
    await registrarHistorial(
      { entidad: 'grupo', entidadId: id, tipo: 'grupo-creado', despues: { ...fila, pedidos: v.pedidos.map((p) => p.codigo) } },
      db,
    );
    return { ok: true, id };
  });
}

/** Agrega pedidos a un grupo abierto. */
export async function agregarAGrupo(grupoId, pedidoIds, db = obtenerBD()) {
  return db.transaction('rw', db.pedidos, db.grupos, db.historial, async () => {
    const grupo = await db.grupos.get(grupoId);
    if (!grupo || grupo.estado !== 'abierto') return { ok: false, error: 'El grupo no está abierto.' };
    const v = await validarPedidosParaGrupo(db, pedidoIds, { grupoId });
    if (!v.ok) return v;
    if (v.clienteId !== grupo.clienteId) return { ok: false, error: 'Los pedidos son de otra clienta.' };
    for (const p of v.pedidos) await db.pedidos.update(p.id, { grupoId });
    await registrarHistorial(
      { entidad: 'grupo', entidadId: grupoId, tipo: 'grupo-pedidos-agregados', despues: { pedidos: v.pedidos.map((p) => p.codigo) } },
      db,
    );
    return { ok: true };
  });
}

/** Quita un pedido de su grupo. Si el grupo queda con menos de 2, se deshace. */
export async function quitarDeGrupo(pedidoId, db = obtenerBD()) {
  return db.transaction('rw', db.pedidos, db.grupos, db.historial, async () => {
    const pedido = await db.pedidos.get(pedidoId);
    if (!pedido?.grupoId) return { ok: false, error: 'El pedido no está en un grupo.' };
    if (pedido.estado !== 'pendiente') return { ok: false, error: 'El pedido ya no está pendiente.' };
    const grupoId = pedido.grupoId;
    await db.pedidos.update(pedidoId, { grupoId: null });
    const restantes = await db.pedidos.where('grupoId').equals(grupoId).toArray();
    await registrarHistorial(
      { entidad: 'grupo', entidadId: grupoId, tipo: 'grupo-pedido-quitado', antes: { pedido: pedido.codigo } },
      db,
    );
    if (restantes.length < 2) {
      for (const p of restantes) await db.pedidos.update(p.id, { grupoId: null });
      await db.grupos.update(grupoId, { estado: 'deshecho' });
      await registrarHistorial(
        { entidad: 'grupo', entidadId: grupoId, tipo: 'grupo-deshecho', antes: { pedidos: [pedido, ...restantes].map((p) => p.codigo) } },
        db,
      );
    }
    return { ok: true };
  });
}

export async function obtenerGrupo(id, db = obtenerBD()) {
  const grupo = await db.grupos.get(id);
  if (!grupo) return null;
  const pedidos = (await db.pedidos.where('grupoId').equals(id).toArray()).sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));
  const total = pedidos.reduce((s, p) => s + p.total, 0);
  return { grupo, pedidos, total };
}
