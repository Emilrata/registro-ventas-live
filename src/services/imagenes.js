// Procesamiento de imágenes en el navegador (Canvas).

/**
 * Reduce una imagen para que su lado mayor no pase de `ladoMayor` píxeles.
 * Devuelve { blob, ancho, alto }. Respeta la orientación de la foto (EXIF).
 */
export async function redimensionarImagen(archivo, { ladoMayor = 1280, tipo = 'image/jpeg', calidad = 0.75 } = {}) {
  if (!(archivo instanceof Blob) || !archivo.type.startsWith('image/')) {
    throw new TypeError('El archivo no es una imagen.');
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
  } catch {
    throw new TypeError('No se pudo leer la imagen. Prueba con una foto JPG o PNG.');
  }
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
    ctx.drawImage(bitmap, 0, 0, ancho, alto);
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
