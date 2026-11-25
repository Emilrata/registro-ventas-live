// Registro del Service Worker. Las versiones nuevas NO se activan solas:
// se pregunta antes, para no recargar en medio de un registro.

import { registerSW } from 'virtual:pwa-register';
import { h, agregar } from './dom.js';

export function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  const actualizar = registerSW({
    immediate: true,
    onNeedRefresh() {
      mostrarAvisoActualizacion(() => actualizar(true));
    },
    onOfflineReady() {
      mostrarAviso('La app ya funciona sin internet.');
    },
    onRegisteredSW(_url, registro) {
      // Revisa si hay versión nueva cada hora mientras la app está abierta.
      if (registro) setInterval(() => registro.update().catch(() => {}), 60 * 60 * 1000);
    },
    onRegisterError(err) {
      console.error('No se pudo registrar el Service Worker', err);
    },
  });
}

function zonaAvisos() {
  return document.getElementById('avisos');
}

export function mostrarAviso(texto, { duracion = 4000 } = {}) {
  const aviso = h('div', { class: 'toast', role: 'status' }, texto);
  agregar(zonaAvisos(), aviso);
  setTimeout(() => aviso.remove(), duracion);
}

function mostrarAvisoActualizacion(alAceptar) {
  if (document.getElementById('aviso-actualizacion')) return;
  const aviso = h(
    'div',
    { class: 'toast toast--accion', id: 'aviso-actualizacion', role: 'alert' },
    h('span', {}, 'Hay una versión nueva de la app.'),
    h(
      'button',
      {
        class: 'boton boton--primario boton--chico',
        type: 'button',
        onclick: (e) => {
          e.currentTarget.disabled = true;
          e.currentTarget.textContent = 'Actualizando…';
          alAceptar();
        },
      },
      'Actualizar',
    ),
  );
  agregar(zonaAvisos(), aviso);
}
