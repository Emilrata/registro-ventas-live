// Notificaciones del teléfono para recordar a la dueña a quién avisar.
// NO son notificaciones push desde un servidor: se revisan cuando la app se abre o está abierta.
// En algunos Android con la app instalada, el navegador puede revisar también con la app cerrada
// (sincronización periódica). No se promete: depende del teléfono.
import { obtenerBD } from '../core/db.js';
import { claveDia } from '../core/dates.js';
import { clientasPorAvisar } from './avisos.js';

export const ETIQUETA_SYNC = 'avisos-clientas';

export function notificacionesSoportadas() {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
}

/** 'granted' | 'denied' | 'default' | 'unsupported'. Primero la API de permisos (más fiable), luego Notification. */
export async function permisoNotificaciones() {
  if (!notificacionesSoportadas()) return 'unsupported';
  try {
    const estado = (await navigator.permissions?.query({ name: 'notifications' }))?.state;
    if (estado === 'granted' || estado === 'denied') return estado;
    if (estado === 'prompt') return 'default';
  } catch { /* sin API de permisos */ }
  return Notification.permission;
}

export async function notificacionesActivas(db = obtenerBD()) {
  return (await db.ajustes.get('notificaciones.activas'))?.valor === true && (await permisoNotificaciones()) === 'granted';
}

async function guardar(clave, valor, db) {
  await db.ajustes.put({ clave, valor, actualizadoEn: new Date().toISOString() });
}

async function registroSW() {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

/** Pide permiso y activa. Devuelve { ok, error? }. */
export async function activarNotificaciones(db = obtenerBD()) {
  if (!notificacionesSoportadas()) return { ok: false, error: 'Este navegador no permite notificaciones. Instala la app en la pantalla de inicio.' };
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') {
    return { ok: false, error: 'No diste permiso. Puedes activarlo en los ajustes del navegador o del teléfono (Notificaciones).' };
  }
  await guardar('notificaciones.activas', true, db);
  await guardar('notificaciones.ultima', null, db);
  await registrarRevisionPeriodica();
  await revisarAvisos({ db, forzar: true });
  return { ok: true };
}

export async function desactivarNotificaciones(db = obtenerBD()) {
  await guardar('notificaciones.activas', false, db);
  try {
    const reg = await registroSW();
    await reg?.periodicSync?.unregister(ETIQUETA_SYNC);
  } catch { /* sin soporte */ }
  await ponerInsignia(0);
}

/** Intenta que el navegador revise con la app cerrada (solo algunos Android con la app instalada). */
async function registrarRevisionPeriodica() {
  try {
    const reg = await registroSW();
    if (!reg?.periodicSync) return false;
    const estado = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (estado.state !== 'granted') return false;
    await reg.periodicSync.register(ETIQUETA_SYNC, { minInterval: 12 * 60 * 60 * 1000 });
    return true;
  } catch {
    return false;
  }
}

/** Número en el ícono de la app (donde el teléfono lo permite). */
async function ponerInsignia(n) {
  try {
    if (n > 0) await navigator.setAppBadge?.(n);
    else await navigator.clearAppBadge?.();
  } catch { /* sin soporte */ }
}

/**
 * Cuenta las clientas por avisar, guarda la agenda (para el Service Worker), pone el número en el ícono
 * y muestra una notificación como máximo una vez al día (o si aumentó la cantidad).
 * El texto no incluye nombres ni montos: puede verse con el teléfono bloqueado.
 */
export async function revisarAvisos({ db = obtenerBD(), ahora = new Date(), forzar = false } = {}) {
  const { grupos, agenda } = await clientasPorAvisar({ ahora, db });
  await guardar('notificaciones.agenda', agenda.slice(0, 2000), db);
  if (!(await notificacionesActivas(db))) return { cantidad: grupos.length, notificado: false };
  const cantidad = grupos.length;
  await ponerInsignia(cantidad);
  const hoy = claveDia(ahora);
  const ultima = (await db.ajustes.get('notificaciones.ultima'))?.valor ?? null;
  const toca = cantidad > 0 && (forzar || !ultima || ultima.dia !== hoy || cantidad > ultima.cantidad);
  if (!toca) return { cantidad, notificado: false };
  const reg = await registroSW();
  if (!reg) return { cantidad, notificado: false };
  try {
    await reg.showNotification('Clientas por avisar', {
      body: cantidad === 1
        ? 'Tienes 1 clienta a la que debes avisar que recoja su pedido.'
        : `Tienes ${cantidad} clientas a las que debes avisar que recojan su pedido.`,
      tag: 'avisos-clientas',
      renotify: true,
      icon: '/icons/icon-192.png',
      data: { url: '/#/avisos' },
    });
  } catch (err) {
    console.warn('No se pudo mostrar la notificación', err);
    return { cantidad, notificado: false };
  }
  await guardar('notificaciones.ultima', { dia: hoy, cantidad }, db);
  return { cantidad, notificado: true };
}
