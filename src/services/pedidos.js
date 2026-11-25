// Pedidos: creación, edición, consulta y búsqueda.
// Reglas:
//  - El código LIVE-00001 se genera DENTRO de la transacción del pedido; continuo y sin reinicio.
//  - Totales recalculados y guardados en el pedido en cada cambio.
//  - Las fotos nunca se borran (al quitar una prenda, su foto queda en `archivos`).
//  - Todo cambio va al historial.
import { obtenerBD } from '../core/db.js';
import { ahoraISO, calcularFechaLimite } from '../core/dates.js';
import { limpiarTexto, normalizarNombre, normalizarWhatsapp } from '../core/validation.js';
import {
  MODALIDADES,
  calcularEstadoPago,
  calcularTotales,
  formatearCodigo,
  leerCodigo,
  subtotalPrenda,
} from '../core/calculos.js';
import { agregarArchivo } from '../repositories/archivos.repo.js';
import { registrarHistorial } from '../repositories/historial.repo.js';
import { codigoPaisPorDefecto, crearClienteEnTx } from './clientes.js';

const CLAVE_SEQ = 'codigos.ultimoSeq';

// ---------------------------------------------------------------------------
// Validación

/** Limpia y valida una prenda. Devuelve { ok, prenda } o { ok:false, error }. */
export function validarPrenda(p, indice = 0) {
  const n = indice + 1;
  const descripcion = limpiarTexto(p.descripcion ?? '');
  const talla = limpiarTexto(p.talla ?? '');
  const color = limpiarTexto(p.color ?? '');
  const extra = limpiarTexto(p.extra ?? '');
  const tieneFoto = Boolean(p.foto || p.fotoId);
  if (!descripcion && !tieneFoto) return { ok: false, error: `Prenda ${n}: agrega una foto o una descripción.` };
  if (descripcion.length > 120) return { ok: false, error: `Prenda ${n}: la descripción es muy larga.` };
  if ([talla, color, extra].some((t) => t.length > 40)) return { ok: false, error: `Prenda ${n}: texto muy largo.` };
  if (!Number.isSafeInteger(p.precio) || p.precio < 0) return { ok: false, error: `Prenda ${n}: el precio no es válido.` };
  if (!Number.isInteger(p.cantidad) || p.cantidad < 1 || p.cantidad > 999) {
    return { ok: false, error: `Prenda ${n}: la cantidad debe ser de 1 a 999.` };
  }
  return {
    ok: true,
    prenda: {
      id: p.id ?? null,
      descripcion,
      talla,
      color,
      extra,
      precio: p.precio,
      cantidad: p.cantidad,
      subtotal: subtotalPrenda(p),
      fotoId: p.fotoId ?? null,
      foto: p.foto ?? null,
    },
  };
}

function validarCabecera({ modalidad = 'recojo', envio = 0, observaciones = '' }) {
  if (!MODALIDADES.includes(modalidad)) return { ok: false, error: 'Modalidad no válida.' };
  if (!Number.isSafeInteger(envio) || envio < 0) return { ok: false, error: 'El costo de envío no es válido.' };
  const obs = limpiarTexto(observaciones);
  if (obs.length > 500) return { ok: false, error: 'Las observaciones son muy largas.' };
  return { ok: true, modalidad, envio: modalidad === 'envio' ? envio : 0, observaciones: obs };
}

function validarPrendas(prendas) {
  if (!Array.isArray(prendas) || prendas.length === 0) return { ok: false, error: 'Agrega al menos una prenda.' };
  if (prendas.length > 100) return { ok: false, error: 'Máximo 100 prendas por pedido.' };
  const limpias = [];
  for (let i = 0; i < prendas.length; i += 1) {
    const v = validarPrenda(prendas[i], i);
    if (!v.ok) return v;
    limpias.push(v.prenda);
  }
  return { ok: true, prendas: limpias };
}

const sinFoto = ({ foto, ...resto }) => resto;

async function guardarFotoEnTx(db, foto, prendaId) {
  return agregarArchivo(
    {
      tipo: 'foto',
      blob: foto.blob,
      ancho: foto.ancho,
      alto: foto.alto,
      miniatura: foto.miniatura ?? null,
      sha256: foto.sha256,
      refTipo: 'prenda',
      refId: prendaId,
    },
    db,
  );
}

// ---------------------------------------------------------------------------
// Crear

/**
 * Aviso (sin bloqueo): la misma clienta tiene un pedido con el mismo total en los últimos minutos.
 * Devuelve los pedidos parecidos (vacío si no hay).
 */
export async function posiblesDuplicados({ whatsapp, clienteId, total, ahora = new Date(), db = obtenerBD() }) {
  let id = clienteId;
  if (!id && whatsapp) {
    const w = normalizarWhatsapp(whatsapp, await codigoPaisPorDefecto(db));
    if (!w.ok) return [];
    id = (await db.clientes.where('whatsapp').equals(w.valor).first())?.id;
  }
  if (!id) return [];
  const minutos = (await db.ajustes.get('pedidos.minutosDuplicado'))?.valor ?? 10;
  const desde = new Date(ahora.getTime() - minutos * 60000).toISOString();
  const recientes = await db.pedidos.where('[clienteId+creadoEn]').between([id, desde], [id, '￿']).toArray();
  return recientes.filter((p) => p.total === total && p.estado !== 'cancelado');
}

/**
 * Crea un pedido (y la clienta si es nueva).
 * datos = { whatsapp, nombre, codigoPais?, transmisionId, modalidad, envio, observaciones, prendas }
 * Las prendas con foto nueva traen foto = { blob, ancho, alto, miniatura, sha256 } (ya procesada).
 * Devuelve { ok, id, codigo, clienteId } o { ok:false, campo?, error }.
 */
export async function crearPedido(datos, { ahora = new Date(), db = obtenerBD() } = {}) {
  const w = normalizarWhatsapp(datos.whatsapp ?? '', datos.codigoPais ?? (await codigoPaisPorDefecto(db)));
  if (!w.ok) return { ok: false, campo: 'whatsapp', error: w.error };
  const cab = validarCabecera(datos);
  if (!cab.ok) return cab;
  const vp = validarPrendas(datos.prendas);
  if (!vp.ok) return { ...vp, campo: 'prendas' };
  const { totalPrendas, total } = calcularTotales(vp.prendas, cab.envio);
  const plazo = (await db.ajustes.get('pedidos.plazoDias'))?.valor ?? 30;
  const creadoEn = ahora.toISOString();

  try {
    return await db.transaction(
      'rw',
      [db.pedidos, db.prendas, db.archivos, db.clientes, db.ajustes, db.historial, db.transmisiones],
      async () => {
        let cliente = await db.clientes.where('whatsapp').equals(w.valor).first();
        const clienteId = cliente
          ? cliente.id
          : await crearClienteEnTx(db, { nombre: datos.nombre, whatsapp: w.valor });

        const transmisionId = datos.transmisionId ?? null;
        if (transmisionId !== null && !(await db.transmisiones.get(transmisionId))) {
          throw Object.assign(new Error('La transmisión no existe.'), { campo: 'transmision' });
        }

        // Código: siguiente al mayor entre el contador y el último usado (nunca se repite).
        const contador = (await db.ajustes.get(CLAVE_SEQ))?.valor ?? 0;
        const ultimo = (await db.pedidos.orderBy('seq').last())?.seq ?? 0;
        const seq = Math.max(contador, ultimo) + 1;
        const codigo = formatearCodigo(seq);
        await db.ajustes.put({ clave: CLAVE_SEQ, valor: seq, actualizadoEn: creadoEn });

        const pedido = {
          codigo,
          seq,
          clienteId,
          transmisionId,
          creadoEn,
          fechaLimite: calcularFechaLimite(creadoEn, plazo),
          estado: 'pendiente',
          modalidad: cab.modalidad,
          totalPrendas,
          envio: cab.envio,
          total,
          pagado: 0,
          reembolsado: 0,
          estadoPago: calcularEstadoPago({ total, pagado: 0, reembolsado: 0 }),
          grupoId: null,
          observaciones: cab.observaciones,
          cancelacion: null,
          actualizadoEn: creadoEn,
        };
        const id = await db.pedidos.add(pedido);

        const guardadas = [];
        for (let i = 0; i < vp.prendas.length; i += 1) {
          const p = vp.prendas[i];
          const fila = { ...sinFoto(p), id: undefined, pedidoId: id, orden: i + 1, fotoId: null };
          delete fila.id;
          const prendaId = await db.prendas.add(fila);
          if (p.foto) {
            fila.fotoId = await guardarFotoEnTx(db, p.foto, prendaId);
            await db.prendas.update(prendaId, { fotoId: fila.fotoId });
          }
          guardadas.push({ ...fila, id: prendaId });
        }

        await registrarHistorial(
          { entidad: 'pedido', entidadId: id, tipo: 'pedido-creado', despues: { ...pedido, id, prendas: guardadas } },
          db,
        );
        return { ok: true, id, codigo, clienteId };
      },
    );
  } catch (err) {
    if (err?.campo) return { ok: false, campo: err.campo, error: err.message };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Editar

/**
 * Edita un pedido pendiente. prendas = lista completa final (las existentes con su id).
 * Las prendas que ya no están se quitan del pedido (quedan en el historial; su foto no se borra).
 * No cambia código, fecha de creación, fecha límite, pagos ni grupo.
 */
export async function editarPedido(id, datos, { db = obtenerBD() } = {}) {
  const cab = validarCabecera(datos);
  if (!cab.ok) return cab;
  const vp = validarPrendas(datos.prendas);
  if (!vp.ok) return { ...vp, campo: 'prendas' };
  const { totalPrendas, total } = calcularTotales(vp.prendas, cab.envio);

  return db.transaction('rw', [db.pedidos, db.prendas, db.archivos, db.historial, db.transmisiones], async () => {
    const antes = await db.pedidos.get(id);
    if (!antes) return { ok: false, error: 'El pedido no existe.' };
    if (antes.estado !== 'pendiente') return { ok: false, error: 'Solo se pueden editar pedidos pendientes.' };
    const netoPagado = antes.pagado - antes.reembolsado;
    if (total < netoPagado) {
      return { ok: false, error: 'El nuevo total sería menor a lo ya pagado. Primero corrige los pagos.' };
    }
    const transmisionId = datos.transmisionId === undefined ? antes.transmisionId : datos.transmisionId;
    if (transmisionId !== null && !(await db.transmisiones.get(transmisionId))) {
      return { ok: false, error: 'La transmisión no existe.' };
    }

    const prendasAntes = await db.prendas.where('pedidoId').equals(id).toArray();
    const idsAntes = new Set(prendasAntes.map((p) => p.id));
    for (const p of vp.prendas) {
      if (p.id !== null && !idsAntes.has(p.id)) return { ok: false, error: 'Una prenda no pertenece a este pedido.' };
    }
    const idsQuedan = new Set(vp.prendas.filter((p) => p.id !== null).map((p) => p.id));
    const quitadas = prendasAntes.filter((p) => !idsQuedan.has(p.id));
    if (quitadas.length) await db.prendas.bulkDelete(quitadas.map((p) => p.id));

    const despuesPrendas = [];
    for (let i = 0; i < vp.prendas.length; i += 1) {
      const p = vp.prendas[i];
      const fila = { ...sinFoto(p), pedidoId: id, orden: i + 1 };
      delete fila.id;
      let prendaId = p.id;
      if (prendaId === null) prendaId = await db.prendas.add({ ...fila, fotoId: null });
      if (p.foto) fila.fotoId = await guardarFotoEnTx(db, p.foto, prendaId);
      await db.prendas.update(prendaId, fila);
      despuesPrendas.push({ ...fila, id: prendaId });
    }

    const cambios = {
      modalidad: cab.modalidad,
      envio: cab.envio,
      observaciones: cab.observaciones,
      transmisionId,
      totalPrendas,
      total,
      estadoPago: calcularEstadoPago({ total, pagado: antes.pagado, reembolsado: antes.reembolsado }),
      actualizadoEn: ahoraISO(),
    };
    await db.pedidos.update(id, cambios);
    await registrarHistorial(
      {
        entidad: 'pedido',
        entidadId: id,
        tipo: 'pedido-editado',
        antes: { ...antes, prendas: prendasAntes },
        despues: { ...antes, ...cambios, prendas: despuesPrendas },
      },
      db,
    );
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Consultar

export async function obtenerPedido(id, db = obtenerBD()) {
  const pedido = await db.pedidos.get(id);
  if (!pedido) return null;
  const [cliente, prendas, transmision, grupo] = await Promise.all([
    db.clientes.get(pedido.clienteId),
    db.prendas.where('pedidoId').equals(id).sortBy('orden'),
    pedido.transmisionId ? db.transmisiones.get(pedido.transmisionId) : null,
    pedido.grupoId ? db.grupos.get(pedido.grupoId) : null,
  ]);
  return { pedido, cliente, prendas, transmision: transmision ?? null, grupo: grupo ?? null };
}

/** Agrega clienta y cantidad de prendas a una lista de pedidos (para mostrar en listas). */
async function completar(pedidos, db) {
  const ids = [...new Set(pedidos.map((p) => p.clienteId))];
  const clientes = await db.clientes.bulkGet(ids);
  const porId = new Map(clientes.filter(Boolean).map((c) => [c.id, c]));
  return pedidos.map((p) => ({ ...p, cliente: porId.get(p.clienteId) ?? null }));
}

/** Pedidos más recientes primero. filtro: { transmisionId, clienteId } */
export async function listarPedidos({ desde = 0, limite = 30, transmisionId, clienteId } = {}, db = obtenerBD()) {
  let coleccion;
  if (clienteId) {
    coleccion = db.pedidos.where('[clienteId+creadoEn]').between([clienteId, ''], [clienteId, '￿']).reverse();
  } else if (transmisionId) {
    coleccion = db.pedidos.where('transmisionId').equals(transmisionId).reverse();
  } else {
    coleccion = db.pedidos.orderBy('creadoEn').reverse();
  }
  const pedidos = await coleccion.offset(desde).limit(limite).toArray();
  if (transmisionId && !clienteId) pedidos.sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  return completar(pedidos, db);
}

/**
 * Busca por código ("LIVE-00012", "12"), nombre de la clienta o dígitos del WhatsApp.
 * Devuelve hasta `limite` pedidos, más recientes primero.
 */
export async function buscarPedidos(texto, { limite = 50, db = obtenerBD() } = {}) {
  const t = String(texto ?? '').trim();
  if (!t) return listarPedidos({ limite }, db);
  const encontrados = new Map();

  const seq = leerCodigo(t);
  if (seq !== null) {
    const p = await db.pedidos.where('seq').equals(seq).first();
    if (p) encontrados.set(p.id, p);
  }

  const n = normalizarNombre(t);
  const palabras = n.split(' ').filter(Boolean);
  const digitos = t.replace(/\D/g, '');
  const soloNumero = /^[\d\s+()-]+$/.test(t);
  const clientes = await db.clientes
    .filter(
      (c) =>
        (!soloNumero && palabras.every((p) => c.nombreNormalizado.includes(p))) ||
        (soloNumero && digitos.length >= 4 && c.whatsapp.includes(digitos)),
    )
    .toArray();
  if (clientes.length) {
    const ids = clientes.map((c) => c.id);
    const deClientes = await db.pedidos.where('clienteId').anyOf(ids).toArray();
    for (const p of deClientes) encontrados.set(p.id, p);
  }
  const lista = [...encontrados.values()].sort((a, b) => b.creadoEn.localeCompare(a.creadoEn)).slice(0, limite);
  return completar(lista, db);
}

