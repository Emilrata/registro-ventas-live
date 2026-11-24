// Conecta la pantalla de bloqueo con el resto de la app (bloquear desde cualquier pantalla).
import { emit } from '../core/events.js';
import { bloquearSesion } from './seguridad.js';

export function bloquearAhora() {
  bloquearSesion();
  emit('sesion:bloqueada');
}
