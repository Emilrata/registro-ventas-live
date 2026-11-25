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
