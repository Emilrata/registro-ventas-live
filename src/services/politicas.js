// Políticas del negocio (ajustes que cambian reglas).
//
// pedidos.exigirPagoCompleto (por defecto: SÍ)
//   - Cada pedido se guarda con su pago completo (en la misma operación).
//   - No hay pagos parciales: un pago siempre cubre todo el saldo.
//   - No se entrega nada con deuda.
//   - Si al editar sube el total, se cobra la diferencia en ese momento; no se puede bajar
//     el total por debajo de lo ya pagado.
export const CLAVE_PAGO_COMPLETO = 'pedidos.exigirPagoCompleto';

/** Lee la política (las bases creadas antes de este ajuste usan el valor por defecto: sí). */
export async function exigePagoCompleto(db) {
  return (await db.ajustes.get(CLAVE_PAGO_COMPLETO))?.valor ?? true;
}
