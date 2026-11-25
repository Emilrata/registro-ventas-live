// Clientas: se identifican por su WhatsApp (único).
import { obtenerBD } from '../core/db.js';
import { ahoraISO } from '../core/dates.js';
import { limpiarTexto, normalizarNombre, normalizarWhatsapp, validarNombreCliente } from '../core/validation.js';
import { registrarHistorial } from '../repositories/historial.repo.js';

export async function codigoPaisPorDefecto(db = obtenerBD()) {
  return (await db.ajustes.get('whatsapp.codigoPais'))?.valor ?? '591';
}

/** Busca una clienta por WhatsApp (escrito de cualquier forma). null si no existe o es inválido. */
export async function buscarPorWhatsapp(texto, { codigoPais, db = obtenerBD() } = {}) {
  const w = normalizarWhatsapp(texto, codigoPais ?? (await codigoPaisPorDefecto(db)));
  if (!w.ok) return null;
  return (await db.clientes.where('whatsapp').equals(w.valor).first()) ?? null;
}

/** Crea la fila de una clienta dentro de una transacción ya abierta (incluir clientes e historial). */
export async function crearClienteEnTx(db, { nombre, whatsapp, notas = '' }) {
  const n = validarNombreCliente(nombre);
  if (!n.ok) throw Object.assign(new Error(n.error), { campo: 'nombre' });
  const fila = {
    nombre: n.valor,
    nombreNormalizado: normalizarNombre(n.valor),
    whatsapp,
    notas: limpiarTexto(notas),
    creadoEn: ahoraISO(),
  };
  const id = await db.clientes.add(fila);
  await registrarHistorial({ entidad: 'cliente', entidadId: id, tipo: 'cliente-creada', despues: fila }, db);
  return id;
}

/** Edita nombre, WhatsApp o notas. Devuelve { ok } o { ok:false, campo, error }. */
export async function editarCliente(id, { nombre, whatsapp, notas, codigoPais }, db = obtenerBD()) {
  const n = validarNombreCliente(nombre);
  if (!n.ok) return { ok: false, campo: 'nombre', error: n.error };
  const w = normalizarWhatsapp(whatsapp ?? '', codigoPais ?? (await codigoPaisPorDefecto(db)));
  if (!w.ok) return { ok: false, campo: 'whatsapp', error: w.error };
  return db.transaction('rw', db.clientes, db.historial, async () => {
    const antes = await db.clientes.get(id);
    if (!antes) return { ok: false, error: 'La clienta no existe.' };
    const otra = await db.clientes.where('whatsapp').equals(w.valor).first();
    if (otra && otra.id !== id) {
      return { ok: false, campo: 'whatsapp', error: `Ese número ya es de ${otra.nombre}.` };
    }
    const cambios = {
      nombre: n.valor,
      nombreNormalizado: normalizarNombre(n.valor),
      whatsapp: w.valor,
      notas: limpiarTexto(notas ?? antes.notas ?? ''),
    };
    await db.clientes.update(id, cambios);
    await registrarHistorial(
      { entidad: 'cliente', entidadId: id, tipo: 'cliente-editada', antes, despues: { ...antes, ...cambios } },
      db,
    );
    return { ok: true };
  });
}

/**
 * Busca clientas por nombre (todas las palabras, sin tildes) o por dígitos del WhatsApp.
 * Devuelve hasta `limite` clientas ordenadas por nombre.
 */
export async function buscarClientes(texto, { limite = 50, db = obtenerBD() } = {}) {
  const t = normalizarNombre(texto ?? '');
  const todas = await db.clientes.toArray();
  let resultado = todas;
  if (t) {
    const digitos = t.replace(/\D/g, '');
    const palabras = t.split(' ');
    resultado = todas.filter(
      (c) =>
        palabras.every((p) => c.nombreNormalizado.includes(p)) ||
        (digitos.length >= 3 && digitos.length === t.replace(/[\s+()-]/g, '').length && c.whatsapp.includes(digitos)),
    );
  }
  return resultado.sort((a, b) => a.nombreNormalizado.localeCompare(b.nombreNormalizado)).slice(0, limite);
}

/** Resumen por clienta: cantidad de pedidos y total vendido (sin cancelados). */
export async function resumenCliente(id, db = obtenerBD()) {
  const pedidos = await db.pedidos.where('clienteId').equals(id).toArray();
  const activos = pedidos.filter((p) => p.estado !== 'cancelado');
  return {
    pedidos: pedidos.length,
    total: activos.reduce((s, p) => s + p.total, 0),
    pendientes: activos.filter((p) => p.estado === 'pendiente').length,
  };
}
