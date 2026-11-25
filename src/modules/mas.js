// Pantalla: Más — negocio, seguridad, licencia, estado de la app.
import { h, agregar, reemplazar } from '../ui/dom.js';
import { encabezado, fila, tarjetaInstalacion } from '../ui/componentes.js';
import { obtenerBD, VERSION_ESQUEMA } from '../core/db.js';
import { formatearFecha, formatearFechaHora } from '../core/dates.js';
import { emit } from '../core/events.js';
import { contarRegistros, guardarAjuste, obtenerAjuste } from '../repositories/ajustes.repo.js';
import { obtenerArchivo } from '../repositories/archivos.repo.js';
import {
  estaInstalada,
  estadoAlmacenamiento,
  formatearBytes,
  pedirPersistencia,
} from '../services/almacenamiento.js';
import { guardarMarca, obtenerMarca } from '../services/configuracion.js';
import { licenciaActual } from '../services/licencia.js';
import { cambiarPin, renovarCodigoRecuperacion, verificarPin } from '../services/seguridad.js';
import { bloquearAhora } from '../services/sesion.js';
import { biometriaActiva, biometriaDisponible, activarBiometria, desactivarBiometria } from '../services/biometria.js';
import { confirmar } from '../ui/dialogo.js';
import { mostrarAviso } from '../ui/actualizacion.js';
import { crearTecladoPin } from '../ui/teclado-pin.js';
import { flujoPinNuevo, formularioMarca, vistaCodigoRecuperacion } from '../ui/flujos-acceso.js';

export const OPCIONES_BLOQUEO = [1, 3, 5, 10, 15, 30];

function botonFila(texto, onclick) {
  return h('button', { class: 'accion', type: 'button', onclick }, h('span', {}, texto), h('span', { class: 'accion__flecha', 'aria-hidden': 'true' }, '›'));
}

// --- #/mas ------------------------------------------------------------------
export async function render(contenedor) {
  const db = obtenerBD();
  const [marca, licencia, minutos] = await Promise.all([
    obtenerMarca(db),
    licenciaActual({ db }),
    obtenerAjuste('seguridad.minutosBloqueo', 5, db),
  ]);

  const selector = h(
    'select',
    { class: 'entrada entrada--chica', id: 'minutos-bloqueo' },
    ...OPCIONES_BLOQUEO.map((m) => h('option', { value: String(m), selected: m === minutos }, `${m} min`)),
  );
  selector.addEventListener('change', async () => {
    await guardarAjuste('seguridad.minutosBloqueo', Number(selector.value), db);
    emit('seguridad:minutos-cambiados', Number(selector.value));
    mostrarAviso('Guardado.');
  });

  const tarjetaNegocio = h(
    'section',
    { class: 'tarjeta', 'aria-labelledby': 'negocio-titulo' },
    h('h2', { class: 'tarjeta__titulo', id: 'negocio-titulo' }, 'Negocio'),
    fila('Nombre', marca?.nombre ?? '—'),
    fila('WhatsApp', marca?.whatsapp ?? '—'),
    botonFila('Editar datos del negocio', () => { window.location.hash = '/mas/negocio'; }),
  );

  const [bioDisponible, bioActiva] = await Promise.all([biometriaDisponible(), biometriaActiva(db)]);
  const tarjetaSeguridad = h(
    'section',
    { class: 'tarjeta', 'aria-labelledby': 'seguridad-titulo' },
    h('h2', { class: 'tarjeta__titulo', id: 'seguridad-titulo' }, 'Seguridad'),
    h('div', { class: 'fila' },
      h('label', { class: 'fila__etiqueta', for: 'minutos-bloqueo' }, 'Bloquear tras inactividad'),
      selector),
    botonFila('Bloquear ahora', () => bloquearAhora()),
    botonFila('Cambiar PIN', () => { window.location.hash = '/mas/pin'; }),
    botonFila('Nuevo código de recuperación', () => { window.location.hash = '/mas/recuperacion'; }),
    bioDisponible
      ? bioActiva
        ? botonFila('Desactivar huella / Face ID', async () => {
            if (!(await confirmar({ titulo: 'Desactivar huella / Face ID', texto: 'Solo podrás entrar con tu PIN.', aceptar: 'Desactivar' }))) return;
            await desactivarBiometria(db);
            mostrarAviso('Huella / Face ID desactivada.');
            window.dispatchEvent(new HashChangeEvent('hashchange'));
          })
        : botonFila('Activar huella / Face ID', () => { window.location.hash = '/mas/biometria'; })
      : null,
  );

  const tarjetaLicencia = h(
    'section',
    { class: 'tarjeta', 'aria-labelledby': 'licencia-titulo' },
    h('h2', { class: 'tarjeta__titulo', id: 'licencia-titulo' }, 'Licencia'),
    licencia.ok
      ? [
          fila('Negocio', licencia.datos.negocio),
          fila('Número', licencia.datos.id),
          fila('Emitida', formatearFecha(`${licencia.datos.emitida}T12:00:00`)),
          fila('Vence', licencia.datos.vence ? formatearFecha(`${licencia.datos.vence}T12:00:00`) : 'No vence'),
        ]
      : fila('Estado', licencia.error, { alerta: true }),
  );

  const tarjetaEstado = h('section', { class: 'tarjeta', 'aria-labelledby': 'estado-titulo' });
  const tarjetaDatos = h('section', { class: 'tarjeta', 'aria-labelledby': 'datos-titulo' });

  async function dibujarEstado() {
    const alm = await estadoAlmacenamiento();
    const conexion = navigator.onLine ? 'En línea' : 'Sin conexión';
    reemplazar(tarjetaEstado, 
      h('h2', { class: 'tarjeta__titulo', id: 'estado-titulo' }, 'Estado de la app'),
      fila('Versión', __APP_VERSION__),
      fila('Modo', estaInstalada() ? 'Instalada' : 'En el navegador', { alerta: !estaInstalada() }),
      fila('Conexión', conexion),
      fila('Datos protegidos', alm.persistente ? 'Sí' : 'No', { alerta: !alm.persistente }),
      fila('Espacio usado', formatearBytes(alm.usado)),
      fila('Espacio disponible', formatearBytes(alm.cuota)),
      alm.soportado && !alm.persistente
        ? h(
            'button',
            {
              class: 'boton boton--secundario',
              type: 'button',
              onclick: async () => {
                const ok = await pedirPersistencia();
                mostrarAviso(
                  ok
                    ? 'Listo: el navegador no borrará los datos.'
                    : 'El navegador no lo permitió. Instala la app y vuelve a intentarlo.',
                );
                await dibujarEstado();
              },
            },
            'Proteger datos',
          )
        : null,
    );
  }

  async function dibujarDatos() {
    const conteos = await contarRegistros(db);
    const total = Object.values(conteos).reduce((a, b) => a + b, 0);
    reemplazar(tarjetaDatos, 
      h('h2', { class: 'tarjeta__titulo', id: 'datos-titulo' }, 'Base de datos'),
      fila('Versión del esquema', String(VERSION_ESQUEMA)),
      fila('Tablas', String(Object.keys(conteos).length)),
      fila('Registros', String(total)),
    );
  }

  const ultimoRespaldo = (await obtenerAjuste('respaldo.ultimo', null, db))?.fecha ?? null;
  const tarjetaRespaldos = h(
    'section',
    { class: 'tarjeta', 'aria-labelledby': 'respaldos-titulo' },
    h('h2', { class: 'tarjeta__titulo', id: 'respaldos-titulo' }, 'Respaldos'),
    fila('Último respaldo', ultimoRespaldo ? formatearFechaHora(ultimoRespaldo) : 'Nunca', { alerta: !ultimoRespaldo }),
    botonFila('Crear o restaurar respaldo', () => { window.location.hash = '/mas/respaldos'; }),
  );

  agregar(contenedor, 
    encabezado('Más'),
    tarjetaInstalacion(() => dibujarEstado()) ?? '',
    h('section', { class: 'tarjeta' },
      h('h2', { class: 'tarjeta__titulo' }, 'Informes'),
      botonFila('Estadísticas y Excel', () => { window.location.hash = '/informes'; }),
      botonFila('Vencimientos', () => { window.location.hash = '/vencimientos'; })),
    tarjetaRespaldos,
    tarjetaNegocio,
    tarjetaSeguridad,
    tarjetaLicencia,
    tarjetaEstado,
    tarjetaDatos,
  );
  await Promise.all([dibujarEstado(), dibujarDatos()]);

  const alCambiarConexion = () => dibujarEstado();
  window.addEventListener('online', alCambiarConexion);
  window.addEventListener('offline', alCambiarConexion);
  return () => {
    window.removeEventListener('online', alCambiarConexion);
    window.removeEventListener('offline', alCambiarConexion);
  };
}

function volver() {
  window.location.hash = '/mas';
}

function enlaceVolver() {
  return h('a', { class: 'boton boton--enlace volver', href: '#/mas' }, '‹ Más');
}

// --- #/mas/negocio ------------------------------------------------------------
export async function renderNegocio(contenedor) {
  const marca = await obtenerMarca();
  let logoUrl = null;
  if (marca?.logoId) {
    const a = await obtenerArchivo(marca.logoId);
    if (a?.blob) logoUrl = URL.createObjectURL(a.blob);
  }
  const f = formularioMarca({
    inicial: { nombre: marca?.nombre, whatsapp: marca?.whatsapp, logoUrl },
    textoBoton: 'Guardar',
    alGuardar: async (datos) => {
      const r = await guardarMarca(datos);
      if (r.ok) {
        emit('marca:cambiada');
        mostrarAviso('Datos del negocio guardados.');
        volver();
      }
      return r;
    },
  });
  agregar(contenedor, enlaceVolver(), encabezado('Datos del negocio'), h('section', { class: 'tarjeta' }, f.elemento));
  return () => {
    f.destruir();
    if (logoUrl) URL.revokeObjectURL(logoUrl);
  };
}

// --- #/mas/pin ----------------------------------------------------------------
export async function renderCambiarPin(contenedor) {
  const zona = h('div', { class: 'paso' });
  agregar(contenedor, enlaceVolver(), zona);
  let limpieza = null;

  const teclado = crearTecladoPin({
    titulo: 'PIN actual',
    subtitulo: 'Primero escribe el PIN que usas ahora.',
    alCompletar: async (actual) => {
      const r = await verificarPin(actual);
      if (!r.ok) return r;
      teclado.destruir();
      limpieza = flujoPinNuevo(zona, {
        titulo: 'PIN nuevo',
        alConfirmar: async (nuevo) => {
          const c = await cambiarPin(actual, nuevo);
          if (c.ok) {
            mostrarAviso('PIN cambiado.');
            volver();
          }
          return c;
        },
      });
      return { ok: true };
    },
  });
  agregar(zona, teclado.elemento);
  return () => {
    teclado.destruir();
    limpieza?.();
  };
}

// --- #/mas/recuperacion -------------------------------------------------------
// --- #/mas/biometria: pide el PIN y registra la huella / Face ID -----------------------
export async function renderBiometria(contenedor) {
  const zona = h('div', { class: 'paso' });
  agregar(contenedor, enlaceVolver(), zona);
  const teclado = crearTecladoPin({
    titulo: 'Activar huella / Face ID',
    subtitulo: 'Primero escribe tu PIN. Luego el teléfono te pedirá tu huella o tu cara.',
    alCompletar: async (pin) => {
      const r = await verificarPin(pin);
      if (!r.ok) return r;
      const marca = await obtenerMarca();
      const a = await activarBiometria({ nombreNegocio: marca?.nombre });
      if (!a.ok) {
        teclado.limpiar();
        return { ok: false, error: a.error };
      }
      mostrarAviso('Listo: ya puedes entrar con tu huella o Face ID.');
      volver();
      return { ok: true };
    },
  });
  agregar(zona, teclado.elemento);
  return () => teclado.destruir();
}

export async function renderRecuperacion(contenedor) {
  const zona = h('div', { class: 'paso' });
  agregar(contenedor, enlaceVolver(), zona);
  const teclado = crearTecladoPin({
    titulo: 'Nuevo código de recuperación',
    subtitulo: 'Escribe tu PIN. El código anterior dejará de servir.',
    alCompletar: async (pin) => {
      const r = await renovarCodigoRecuperacion(pin);
      if (!r.ok) return r;
      teclado.destruir();
      reemplazar(zona, 
        vistaCodigoRecuperacion({
          codigo: r.codigo,
          titulo: 'Tu nuevo código',
          textoBoton: 'Listo',
          alConfirmar: async () => volver(),
        }),
      );
      return { ok: true };
    },
  });
  agregar(zona, teclado.elemento);
  return () => teclado.destruir();
}
