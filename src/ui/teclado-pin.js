// Teclado numérico para escribir el PIN de 6 dígitos.
import { h } from './dom.js';
import { LARGO_PIN } from '../services/seguridad.js';

/** "1 min 05 s" / "25 s" */
export function formatearEspera(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m} min ${String(r).padStart(2, '0')} s` : `${m} min`;
  const horas = Math.floor(m / 60);
  return `${horas} h ${String(m % 60).padStart(2, '0')} min`;
}

/**
 * alCompletar(pin) → Promise<{ ok, error?, esperaMs? }>.
 * Devuelve { elemento, destruir, mostrarEspera(ms), limpiar() }.
 */
export function crearTecladoPin({ titulo, subtitulo = '', alCompletar, esperaInicialMs = 0 }) {
  let digitos = '';
  let ocupado = false;
  let temporizador = null;

  const puntos = Array.from({ length: LARGO_PIN }, () => h('span', { class: 'pin__punto' }));
  const lector = h('span', { class: 'solo-lectores', 'aria-live': 'polite' });
  const mensaje = h('p', { class: 'pin__mensaje', role: 'alert' });
  const teclas = [];

  const tecla = (texto, accion, etiqueta) => {
    const b = h('button', { class: 'pin__tecla', type: 'button', 'aria-label': etiqueta ?? texto, onclick: accion }, texto);
    teclas.push(b);
    return b;
  };

  const rejilla = h(
    'div',
    { class: 'pin__teclado' },
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => tecla(n, () => agregar(n))),
    h('span'),
    tecla('0', () => agregar('0')),
    tecla('⌫', () => borrar(), 'Borrar'),
  );

  const elemento = h(
    'div',
    { class: 'pin' },
    h('h1', { class: 'titulo pin__titulo', tabindex: '-1' }, titulo),
    subtitulo ? h('p', { class: 'texto-secundario pin__subtitulo' }, subtitulo) : null,
    h('div', { class: 'pin__puntos', 'aria-hidden': 'true' }, ...puntos),
    lector,
    mensaje,
    rejilla,
  );

  function dibujar() {
    puntos.forEach((p, i) => p.classList.toggle('pin__punto--lleno', i < digitos.length));
    lector.textContent = `${digitos.length} de ${LARGO_PIN} números`;
  }

  function habilitar(si) {
    for (const t of teclas) t.disabled = !si;
  }

  function agregar(n) {
    if (ocupado || digitos.length >= LARGO_PIN) return;
    digitos += n;
    mensaje.textContent = '';
    elemento.classList.remove('pin--error');
    dibujar();
    if (digitos.length === LARGO_PIN) enviar();
  }

  function borrar() {
    if (ocupado) return;
    digitos = digitos.slice(0, -1);
    dibujar();
  }

  async function enviar() {
    ocupado = true;
    habilitar(false);
    const pin = digitos;
    let r;
    try {
      r = await alCompletar(pin);
    } catch (err) {
      console.error(err);
      r = { ok: false, error: 'Ocurrió un error. Vuelve a intentarlo.' };
    }
    if (!elemento.isConnected) return;
    if (r?.ok) return; // quien llama cambia de pantalla
    digitos = '';
    dibujar();
    ocupado = false;
    elemento.classList.add('pin--error');
    if (r?.esperaMs > 0) {
      mostrarEspera(r.esperaMs);
    } else {
      mensaje.textContent = r?.error ?? 'PIN incorrecto.';
      if (r?.intentosRestantes > 0 && r.intentosRestantes <= 2) {
        mensaje.textContent += ` Te quedan ${r.intentosRestantes} ${r.intentosRestantes === 1 ? 'intento' : 'intentos'}.`;
      }
      habilitar(true);
    }
  }

  function mostrarEspera(ms) {
    clearInterval(temporizador);
    const fin = Date.now() + ms;
    habilitar(false);
    ocupado = true;
    const tic = () => {
      const resta = fin - Date.now();
      if (resta <= 0) {
        clearInterval(temporizador);
        ocupado = false;
        habilitar(true);
        mensaje.textContent = 'Ya puedes intentar otra vez.';
        return;
      }
      mensaje.textContent = `Demasiados intentos. Espera ${formatearEspera(resta)}.`;
    };
    tic();
    temporizador = setInterval(tic, 1000);
  }

  function alTeclear(e) {
    if (!elemento.isConnected || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      agregar(e.key);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      borrar();
    }
  }
  document.addEventListener('keydown', alTeclear);

  dibujar();
  if (esperaInicialMs > 0) mostrarEspera(esperaInicialMs);

  return {
    elemento,
    mostrarEspera,
    limpiar() {
      digitos = '';
      ocupado = false;
      habilitar(true);
      dibujar();
    },
    destruir() {
      clearInterval(temporizador);
      document.removeEventListener('keydown', alTeclear);
    },
  };
}
