// Base de datos local (IndexedDB con Dexie).
// Reglas:
//  - Solo los repositorios (src/repositories) usan este módulo.
//  - Cada cambio de esquema agrega una versión nueva aquí, con su migración
//    probada en tests/unit. Nunca se edita una versión ya publicada.
//  - Antes de migrar se guarda automáticamente una copia completa de los datos
//    en una base aparte (ver respaldarAntesDeMigrar).

import Dexie from 'dexie';
import { emit } from './events.js';
import { ahoraISO, PLAZO_DIAS_POR_DEFECTO } from './dates.js';

export const NOMBRE_BD = 'registro-ventas-live';
export const NOMBRE_BD_MIGRACIONES = 'registro-ventas-live-migraciones';
export const VERSION_ESQUEMA = 1;

// Índices de cada tabla. '++id' = clave numérica automática; '&' = único;
// '[a+b]' = índice compuesto. Los demás campos se guardan pero no se indexan.
export const ESQUEMAS = {
  1: {
    clientes: '++id, &whatsapp, nombreNormalizado, creadoEn',
    pedidos:
      '++id, &codigo, &seq, clienteId, transmisionId, creadoEn, fechaLimite, estado, estadoPago, grupoId, [clienteId+creadoEn]',
    prendas: '++id, pedidoId, [pedidoId+orden], fotoId',
    archivos: '++id, tipo, sha256, [refTipo+refId], creadoEn',
    pagos: '++id, pedidoId, fechaHora, metodo, anulaA, comprobanteId',
    devoluciones: '++id, pedidoId, fechaHora, comprobanteId',
    grupos: '++id, clienteId, estado, creadoEn',
    entregas: '++id, pedidoId, grupoId, fechaDespacho, entregadoEn',
    historial: '++id, [entidad+entidadId], tipo, fechaHora',
    ajustes: '&clave',
    respaldos: '++id, fecha, tipo',
    transmisiones: '++id, fecha',
  },
};

export const TABLAS = Object.keys(ESQUEMAS[VERSION_ESQUEMA]);

/** Ajustes que se crean una sola vez, cuando la base nace. */
export function ajustesIniciales(fecha = ahoraISO()) {
  const filas = {
    'codigos.ultimoSeq': 0, // contador de códigos LIVE-00001 (solo sube)
    'pedidos.plazoDias': PLAZO_DIAS_POR_DEFECTO,
    'pedidos.diasAviso': [25, 28],
    'pedidos.minutosDuplicado': 10,
    'whatsapp.codigoPais': '591',
    'seguridad.minutosBloqueo': 5,
    'fotos.archivoAntiguasActivo': false,
    'bd.creadaEn': fecha,
    'bd.versionInicial': VERSION_ESQUEMA,
  };
  return Object.entries(filas).map(([clave, valor]) => ({ clave, valor, actualizadoEn: fecha }));
}

/** Crea la instancia de Dexie con todas las versiones del esquema. */
export function crearBaseDeDatos(nombre = NOMBRE_BD, opcionesDexie) {
  const db = new Dexie(nombre, opcionesDexie);
  db.version(1).stores(ESQUEMAS[1]);
  // Ejemplo para el futuro (no borrar versiones anteriores):
  // db.version(2).stores(ESQUEMAS[2]).upgrade((tx) => migrarA2(tx));

  db.on('populate', (tx) => tx.table('ajustes').bulkAdd(ajustesIniciales()));
  return db;
}

// ---------------------------------------------------------------------------
// Copia automática antes de migrar

function crearBdMigraciones(opcionesDexie) {
  const m = new Dexie(NOMBRE_BD_MIGRACIONES, opcionesDexie);
  m.version(1).stores({
    copias: '++id, fecha, versionOrigen, completa',
    filas: '++id, copiaId, [copiaId+tabla]',
  });
  return m;
}

const TAMANO_LOTE = 200;

/**
 * Copia todas las tablas de `origen` (base abierta) a la base de copias internas.
 * Devuelve el id de la copia.
 */
async function copiarTablas(origen, datos, opcionesDexie) {
  const m = crearBdMigraciones(opcionesDexie);
  await m.open();
  try {
    const copiaId = await m.copias.add({ fecha: ahoraISO(), ...datos, completa: 0, conteos: {} });
    const conteos = {};
    for (const tabla of origen.tables) {
      const clave = tabla.schema.primKey.keyPath;
      let ultimo;
      let total = 0;
      for (;;) {
        const lote =
          ultimo === undefined
            ? await tabla.orderBy(':id').limit(TAMANO_LOTE).toArray()
            : await tabla.where(':id').above(ultimo).limit(TAMANO_LOTE).toArray();
        if (lote.length === 0) break;
        await m.filas.bulkAdd(lote.map((fila) => ({ copiaId, tabla: tabla.name, fila })));
        total += lote.length;
        ultimo = lote[lote.length - 1][clave];
        if (lote.length < TAMANO_LOTE) break;
      }
      conteos[tabla.name] = total;
    }
    await m.copias.update(copiaId, { completa: 1, conteos });
    return copiaId;
  } finally {
    m.close();
  }
}

/** Copia de seguridad interna de la base abierta (por ejemplo, antes de restaurar). */
export function copiaInterna(db, motivo, opcionesDexie) {
  return copiarTablas(db, { motivo, versionOrigen: db.verno, versionDestino: db.verno }, opcionesDexie);
}

/**
 * Si la base existente tiene una versión menor que `versionDestino`, copia todas
 * sus tablas (incluidas fotos en Blob) a una base aparte antes de migrar.
 * Devuelve el id de la copia, o null si no hacía falta.
 * Si la base existente es MÁS NUEVA que la app, lanza un error (no se toca nada).
 */
export async function respaldarAntesDeMigrar({
  nombre = NOMBRE_BD,
  versionDestino = VERSION_ESQUEMA,
  opcionesDexie,
} = {}) {
  if (!(await Dexie.exists(nombre))) return null;

  const previa = new Dexie(nombre, opcionesDexie);
  await previa.open(); // modo dinámico: abre con el esquema que ya existe
  try {
    const versionOrigen = previa.verno;
    if (versionOrigen > versionDestino) {
      const err = new Error(
        'Los datos de este dispositivo fueron creados por una versión más nueva de la app.',
      );
      err.name = 'VersionMasNuevaError';
      throw err;
    }
    if (versionOrigen === versionDestino) return null;

    return await copiarTablas(previa, { motivo: 'migracion', versionOrigen, versionDestino }, opcionesDexie);
  } finally {
    previa.close();
  }
}

// ---------------------------------------------------------------------------
// Instancia única de la app

let instancia = null;

/** Abre la base de la app (con copia previa si hay migración). */
export async function abrirBaseDeDatos() {
  if (instancia) return instancia;
  await respaldarAntesDeMigrar();
  const db = crearBaseDeDatos();
  db.on('blocked', () => emit('bd:bloqueada'));
  db.on('versionchange', () => {
    // Otra pestaña instaló una versión nueva: cerrar para no bloquearla.
    db.close();
    instancia = null;
    emit('bd:version-cambiada');
    return false;
  });
  await db.open();
  instancia = db;
  return db;
}

/** Solo para pruebas: usar una base ya abierta como instancia de la app. */
export function establecerBD(db) {
  instancia = db;
}

/** Devuelve la base ya abierta (la usan los repositorios). */
export function obtenerBD() {
  if (!instancia) throw new Error('La base de datos no está abierta.');
  return instancia;
}
