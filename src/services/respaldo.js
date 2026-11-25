// Respaldo y restauración.
//
// Tipos de respaldo (ZIP):
//  - 'datos'    → solo datos.json (liviano; para hacerlo todos los días).
//  - 'fotos'    → solo las fotos y comprobantes NUEVOS desde el último respaldo con fotos (semanal).
//  - 'completo' → datos.json + todas las fotos y comprobantes.
// Cada ZIP lleva manifiesto.json con la versión y el SHA-256 de cada archivo.
// Contraseña opcional: cada archivo va cifrado con AES-GCM (clave PBKDF2-SHA256).
//
// "Por partes": las fotos se leen y escriben de a una y el ZIP se arma en trozos de ~8 MB,
// así un respaldo grande no se carga entero en la memoria del teléfono. Al restaurar, cada foto
// se lee directamente del archivo elegido (sin abrir todo el ZIP en memoria).
//
// La restauración VERIFICA TODO antes de tocar los datos, guarda una copia interna y luego
// reemplaza todo en una sola transacción. Se conservan los datos de acceso de ESTE teléfono
// (PIN, código de recuperación, huella, licencia).
import { Zip, ZipPassThrough, strToU8, strFromU8 } from 'fflate';
import { VERSION_ESQUEMA, TABLAS, copiaInterna, obtenerBD } from '../core/db.js';
import { ahoraISO } from '../core/dates.js';
import {
  aBase64Url,
  bytesAleatorios,
  claveDesdeContrasena,
  cifrarBytes,
  descifrarBytes,
  desdeBase64Url,
  PBKDF2_ITERACIONES,
  sha256Hex,
} from '../core/crypto.js';
import { blobDeEntrada, bytesDeEntrada, leerIndiceZip } from '../core/zip-lector.js';
import { registrarHistorial } from '../repositories/historial.repo.js';

export const FORMATO = 'registro-ventas-live/respaldo';
export const VERSION_FORMATO = 2;
export const TIPOS_RESPALDO = { datos: 'Datos', fotos: 'Fotos nuevas', completo: 'Completo' };
const VERIFICADOR = 'registro-ventas-live';
const TAMANO_TROZO = 8 * 1024 * 1024;

/** Ajustes propios del dispositivo: nunca se reemplazan al restaurar. */
export function esAjusteDelDispositivo(clave) {
  return clave.startsWith('seguridad.') || clave.startsWith('drive.') || clave.startsWith('notificaciones.') || clave === 'licencia' || clave === 'configuracion.completa';
}

const EXTENSIONES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const carpeta = (tipo) => (tipo === 'comprobante' ? 'comprobantes' : 'fotos');
const ext = (mime) => EXTENSIONES[mime] ?? 'bin';
export const rutaArchivo = (a) => `${carpeta(a.tipo)}/${a.id}.${ext(a.mime)}`;
export const rutaMiniatura = (a) => `${carpeta(a.tipo)}/${a.id}-mini.jpg`;
const bytesDe = async (blob) => new Uint8Array(await blob.arrayBuffer());

/** Escritor de ZIP sin compresión que va juntando trozos en Blobs (no todo en memoria). */
function crearEscritorZip() {
  const trozos = [];
  let pendiente = [];
  let tamanoPendiente = 0;
  let resolver;
  let rechazar;
  const terminado = new Promise((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  const vaciar = () => {
    if (pendiente.length) trozos.push(new Blob(pendiente));
    pendiente = [];
    tamanoPendiente = 0;
  };
  const zip = new Zip((err, chunk, final) => {
    if (err) return rechazar(err);
    pendiente.push(chunk);
    tamanoPendiente += chunk.length;
    if (tamanoPendiente >= TAMANO_TROZO) vaciar();
    if (final) {
      vaciar();
      resolver(new Blob(trozos, { type: 'application/zip' }));
    }
    return undefined;
  });
  return {
    agregar(ruta, bytes) {
      const archivo = new ZipPassThrough(ruta);
      zip.add(archivo);
      archivo.push(bytes, true);
    },
    async terminar() {
      zip.end();
      return terminado;
    },
  };
}

// ---------------------------------------------------------------------------
// Crear

/**
 * Crea un respaldo.
 * opciones: { tipo: 'datos'|'fotos'|'completo', contrasena?, ahora?, db?, registrar? }
 * Devuelve { blob, nombre, tipo, conteos, archivos (cantidad de fotos/comprobantes), bytes }.
 */
export async function crearRespaldo({ tipo = 'completo', contrasena = '', ahora = new Date(), db = obtenerBD(), registrar = true } = {}) {
  if (!TIPOS_RESPALDO[tipo]) throw new TypeError(`Tipo de respaldo desconocido: ${tipo}`);
  const fecha = ahora.toISOString();
  const incluyeDatos = tipo !== 'fotos';

  // Foto instantánea y coherente de todas las tablas (los Blobs no se cargan en memoria aquí).
  const tablas = {};
  await db.transaction('r', db.tables, async () => {
    for (const nombre of TABLAS) tablas[nombre] = await db.table(nombre).toArray();
  });
  // "Fotos nuevas" se decide por el número de archivo (siempre crece), no por la hora del teléfono:
  // si el reloj se atrasa, ninguna foto queda fuera de los respaldos.
  const ultimoId = tablas.archivos.reduce((m, a) => Math.max(m, a.id), 0);
  const fotosDesde = tipo === 'fotos' ? (tablas.ajustes.find((a) => a.clave === 'respaldo.fotosHastaId')?.valor ?? 0) : 0;
  const aIncluir =
    tipo === 'datos' ? [] : tablas.archivos.filter((a) => a.blob instanceof Blob && !a.perdido && (tipo === 'completo' || a.id > fotosDesde));

  // Contraseña opcional
  let clave = null;
  let cifrado = null;
  if (contrasena) {
    if (contrasena.length < 6) throw Object.assign(new Error('La contraseña debe tener al menos 6 caracteres.'), { esValidacion: true });
    const sal = bytesAleatorios(16);
    clave = await claveDesdeContrasena(contrasena, sal, PBKDF2_ITERACIONES);
    cifrado = {
      algoritmo: 'AES-GCM-256',
      kdf: 'PBKDF2-SHA256',
      iteraciones: PBKDF2_ITERACIONES,
      sal: aBase64Url(sal),
      verificador: aBase64Url(await cifrarBytes(clave, strToU8(VERIFICADOR))),
    };
  }
  const preparar = async (bytes) => (clave ? cifrarBytes(clave, bytes) : bytes);

  const zip = crearEscritorZip();
  const hashes = {};
  const agregar = async (ruta, bytes) => {
    const guardado = await preparar(bytes);
    hashes[ruta] = await sha256Hex(guardado);
    zip.agregar(ruta, guardado);
  };

  // Fotos y comprobantes, de a uno (así nunca están todos en memoria a la vez).
  for (const a of aIncluir) {
    await agregar(rutaArchivo(a), await bytesDe(a.blob));
    if (a.miniatura instanceof Blob) await agregar(rutaMiniatura(a), await bytesDe(a.miniatura));
  }

  let conteos = null;
  if (incluyeDatos) {
    const archivosMeta = tablas.archivos.map(({ blob, miniatura, ...resto }) => ({
      ...resto,
      archivo: rutaArchivo(resto),
      archivoMime: blob?.type || resto.mime,
      miniaturaArchivo: miniatura instanceof Blob ? rutaMiniatura(resto) : null,
      miniaturaMime: miniatura instanceof Blob ? miniatura.type || 'image/jpeg' : null,
    }));
    const datos = { ...tablas, archivos: archivosMeta };
    conteos = Object.fromEntries(TABLAS.map((t) => [t, datos[t].length]));
    await agregar('datos.json', strToU8(JSON.stringify({ tablas: datos })));
  }

  const manifiesto = {
    formato: FORMATO,
    versionFormato: VERSION_FORMATO,
    tipo,
    idRespaldo: aBase64Url(bytesAleatorios(9)),
    versionEsquema: VERSION_ESQUEMA,
    app: typeof __APP_VERSION__ === 'undefined' ? 'pruebas' : __APP_VERSION__,
    creadoEn: fecha,
    incluyeDatos,
    conteos,
    fotos: aIncluir.length,
    fotosDesdeId: tipo === 'fotos' ? fotosDesde : null,
    fotosHastaId: tipo === 'datos' ? null : ultimoId,
    cifrado,
    sha256: hashes,
  };
  zip.agregar('manifiesto.json', strToU8(JSON.stringify(manifiesto, null, 2)));
  const blob = await zip.terminar();

  const nombre = `respaldo-ventas-live-${tipo}-${fecha.slice(0, 16).replace(/[:T]/g, '-')}.zip`;
  if (registrar) {
    await db.transaction('rw', db.respaldos, db.ajustes, db.historial, async () => {
      const fila = { fecha, tipo, tamano: blob.size, nombre, rango: { fotosDesdeId: manifiesto.fotosDesdeId, fotosHastaId: manifiesto.fotosHastaId, fotos: aIncluir.length, cifrado: Boolean(cifrado) } };
      const id = await db.respaldos.add(fila);
      if (incluyeDatos) await db.ajustes.put({ clave: 'respaldo.ultimo', valor: { fecha, id, tipo }, actualizadoEn: fecha });
      if (tipo !== 'datos') {
        await db.ajustes.put({ clave: 'respaldo.fotosHastaId', valor: ultimoId, actualizadoEn: fecha });
        await db.ajustes.put({ clave: 'respaldo.ultimoFotos', valor: { fecha, id, tipo }, actualizadoEn: fecha });
      }
      await registrarHistorial({ entidad: 'respaldo', entidadId: id, tipo: 'respaldo-creado', despues: fila }, db);
    });
  }
  return { blob, nombre, tipo, conteos, archivos: aIncluir.length, bytes: blob.size };
}

/** Cuántas fotos/comprobantes no están en ningún respaldo de fotos todavía. */
export async function fotosSinRespaldar(db = obtenerBD()) {
  const desde = (await db.ajustes.get('respaldo.fotosHastaId'))?.valor ?? 0;
  return db.archivos.where(':id').above(desde).filter((a) => !a.perdido && a.blob instanceof Blob).count();
}

// ---------------------------------------------------------------------------
// Verificar (sin tocar la base)

const errorVerif = (error, extra = {}) => ({ ok: false, error, ...extra });

async function abrirArchivoRespaldo(archivo) {
  const blob = archivo instanceof Blob ? archivo : new Blob([archivo]);
  let indice;
  try {
    indice = await leerIndiceZip(blob);
  } catch {
    return errorVerif('El archivo no es un respaldo válido (no se pudo abrir el ZIP).');
  }
  const entradaManifiesto = indice.get('manifiesto.json');
  if (!entradaManifiesto) return errorVerif('El archivo no es un respaldo de esta app.');
  let manifiesto;
  try {
    manifiesto = JSON.parse(strFromU8(await bytesDeEntrada(blob, entradaManifiesto)));
  } catch {
    return errorVerif('El respaldo no tiene un manifiesto válido.');
  }
  if (manifiesto.formato !== FORMATO) return errorVerif('El archivo no es un respaldo de esta app.');
  if (manifiesto.versionFormato > VERSION_FORMATO || manifiesto.versionEsquema > VERSION_ESQUEMA) {
    return errorVerif('El respaldo es de una versión más nueva de la app. Actualiza la app primero.');
  }
  // Formato 1 (etapa 3): siempre completo, sin cifrado.
  if (manifiesto.versionFormato === 1) Object.assign(manifiesto, { tipo: 'completo', incluyeDatos: true, cifrado: null });
  for (const ruta of Object.keys(manifiesto.sha256 ?? {})) {
    if (!indice.has(ruta)) return errorVerif(`Falta un archivo en el respaldo: ${ruta}.`);
  }
  return { ok: true, blob, indice, manifiesto };
}

/** Lee una entrada, comprueba su SHA-256 contra el manifiesto y la descifra si hace falta. */
async function leerEntradaVerificada(r, ruta, clave) {
  const entrada = r.indice.get(ruta);
  const guardado = await bytesDeEntrada(r.blob, entrada);
  const esperado = r.manifiesto.sha256?.[ruta];
  if (!esperado || (await sha256Hex(guardado)) !== esperado) throw Object.assign(new Error(`Un archivo del respaldo está dañado: ${ruta}.`), { esVerif: true });
  if (!clave) return { bytes: guardado, slice: await blobDeEntrada(r.blob, entrada) };
  try {
    return { bytes: await descifrarBytes(clave, guardado), slice: null };
  } catch {
    throw Object.assign(new Error(`No se pudo descifrar ${ruta}: el archivo está dañado.`), { esVerif: true });
  }
}

/**
 * Lee y verifica uno o varios archivos de respaldo SIN tocar la base.
 * Se toman los datos del respaldo más reciente que los tenga, y las fotos de cualquiera de los archivos.
 * opciones: { contrasena?, permitirFaltantes? }
 * Devuelve { ok, manifiesto, tablas, faltantes } o { ok:false, error, necesitaContrasena?, faltantes? }.
 */
export async function verificarRespaldo(entrada, { contrasena = '', permitirFaltantes = false } = {}) {
  const lista = Array.isArray(entrada) ? entrada : [entrada];
  if (!lista.length) return errorVerif('Elige al menos un archivo de respaldo.');
  const abiertos = [];
  for (const a of lista) {
    const r = await abrirArchivoRespaldo(a);
    if (!r.ok) return r;
    abiertos.push(r);
  }

  // Claves de los respaldos con contraseña
  const claves = new Map();
  if (abiertos.some((r) => r.manifiesto.cifrado)) {
    if (!contrasena) return errorVerif('Este respaldo tiene contraseña.', { necesitaContrasena: true });
    for (const r of abiertos) {
      const c = r.manifiesto.cifrado;
      if (!c) continue;
      const id = `${c.sal}:${c.iteraciones}`;
      if (!claves.has(id)) {
        const clave = await claveDesdeContrasena(contrasena, desdeBase64Url(c.sal), c.iteraciones);
        try {
          const v = await descifrarBytes(clave, desdeBase64Url(c.verificador));
          if (strFromU8(v) !== VERIFICADOR) throw new Error('verificador');
        } catch {
          return errorVerif('La contraseña no es correcta.', { necesitaContrasena: true });
        }
        claves.set(id, clave);
      }
      r.clave = claves.get(id);
    }
  }

  // Datos: del respaldo más reciente que los tenga
  const conDatos = abiertos.filter((r) => r.manifiesto.incluyeDatos).sort((a, b) => b.manifiesto.creadoEn.localeCompare(a.manifiesto.creadoEn));
  if (!conDatos.length) return errorVerif('Este archivo solo tiene fotos. Elige también un respaldo de datos o completo.');
  const base = conDatos[0];
  let tablas;
  try {
    const { bytes } = await leerEntradaVerificada(base, 'datos.json', base.clave);
    tablas = JSON.parse(strFromU8(bytes))?.tablas ?? {};
  } catch (err) {
    return errorVerif(err.esVerif ? err.message : 'Los datos del respaldo están dañados.');
  }
  for (const t of TABLAS) {
    if (!Array.isArray(tablas[t])) return errorVerif(`Al respaldo le falta la tabla ${t}.`);
    if (tablas[t].length !== base.manifiesto.conteos?.[t]) return errorVerif(`La tabla ${t} no coincide con el manifiesto.`);
  }

  // Fotos: se buscan en todos los archivos elegidos (primero en el de los datos)
  const orden = [base, ...abiertos.filter((r) => r !== base).sort((a, b) => b.manifiesto.creadoEn.localeCompare(a.manifiesto.creadoEn))];
  const buscar = (ruta) => orden.find((r) => r.manifiesto.sha256?.[ruta]);
  let faltantes = 0;
  const archivos = [];
  try {
    for (const fila of tablas.archivos) {
      const { archivo, archivoMime, miniaturaArchivo, miniaturaMime, ...resto } = fila;
      if (resto.perdido) {
        archivos.push({ ...resto, blob: null, miniatura: null });
        continue;
      }
      const origen = buscar(archivo);
      if (!origen) {
        faltantes += 1;
        archivos.push({ ...resto, blob: null, miniatura: null, perdido: true });
        continue;
      }
      const principal = await leerEntradaVerificada(origen, archivo, origen.clave);
      if (resto.sha256 && (await sha256Hex(principal.bytes)) !== resto.sha256) {
        throw Object.assign(new Error(`Un archivo del respaldo está dañado: ${archivo}.`), { esVerif: true });
      }
      const tipo = archivoMime || resto.mime || '';
      const blob = principal.slice && !origen.clave ? principal.slice.slice(0, principal.slice.size, tipo) : new Blob([principal.bytes], { type: tipo });
      let miniatura = null;
      const origenMini = miniaturaArchivo ? buscar(miniaturaArchivo) : null;
      if (origenMini) {
        const m = await leerEntradaVerificada(origenMini, miniaturaArchivo, origenMini.clave);
        miniatura = m.slice && !origenMini.clave ? m.slice.slice(0, m.slice.size, miniaturaMime || 'image/jpeg') : new Blob([m.bytes], { type: miniaturaMime || 'image/jpeg' });
      }
      archivos.push({ ...resto, blob, miniatura });
    }
  } catch (err) {
    if (err.esVerif) return errorVerif(err.message);
    throw err;
  }
  if (faltantes && !permitirFaltantes) {
    return errorVerif(
      `Faltan ${faltantes} ${faltantes === 1 ? 'foto o comprobante' : 'fotos o comprobantes'} en los archivos elegidos. Elige también tus respaldos de fotos o un respaldo completo.`,
      { faltantes, puedeContinuar: true },
    );
  }
  tablas.archivos = archivos;
  return { ok: true, manifiesto: base.manifiesto, tablas, faltantes, archivosElegidos: abiertos.length };
}

// ---------------------------------------------------------------------------
// Restaurar

/**
 * Restaura un respaldo ya verificado (resultado de verificarRespaldo).
 * Antes guarda una copia interna de los datos actuales. Reemplaza todo en una sola transacción.
 */
export async function restaurarRespaldo(verificado, { db = obtenerBD(), copiaPrevia = true } = {}) {
  if (!verificado?.ok) throw new Error('El respaldo no está verificado.');
  if (copiaPrevia) await copiaInterna(db, 'antes-de-restaurar');
  const { tablas, manifiesto } = verificado;
  await db.transaction('rw', db.tables, async () => {
    const delDispositivo = (await db.ajustes.toArray()).filter((a) => esAjusteDelDispositivo(a.clave));
    // Códigos ya usados en ESTE teléfono (pueden haberse enviado a clientas): nunca se reutilizan.
    const contadorDispositivo = Math.max(
      (await db.ajustes.get('codigos.ultimoSeq'))?.valor ?? 0,
      (await db.pedidos.orderBy('seq').last())?.seq ?? 0,
    );
    for (const t of TABLAS) await db.table(t).clear();
    for (const t of TABLAS) {
      let filas = tablas[t];
      if (t === 'ajustes') filas = filas.filter((a) => !esAjusteDelDispositivo(a.clave)).concat(delDispositivo);
      if (filas.length) await db.table(t).bulkAdd(filas);
    }
    // El contador queda en el mayor entre: este teléfono, el respaldo y el último pedido restaurado.
    const ultimo = (await db.pedidos.orderBy('seq').last())?.seq ?? 0;
    const contador = (await db.ajustes.get('codigos.ultimoSeq'))?.valor ?? 0;
    const seguro = Math.max(ultimo, contador, contadorDispositivo);
    if (seguro !== contador) await db.ajustes.put({ clave: 'codigos.ultimoSeq', valor: seguro, actualizadoEn: ahoraISO() });
    // El respaldo restaurado es, como mínimo, el último respaldo existente.
    const ultimoRespaldo = (await db.ajustes.get('respaldo.ultimo'))?.valor;
    if (!ultimoRespaldo || ultimoRespaldo.fecha < manifiesto.creadoEn) {
      await db.ajustes.put({ clave: 'respaldo.ultimo', valor: { fecha: manifiesto.creadoEn, id: null, tipo: manifiesto.tipo }, actualizadoEn: ahoraISO() });
    }
    await registrarHistorial(
      {
        entidad: 'respaldo',
        tipo: 'respaldo-restaurado',
        despues: { creadoEn: manifiesto.creadoEn, tipo: manifiesto.tipo, conteos: manifiesto.conteos, fotosFaltantes: verificado.faltantes ?? 0 },
      },
      db,
    );
  });
  return { ok: true };
}
