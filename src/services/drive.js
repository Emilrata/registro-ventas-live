// Conexión OPCIONAL con Google Drive para guardar respaldos.
// - Google Identity Services (modelo de «token»), sin servidor propio: el permiso dura ~1 hora y
//   se guarda solo en memoria; al vencer, Google lo vuelve a pedir (normalmente con un toque).
// - Alcance drive.file: la app solo ve los archivos que ella misma creó. No ve el resto del Drive.
// - Necesita internet solo en el momento de conectar, subir o descargar.
// - Nunca se borra un respaldo de fotos ni uno completo. De los de «datos» se conservan los últimos 7.
import { obtenerBD } from '../core/db.js';
import { ahoraISO } from '../core/dates.js';
import { DATOS_A_CONSERVAR, DRIVE_SCOPE, GOOGLE_CLIENT_ID, NOMBRE_CARPETA } from '../core/drive-config.js';
import { registrarHistorial } from '../repositories/historial.repo.js';

const API = 'https://www.googleapis.com/drive/v3';
const SUBIDA = 'https://www.googleapis.com/upload/drive/v3/files';
const CLAVE = 'drive.conexion';
const TROZO = 8 * 1024 * 1024; // múltiplo de 256 KB, como pide Google

let token = null; // { valor, vence }
let cargaGis = null;

/** Para pruebas: reemplaza la carga de Google Identity Services y fetch. */
let entorno = { fetch: (...a) => globalThis.fetch(...a), cargarGis: cargarScriptGis };
export function _usarEntorno(nuevo) {
  entorno = { ...entorno, ...nuevo };
  token = null;
  cargaGis = null;
}

function errorDrive(mensaje, extra = {}) {
  return Object.assign(new Error(mensaje), { esDrive: true, ...extra });
}

function cargarScriptGis() {
  return new Promise((resolver, rechazar) => {
    if (globalThis.google?.accounts?.oauth2) return resolver(globalThis.google.accounts.oauth2);
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => (globalThis.google?.accounts?.oauth2 ? resolver(globalThis.google.accounts.oauth2) : rechazar(new Error('gis')));
    s.onerror = () => rechazar(new Error('gis'));
    document.head.appendChild(s);
  });
}

async function oauth2() {
  if (globalThis.navigator?.onLine === false) throw errorDrive('Se necesita internet para usar Google Drive.');
  cargaGis ??= entorno.cargarGis().catch((err) => {
    cargaGis = null;
    throw err;
  });
  try {
    return await cargaGis;
  } catch {
    throw errorDrive('No se pudo abrir Google. Revisa tu conexión a internet.');
  }
}

/**
 * Pide (o renueva) el permiso. Debe llamarse desde un toque de la persona (Google abre una ventana).
 * correo: sugiere la cuenta ya conectada.
 */
async function pedirToken({ correo, elegirCuenta = false } = {}) {
  if (token && token.vence > Date.now() + 60000) return token.valor;
  const o = await oauth2();
  return new Promise((resolver, rechazar) => {
    const cliente = o.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      hint: correo,
      callback: (r) => {
        if (r?.error || !r?.access_token) return rechazar(errorDrive('No se dio permiso para usar Google Drive.'));
        if (o.hasGrantedAllScopes && !o.hasGrantedAllScopes(r, DRIVE_SCOPE)) {
          return rechazar(errorDrive('Hay que marcar el permiso de Google Drive para continuar.'));
        }
        token = { valor: r.access_token, vence: Date.now() + (Number(r.expires_in) || 3600) * 1000 };
        return resolver(token.valor);
      },
      error_callback: (e) => rechazar(errorDrive(e?.type === 'popup_closed' ? 'Se cerró la ventana de Google.' : 'No se pudo conectar con Google.')),
    });
    cliente.requestAccessToken({ prompt: elegirCuenta ? 'select_account consent' : '' });
  });
}

async function api(url, opciones = {}, { reintentar = true } = {}) {
  const conexion = await obtenerConexion();
  const t = await pedirToken({ correo: conexion?.correo });
  const r = await entorno.fetch(url, { ...opciones, headers: { ...(opciones.headers ?? {}), Authorization: `Bearer ${t}` } });
  if (r.status === 401 && reintentar) {
    token = null;
    return api(url, opciones, { reintentar: false });
  }
  if (r.status === 403 || r.status === 429) {
    const cuerpo = await r.json().catch(() => ({}));
    const motivo = cuerpo?.error?.errors?.[0]?.reason ?? '';
    if (motivo === 'storageQuotaExceeded') throw errorDrive('Tu Google Drive está lleno. Libera espacio y vuelve a intentarlo.');
    throw errorDrive('Google Drive no permitió la operación. Intenta de nuevo en un momento.');
  }
  if (!r.ok && r.status !== 308) throw errorDrive(`Google Drive respondió con un error (${r.status}).`);
  return r;
}

// ---------------------------------------------------------------------------
// Conexión

export async function obtenerConexion(db = obtenerBD()) {
  return (await db.ajustes.get(CLAVE))?.valor ?? null;
}

async function buscarOCrearCarpeta() {
  const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${NOMBRE_CARPETA.replace(/'/g, "\\'")}' and trashed=false`);
  const lista = await (await api(`${API}/files?q=${q}&fields=files(id,name)&spaces=drive`)).json();
  if (lista.files?.length) return lista.files[0].id;
  const r = await api(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NOMBRE_CARPETA, mimeType: 'application/vnd.google-apps.folder', appProperties: { ventasLive: 'carpeta' } }),
  });
  return (await r.json()).id;
}

/** Conecta (o reconecta) la cuenta de Google. Llamar desde un toque. */
export async function conectarDrive(db = obtenerBD()) {
  token = null;
  await pedirToken({ elegirCuenta: true });
  const yo = await (await api(`${API}/about?fields=user(emailAddress,displayName)`)).json();
  const carpetaId = await buscarOCrearCarpeta();
  const valor = { correo: yo.user?.emailAddress ?? '', nombre: yo.user?.displayName ?? '', carpetaId, conectadoEn: ahoraISO() };
  await db.transaction('rw', db.ajustes, db.historial, async () => {
    await db.ajustes.put({ clave: CLAVE, valor, actualizadoEn: ahoraISO() });
    await registrarHistorial({ entidad: 'respaldo', tipo: 'drive-conectado', despues: { correo: valor.correo } }, db);
  });
  return valor;
}

export async function desconectarDrive(db = obtenerBD()) {
  try {
    if (token && globalThis.google?.accounts?.oauth2?.revoke) globalThis.google.accounts.oauth2.revoke(token.valor, () => {});
  } catch {
    /* sin internet: igual se desconecta aquí */
  }
  token = null;
  await db.transaction('rw', db.ajustes, db.historial, async () => {
    await db.ajustes.put({ clave: CLAVE, valor: null, actualizadoEn: ahoraISO() });
    await registrarHistorial({ entidad: 'respaldo', tipo: 'drive-desconectado' }, db);
  });
}

async function carpeta(db) {
  const c = await obtenerConexion(db);
  if (!c?.carpetaId) throw errorDrive('Primero conecta tu Google Drive.');
  // La carpeta pudo borrarse a mano: se comprueba y, si hace falta, se crea otra.
  const r = await api(`${API}/files/${c.carpetaId}?fields=id,trashed`).catch(() => null);
  const info = r ? await r.json() : null;
  if (info?.id && !info.trashed) return c.carpetaId;
  const nueva = await buscarOCrearCarpeta();
  await db.ajustes.put({ clave: CLAVE, valor: { ...c, carpetaId: nueva }, actualizadoEn: ahoraISO() });
  return nueva;
}

// ---------------------------------------------------------------------------
// Subir, listar, descargar

const tipoDeNombre = (nombre) => (/-fotos-/.test(nombre) ? 'fotos' : /-datos-/.test(nombre) ? 'datos' : 'completo');

/**
 * Sube un respaldo con subida reanudable (por trozos de 8 MB).
 * alProgreso(fraccion 0..1). Devuelve { id, nombre }.
 */
export async function subirRespaldo(blob, nombre, { alProgreso, db = obtenerBD() } = {}) {
  const padre = await carpeta(db);
  const inicio = await api(`${SUBIDA}?uploadType=resumable&fields=id,name`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/zip', 'X-Upload-Content-Length': String(blob.size) },
    body: JSON.stringify({ name: nombre, parents: [padre], mimeType: 'application/zip', appProperties: { ventasLive: 'respaldo', tipo: tipoDeNombre(nombre) } }),
  });
  const destino = inicio.headers.get('Location');
  if (!destino) throw errorDrive('Google Drive no aceptó la subida.');
  let enviado = 0;
  let resultado = null;
  while (enviado < blob.size || blob.size === 0) {
    const fin = Math.min(enviado + TROZO, blob.size);
    const trozo = blob.slice(enviado, fin);
    const r = await entorno.fetch(destino, {
      method: 'PUT',
      headers: { 'Content-Range': blob.size === 0 ? 'bytes */0' : `bytes ${enviado}-${fin - 1}/${blob.size}` },
      body: trozo,
    });
    if (r.status === 308) {
      const rango = r.headers.get('Range');
      enviado = rango ? Number(rango.split('-')[1]) + 1 : enviado;
      alProgreso?.(enviado / blob.size);
      continue;
    }
    if (!r.ok) throw errorDrive(`La subida se cortó (${r.status}). Vuelve a intentarlo.`);
    resultado = await r.json();
    alProgreso?.(1);
    break;
  }
  await db.transaction('rw', db.ajustes, db.historial, async () => {
    await db.ajustes.put({ clave: 'drive.ultimaSubida', valor: { fecha: ahoraISO(), nombre, id: resultado?.id }, actualizadoEn: ahoraISO() });
    await registrarHistorial({ entidad: 'respaldo', tipo: 'respaldo-subido-drive', despues: { nombre, bytes: blob.size } }, db);
  });
  await limpiarDatosViejos(db).catch(() => {});
  return { id: resultado?.id, nombre };
}

/** Respaldos guardados en Drive por esta app (más nuevos primero). */
export async function listarRespaldosDrive(db = obtenerBD()) {
  const padre = await carpeta(db);
  const q = encodeURIComponent(`'${padre}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`);
  const r = await api(`${API}/files?q=${q}&orderBy=createdTime desc&pageSize=200&fields=files(id,name,size,createdTime,appProperties)`);
  const { files = [] } = await r.json();
  return files.map((f) => ({ id: f.id, nombre: f.name, bytes: Number(f.size ?? 0), creado: f.createdTime, tipo: f.appProperties?.tipo ?? tipoDeNombre(f.name) }));
}

/** Descarga un respaldo de Drive como File (para verificarlo y restaurarlo). */
export async function descargarRespaldoDrive(archivo) {
  const r = await api(`${API}/files/${archivo.id}?alt=media`);
  const blob = await r.blob();
  return new File([blob], archivo.nombre, { type: 'application/zip' });
}

/** Deja solo los últimos N respaldos de «datos». Nunca toca los de fotos ni los completos. */
export async function limpiarDatosViejos(db = obtenerBD()) {
  const lista = await listarRespaldosDrive(db);
  const viejos = lista.filter((f) => f.tipo === 'datos').slice(DATOS_A_CONSERVAR);
  for (const f of viejos) await api(`${API}/files/${f.id}`, { method: 'DELETE' });
  return viejos.length;
}
