// Flujos reutilizables de acceso: crear PIN (con confirmación), mostrar código de
// recuperación y formulario de la marca del negocio.
import { h, reemplazar } from './dom.js';
import { crearTecladoPin } from './teclado-pin.js';
import { formatearCodigoRecuperacion, validarPinNuevo } from '../services/seguridad.js';
import { validarMarca } from '../services/configuracion.js';
import { procesarLogo } from '../services/imagenes.js';

/**
 * Pide un PIN nuevo dos veces. alConfirmar(pin) → Promise<{ ok, error? }>.
 * Devuelve función de limpieza.
 */
export function flujoPinNuevo(contenedor, { titulo = 'Crea tu PIN', subtitulo, alConfirmar, encabezado = null }) {
  let teclado = null;
  const cambiar = (nuevo) => {
    teclado?.destruir();
    teclado = nuevo;
    reemplazar(contenedor, ...[encabezado?.()].filter(Boolean), teclado.elemento);
    teclado.elemento.querySelector('h1')?.focus({ preventScroll: true });
  };

  const pedirPrimero = (errorPrevio) => {
    const t = crearTecladoPin({
      titulo,
      subtitulo: subtitulo ?? 'Elige 6 números que recuerdes. Lo pedirá la app cada vez que la abras.',
      alCompletar: async (pin) => {
        const v = validarPinNuevo(pin);
        if (!v.ok) return v;
        pedirConfirmacion(pin);
        return { ok: true };
      },
    });
    cambiar(t);
    if (errorPrevio) t.elemento.querySelector('.pin__mensaje').textContent = errorPrevio;
  };

  const pedirConfirmacion = (primero) => {
    cambiar(
      crearTecladoPin({
        titulo: 'Repite tu PIN',
        subtitulo: 'Escríbelo otra vez para confirmar.',
        alCompletar: async (pin) => {
          if (pin !== primero) {
            pedirPrimero('Los PIN no coinciden. Empieza de nuevo.');
            return { ok: true };
          }
          const r = await alConfirmar(pin);
          if (!r.ok) {
            pedirPrimero(r.error);
            return { ok: true };
          }
          return r;
        },
      }),
    );
  };

  pedirPrimero();
  return () => teclado?.destruir();
}

/** Muestra el código de recuperación una sola vez y exige confirmar que se anotó. */
export function vistaCodigoRecuperacion({ codigo, titulo = 'Código de recuperación', textoBoton = 'Terminar', alConfirmar }) {
  const formateado = formatearCodigoRecuperacion(codigo);
  const casilla = h('input', { type: 'checkbox', id: 'anotado' });
  const error = h('p', { class: 'error-campo', role: 'alert' });
  const boton = h('button', { class: 'boton boton--primario boton--ancho', type: 'button', disabled: true }, textoBoton);
  const copiar = h('button', { class: 'boton boton--secundario', type: 'button' }, 'Copiar');

  casilla.addEventListener('change', () => {
    boton.disabled = !casilla.checked;
  });
  copiar.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(formateado);
      copiar.textContent = 'Copiado';
    } catch {
      copiar.textContent = 'No se pudo copiar: anótalo a mano';
    }
  });
  boton.addEventListener('click', async () => {
    boton.disabled = true;
    boton.textContent = 'Guardando…';
    try {
      await alConfirmar();
    } catch (err) {
      console.error(err);
      error.textContent = 'No se pudo guardar. Vuelve a intentarlo.';
      boton.disabled = false;
      boton.textContent = textoBoton;
    }
  });

  return h(
    'div',
    { class: 'paso' },
    h('h1', { class: 'titulo', tabindex: '-1' }, titulo),
    h(
      'p',
      { class: 'texto-secundario' },
      'Si olvidas tu PIN, este código es la única forma de entrar sin perder los datos. Se muestra solo esta vez.',
    ),
    h('p', { class: 'codigo-recuperacion numero', 'aria-label': `Código: ${formateado.split('').join(' ')}` }, formateado),
    copiar,
    h(
      'ul',
      { class: 'lista-consejos texto-secundario' },
      h('li', {}, 'Anótalo en papel y guárdalo fuera del teléfono.'),
      h('li', {}, 'No lo envíes por WhatsApp ni lo compartas.'),
    ),
    h('label', { class: 'casilla', for: 'anotado' }, casilla, h('span', {}, 'Ya lo anoté en un lugar seguro')),
    error,
    boton,
  );
}

/**
 * Formulario de marca del negocio. alGuardar({ nombre, whatsapp, codigoPais, logo }) → Promise<{ ok, campo?, error? }>.
 * inicial = { nombre, whatsapp, logoUrl }.
 */
export function formularioMarca({ inicial = {}, textoBoton = 'Continuar', alGuardar }) {
  let logo = null;
  let urlVista = null;

  const local = separarWhatsapp(inicial.whatsapp);
  const nombre = h('input', {
    class: 'entrada', id: 'marca-nombre', type: 'text', maxlength: '60', autocomplete: 'organization', value: inicial.nombre ?? '',
  });
  const pais = h('input', {
    class: 'entrada entrada--pais numero', id: 'marca-pais', type: 'text', inputmode: 'numeric', maxlength: '3',
    value: local.pais, 'aria-label': 'Código de país',
  });
  const numero = h('input', {
    class: 'entrada numero', id: 'marca-whatsapp', type: 'tel', inputmode: 'tel', autocomplete: 'tel-national',
    placeholder: '71234567', value: local.numero,
  });
  const archivo = h('input', { class: 'solo-lectores', id: 'marca-logo', type: 'file', accept: 'image/*' });
  const vista = h('div', { class: 'logo-vista' });
  const errorNombre = h('p', { class: 'error-campo', role: 'alert' });
  const errorWhatsapp = h('p', { class: 'error-campo', role: 'alert' });
  const errorLogo = h('p', { class: 'error-campo', role: 'alert' });
  const boton = h('button', { class: 'boton boton--primario boton--ancho', type: 'submit' }, textoBoton);

  const mostrarLogo = (url) => {
    reemplazar(vista, url ? h('img', { src: url, alt: 'Logo del negocio' }) : h('span', { class: 'texto-secundario' }, 'Sin logo'));
  };
  mostrarLogo(inicial.logoUrl);

  archivo.addEventListener('change', async () => {
    errorLogo.textContent = '';
    const f = archivo.files?.[0];
    if (!f) return;
    try {
      logo = await procesarLogo(f);
      if (urlVista) URL.revokeObjectURL(urlVista);
      urlVista = URL.createObjectURL(logo.blob);
      mostrarLogo(urlVista);
    } catch (err) {
      logo = null;
      errorLogo.textContent = err.message;
    }
  });

  const form = h(
    'form',
    { class: 'formulario', novalidate: true },
    h('div', { class: 'campo' },
      h('label', { class: 'campo__etiqueta', for: 'marca-nombre' }, 'Nombre del negocio'),
      nombre, errorNombre),
    h('div', { class: 'campo' },
      h('label', { class: 'campo__etiqueta', for: 'marca-whatsapp' }, 'WhatsApp del negocio'),
      h('div', { class: 'fila-entradas' }, h('span', { class: 'prefijo' }, '+'), pais, numero),
      h('p', { class: 'campo__ayuda' }, 'Bolivia: 591. Cambia el código si el número es de otro país.'),
      errorWhatsapp),
    h('div', { class: 'campo' },
      h('span', { class: 'campo__etiqueta' }, 'Logo (opcional)'),
      h('div', { class: 'logo-campo' }, vista,
        h('label', { class: 'boton boton--secundario', for: 'marca-logo' }, 'Elegir imagen')),
      archivo, errorLogo),
    boton,
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorNombre.textContent = '';
    errorWhatsapp.textContent = '';
    const datos = { nombre: nombre.value, whatsapp: numero.value, codigoPais: pais.value || '591', logo };
    const v = validarMarca(datos);
    if (!v.ok) {
      (v.campo === 'nombre' ? errorNombre : errorWhatsapp).textContent = v.error;
      (v.campo === 'nombre' ? nombre : numero).focus();
      return;
    }
    boton.disabled = true;
    const textoOriginal = boton.textContent;
    boton.textContent = 'Guardando…';
    try {
      const r = await alGuardar(datos);
      if (r && !r.ok) {
        (r.campo === 'nombre' ? errorNombre : errorWhatsapp).textContent = r.error;
        boton.disabled = false;
        boton.textContent = textoOriginal;
      }
    } catch (err) {
      console.error(err);
      errorLogo.textContent = 'No se pudo guardar. Vuelve a intentarlo.';
      boton.disabled = false;
      boton.textContent = textoOriginal;
    }
  });

  return {
    elemento: form,
    destruir() {
      if (urlVista) URL.revokeObjectURL(urlVista);
    },
  };
}

function separarWhatsapp(valor) {
  if (typeof valor !== 'string' || !valor.startsWith('+')) return { pais: '591', numero: '' };
  if (valor.startsWith('+591')) return { pais: '591', numero: valor.slice(4) };
  return { pais: '', numero: valor }; // otro país: se edita completo con "+"
}
