// Lector de ZIP "por partes": lee el índice (directorio central) y devuelve cada archivo como un
// trozo (Blob.slice) del archivo original, SIN cargar todo el ZIP en memoria.
// Soporta entradas sin comprimir (método 0, las que genera la app) y comprimidas (método 8,
// solo para archivos pequeños). No soporta ZIP64 (archivos de más de 4 GB).
import { inflateSync } from 'fflate';

const FIRMA_FIN = 0x06054b50;
const FIRMA_CENTRAL = 0x02014b50;
const FIRMA_LOCAL = 0x04034b50;

async function leerBytes(blob, desde, hasta) {
  return new Uint8Array(await blob.slice(desde, hasta).arrayBuffer());
}

/**
 * Lee el índice del ZIP. Devuelve Map(nombre → { nombre, metodo, comprimido, tamano, desdeLocal }).
 * Lanza un error con mensaje en español si no es un ZIP válido.
 */
export async function leerIndiceZip(archivo) {
  const total = archivo.size;
  if (total < 22) throw new Error('El archivo no es un ZIP válido.');
  const desde = Math.max(0, total - 65557);
  const cola = await leerBytes(archivo, desde, total);
  const vista = new DataView(cola.buffer, cola.byteOffset, cola.byteLength);
  let fin = -1;
  for (let i = cola.length - 22; i >= 0; i -= 1) {
    if (vista.getUint32(i, true) === FIRMA_FIN) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error('El archivo no es un ZIP válido (está incompleto o dañado).');
  const cantidad = vista.getUint16(fin + 10, true);
  const tamanoCentral = vista.getUint32(fin + 12, true);
  const inicioCentral = vista.getUint32(fin + 16, true);
  if (cantidad === 0xffff || inicioCentral === 0xffffffff) throw new Error('El respaldo es demasiado grande (ZIP64 no soportado).');
  if (inicioCentral + tamanoCentral > total) throw new Error('El archivo ZIP está incompleto.');

  const central = await leerBytes(archivo, inicioCentral, inicioCentral + tamanoCentral);
  const v = new DataView(central.buffer, central.byteOffset, central.byteLength);
  const decodificador = new TextDecoder('utf-8');
  const entradas = new Map();
  let p = 0;
  for (let i = 0; i < cantidad; i += 1) {
    if (p + 46 > central.length || v.getUint32(p, true) !== FIRMA_CENTRAL) throw new Error('El índice del ZIP está dañado.');
    const metodo = v.getUint16(p + 10, true);
    const comprimido = v.getUint32(p + 20, true);
    const tamano = v.getUint32(p + 24, true);
    const largoNombre = v.getUint16(p + 28, true);
    const largoExtra = v.getUint16(p + 30, true);
    const largoComentario = v.getUint16(p + 32, true);
    const desdeLocal = v.getUint32(p + 42, true);
    const nombre = decodificador.decode(central.subarray(p + 46, p + 46 + largoNombre));
    if (!nombre.endsWith('/')) entradas.set(nombre, { nombre, metodo, comprimido, tamano, desdeLocal });
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return entradas;
}

/** Devuelve el contenido de una entrada como Blob (trozo del archivo si no está comprimida). */
export async function blobDeEntrada(archivo, entrada, tipo = '') {
  const local = await leerBytes(archivo, entrada.desdeLocal, entrada.desdeLocal + 30);
  const v = new DataView(local.buffer, local.byteOffset, local.byteLength);
  if (local.length < 30 || v.getUint32(0, true) !== FIRMA_LOCAL) throw new Error(`Archivo dañado dentro del ZIP: ${entrada.nombre}`);
  const inicio = entrada.desdeLocal + 30 + v.getUint16(26, true) + v.getUint16(28, true);
  const fin = inicio + entrada.comprimido;
  if (fin > archivo.size) throw new Error(`El ZIP está incompleto: ${entrada.nombre}`);
  if (entrada.metodo === 0) return archivo.slice(inicio, fin, tipo);
  if (entrada.metodo === 8) {
    if (entrada.tamano > 64 * 1024 * 1024) throw new Error(`Archivo comprimido demasiado grande: ${entrada.nombre}`);
    const datos = inflateSync(await leerBytes(archivo, inicio, fin), { out: new Uint8Array(entrada.tamano) });
    return new Blob([datos], { type: tipo });
  }
  throw new Error(`Formato de compresión no soportado en ${entrada.nombre}.`);
}

/** Contenido de una entrada como bytes. */
export async function bytesDeEntrada(archivo, entrada) {
  return new Uint8Array(await (await blobDeEntrada(archivo, entrada)).arrayBuffer());
}
