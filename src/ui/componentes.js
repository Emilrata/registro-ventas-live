// Piezas de interfaz reutilizables.
import { h, icono } from './dom.js';
import { ICONOS } from './iconos.js';
import { esIOS, estaInstalada } from '../services/almacenamiento.js';
import { instalar, puedeInstalarConBoton } from './instalacion.js';

export function encabezado(titulo, subtitulo) {
  return h(
    'header',
    { class: 'pantalla__encabezado' },
    h('h1', { class: 'titulo', tabindex: '-1' }, titulo),
    subtitulo ? h('p', { class: 'texto-secundario' }, subtitulo) : null,
  );
}

export function estadoVacio(titulo, texto) {
  return h(
    'div',
    { class: 'vacio' },
    h('p', { class: 'vacio__titulo' }, titulo),
    texto ? h('p', { class: 'texto-secundario' }, texto) : null,
  );
}

export function fila(etiqueta, valor, { alerta = false } = {}) {
  return h(
    'div',
    { class: 'fila' },
    h('span', { class: 'fila__etiqueta' }, etiqueta),
    h('span', { class: `fila__valor numero${alerta ? ' texto-alerta' : ''}` }, valor),
  );
}

/**
 * Tarjeta que pide instalar la app. Devuelve null si ya está instalada.
 * En iPhone la instalación es obligatoria para que Safari no borre los datos.
 */
export function tarjetaInstalacion(alInstalar) {
  if (estaInstalada()) return null;

  if (esIOS()) {
    return h(
      'section',
      { class: 'tarjeta tarjeta--destacada', 'aria-labelledby': 'instalar-titulo' },
      h('h2', { class: 'tarjeta__titulo', id: 'instalar-titulo' }, 'Instala la app en tu iPhone'),
      h(
        'p',
        { class: 'texto-secundario' },
        'Es obligatorio: en Safari, si no está en la pantalla de inicio, el teléfono puede borrar los datos.',
      ),
      h(
        'ol',
        { class: 'pasos' },
        h('li', {}, 'Abre esta página en Safari.'),
        h('li', {}, 'Toca ', icono(ICONOS.compartir), ' Compartir.'),
        h('li', {}, 'Elige «Agregar a pantalla de inicio» y luego «Agregar».'),
        h('li', {}, 'Abre la app desde el ícono nuevo.'),
      ),
    );
  }

  const conBoton = puedeInstalarConBoton();
  return h(
    'section',
    { class: 'tarjeta tarjeta--destacada', 'aria-labelledby': 'instalar-titulo' },
    h('h2', { class: 'tarjeta__titulo', id: 'instalar-titulo' }, 'Instala la app'),
    h(
      'p',
      { class: 'texto-secundario' },
      'Instalada abre más rápido, funciona sin internet y protege mejor tus datos.',
    ),
    conBoton
      ? h(
          'button',
          {
            class: 'boton boton--primario',
            type: 'button',
            onclick: async () => {
              const ok = await instalar();
              alInstalar?.(ok);
            },
          },
          icono(ICONOS.descargar),
          'Instalar',
        )
      : h(
          'p',
          { class: 'texto-secundario' },
          'Usa el menú del navegador (⋮) y elige «Instalar app» o «Agregar a pantalla de inicio».',
        ),
  );
}
