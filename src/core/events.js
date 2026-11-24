// Bus de eventos simple para avisar cambios entre pantallas.
const oyentes = new Map();

/** Suscribe una función a un evento. Devuelve la función para cancelar. */
export function on(evento, fn) {
  if (!oyentes.has(evento)) oyentes.set(evento, new Set());
  oyentes.get(evento).add(fn);
  return () => off(evento, fn);
}

export function off(evento, fn) {
  oyentes.get(evento)?.delete(fn);
}

export function emit(evento, datos) {
  for (const fn of [...(oyentes.get(evento) ?? [])]) {
    try {
      fn(datos);
    } catch (err) {
      console.error(`Error en oyente de "${evento}":`, err);
    }
  }
}
