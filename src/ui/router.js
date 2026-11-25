// Router por hash (#/panel). Funciona sin servidor y sin internet.
// Cada ruta: { titulo, render(contenedor, { params }) → función de limpieza opcional }.

import { vaciar, agregar } from './dom.js';

export function crearRouter({ contenedor, rutas, rutaInicial, alCambiar }) {
  let limpiezaActual = null;
  let renderEnCurso = 0;

  function leerRuta() {
    const hash = window.location.hash.replace(/^#/, '');
    const [ruta, consulta = ''] = hash.split('?');
    return { ruta: ruta || rutaInicial, params: Object.fromEntries(new URLSearchParams(consulta)) };
  }

  async function mostrar() {
    const { ruta, params } = leerRuta();
    const definicion = rutas[ruta];
    if (!definicion) {
      window.location.replace(`#${rutaInicial}`);
      return;
    }
    const turno = ++renderEnCurso;

    if (typeof limpiezaActual === 'function') {
      try {
        limpiezaActual();
      } catch (err) {
        console.error(err);
      }
    }
    limpiezaActual = null;
    vaciar(contenedor);
    document.title = `${definicion.titulo} · Ventas LIVE`;
    alCambiar?.(ruta, definicion);

    try {
      const limpieza = await definicion.render(contenedor, { params });
      if (turno === renderEnCurso) limpiezaActual = limpieza ?? null;
      else if (typeof limpieza === 'function') limpieza(); // ya se navegó a otra pantalla
    } catch (err) {
      console.error(err);
      if (turno === renderEnCurso) {
        const aviso = document.createElement('p');
        aviso.className = 'aviso aviso--error';
        aviso.textContent = 'No se pudo abrir esta pantalla. Vuelve a intentarlo.';
        agregar(contenedor, aviso);
      }
    }
    if (turno === renderEnCurso) {
      window.scrollTo(0, 0);
      contenedor.querySelector('h1')?.focus({ preventScroll: true });
    }
  }

  function iniciar() {
    window.addEventListener('hashchange', mostrar);
    // replaceState no dispara hashchange: evita dibujar la pantalla dos veces.
    if (!window.location.hash) window.history.replaceState(null, '', `#${rutaInicial}`);
    return mostrar();
  }

  function ir(ruta) {
    if (leerRuta().ruta === ruta && !window.location.hash.includes('?')) return mostrar();
    window.location.hash = ruta;
    return undefined;
  }

  return { iniciar, ir, refrescar: mostrar };
}
