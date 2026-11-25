// Punto de entrada de la app.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/instrument-serif/latin-400.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/componentes.css';
import './styles/acceso.css';
import './styles/pedidos.css';

import { abrirBaseDeDatos } from './core/db.js';
import { on } from './core/events.js';
import { crearRouter } from './ui/router.js';
import { h, icono, reemplazar } from './ui/dom.js';
import { ICONOS } from './ui/iconos.js';
import { escucharInstalacion } from './ui/instalacion.js';
import { registrarServiceWorker } from './ui/actualizacion.js';
import { pedirPersistencia } from './services/almacenamiento.js';
import { estadoConfiguracion, obtenerMarca } from './services/configuracion.js';
import {
  debeBloquearsePorInactividad,
  desbloquearSesion,
  registrarActividad,
  sesionDesbloqueada,
} from './services/seguridad.js';
import { bloquearAhora } from './services/sesion.js';
import { revisarAvisos } from './services/notificaciones.js';
import { obtenerAjuste } from './repositories/ajustes.repo.js';
import { obtenerArchivo } from './repositories/archivos.repo.js';

import * as panel from './modules/panel.js';
import * as pedidos from './modules/pedidos.js';
import * as clientes from './modules/clientes.js';
import * as pagos from './modules/pagos.js';
import * as mas from './modules/mas.js';
import * as pedidoForm from './modules/pedido-form.js';
import * as pedidoDetalle from './modules/pedido-detalle.js';
import * as respaldos from './modules/respaldos.js';
import * as pagoForm from './modules/pago-form.js';
import * as entregaForm from './modules/entrega-form.js';
import * as devolucionForm from './modules/devolucion-form.js';
import * as vencimientos from './modules/vencimientos.js';
import * as avisos from './modules/avisos.js';
import { mostrarAsistente } from './modules/bienvenida.js';
import { mostrarBloqueo } from './modules/bloqueo.js';

const RUTAS = {
  '/panel': { titulo: 'Panel', icono: ICONOS.panel, render: panel.render },
  '/pedidos': { titulo: 'Pedidos', icono: ICONOS.pedidos, render: pedidos.render },
  '/clientes': { titulo: 'Clientes', icono: ICONOS.clientes, render: clientes.render },
  '/cobros': { titulo: 'Cobros', icono: ICONOS.cobros, render: pagos.render },
  '/mas': { titulo: 'Más', icono: ICONOS.mas, render: mas.render },
  '/pedidos/nuevo': { titulo: 'Nuevo pedido', render: pedidoForm.render },
  '/pedidos/editar': { titulo: 'Editar pedido', render: pedidoForm.render },
  '/pedidos/ver': { titulo: 'Pedido', render: pedidoDetalle.render },
  '/pedidos/pagar': { titulo: 'Registrar pago', render: pagoForm.render },
  '/pedidos/entregar': { titulo: 'Entregar', render: entregaForm.render },
  '/pedidos/devolver': { titulo: 'Devolución', render: devolucionForm.render },
  // Se carga aparte (incluye la librería de gráficos); igual queda guardado para usarse sin internet.
  '/informes': { titulo: 'Informes', render: async (c, ctx) => (await import('./modules/informes.js')).render(c, ctx) },
  '/vencimientos': { titulo: 'Vencimientos', render: vencimientos.render },
  '/avisos': { titulo: 'Avisos a clientas', render: avisos.render },
  '/grupos/pagar': { titulo: 'Cobrar grupo', render: pagoForm.render },
  '/clientes/ver': { titulo: 'Clienta', render: clientes.renderDetalle },
  '/clientes/editar': { titulo: 'Editar clienta', render: clientes.renderEditar },
  '/mas/respaldos': { titulo: 'Respaldos', render: respaldos.render },
  '/mas/negocio': { titulo: 'Datos del negocio', render: mas.renderNegocio },
  '/mas/licencia': { titulo: 'Renovar licencia', render: mas.renderLicencia },
  '/mas/pin': { titulo: 'Cambiar PIN', render: mas.renderCambiarPin },
  '/mas/biometria': { titulo: 'Huella / Face ID', render: mas.renderBiometria },
  '/mas/recuperacion': { titulo: 'Código de recuperación', render: mas.renderRecuperacion },
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Estructura

function construirNavegacion() {
  const enlaces = Object.entries(RUTAS)
    .filter(([, def]) => def.icono)
    .map(([ruta, def]) =>
      h('a', { class: 'nav__item', href: `#${ruta}`, dataset: { ruta } }, icono(def.icono), h('span', { class: 'nav__texto' }, def.titulo)),
    );
  reemplazar($('navegacion'), ...enlaces);
  return (rutaActiva) => {
    for (const a of enlaces) {
      const activa = rutaActiva === a.dataset.ruta || rutaActiva.startsWith(`${a.dataset.ruta}/`);
      if (activa) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  };
}

function indicadorConexion() {
  const el = $('sin-conexion');
  reemplazar(el, icono(ICONOS.sinConexion), h('span', {}, 'Sin conexión'));
  const actualizar = () => {
    el.hidden = navigator.onLine;
  };
  window.addEventListener('online', actualizar);
  window.addEventListener('offline', actualizar);
  actualizar();
}

let logoUrl = null;
/** Nombre y logo del negocio para la cabecera y la pantalla de bloqueo. */
async function cargarMarca() {
  const marca = await obtenerMarca();
  if (logoUrl) URL.revokeObjectURL(logoUrl);
  logoUrl = null;
  if (marca?.logoId) {
    const archivo = await obtenerArchivo(marca.logoId);
    if (archivo?.blob) logoUrl = URL.createObjectURL(archivo.blob);
  }
  return { nombre: marca?.nombre ?? 'Ventas LIVE', logoUrl };
}

async function dibujarMarca() {
  const m = await cargarMarca();
  reemplazar($('marca'), 
    m.logoUrl ? h('img', { class: 'marca__logo', src: m.logoUrl, alt: '' }) : null,
    h('span', { class: 'marca__nombre' }, m.nombre),
  );
  return m;
}

// ---------------------------------------------------------------------------
// Acceso (asistente / bloqueo) y app

let limpiezaAcceso = null;
let router = null;

function ocultarApp(ocultar) {
  const app = document.querySelector('.app');
  app.hidden = ocultar;
  app.inert = ocultar;
  $('acceso').hidden = !ocultar;
}

async function mostrarAcceso(dibujar) {
  limpiezaAcceso?.();
  limpiezaAcceso = null;
  ocultarApp(true);
  const acceso = $('acceso');
  reemplazar(acceso);
  window.scrollTo(0, 0);
  limpiezaAcceso = await dibujar(acceso);
}

async function pedirPin() {
  const marca = await cargarMarca();
  await mostrarAcceso((c) => mostrarBloqueo(c, { marca, alDesbloquear: entrar }));
}

async function entrar() {
  limpiezaAcceso?.();
  limpiezaAcceso = null;
  desbloquearSesion();
  reemplazar($('acceso'));
  ocultarApp(false);
  await dibujarMarca();
  if (!router) {
    const marcarActiva = construirNavegacion();
    router = crearRouter({
      contenedor: $('vista'),
      rutas: RUTAS,
      rutaInicial: '/panel',
      alCambiar: (ruta) => marcarActiva(ruta),
    });
    await router.iniciar();
  } else {
    await router.refrescar();
  }
  revisarAvisosLuego();
}

// Avisos a clientas: notificación del teléfono y número en el ícono (si están activados).
// Se revisa al entrar, al volver a la app y cada 30 minutos mientras está abierta.
function revisarAvisosLuego() {
  revisarAvisos().catch((e) => console.error(e));
}

async function arrancar() {
  const estado = await estadoConfiguracion();
  if (estado.paso === 'lista') {
    await pedirPin();
    return;
  }
  await mostrarAcceso((c) =>
    mostrarAsistente(c, {
      // Solo se entra directo si la configuración se terminó recién; si no, se pide el PIN.
      alTerminar: ({ recienConfigurada }) => (recienConfigurada ? entrar() : pedirPin()),
    }),
  );
}

async function vigilarInactividad() {
  let minutos = await obtenerAjuste('seguridad.minutosBloqueo', 5);
  on('seguridad:minutos-cambiados', (m) => {
    minutos = m;
  });
  const actividad = () => {
    if (sesionDesbloqueada()) registrarActividad();
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll']) {
    window.addEventListener(ev, actividad, { passive: true, capture: true });
  }
  const revisar = () => {
    if (debeBloquearsePorInactividad(minutos)) bloquearAhora();
  };
  setInterval(revisar, 15000);
  setInterval(revisarAvisosLuego, 30 * 60 * 1000);
  // Al volver a la app (el temporizador se pausa en segundo plano).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      revisar();
      if (sesionDesbloqueada()) revisarAvisosLuego();
    }
  });
}

// ---------------------------------------------------------------------------
// Errores

function pantallaDeError(titulo, texto) {
  limpiezaAcceso?.();
  limpiezaAcceso = null;
  ocultarApp(true);
  reemplazar($('acceso'), 
    h(
      'div',
      { class: 'vacio', role: 'alert' },
      h('p', { class: 'vacio__titulo' }, titulo),
      h('p', { class: 'texto-secundario' }, texto),
      h('button', { class: 'boton boton--primario', type: 'button', onclick: () => window.location.reload() }, 'Volver a intentar'),
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

// ---------------------------------------------------------------------------

async function iniciar() {
  if (window.__navegadorAntiguo) return;
  escucharInstalacion();
  indicadorConexion();
  // Antes de abrir la base: si algo falla, la app igual puede recibir una versión corregida.
  registrarServiceWorker();

  on('bd:bloqueada', () =>
    pantallaDeError('La app está abierta en otra pestaña', 'Cierra las otras pestañas o ventanas de la app y vuelve a intentarlo.'),
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

  const botonBloquear = $('boton-bloquear');
  reemplazar(botonBloquear, icono(ICONOS.candado));
  botonBloquear.hidden = false;
  botonBloquear.addEventListener('click', () => bloquearAhora());
  on('sesion:bloqueada', () => pedirPin());
  on('marca:cambiada', () => dibujarMarca());

  try {
    await arrancar();
    await vigilarInactividad();
  } catch (err) {
    console.error(err);
    pantallaDeError('Ocurrió un error al iniciar', 'Vuelve a intentarlo. Tus datos no se borraron.');
  }
}

iniciar();
