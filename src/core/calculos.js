// Cálculos de pedidos. Todo en centavos enteros.
import { asegurarCentavos, multiplicarCentavos, sumarCentavos } from './money.js';

export const ESTADOS_PEDIDO = ['pendiente', 'entregado', 'cancelado'];
export const MODALIDADES = ['recojo', 'envio'];
export const ESTADOS_PAGO = ['sin-pago', 'parcial', 'pagado'];

export const PREFIJO_CODIGO = 'LIVE-';

/** 1 → "LIVE-00001"; 123456 → "LIVE-123456" (nunca se corta). */
export function formatearCodigo(seq) {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new TypeError('Secuencia de código no válida');
  return `${PREFIJO_CODIGO}${String(seq).padStart(5, '0')}`;
}

/** "LIVE-00012", "live 12", "12", "#12" → 12; si no parece un código, null. */
export function leerCodigo(texto) {
  const m = String(texto ?? '').trim().match(/^(?:#|live[\s-]*)?0*(\d{1,9})$/i);
  return m ? Number(m[1]) : null;
}

export function subtotalPrenda({ precio, cantidad }) {
  return multiplicarCentavos(asegurarCentavos(precio, 'precio'), cantidad);
}

/**
 * Totales de un pedido a partir de sus prendas y el envío.
 * Devuelve { totalPrendas, total }.
 */
export function calcularTotales(prendas, envio = 0) {
  asegurarCentavos(envio, 'envío');
  if (envio < 0) throw new RangeError('El envío no puede ser negativo');
  const totalPrendas = sumarCentavos(prendas.map(subtotalPrenda));
  return { totalPrendas, total: sumarCentavos([totalPrendas, envio]) };
}

/**
 * Estado de pago calculado (independiente del estado del pedido).
 * neto = pagado − reembolsado.
 */
export function calcularEstadoPago({ total, pagado = 0, reembolsado = 0 }) {
  const neto = pagado - reembolsado;
  if (neto <= 0) return total === 0 ? 'pagado' : 'sin-pago';
  if (neto < total) return 'parcial';
  return 'pagado';
}

export function saldoPendiente({ total, pagado = 0, reembolsado = 0 }) {
  return Math.max(0, total - (pagado - reembolsado));
}
