// Avisos a clientas: pedidos para recoger que ya están pagados (o pendientes) y todavía no se recogieron.
// La app le recuerda a la DUEÑA a quién escribir; nunca envía nada sola.
//
// Reglas:
// - Solo pedidos pendientes con modalidad «recojo».
// - Sin ningún aviso registrado → «Avisar que está listo».
// - Con aviso → se vuelve a recordar cuando pasaron `avisos.diasRecordatorio` días (7 por defecto)
//   desde el último aviso.
// - Cada aviso queda en el historial (tipo 'aviso-clienta'); nada se borra.
import { obtenerBD } from '../core/db.js';
import { diasEntre, sumarDias } from '../core/dates.js';
import { saldoPendiente } from '../core/calculos.js';
import { registrarHistorial } from '../repositories/historial.repo.js';

export const DIAS_RECORDATORIO_POR_DEFECTO = 7;
export const OPCIONES_DIAS_RECORDATORIO = [3, 5, 7, 10, 15];
const TIPO_HISTORIAL = 'aviso-clienta';

export async function diasRecordatorio(db = obtenerBD()) {
  const v = (await db.ajustes.get('avisos.diasRecordatorio'))?.valor;
  return Number.isInteger(v) && v > 0 ? v : DIAS_RECORDATORIO_POR_DEFECTO;
}

export async function cambiarDiasRecordatorio(dias, db = obtenerBD()) {
  if (!OPCIONES_DIAS_RECORDATORIO.includes(dias)) throw new RangeError('Días no válidos');
  await db.transaction('rw', db.ajustes, db.historial, async () => {
    const antes = (await db.ajustes.get('avisos.diasRecordatorio'))?.valor ?? DIAS_RECORDATORIO_POR_DEFECTO;
    await db.ajustes.put({ clave: 'avisos.diasRecordatorio', valor: dias, actualizadoEn: new Date().toISOString() });
    await registrarHistorial({ entidad: 'ajustes', tipo: 'dias-recordatorio', antes, despues: dias }, db);
  });
}

/** Último aviso por pedido: Map(pedidoId → { fechaHora, veces }). */
async function avisosRegistrados(db) {
  const filas = await db.historial.where('tipo').equals(TIPO_HISTORIAL).toArray();
  const mapa = new Map();
  for (const f of filas) {
    const previo = mapa.get(f.entidadId);
    if (!previo) mapa.set(f.entidadId, { fechaHora: f.fechaHora, veces: 1 });
    else {
      previo.veces += 1;
      if (f.fechaHora > previo.fechaHora) previo.fechaHora = f.fechaHora;
    }
  }
  return mapa;
}

/**
 * Situación de un pedido para avisar. Función pura.
 * Devuelve { toca, tipo: 'listo' | 'recordatorio', desde (ISO en que tocó / tocará), diasReservado, ultimoAviso, veces }.
 */
export function clasificarAviso(pedido, aviso, { ahora = new Date(), dias = DIAS_RECORDATORIO_POR_DEFECTO } = {}) {
  const diasReservado = diasEntre(pedido.creadoEn, ahora);
  if (!aviso) return { toca: true, tipo: 'listo', desde: pedido.creadoEn, diasReservado, ultimoAviso: null, veces: 0 };
  const desde = sumarDias(aviso.fechaHora, dias);
  return {
    toca: diasEntre(aviso.fechaHora, ahora) >= dias,
    tipo: 'recordatorio',
    desde,
    diasReservado,
    ultimoAviso: aviso.fechaHora,
    veces: aviso.veces,
  };
}

/**
 * Clientas a las que hay que escribir hoy, agrupadas (un mensaje por clienta con todos sus pedidos por recoger).
 * También devuelve `agenda`: momentos (ms) en que vence cada aviso, para que el Service Worker pueda contar
 * sin leer nombres ni montos.
 */
export async function clientasPorAvisar({ ahora = new Date(), db = obtenerBD() } = {}) {
  const dias = await diasRecordatorio(db);
  const pendientes = (await db.pedidos.where('estado').equals('pendiente').toArray()).filter((p) => p.modalidad !== 'envio');
  const avisos = await avisosRegistrados(db);
  const clasificados = pendientes.map((p) => ({ ...p, aviso: clasificarAviso(p, avisos.get(p.id), { ahora, dias }) }));

  const porClienta = new Map();
  for (const p of clasificados) {
    if (!porClienta.has(p.clienteId)) porClienta.set(p.clienteId, []);
    porClienta.get(p.clienteId).push(p);
  }
  const clientes = await db.clientes.bulkGet([...porClienta.keys()]);
  const grupos = [];
  for (const cliente of clientes) {
    if (!cliente) continue;
    const pedidos = porClienta.get(cliente.id).sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));
    const tocan = pedidos.filter((p) => p.aviso.toca);
    if (!tocan.length) continue;
    // Si algún pedido todavía no tuvo aviso, el mensaje es «está listo» (incluye todos los pendientes),
    // salvo que alguno ya esté vencido: entonces se recuerda el vencimiento (nunca «puedes recoger hasta» una fecha pasada).
    const vencido = pedidos.some((p) => p.fechaLimite && diasEntre(ahora, p.fechaLimite) < 0);
    const tipo = !vencido && tocan.some((p) => p.aviso.tipo === 'listo') ? 'listo' : 'recordatorio';
    const ultimos = pedidos.map((p) => p.aviso.ultimoAviso).filter(Boolean).sort();
    grupos.push({
      cliente,
      pedidos,
      tipo,
      diasReservado: Math.max(...pedidos.map((p) => p.aviso.diasReservado)),
      ultimoAviso: ultimos.at(-1) ?? null,
      saldo: pedidos.reduce((s, p) => s + saldoPendiente(p), 0),
    });
  }
  // Primero las que esperan hace más tiempo.
  grupos.sort((a, b) => b.diasReservado - a.diasReservado);
  const agenda = clasificados.map((p) => new Date(p.aviso.desde).getTime()).sort((a, b) => a - b);
  return { grupos, agenda, dias };
}

/**
 * Registra que se avisó a la clienta (al abrir WhatsApp con el mensaje o al marcar «Ya le avisé»).
 * Un registro de historial por pedido.
 */
export async function registrarAviso({ pedidoIds, tipo, medio = 'whatsapp', ahora = new Date(), db = obtenerBD() }) {
  if (!pedidoIds?.length) throw new TypeError('Faltan los pedidos');
  await db.transaction('rw', db.pedidos, db.historial, async () => {
    for (const id of pedidoIds) {
      const p = await db.pedidos.get(id);
      if (!p) throw new Error('Pedido no encontrado');
      await registrarHistorial(
        { entidad: 'pedido', entidadId: id, tipo: TIPO_HISTORIAL, despues: { mensaje: tipo, medio, codigo: p.codigo }, fechaHora: ahora.toISOString() },
        db,
      );
    }
  });
}
