// Instalación en pantalla de inicio (Android/Windows con aviso del navegador,
// iPhone/iPad con instrucciones manuales) y aviso de actualización.

import { emit } from '../core/events.js';
import { estaInstalada } from '../services/almacenamiento.js';

let eventoInstalar = null;

export function escucharInstalacion() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // mostramos nuestro propio botón
    eventoInstalar = e;
    emit('instalacion:disponible');
  });
  window.addEventListener('appinstalled', () => {
    eventoInstalar = null;
    emit('instalacion:hecha');
  });
}

export function puedeInstalarConBoton() {
  return eventoInstalar !== null && !estaInstalada();
}

/** Muestra el aviso del navegador. Devuelve true si la persona aceptó. */
export async function instalar() {
  if (!eventoInstalar) return false;
  const e = eventoInstalar;
  eventoInstalar = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  if (outcome !== 'accepted') emit('instalacion:rechazada');
  return outcome === 'accepted';
}
