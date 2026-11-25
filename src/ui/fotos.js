// Manejo de URLs de fotos (se liberan al salir de la pantalla) y visor a pantalla completa.
import { h, agregar } from './dom.js';
import { obtenerBD } from '../core/db.js';

/** Crea un administrador de URLs para una pantalla. Llamar liberar() en la limpieza. */
export function crearGaleria() {
  const urls = new Set();
  return {
    url(blob) {
      if (!(blob instanceof Blob)) return null;
      const u = URL.createObjectURL(blob);
      urls.add(u);
      return u;
    },
    /** URL de la miniatura (o de la foto si no hay miniatura) de un archivo por id. */
    async miniatura(fotoId, db = obtenerBD()) {
      if (!fotoId) return null;
      const a = await db.archivos.get(fotoId);
      return a ? this.url(a.miniatura ?? a.blob) : null;
    },
    async completa(fotoId, db = obtenerBD()) {
      if (!fotoId) return null;
      const a = await db.archivos.get(fotoId);
      return a ? this.url(a.blob) : null;
    },
    liberar() {
      for (const u of urls) URL.revokeObjectURL(u);
      urls.clear();
    },
  };
}

/** Muestra una foto a pantalla completa. Se cierra tocando o con Escape. */
export function abrirVisor(url, texto = '') {
  if (!url) return;
  const cerrar = () => {
    visor.remove();
    document.removeEventListener('keydown', alTeclear);
  };
  const alTeclear = (e) => {
    if (e.key === 'Escape') cerrar();
  };
  const visor = h(
    'div',
    { class: 'visor', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Foto', onclick: cerrar },
    h('img', { src: url, alt: texto }),
    h('button', { class: 'visor__cerrar', type: 'button', 'aria-label': 'Cerrar' }, '✕'),
  );
  document.addEventListener('keydown', alTeclear);
  agregar(document.body, visor);
}

/** Imagen en miniatura que se carga sola; al tocarla abre la foto completa. */
export function miniatura(galeria, fotoId, { clase = 'mini', alt = '' } = {}) {
  const img = h('img', { class: clase, alt, loading: 'lazy' });
  const caja = h('span', { class: `${clase}-caja` }, img);
  if (!fotoId) {
    caja.classList.add('sin-foto');
    img.remove();
    return caja;
  }
  galeria.miniatura(fotoId).then((u) => {
    if (u) img.src = u;
  });
  return caja;
}
