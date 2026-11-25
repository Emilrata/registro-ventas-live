// Genera pedidos de prueba realistas usando el servicio real (crearPedido).
import { crearPedido } from '../../src/services/pedidos.js';
import { crearTransmision } from '../../src/services/transmisiones.js';
import { sha256Hex } from '../../src/core/crypto.js';

const NOMBRES = ['Ana', 'María José', 'Lucía', 'Fernanda', 'Camila', 'Valeria', 'Daniela', 'Sofía', 'Gabriela', 'Paola', 'Andrea', 'Carla'];
const APELLIDOS = ['Pérez', 'Gutiérrez', 'Rojas', 'Mamani', 'Quispe', 'Vargas', 'Flores', 'Choque', 'López', 'Suárez'];
const PRENDAS = ['Blusa', 'Vestido', 'Jean', 'Chompa', 'Falda', 'Polera', 'Chamarra', 'Short', 'Conjunto'];
const TALLAS = ['S', 'M', 'L', 'XL', 'Única'];
const COLORES = ['Negro', 'Blanco', 'Rojo', 'Azul', 'Beige', 'Rosado'];

/** Generador pseudoaleatorio con semilla (resultados repetibles). */
export function azar(semilla = 42) {
  let s = semilla >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export async function fotoFalsa(n) {
  const bytes = new Uint8Array(64).map((_, i) => (i * 31 + n) % 256);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  return { blob, ancho: 1280, alto: 960, miniatura: new Blob([bytes.slice(0, 16)], { type: 'image/jpeg' }), sha256: await sha256Hex(bytes) };
}

/**
 * Crea `cantidad` pedidos repartidos en `clientas` clientas y algunas transmisiones.
 * Devuelve la lista de resultados de crearPedido.
 */
export async function generarPedidos({ cantidad = 500, clientas = 120, conFotoCada = 5, semilla = 7, db } = {}) {
  const r = azar(semilla);
  const elegir = (lista) => lista[Math.floor(r() * lista.length)];
  const transmisiones = [];
  for (let i = 0; i < 6; i += 1) transmisiones.push((await crearTransmision({ nombre: `LIVE ${i + 1}` }, db)).id);
  const clientes = Array.from({ length: clientas }, (_, i) => ({
    nombre: `${elegir(NOMBRES)} ${elegir(APELLIDOS)}`,
    whatsapp: `7${String(1000000 + i * 7919).slice(-7)}`,
  }));
  const resultados = [];
  const inicio = Date.UTC(2026, 0, 1, 14);
  for (let i = 0; i < cantidad; i += 1) {
    const c = clientes[Math.floor(r() * clientes.length)];
    const nPrendas = 1 + Math.floor(r() * 3);
    const prendas = [];
    for (let k = 0; k < nPrendas; k += 1) {
      prendas.push({
        descripcion: `${elegir(PRENDAS)} ${elegir(COLORES).toLowerCase()}`,
        talla: elegir(TALLAS),
        color: elegir(COLORES),
        precio: (50 + Math.floor(r() * 30) * 5) * 100 + (r() < 0.2 ? 50 : 0),
        cantidad: 1 + Math.floor(r() * 2),
        foto: i % conFotoCada === 0 && k === 0 ? await fotoFalsa(i) : null,
      });
    }
    const envio = r() < 0.3;
    const res = await crearPedido(
      {
        whatsapp: c.whatsapp,
        nombre: c.nombre,
        transmisionId: transmisiones[Math.floor(i / (cantidad / transmisiones.length))] ?? null,
        modalidad: envio ? 'envio' : 'recojo',
        envio: envio ? 1500 : 0,
        observaciones: r() < 0.1 ? 'Paga al recoger' : '',
        prendas,
      },
      { ahora: new Date(inicio + i * 37 * 60000), db },
    );
    if (!res.ok) throw new Error(`No se pudo crear el pedido ${i}: ${res.error}`);
    resultados.push(res);
  }
  return resultados;
}
