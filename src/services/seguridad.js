// Acceso con PIN. El PIN protege el acceso a la app; NO cifra los datos.
// - PIN de 6 dígitos guardado como hash PBKDF2-SHA256 (sal de 16 bytes, 300.000 iteraciones).
// - 5 intentos fallidos → espera de 30 s, que se duplica en cada nueva serie.
// - Código de recuperación de 12 caracteres, mostrado una sola vez (se guarda solo su hash).

import { obtenerBD } from '../core/db.js';
import { ahoraISO } from '../core/dates.js';
import { PBKDF2_ITERACIONES, bytesAleatorios, derivarPBKDF2, verificarPBKDF2 } from '../core/crypto.js';
import { registrarHistorial } from '../repositories/historial.repo.js';

export const LARGO_PIN = 6;
export const INTENTOS_POR_SERIE = 5;
export const ESPERA_INICIAL_MS = 30 * 1000;
export const ESPERA_MAXIMA_MS = 24 * 60 * 60 * 1000;

const CLAVE_PIN = 'seguridad.pin';
const CLAVE_RECUPERACION = 'seguridad.recuperacion';
const CLAVE_INTENTOS_PIN = 'seguridad.intentosPin';
const CLAVE_INTENTOS_RECUPERACION = 'seguridad.intentosRecuperacion';

// Iteraciones configurables solo para pruebas automáticas.
let iteraciones = PBKDF2_ITERACIONES;
export function _usarIteraciones(n) {
  iteraciones = n;
}

// ---------------------------------------------------------------------------
// Validación

const PINES_PROHIBIDOS = new Set(['123456', '654321', '012345', '543210', '123123', '121212']);

export function validarPinNuevo(pin) {
  if (typeof pin !== 'string' || !new RegExp(`^\\d{${LARGO_PIN}}$`).test(pin)) {
    return { ok: false, error: `El PIN debe tener ${LARGO_PIN} números.` };
  }
  if (/^(\d)\1+$/.test(pin) || PINES_PROHIBIDOS.has(pin)) {
    return { ok: false, error: 'Ese PIN es muy fácil de adivinar. Elige otro.' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Intentos fallidos

export function esperaDeSerie(serie) {
  if (serie < 1) return 0;
  return Math.min(ESPERA_INICIAL_MS * 2 ** (serie - 1), ESPERA_MAXIMA_MS);
}

const INTENTOS_VACIOS = { fallidos: 0, series: 0, bloqueadoHasta: 0 };

async function leerIntentos(clave, db) {
  return (await db.ajustes.get(clave))?.valor ?? { ...INTENTOS_VACIOS };
}

/** Milisegundos que faltan para poder intentar otra vez (0 = puede intentar). */
function esperaRestante(intentos, ahora) {
  const resta = intentos.bloqueadoHasta - ahora;
  if (resta <= 0) return 0;
  // Si el reloj se atrasó, nunca esperar más que la espera de la serie actual.
  return Math.min(resta, esperaDeSerie(intentos.series));
}

export async function estadoIntentos({ recuperacion = false, ahora = Date.now(), db = obtenerBD() } = {}) {
  const intentos = await leerIntentos(recuperacion ? CLAVE_INTENTOS_RECUPERACION : CLAVE_INTENTOS_PIN, db);
  return {
    esperaMs: esperaRestante(intentos, ahora),
    intentosRestantes: INTENTOS_POR_SERIE - intentos.fallidos,
  };
}

async function anotarResultado(clave, acierto, ahora, db) {
  return db.transaction('rw', db.ajustes, async () => {
    const intentos = await leerIntentos(clave, db);
    let nuevo;
    if (acierto) {
      nuevo = { ...INTENTOS_VACIOS };
    } else {
      nuevo = { ...intentos, fallidos: intentos.fallidos + 1 };
      if (nuevo.fallidos >= INTENTOS_POR_SERIE) {
        nuevo.series += 1;
        nuevo.fallidos = 0;
        nuevo.bloqueadoHasta = ahora + esperaDeSerie(nuevo.series);
      }
    }
    await db.ajustes.put({ clave, valor: nuevo, actualizadoEn: ahoraISO() });
    return nuevo;
  });
}

// ---------------------------------------------------------------------------
// PIN

export async function tienePin(db = obtenerBD()) {
  return Boolean((await db.ajustes.get(CLAVE_PIN))?.valor?.hash);
}

async function guardarPin(pin, tipo, db, extra = async () => {}) {
  const v = validarPinNuevo(pin);
  if (!v.ok) return v;
  const hash = await derivarPBKDF2(pin, { iteraciones });
  await db.transaction('rw', db.ajustes, db.historial, async () => {
    await db.ajustes.put({ clave: CLAVE_PIN, valor: { ...hash, creadoEn: ahoraISO() }, actualizadoEn: ahoraISO() });
    await db.ajustes.put({ clave: CLAVE_INTENTOS_PIN, valor: { ...INTENTOS_VACIOS }, actualizadoEn: ahoraISO() });
    await registrarHistorial({ entidad: 'seguridad', tipo }, db);
    await extra();
  });
  return { ok: true };
}

/** PIN de la configuración inicial (solo mientras la configuración no esté terminada). */
export async function crearPinInicial(pin, db = obtenerBD()) {
  if ((await db.ajustes.get('configuracion.completa'))?.valor === true) {
    return { ok: false, error: 'El PIN ya fue creado. Usa «Cambiar PIN».' };
  }
  return guardarPin(pin, 'pin-creado', db);
}

/**
 * Comprueba el PIN respetando las esperas.
 * Devuelve { ok: true } o { ok: false, error, esperaMs, intentosRestantes }.
 */
export async function verificarPin(pin, { ahora = Date.now(), db = obtenerBD() } = {}) {
  const intentos = await leerIntentos(CLAVE_INTENTOS_PIN, db);
  const espera = esperaRestante(intentos, ahora);
  if (espera > 0) return { ok: false, error: 'Demasiados intentos. Espera un momento.', esperaMs: espera };

  const guardado = (await db.ajustes.get(CLAVE_PIN))?.valor;
  if (!guardado) return { ok: false, error: 'Todavía no hay un PIN creado.' };
  const acierto = typeof pin === 'string' && (await verificarPBKDF2(pin, guardado));
  const nuevo = await anotarResultado(CLAVE_INTENTOS_PIN, acierto, ahora, db);
  if (acierto) return { ok: true };
  const esperaMs = esperaRestante(nuevo, ahora);
  return {
    ok: false,
    error: esperaMs > 0 ? 'Demasiados intentos. Espera un momento.' : 'PIN incorrecto.',
    esperaMs,
    intentosRestantes: INTENTOS_POR_SERIE - nuevo.fallidos,
  };
}

export async function cambiarPin(actual, nuevo, { ahora = Date.now(), db = obtenerBD() } = {}) {
  const v = validarPinNuevo(nuevo);
  if (!v.ok) return v;
  const r = await verificarPin(actual, { ahora, db });
  if (!r.ok) return { ...r, error: r.esperaMs > 0 ? r.error : 'El PIN actual no es correcto.' };
  return guardarPin(nuevo, 'pin-cambiado', db);
}

// ---------------------------------------------------------------------------
// Código de recuperación

// Sin letras que se confunden (I, L, O, U). 32 símbolos → 256 % 32 = 0, sin sesgo.
const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const LARGO_RECUPERACION = 12;

export function generarCodigoRecuperacion() {
  const b = bytesAleatorios(LARGO_RECUPERACION);
  return [...b].map((x) => ALFABETO[x % 32]).join('');
}

/** "ABCD1234EFGH" → "ABCD-1234-EFGH" */
export function formatearCodigoRecuperacion(codigo) {
  return codigo.match(/.{1,4}/g).join('-');
}

/** Acepta minúsculas, guiones y espacios; corrige O→0 e I/L→1. */
export function normalizarCodigoRecuperacion(texto) {
  if (typeof texto !== 'string') return '';
  return texto
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

async function hashRecuperacion(codigo) {
  return { ...(await derivarPBKDF2(normalizarCodigoRecuperacion(codigo), { iteraciones })), creadoEn: ahoraISO() };
}

/**
 * Termina la configuración inicial: guarda el hash del código de recuperación
 * y marca la configuración como completa, en una sola transacción.
 */
export async function finalizarConfiguracion(codigoRecuperacion, db = obtenerBD()) {
  if (!(await tienePin(db))) throw new Error('Falta crear el PIN.');
  const hash = await hashRecuperacion(codigoRecuperacion);
  await db.transaction('rw', db.ajustes, db.historial, async () => {
    await db.ajustes.put({ clave: CLAVE_RECUPERACION, valor: hash, actualizadoEn: ahoraISO() });
    await db.ajustes.put({ clave: 'configuracion.completa', valor: true, actualizadoEn: ahoraISO() });
    await registrarHistorial({ entidad: 'seguridad', tipo: 'configuracion-completa' }, db);
  });
}

/** Reemplaza el código de recuperación (pide el PIN). Devuelve { ok, codigo }. */
export async function renovarCodigoRecuperacion(pin, { ahora = Date.now(), db = obtenerBD() } = {}) {
  const r = await verificarPin(pin, { ahora, db });
  if (!r.ok) return r;
  const codigo = generarCodigoRecuperacion();
  const hash = await hashRecuperacion(codigo);
  await db.transaction('rw', db.ajustes, db.historial, async () => {
    await db.ajustes.put({ clave: CLAVE_RECUPERACION, valor: hash, actualizadoEn: ahoraISO() });
    await registrarHistorial({ entidad: 'seguridad', tipo: 'recuperacion-renovada' }, db);
  });
  return { ok: true, codigo };
}

/**
 * Usa el código de recuperación para poner un PIN nuevo.
 * El código usado deja de servir y se entrega uno nuevo para anotar.
 * Devuelve { ok: true, codigo } o { ok: false, error, esperaMs }.
 */
export async function recuperarConCodigo(texto, pinNuevo, { ahora = Date.now(), db = obtenerBD() } = {}) {
  const v = validarPinNuevo(pinNuevo);
  if (!v.ok) return v;

  const intentos = await leerIntentos(CLAVE_INTENTOS_RECUPERACION, db);
  const espera = esperaRestante(intentos, ahora);
  if (espera > 0) return { ok: false, error: 'Demasiados intentos. Espera un momento.', esperaMs: espera };

  const guardado = (await db.ajustes.get(CLAVE_RECUPERACION))?.valor;
  if (!guardado) return { ok: false, error: 'No hay código de recuperación guardado.' };
  const codigo = normalizarCodigoRecuperacion(texto);
  const acierto = codigo.length === LARGO_RECUPERACION && (await verificarPBKDF2(codigo, guardado));
  const nuevo = await anotarResultado(CLAVE_INTENTOS_RECUPERACION, acierto, ahora, db);
  if (!acierto) {
    const esperaMs = esperaRestante(nuevo, ahora);
    return {
      ok: false,
      error: esperaMs > 0 ? 'Demasiados intentos. Espera un momento.' : 'El código de recuperación no es correcto.',
      esperaMs,
    };
  }

  const codigoNuevo = generarCodigoRecuperacion();
  const hashNuevo = await hashRecuperacion(codigoNuevo);
  const r = await guardarPin(pinNuevo, 'pin-recuperado', db, async () => {
    await db.ajustes.put({ clave: CLAVE_RECUPERACION, valor: hashNuevo, actualizadoEn: ahoraISO() });
  });
  if (!r.ok) return r;
  return { ok: true, codigo: codigoNuevo };
}

// ---------------------------------------------------------------------------
// Sesión (en memoria): bloqueada al abrir la app y tras inactividad.

let desbloqueada = false;
let ultimaActividad = Date.now();

export function sesionDesbloqueada() {
  return desbloqueada;
}

export function desbloquearSesion() {
  desbloqueada = true;
  ultimaActividad = Date.now();
}

export function bloquearSesion() {
  desbloqueada = false;
}

export function registrarActividad(ahora = Date.now()) {
  ultimaActividad = ahora;
}

/** ¿Pasó el tiempo de inactividad? minutos = 0 desactiva el bloqueo automático. */
export function debeBloquearsePorInactividad(minutos, ahora = Date.now()) {
  return desbloqueada && minutos > 0 && ahora - ultimaActividad >= minutos * 60 * 1000;
}
