// Pantalla de bloqueo: pide el PIN. Incluye «Olvidé mi PIN» con el código de recuperación.
import { h, reemplazar } from '../ui/dom.js';
import { crearTecladoPin, formatearEspera } from '../ui/teclado-pin.js';
import { flujoPinNuevo, vistaCodigoRecuperacion } from '../ui/flujos-acceso.js';
import { estadoIntentos, recuperarConCodigo, validarPinNuevo, verificarPin } from '../services/seguridad.js';

/**
 * marca = { nombre, logoUrl }. alDesbloquear() se llama al entrar.
 * Devuelve función de limpieza.
 */
export async function mostrarBloqueo(contenedor, { marca, alDesbloquear }) {
  let limpieza = null;
  const limpiar = () => {
    limpieza?.();
    limpieza = null;
  };

  const cabecera = () =>
    h(
      'div',
      { class: 'bloqueo__marca' },
      marca?.logoUrl ? h('img', { class: 'bloqueo__logo', src: marca.logoUrl, alt: '' }) : null,
      h('p', { class: 'bloqueo__nombre' }, marca?.nombre ?? 'Ventas LIVE'),
    );

  async function pedirPin() {
    limpiar();
    const { esperaMs } = await estadoIntentos();
    const teclado = crearTecladoPin({
      titulo: 'Ingresa tu PIN',
      esperaInicialMs: esperaMs,
      alCompletar: async (pin) => {
        const r = await verificarPin(pin);
        if (r.ok) {
          limpiar();
          alDesbloquear();
        }
        return r;
      },
    });
    limpieza = () => teclado.destruir();
    reemplazar(contenedor, 
      h(
        'div',
        { class: 'paso paso--centrado' },
        cabecera(),
        teclado.elemento,
        h('button', { class: 'boton boton--enlace', type: 'button', onclick: pedirCodigo }, 'Olvidé mi PIN'),
      ),
    );
    teclado.elemento.querySelector('h1')?.focus({ preventScroll: true });
  }

  // Paso 1 de recuperación: escribir el código.
  async function pedirCodigo() {
    limpiar();
    const entrada = h('input', {
      class: 'entrada entrada--codigo-recuperacion numero', id: 'codigo-recuperacion', type: 'text',
      autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false',
      maxlength: '20', placeholder: 'XXXX-XXXX-XXXX',
    });
    const error = h('p', { class: 'error-campo', role: 'alert' });
    const boton = h('button', { class: 'boton boton--primario boton--ancho', type: 'submit' }, 'Continuar');
    const form = h(
      'form',
      { class: 'formulario', novalidate: true },
      h('div', { class: 'campo' },
        h('label', { class: 'campo__etiqueta', for: 'codigo-recuperacion' }, 'Código de recuperación'),
        entrada, error),
      boton,
    );
    const { esperaMs } = await estadoIntentos({ recuperacion: true });
    if (esperaMs > 0) error.textContent = `Demasiados intentos. Espera ${formatearEspera(esperaMs)}.`;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const codigo = entrada.value.trim();
      if (codigo.replace(/[\s-]/g, '').length !== 12) {
        error.textContent = 'El código tiene 12 caracteres.';
        entrada.focus();
        return;
      }
      pedirPinNuevo(codigo);
    });

    reemplazar(contenedor, 
      h(
        'div',
        { class: 'paso' },
        h('h1', { class: 'titulo', tabindex: '-1' }, 'Recuperar acceso'),
        h('p', { class: 'texto-secundario' }, 'Escribe el código de 12 caracteres que anotaste al configurar la app.'),
        form,
        h('button', { class: 'boton boton--enlace', type: 'button', onclick: pedirPin }, 'Volver'),
        h(
          'p',
          { class: 'texto-secundario nota' },
          'Si perdiste el código: reinstala la app y restaura tu último respaldo. Tendrás que crear un PIN nuevo.',
        ),
      ),
    );
    contenedor.querySelector('h1')?.focus({ preventScroll: true });
  }

  // Paso 2: PIN nuevo. El código se comprueba al confirmar el PIN.
  function pedirPinNuevo(codigo) {
    limpiar();
    const zona = h('div', { class: 'paso' });
    reemplazar(contenedor, zona);
    limpieza = flujoPinNuevo(zona, {
      titulo: 'Crea un PIN nuevo',
      alConfirmar: async (pin) => {
        const v = validarPinNuevo(pin);
        if (!v.ok) return v;
        const r = await recuperarConCodigo(codigo, pin);
        if (!r.ok) {
          // El problema es el código: volver a pedirlo.
          setTimeout(async () => {
            await pedirCodigo();
            const err = contenedor.querySelector('.error-campo');
            if (err) err.textContent = r.esperaMs > 0 ? `Demasiados intentos. Espera ${formatearEspera(r.esperaMs)}.` : r.error;
          });
          return { ok: true };
        }
        mostrarCodigoNuevo(r.codigo);
        return { ok: true };
      },
    });
  }

  // Paso 3: el código usado ya no sirve; mostrar el nuevo.
  function mostrarCodigoNuevo(codigo) {
    limpiar();
    reemplazar(contenedor, 
      vistaCodigoRecuperacion({
        codigo,
        titulo: 'Tu nuevo código',
        textoBoton: 'Entrar',
        alConfirmar: async () => alDesbloquear(),
      }),
    );
    contenedor.querySelector('h1')?.focus({ preventScroll: true });
  }

  await pedirPin();
  return limpiar;
}
