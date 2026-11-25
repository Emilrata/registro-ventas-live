// Asistente de primera configuración: bienvenida → licencia → marca → PIN → código de recuperación.
import { h, reemplazar } from '../ui/dom.js';
import { tarjetaInstalacion } from '../ui/componentes.js';
import { flujoPinNuevo, formularioMarca, vistaCodigoRecuperacion } from '../ui/flujos-acceso.js';
import { esIOS, estaInstalada } from '../services/almacenamiento.js';
import { activarLicencia } from '../services/licencia.js';
import { estadoConfiguracion, guardarMarca } from '../services/configuracion.js';
import { crearPinInicial, finalizarConfiguracion, generarCodigoRecuperacion } from '../services/seguridad.js';
import { on } from '../core/events.js';
import { obtenerBD } from '../core/db.js';
import { panelRestaurar } from '../ui/restaurar-ui.js';

const PASOS = ['licencia', 'marca', 'pin', 'recuperacion'];

/**
 * Muestra el asistente dentro de `contenedor`.
 * alTerminar({ recienConfigurada }) se llama al final. recienConfigurada = true solo si
 * este asistente terminó la configuración (si ya estaba terminada, hay que pedir el PIN).
 */
export async function mostrarAsistente(contenedor, { alTerminar }) {
  let limpieza = null;
  let recienConfigurada = false;
  let quitarOyentes = [];

  const limpiar = () => {
    limpieza?.();
    limpieza = null;
    quitarOyentes.forEach((f) => f());
    quitarOyentes = [];
  };

  const progreso = (paso) => {
    const i = PASOS.indexOf(paso);
    return h('p', { class: 'progreso texto-secundario numero' }, `Paso ${i + 1} de ${PASOS.length}`);
  };

  const pantalla = (...hijos) => {
    reemplazar(contenedor, h('div', { class: 'paso' }, ...hijos));
    contenedor.querySelector('h1')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  };

  async function siguiente() {
    limpiar();
    const estado = await estadoConfiguracion();
    if (estado.paso === 'lista') {
      alTerminar({ recienConfigurada });
      return;
    }
    mostrarPaso(estado.paso, estado);
  }

  function mostrarPaso(paso, estado) {
    if (paso === 'licencia') return pasoLicencia();
    if (paso === 'marca') return pasoMarca(estado);
    if (paso === 'pin') return pasoPin();
    if (paso === 'recuperacion') return pasoRecuperacion();
    return undefined;
  }

  // --- Bienvenida -----------------------------------------------------------
  function pasoInicio() {
    const dibujar = () => {
      // En iPhone/iPad los datos de Safari y los de la app instalada están separados:
      // hay que instalar ANTES de configurar, o se perdería todo al instalar.
      const bloqueaIOS = esIOS() && !estaInstalada();
      pantalla(
        h('h1', { class: 'titulo titulo--grande', tabindex: '-1' }, 'Bienvenida'),
        h(
          'p',
          { class: 'texto-secundario' },
          'Registra los pedidos de tus transmisiones LIVE, los cobros y las entregas. Todo se guarda en este dispositivo y funciona sin internet.',
        ),
        tarjetaInstalacion(dibujar),
        bloqueaIOS
          ? h('p', { class: 'aviso' }, 'Cuando abras la app desde el ícono de tu pantalla de inicio, podrás continuar.')
          : h('button', { class: 'boton boton--primario boton--ancho', type: 'button', onclick: () => pasoLicencia() }, 'Empezar'),
        h('p', { class: 'campo__ayuda' }, 'Al continuar aceptas los ',
          h('a', { href: '/legal/terminos/' }, 'Términos y condiciones'), ' y la ',
          h('a', { href: '/legal/privacidad/' }, 'Política de privacidad'), '.'),
      );
    };
    dibujar();
    quitarOyentes.push(on('instalacion:disponible', dibujar), on('instalacion:hecha', dibujar));
  }

  // --- Licencia ---------------------------------------------------------------
  function pasoLicencia() {
    limpiar();
    const area = h('textarea', {
      class: 'entrada entrada--codigo', id: 'codigo-licencia', rows: '4', autocomplete: 'off',
      autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', placeholder: 'RVL1.…',
    });
    const error = h('p', { class: 'error-campo', role: 'alert' });
    const boton = h('button', { class: 'boton boton--primario boton--ancho', type: 'submit' }, 'Activar');
    const form = h(
      'form',
      { class: 'formulario', novalidate: true },
      h('div', { class: 'campo' },
        h('label', { class: 'campo__etiqueta', for: 'codigo-licencia' }, 'Código de activación'),
        area,
        h('p', { class: 'campo__ayuda' }, 'Pega el código completo que te enviaron. No necesita internet.'),
        error),
      boton,
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.textContent = '';
      if (area.value.trim() === '') {
        error.textContent = 'Pega el código de activación.';
        area.focus();
        return;
      }
      boton.disabled = true;
      boton.textContent = 'Verificando…';
      try {
        const r = await activarLicencia(area.value);
        if (!r.ok) {
          error.textContent = r.error;
          return;
        }
        await siguiente();
      } catch (err) {
        console.error(err);
        error.textContent = 'No se pudo verificar el código. Vuelve a intentarlo.';
      } finally {
        if (boton.isConnected) {
          boton.disabled = false;
          boton.textContent = 'Activar';
        }
      }
    });
    pantalla(
      progreso('licencia'),
      h('h1', { class: 'titulo', tabindex: '-1' }, 'Activa la app'),
      h('p', { class: 'texto-secundario' }, 'Cada negocio tiene su propio código de activación.'),
      form,
    );
  }

  // --- Marca ------------------------------------------------------------------
  function pasoMarca(estado) {
    const f = formularioMarca({
      inicial: { nombre: estado.licencia?.datos?.negocio ?? '' },
      alGuardar: async (datos) => {
        const r = await guardarMarca(datos);
        if (r.ok) await siguiente();
        return r;
      },
    });
    limpieza = () => f.destruir();
    pantalla(
      progreso('marca'),
      h('h1', { class: 'titulo', tabindex: '-1' }, 'Tu negocio'),
      h('p', { class: 'texto-secundario' }, 'Aparecerá en la app y en los mensajes a tus clientas.'),
      f.elemento,
      // Teléfono nuevo o reinstalación: traer todo desde un respaldo (luego se crea un PIN nuevo).
      h('details', { class: 'tarjeta' },
        h('summary', { class: 'tarjeta__titulo' }, '¿Ya usabas la app en otro teléfono? Restaurar un respaldo'),
        h('p', { class: 'texto-secundario' }, 'Se cargan tus pedidos, clientas, fotos y los datos del negocio. Después crearás un PIN nuevo para este teléfono.'),
        panelRestaurar({
          db: obtenerBD(),
          textoConfirmacion: 'Se cargarán en este teléfono todos los datos del respaldo.',
          alRestaurar: () => siguiente(),
        })),
    );
  }

  // --- PIN --------------------------------------------------------------------
  function pasoPin() {
    const zona = h('div');
    pantalla(zona);
    limpieza = flujoPinNuevo(zona, {
      encabezado: () => progreso('pin'),
      alConfirmar: async (pin) => {
        const r = await crearPinInicial(pin);
        if (r.ok) await siguiente();
        return r;
      },
    });
  }

  // --- Código de recuperación -------------------------------------------------
  function pasoRecuperacion() {
    const codigo = generarCodigoRecuperacion();
    const vista = vistaCodigoRecuperacion({
      codigo,
      alConfirmar: async () => {
        await finalizarConfiguracion(codigo);
        recienConfigurada = true;
        await siguiente();
      },
    });
    reemplazar(contenedor, h('div', { class: 'paso' }, progreso('recuperacion'), ...vista.childNodes));
    contenedor.querySelector('h1')?.focus({ preventScroll: true });
  }

  const estado = await estadoConfiguracion();
  if (estado.paso === 'licencia' && !estado.completa) pasoInicio();
  else mostrarPaso(estado.paso, estado);

  return limpiar;
}
