// Creación de elementos sin innerHTML para datos (evita inyección de código).
// h('div', { class: 'tarjeta', onclick: fn }, 'texto', otroNodo)

export function h(etiqueta, atributos = {}, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos ?? {})) {
    if (valor === undefined || valor === null || valor === false) continue;
    if (clave.startsWith('on') && typeof valor === 'function') {
      el.addEventListener(clave.slice(2).toLowerCase(), valor);
    } else if (clave === 'class') {
      el.className = valor;
    } else if (clave === 'dataset') {
      Object.assign(el.dataset, valor);
    } else if (valor === true) {
      el.setAttribute(clave, '');
    } else {
      el.setAttribute(clave, String(valor));
    }
  }
  agregarHijos(el, hijos);
  return el;
}

function agregarHijos(el, hijos) {
  for (const hijo of hijos.flat(Infinity)) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
}

/** Ícono SVG desde una cadena estática definida en el código (nunca datos del usuario). */
export function icono(svg) {
  const span = document.createElement('span');
  span.className = 'icono';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = svg;
  return span;
}

/** Como el.append(), pero ignora null/undefined/false (append los convertiría en el texto «null»). */
export function agregar(el, ...hijos) {
  agregarHijos(el, hijos);
  return el;
}

/** Como el.replaceChildren(), pero ignora null/undefined/false. */
export function reemplazar(el, ...hijos) {
  el.replaceChildren();
  agregarHijos(el, hijos);
  return el;
}

export function vaciar(el) {
  el.replaceChildren();
}
