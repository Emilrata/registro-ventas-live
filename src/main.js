// Punto de entrada de la app.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/instrument-serif/latin-400.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/componentes.css';

import { abrirBaseDeDatos } from './core/db.js';
import { on } from './core/events.js';
import { crearRouter } from './ui/router.js';
import { h, icono } from './ui/dom.js';
import { ICONOS } from './ui/iconos.js';
import { escucharInstalacion } from './ui/instalacion.js';
import { registrarServiceWorker } from './ui/actualizacion.js';
import { pedirPersistencia } from './services/almacenamiento.js';

import * as panel from './modules/panel.js';
import * as pedidos from './modules/pedidos.js';
import * as clientes from './modules/clientes.js';
import * as pagos from './modules/pagos.js';
import * as mas from './modules/mas.js';

const RUTAS = {
  '/panel': { titulo: 'Panel', icono: ICONOS.panel, render: panel.render },
  '/pedidos': { titulo: 'Pedidos', icono: ICONOS.pedidos, render: pedidos.render },
  '/clientes': { titulo: 'Clientes', icono: ICONOS.clientes, render: clientes.render },
  '/cobros': { titulo: 'Cobros', icono: ICONOS.cobros, render: pagos.render },
  '/mas': { titulo: 'Más', icono: ICONOS.mas, render: mas.render },
};

function construirNavegacion() {
  const nav = document.getElementById('navegacion');
  const enlaces = Object.entries(RUTAS).map(([ruta, def]) =>
    h(
      'a',
      { class: 'nav__item', href: `#${ruta}`, dataset: { ruta } },
      icono(def.icono),
      h('span', { class: 'nav__texto' }, def.titulo),
    ),
  );
  nav.replaceChildren(...enlaces);
  return (rutaActiva) => {
    for (const a of enlaces) {
      if (a.dataset.ruta === rutaActiva) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  };
}

function indicadorConexion() {
  const el = document.getElementById('sin-conexion');
  el.replaceChildren(icono(ICONOS.sinConexion), h('span', {}, 'Sin conexión'));
  const actualizar = () => {
    el.hidden = navigator.onLine;
  };
  window.addEventListener('online', actualizar);
  window.addEventListener('offline', actualizar);
  actualizar();
}

function pantallaDeError(titulo, texto) {
  document.getElementById('navegacion').hidden = true;
  document
    .getElementById('vista')
    .replaceChildren(
      h(
        'div',
        { class: 'vacio', role: 'alert' },
        h('p', { class: 'vacio__titulo' }, titulo),
        h('p', { class: 'texto-secundario' }, texto),
        h(
          'button',
          { class: 'boton boton--primario', type: 'button', onclick: () => window.location.reload() },
          'Volver a intentar',
        ),
      ),
    );
}

function explicarErrorBD(err) {
  console.error(err);
  if (err?.name === 'VersionMasNuevaError' || err?.name === 'VersionError') {
    return pantallaDeError(
      'Hay que actualizar la app',
      'Los datos son de una versión más nueva. Cierra la app por completo y ábrela con internet.',
    );
  }
  if (err?.name === 'MissingAPIError' || err?.name === 'InvalidStateError') {
    return pantallaDeError(
      'Este navegador no guarda datos',
      'Puede estar en modo privado o incógnito. Abre la app en una ventana normal.',
    );
  }
  if (err?.name === 'QuotaExceededError') {
    return pantallaDeError('No hay espacio', 'Libera espacio en el dispositivo y vuelve a abrir la app.');
  }
  return pantallaDeError(
    'No se pudo abrir la base de datos',
    'Cierra otras pestañas de la app y vuelve a intentarlo. Tus datos no se borraron.',
  );
}

async function iniciar() {
  escucharInstalacion();
  indicadorConexion();
  // Se registra antes de abrir la base: si algo falla, la app igual puede recibir una versión corregida.
  registrarServiceWorker();

  on('bd:bloqueada', () =>
    pantallaDeError(
      'La app está abierta en otra pestaña',
      'Cierra las otras pestañas o ventanas de la app y vuelve a intentarlo.',
    ),
  );
  on('bd:version-cambiada', () =>
    pantallaDeError('Se instaló una versión nueva', 'Recarga para seguir trabajando con la versión actual.'),
  );

  try {
    await abrirBaseDeDatos();
  } catch (err) {
    explicarErrorBD(err);
    return;
  }

  pedirPersistencia(); // sin esperar: el navegador decide

  const marcarActiva = construirNavegacion();
  const router = crearRouter({
    contenedor: document.getElementById('vista'),
    rutas: RUTAS,
    rutaInicial: '/panel',
    alCambiar: (ruta) => marcarActiva(ruta),
  });
  await router.iniciar();
}

iniciar();
