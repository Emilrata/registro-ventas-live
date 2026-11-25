import { sha256Hex } from '../core/crypto.js';

// Procesamiento de imágenes en el navegador (Canvas).

/**
 * Abre la imagen para dibujarla. Intenta createImageBitmap (rápido) y, si el navegador no lo
 * permite (por ejemplo, Safari antiguo con esas opciones), usa una etiqueta <img>.
 * Ambos caminos respetan la orientación de la foto (EXIF).
 */
async function abrirImagen(archivo) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(archivo, { imageOrientation: 'from-image' });
    } catch {
      try {
        return await createImageBitmap(archivo);
      } catch {
        /* se intenta con <img> */
      }
    }
  }
  const url = URL.createObjectURL(archivo);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await (img.decode ? img.decode() : new Promise((ok, mal) => { img.onload = ok; img.onerror = mal; }));
    if (!img.naturalWidth) throw new Error('vacía');
    return { width: img.naturalWidth, height: img.naturalHeight, fuente: img, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new TypeError('No se pudo leer la imagen. Prueba con una foto JPG o PNG.');
  }
}

/**
 * Reduce una imagen para que su lado mayor no pase de `ladoMayor` píxeles.
 * Devuelve { blob, ancho, alto }. Respeta la orientación de la foto (EXIF).
 */
export async function redimensionarImagen(archivo, { ladoMayor = 1280, tipo = 'image/jpeg', calidad = 0.75 } = {}) {
  if (!(archivo instanceof Blob) || !archivo.type.startsWith('image/')) {
    throw new TypeError('El archivo no es una imagen.');
  }
  const bitmap = await abrirImagen(archivo);
  try {
    const escala = Math.min(1, ladoMayor / Math.max(bitmap.width, bitmap.height));
    const ancho = Math.max(1, Math.round(bitmap.width * escala));
    const alto = Math.max(1, Math.round(bitmap.height * escala));
    const canvas = document.createElement('canvas');
    canvas.width = ancho;
    canvas.height = alto;
    const ctx = canvas.getContext('2d');
    if (tipo === 'image/jpeg') {
      ctx.fillStyle = '#ffffff'; // JPEG no tiene transparencia
      ctx.fillRect(0, 0, ancho, alto);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap.fuente ?? bitmap, 0, 0, ancho, alto);
    const blob = await new Promise((resolver, rechazar) =>
      canvas.toBlob((b) => (b ? resolver(b) : rechazar(new Error('No se pudo procesar la imagen.'))), tipo, calidad),
    );
    return { blob, ancho, alto };
  } finally {
    bitmap.close?.();
  }
}

/** Logo del negocio: PNG de hasta 512 px (conserva transparencia). */
export function procesarLogo(archivo) {
  return redimensionarImagen(archivo, { ladoMayor: 512, tipo: 'image/png' });
}

/**
 * Foto de una prenda: 1280 px, JPEG 75 %, miniatura ~240 px y huella SHA-256.
 * Devuelve { blob, ancho, alto, miniatura, sha256 }.
 */
export async function procesarFoto(archivo) {
  const grande = await redimensionarImagen(archivo, { ladoMayor: 1280, tipo: 'image/jpeg', calidad: 0.75 });
  const mini = await redimensionarImagen(grande.blob, { ladoMayor: 240, tipo: 'image/jpeg', calidad: 0.7 });
  return { ...grande, miniatura: mini.blob, sha256: await sha256Hex(grande.blob) };
}
