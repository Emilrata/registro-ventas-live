/* Parte del Service Worker para los avisos a clientas (se carga con importScripts).
 * - Al tocar la notificación, abre la app en «Avisos».
 * - Sincronización periódica (solo algunos Android con la app instalada): cuenta los avisos que ya tocan
 *   usando la agenda que guarda la app (solo horas, sin nombres ni montos) y notifica una vez al día.
 *   No modifica pedidos ni nada importante: solo escribe el ajuste 'notificaciones.ultima'. */
'use strict';

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = new URL((event.notification.data && event.notification.data.url) || '/#/panel', self.location.origin).href;
  event.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const v of ventanas) {
      if (new URL(v.url).origin === self.location.origin) {
        await v.focus();
        try { await v.navigate(destino); } catch (e) { /* la app ya muestra su pantalla */ }
        return;
      }
    }
    await self.clients.openWindow(destino);
  })());
});

function abrirBD() {
  return new Promise((resolve, reject) => {
    // Sin versión: abre la versión actual y nunca crea ni migra la base.
    const pet = indexedDB.open('registro-ventas-live');
    pet.onupgradeneeded = () => { pet.transaction.abort(); };
    pet.onsuccess = () => resolve(pet.result);
    pet.onerror = () => reject(pet.error);
  });
}

function leerAjustes(bd, claves) {
  return new Promise((resolve, reject) => {
    const tx = bd.transaction('ajustes', 'readonly');
    const tabla = tx.objectStore('ajustes');
    const salida = {};
    for (const c of claves) {
      const pet = tabla.get(c);
      pet.onsuccess = () => { salida[c] = pet.result ? pet.result.valor : undefined; };
    }
    tx.oncomplete = () => resolve(salida);
    tx.onerror = () => reject(tx.error);
  });
}

function guardarAjuste(bd, clave, valor) {
  return new Promise((resolve, reject) => {
    const tx = bd.transaction('ajustes', 'readwrite');
    tx.objectStore('ajustes').put({ clave, valor, actualizadoEn: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function diaLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function revisarEnSegundoPlano() {
  try {
    const estado = await self.navigator.permissions.query({ name: 'notifications' });
    if (estado.state !== 'granted') return;
  } catch (e) {
    if (self.Notification && self.Notification.permission !== 'granted') return;
  }
  const bd = await abrirBD();
  try {
    const a = await leerAjustes(bd, ['notificaciones.activas', 'notificaciones.agenda', 'notificaciones.ultima']);
    if (a['notificaciones.activas'] !== true) return;
    const ahora = Date.now();
    // Cuenta pedidos (no clientas): la agenda no guarda a quién pertenece cada uno.
    const cantidad = (a['notificaciones.agenda'] || []).filter((t) => t <= ahora).length;
    try {
      if (cantidad > 0 && self.navigator.setAppBadge) await self.navigator.setAppBadge(cantidad);
    } catch (e) { /* sin soporte */ }
    const hoy = diaLocal(new Date());
    const ultima = a['notificaciones.ultima'];
    if (cantidad === 0 || (ultima && ultima.dia === hoy)) return;
    await self.registration.showNotification('Pedidos por avisar', {
      body: cantidad === 1
        ? 'Hay 1 pedido para recoger: avisa a tu clienta.'
        : `Hay ${cantidad} pedidos para recoger: avisa a tus clientas.`,
      tag: 'avisos-clientas',
      icon: '/icons/icon-192.png',
      data: { url: '/#/avisos' },
    });
    // Cantidad de pedidos (≥ clientas): al abrir la app el mismo día no se repite la notificación.
    await guardarAjuste(bd, 'notificaciones.ultima', { dia: hoy, cantidad });
  } finally {
    bd.close();
  }
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'avisos-clientas') event.waitUntil(revisarEnSegundoPlano().catch(() => {}));
});
