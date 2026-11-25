// Diálogo de confirmación. Devuelve una promesa con true (aceptar) o false.
import { h, agregar } from './dom.js';

export function confirmar({ titulo, texto = '', aceptar = 'Aceptar', cancelar = 'Cancelar', peligro = false }) {
  return new Promise((resolver) => {
    const dialogo = h('dialog', { class: 'dialogo', 'aria-labelledby': 'dialogo-titulo' });
    const terminar = (valor) => {
      dialogo.close();
      dialogo.remove();
      resolver(valor);
    };
    agregar(dialogo, 
      h('h2', { class: 'dialogo__titulo', id: 'dialogo-titulo' }, titulo),
      texto ? h('p', { class: 'texto-secundario' }, texto) : null,
      h(
        'div',
        { class: 'dialogo__acciones' },
        h('button', { class: 'boton boton--secundario', type: 'button', onclick: () => terminar(false) }, cancelar),
        h(
          'button',
          { class: `boton ${peligro ? 'boton--peligro' : 'boton--primario'}`, type: 'button', onclick: () => terminar(true) },
          aceptar,
        ),
      ),
    );
    dialogo.addEventListener('cancel', (e) => {
      e.preventDefault();
      terminar(false);
    });
    agregar(document.body, dialogo);
    dialogo.showModal();
  });
}

/** Pide un texto corto (por ejemplo, un motivo). Devuelve el texto o null si se cancela. */
export function pedirTexto({ titulo, texto = '', etiqueta = 'Motivo', aceptar = 'Aceptar', peligro = false, maximo = 200 }) {
  return new Promise((resolver) => {
    const dialogo = h('dialog', { class: 'dialogo', 'aria-labelledby': 'dialogo-titulo' });
    const entrada = h('input', { class: 'entrada', id: 'dialogo-entrada', type: 'text', maxlength: String(maximo), autocomplete: 'off' });
    const error = h('p', { class: 'error-campo', role: 'alert' });
    const terminar = (valor) => {
      dialogo.close();
      dialogo.remove();
      resolver(valor);
    };
    const enviar = () => {
      if (!entrada.value.trim()) {
        error.textContent = `Escribe: ${etiqueta.toLowerCase()}.`;
        entrada.focus();
        return;
      }
      terminar(entrada.value.trim());
    };
    entrada.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        enviar();
      }
    });
    agregar(
      dialogo,
      h('h2', { class: 'dialogo__titulo', id: 'dialogo-titulo' }, titulo),
      texto ? h('p', { class: 'texto-secundario' }, texto) : null,
      h('div', { class: 'campo' }, h('label', { class: 'campo__etiqueta', for: 'dialogo-entrada' }, etiqueta), entrada, error),
      h(
        'div',
        { class: 'dialogo__acciones' },
        h('button', { class: 'boton boton--secundario', type: 'button', onclick: () => terminar(null) }, 'Cancelar'),
        h('button', { class: `boton ${peligro ? 'boton--peligro' : 'boton--primario'}`, type: 'button', onclick: enviar }, aceptar),
      ),
    );
    dialogo.addEventListener('cancel', (e) => {
      e.preventDefault();
      terminar(null);
    });
    agregar(document.body, dialogo);
    dialogo.showModal();
    entrada.focus();
  });
}
