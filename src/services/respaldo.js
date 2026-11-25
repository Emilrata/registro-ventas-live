// Respaldo y restauración (versión básica; la versión por partes y con contraseña llega en la etapa 7).
// ZIP: datos.json + fotos/ + comprobantes/ + manifiesto.json (versión y SHA-256 de cada archivo).
// La restauración verifica TODO antes de tocar los datos y luego reemplaza todo en una sola transacción.
// Se conservan los datos de acceso de ESTE dispositivo (PIN, código de recuperación, licencia).
import { Zip, ZipPassThrough, strToU8, strFromU8, unzipSync } from 'fflate';
import { VERSION_ESQUEMA, TABLAS, copiaInterna, obtenerBD } from '../core/db.js';
import { ahoraISO } from '../core/dates.js';
import { sha256Hex } from '../core/crypto.js';
import { registrarHistorial } from '../repositories/historial.repo.js';

export const FORMATO = 'registro-ventas-live/respaldo';
export const VERSION_FORMATO = 1;

/** Ajustes propios del dispositivo: nunca se reemplazan al restaurar. */
export function esAjusteDelDispositivo(clave) {
  return clave.startsWith('seguridad.') || clave === 'licencia' || clave === 'configuracion.completa';
}

const EXTENSIONES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const carpeta = (tipo) => (tipo === 'comprobante' ? 'comprobantes' : 'fotos');
const ext = (mime) => EXTENSIONES[mime] ?? 'bin';

function zipEnBlob(entradas) {
  // entradas: [{ ruta, bytes }]. Sin compresión (las fotos ya están comprimidas).
  return new Promise((resolver, rechazar) => {
    const partes = [];
    const zip = new Zip((err, chunk, final) => {
      if (err) return rechazar(err);
      partes.push(chunk);
      if (final) resolver(new Blob(partes, { type: 'application/zip' }));
      return undefined;
    });
    for (const { ruta, bytes } of entradas) {
      const archivo = new ZipPassThrough(ruta);
      zip.add(archivo);
      archivo.push(bytes, true);
    }
    zip.end();
  });
}

const bytesDe = async (blob) => new Uint8Array(await blob.arrayBuffer());

/**
 * Crea el respaldo completo. Devuelve { blob, nombre, conteos, bytes }.
 */
export async function crearRespaldo({ ahora = new Date(), db = obtenerBD(), registrar = true } = {}) {
  const fecha = ahora.toISOString();
  const tablas = {};
  const entradas = [];
  const hashes = {};

  await db.transaction('r', db.tables, async () => {
    for (const nombre of TABLAS) tablas[nombre] = await db.table(nombre).toArray();
  });

  // Los archivos van como ficheros aparte; en datos.json queda la ruta.
  tablas.archivos = await Promise.all(
    tablas.archivos.map(async (a) => {
      const { blob, miniatura, ...resto } = a;
      const ruta = `${carpeta(a.tipo)}/${a.id}.${ext(a.mime)}`;
      const bytes = await bytesDe(blob);
      entradas.push({ ruta, bytes });
      hashes[ruta] = await sha256Hex(bytes);
      let rutaMiniatura = null;
      if (miniatura instanceof Blob) {
        rutaMiniatura = `${carpeta(a.tipo)}/${a.id}-mini.${ext(miniatura.type)}`;
        const mb = await bytesDe(miniatura);
        entradas.push({ ruta: rutaMiniatura, bytes: mb });
        hashes[rutaMiniatura] = await sha256Hex(mb);
      }
      return { ...resto, archivo: ruta, archivoMime: blob.type || a.mime, miniaturaArchivo: rutaMiniatura, miniaturaMime: miniatura?.type ?? null };
    }),
  );

  const conteos = Object.fromEntries(TABLAS.map((t) => [t, tablas[t].length]));
  const datosBytes = strToU8(JSON.stringify({ tablas }));
  hashes['datos.json'] = await sha256Hex(datosBytes);
  const manifiesto = {
    formato: FORMATO,
    versionFormato: VERSION_FORMATO,
    versionEsquema: VERSION_ESQUEMA,
    app: typeof __APP_VERSION__ === 'undefined' ? 'pruebas' : __APP_VERSION__,
    creadoEn: fecha,
    conteos,
    sha256: hashes,
  };
  const blob = await zipEnBlob([
    { ruta: 'manifiesto.json', bytes: strToU8(JSON.stringify(manifiesto, null, 2)) },
    { ruta: 'datos.json', bytes: datosBytes },
    ...entradas,
  ]);

  const nombre = `respaldo-ventas-live-${fecha.slice(0, 16).replace(/[:T]/g, '-')}.zip`;
  if (registrar) {
    await db.transaction('rw', db.respaldos, db.ajustes, db.historial, async () => {
      const fila = { fecha, tipo: 'completo', tamano: blob.size, nombre, rango: null };
      const id = await db.respaldos.add(fila);
      await db.ajustes.put({ clave: 'respaldo.ultimo', valor: { fecha, id }, actualizadoEn: fecha });
      await registrarHistorial({ entidad: 'respaldo', entidadId: id, tipo: 'respaldo-creado', despues: fila }, db);
    });
  }
  return { blob, nombre, conteos, bytes: blob.size };
}

/**
 * Lee y verifica un respaldo SIN tocar la base.
 * Devuelve { ok, manifiesto, tablas } (con Blobs reconstruidos) o { ok:false, error }.
 */
export async function verificarRespaldo(archivo) {
  let entradas;
  try {
    entradas = unzipSync(archivo instanceof Uint8Array ? archivo : await bytesDe(archivo));
  } catch {
    return { ok: false, error: 'El archivo no es un respaldo válido (no se pudo abrir el ZIP).' };
  }
  let manifiesto;
  let datos;
  try {
    manifiesto = JSON.parse(strFromU8(entradas['manifiesto.json']));
  } catch {
    return { ok: false, error: 'El respaldo no tiene manifiesto.' };
  }
  if (manifiesto.formato !== FORMATO) return { ok: false, error: 'El archivo no es un respaldo de esta app.' };
  if (manifiesto.versionFormato > VERSION_FORMATO || manifiesto.versionEsquema > VERSION_ESQUEMA) {
    return { ok: false, error: 'El respaldo es de una versión más nueva de la app. Actualiza la app primero.' };
  }
  for (const [ruta, hash] of Object.entries(manifiesto.sha256 ?? {})) {
    if (!entradas[ruta]) return { ok: false, error: `Falta un archivo en el respaldo: ${ruta}.` };
    if ((await sha256Hex(entradas[ruta])) !== hash) return { ok: false, error: `Un archivo del respaldo está dañado: ${ruta}.` };
  }
  if (!manifiesto.sha256?.['datos.json']) return { ok: false, error: 'El respaldo no tiene datos.' };
  try {
    datos = JSON.parse(strFromU8(entradas['datos.json']));
  } catch {
    return { ok: false, error: 'Los datos del respaldo están dañados.' };
  }
  const tablas = datos?.tablas ?? {};
  for (const t of TABLAS) {
    if (!Array.isArray(tablas[t])) return { ok: false, error: `Al respaldo le falta la tabla ${t}.` };
    if (tablas[t].length !== manifiesto.conteos?.[t]) return { ok: false, error: `La tabla ${t} no coincide con el manifiesto.` };
  }
  for (const a of tablas.archivos) {
    for (const ruta of [a.archivo, a.miniaturaArchivo].filter(Boolean)) {
      if (!manifiesto.sha256[ruta]) return { ok: false, error: `Falta una foto en el respaldo: ${ruta}.` };
    }
  }
  tablas.archivos = tablas.archivos.map(({ archivo, archivoMime, miniaturaArchivo, miniaturaMime, ...resto }) => ({
    ...resto,
    blob: new Blob([entradas[archivo]], { type: archivoMime }),
    miniatura: miniaturaArchivo ? new Blob([entradas[miniaturaArchivo]], { type: miniaturaMime }) : null,
  }));
  return { ok: true, manifiesto, tablas };
}

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
      await db.ajustes.put({ clave: 'respaldo.ultimo', valor: { fecha: manifiesto.creadoEn, id: null }, actualizadoEn: ahoraISO() });
    }
    await registrarHistorial(
      { entidad: 'respaldo', tipo: 'respaldo-restaurado', despues: { creadoEn: manifiesto.creadoEn, conteos: manifiesto.conteos } },
      db,
    );
  });
  return { ok: true };
}
