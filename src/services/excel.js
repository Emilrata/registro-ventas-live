// Informe en Excel del período: resumen, por día, pedidos, prendas, pagos, devoluciones,
// entregas, deudas (foto de hoy) y clientas.
import { obtenerBD } from '../core/db.js';
import { formatearFecha } from '../core/dates.js';
import { saldoPendiente } from '../core/calculos.js';
import { crearXlsx } from '../core/xlsx.js';
import { calcularEstadisticas, inicioDia } from './estadisticas.js';
import { PERIODOS } from './estadisticas.js';

const ESTADO = { pendiente: 'Pendiente', entregado: 'Entregado', cancelado: 'Cancelado' };
const PAGO = { 'sin-pago': 'Sin pago', parcial: 'Pago parcial', pagado: 'Pagado' };
const METODO = { efectivo: 'Efectivo', qr: 'QR' };
const MODALIDAD = { recojo: 'Recoge', envio: 'Envío' };
const fechaTexto = (clave) => formatearFecha(`${clave}T12:00:00`);

export async function crearInformeExcel(filtro, { ahora = new Date(), db = obtenerBD() } = {}) {
  const e = await calcularEstadisticas(filtro, { ahora, db });
  const { creados, pagos, devoluciones, entregas, conDeuda, pedidosDe } = e._detalle;

  const clientes = await db.clientes.toArray();
  const cliente = new Map(clientes.map((c) => [c.id, c]));
  const transmisiones = new Map((await db.transmisiones.toArray()).map((t) => [t.id, t]));
  for (const p of [...creados, ...conDeuda]) pedidosDe.set(p.id, p);
  const faltan = [...new Set(entregas.flatMap((x) => x.pedidos))].filter((id) => !pedidosDe.has(id));
  for (const p of (await db.pedidos.bulkGet(faltan)).filter(Boolean)) pedidosDe.set(p.id, p);
  const prendas = (await db.prendas.where('pedidoId').anyOf(creados.map((p) => p.id)).toArray()).sort((a, b) => a.pedidoId - b.pedidoId || a.orden - b.orden);
  const negocio = (await db.ajustes.get('marca'))?.valor?.nombre ?? '';
  const nombreCliente = (id) => cliente.get(id)?.nombre ?? '';
  const codigo = (id) => pedidosDe.get(id)?.codigo ?? '';
  const t = filtro.transmisionId ? transmisiones.get(filtro.transmisionId) : null;

  const resumen = [
    ['Negocio', negocio],
    ['Período', `${fechaTexto(filtro.desde)} al ${fechaTexto(filtro.hasta)}`],
    ['Transmisión', t ? t.nombre : 'Todas'],
    ['Generado', formatearFecha(ahora)],
    ['', ''],
    ['VENTAS GENERADAS (pedidos creados en el período, sin cancelados)', ''],
    ['Pedidos', e.ventas.pedidos, 'entero'],
    ['Ventas (Bs)', e.ventas.total, 'dinero'],
    ['Ticket promedio (Bs)', e.ventas.ticketPromedio, 'dinero'],
    ['Cancelaciones del período: pedidos', e.cancelaciones.pedidos, 'entero'],
    ['Cancelaciones del período (Bs)', e.cancelaciones.total, 'dinero'],
    ['', ''],
    ['DINERO COBRADO (pagos recibidos en el período)', ''],
    ['Cobrado (Bs)', e.cobros.total, 'dinero'],
    ['Efectivo (Bs)', e.cobros.efectivo, 'dinero'],
    ['QR (Bs)', e.cobros.qr, 'dinero'],
    ['Devoluciones (Bs)', e.devoluciones.total, 'dinero'],
    ['Neto cobrado (Bs)', e.netoCobrado, 'dinero'],
    ['', ''],
    ['ENTREGAS DEL PERÍODO', ''],
    ['Pedidos entregados', e.entregas.pedidos, 'entero'],
    ['Entregas por recojo', e.entregas.recojo, 'entero'],
    ['Entregas por envío', e.entregas.envio, 'entero'],
    ['Entregas de pedidos vencidos', e.entregas.vencidos, 'entero'],
    ['', ''],
    ['FOTO DE HOY', ''],
    ['Por cobrar (Bs)', e.deudas.total, 'dinero'],
    ['Pedidos con deuda', e.deudas.pedidos, 'entero'],
    ['Pendientes de entrega', e.pendientesEntrega.pedidos, 'entero'],
    ['Pendientes vencidos', e.pendientesEntrega.vencidos, 'entero'],
  ];

  const hojas = [
    {
      nombre: 'Resumen',
      columnas: [{ titulo: 'Concepto', ancho: 62 }, { titulo: 'Valor', ancho: 18, tipo: 'mixto' }],
      filas: resumen.map(([a, b]) => [a, b]),
      tipos: resumen.map((r) => r[2] ?? 'texto'),
    },
    {
      nombre: 'Por día',
      columnas: [{ titulo: 'Día', ancho: 12 }, { titulo: 'Pedidos', tipo: 'entero' }, { titulo: 'Ventas (Bs)', tipo: 'dinero', ancho: 14 }, { titulo: 'Cobrado (Bs)', tipo: 'dinero', ancho: 14 }, { titulo: 'Devuelto (Bs)', tipo: 'dinero', ancho: 14 }],
      filas: e.serie.map((s) => [fechaTexto(s.dia), s.pedidos, s.ventas, s.cobros, s.devoluciones]),
    },
    {
      nombre: 'Pedidos',
      columnas: [
        { titulo: 'Código', ancho: 13 }, { titulo: 'Creado', tipo: 'fecha', ancho: 17 }, { titulo: 'Clienta', ancho: 24 }, { titulo: 'WhatsApp', ancho: 15 },
        { titulo: 'Transmisión', ancho: 18 }, { titulo: 'Estado', ancho: 11 }, { titulo: 'Entrega', ancho: 9 }, { titulo: 'Prendas (Bs)', tipo: 'dinero' },
        { titulo: 'Envío (Bs)', tipo: 'dinero' }, { titulo: 'Total (Bs)', tipo: 'dinero' }, { titulo: 'Pagado (Bs)', tipo: 'dinero' }, { titulo: 'Devuelto (Bs)', tipo: 'dinero' },
        { titulo: 'Saldo (Bs)', tipo: 'dinero' }, { titulo: 'Estado de pago', ancho: 13 }, { titulo: 'Fecha límite', tipo: 'fecha', ancho: 17 },
        { titulo: 'Cancelado el', tipo: 'fecha', ancho: 17 }, { titulo: 'Motivo de cancelación', ancho: 28 }, { titulo: 'Observaciones', ancho: 30 },
      ],
      filas: creados.map((p) => [
        p.codigo, p.creadoEn, nombreCliente(p.clienteId), cliente.get(p.clienteId)?.whatsapp ?? '', transmisiones.get(p.transmisionId)?.nombre ?? '',
        ESTADO[p.estado], MODALIDAD[p.modalidad], p.totalPrendas, p.envio, p.total, p.pagado, p.reembolsado,
        p.estado === 'cancelado' ? 0 : saldoPendiente(p), PAGO[p.estadoPago], p.fechaLimite, p.cancelacion?.fecha ?? null, p.cancelacion?.motivo ?? '', p.observaciones,
      ]),
    },
    {
      nombre: 'Prendas',
      columnas: [{ titulo: 'Pedido', ancho: 13 }, { titulo: 'N.º', tipo: 'entero' }, { titulo: 'Descripción', ancho: 28 }, { titulo: 'Talla' }, { titulo: 'Color' }, { titulo: 'Otro' }, { titulo: 'Precio (Bs)', tipo: 'dinero' }, { titulo: 'Cantidad', tipo: 'entero' }, { titulo: 'Subtotal (Bs)', tipo: 'dinero' }, { titulo: 'Con foto' }],
      filas: prendas.map((x) => [codigo(x.pedidoId), x.orden, x.descripcion, x.talla, x.color, x.extra, x.precio, x.cantidad, x.subtotal, x.fotoId ? 'Sí' : 'No']),
    },
    {
      nombre: 'Pagos',
      columnas: [{ titulo: 'Fecha', tipo: 'fecha', ancho: 17 }, { titulo: 'Pedido', ancho: 13 }, { titulo: 'Clienta', ancho: 24 }, { titulo: 'Método' }, { titulo: 'Monto (Bs)', tipo: 'dinero' }, { titulo: 'Tipo', ancho: 14 }, { titulo: 'Pago de grupo' }, { titulo: 'Con comprobante' }, { titulo: 'Nota', ancho: 28 }],
      filas: pagos.slice().sort((a, b) => a.fechaHora.localeCompare(b.fechaHora)).map((x) => [
        x.fechaHora, codigo(x.pedidoId), nombreCliente(pedidosDe.get(x.pedidoId)?.clienteId), METODO[x.metodo], x.monto, x.anulaA ? 'Anulación' : 'Pago', x.grupoId ? 'Sí' : 'No', x.comprobanteId ? 'Sí' : 'No', x.nota,
      ]),
    },
    {
      nombre: 'Devoluciones',
      columnas: [{ titulo: 'Fecha', tipo: 'fecha', ancho: 17 }, { titulo: 'Pedido', ancho: 13 }, { titulo: 'Clienta', ancho: 24 }, { titulo: 'Método' }, { titulo: 'Monto (Bs)', tipo: 'dinero' }, { titulo: 'Tipo', ancho: 14 }, { titulo: 'Motivo', ancho: 28 }, { titulo: 'Excepción', ancho: 28 }],
      filas: devoluciones.slice().sort((a, b) => a.fechaHora.localeCompare(b.fechaHora)).map((x) => [
        x.fechaHora, codigo(x.pedidoId), nombreCliente(pedidosDe.get(x.pedidoId)?.clienteId), METODO[x.metodo], x.monto, x.anulaA ? 'Anulación' : 'Devolución', x.motivo, x.excepcion ?? '',
      ]),
    },
    {
      nombre: 'Entregas',
      columnas: [{ titulo: 'Fecha', tipo: 'fecha', ancho: 17 }, { titulo: 'Pedidos', ancho: 26 }, { titulo: 'Tipo' }, { titulo: 'Recibe', ancho: 22 }, { titulo: 'Ciudad', ancho: 14 }, { titulo: 'Transportista', ancho: 18 }, { titulo: 'Guía', ancho: 14 }, { titulo: 'Costo envío (Bs)', tipo: 'dinero', ancho: 15 }, { titulo: 'Saldo al entregar (Bs)', tipo: 'dinero', ancho: 18 }, { titulo: 'Vencido' }],
      filas: entregas.map((x) => [
        x.entregadoEn ?? x.fechaDespacho, x.pedidos.map(codigo).join(', '), MODALIDAD[x.modalidad], x.destinatario, x.ciudad, x.transportista, x.seguimiento, x.costoEnvio, x.saldoAlEntregar, x.vencido ? 'Sí' : 'No',
      ]),
    },
    {
      nombre: 'Por cobrar (hoy)',
      columnas: [{ titulo: 'Pedido', ancho: 13 }, { titulo: 'Creado', tipo: 'fecha', ancho: 17 }, { titulo: 'Clienta', ancho: 24 }, { titulo: 'WhatsApp', ancho: 15 }, { titulo: 'Estado', ancho: 11 }, { titulo: 'Total (Bs)', tipo: 'dinero' }, { titulo: 'Pagado (Bs)', tipo: 'dinero' }, { titulo: 'Saldo (Bs)', tipo: 'dinero' }],
      filas: conDeuda.slice().sort((a, b) => a.creadoEn.localeCompare(b.creadoEn)).map((p) => [
        p.codigo, p.creadoEn, nombreCliente(p.clienteId), cliente.get(p.clienteId)?.whatsapp ?? '', ESTADO[p.estado], p.total, p.pagado - p.reembolsado, saldoPendiente(p),
      ]),
    },
    {
      nombre: 'Clientas',
      columnas: [{ titulo: 'Nombre', ancho: 26 }, { titulo: 'WhatsApp', ancho: 15 }, { titulo: 'Registrada', tipo: 'fecha', ancho: 17 }, { titulo: 'Notas', ancho: 30 }],
      filas: clientes.slice().sort((a, b) => a.nombreNormalizado.localeCompare(b.nombreNormalizado)).map((c) => [c.nombre, c.whatsapp, c.creadoEn, c.notas]),
    },
  ];

  // La hoja Resumen mezcla tipos por fila: se convierte a filas tipadas.
  const resumenHoja = hojas[0];
  resumenHoja.filas = resumenHoja.filas.map(([a, b], i) => [a, { valor: b, tipo: resumenHoja.tipos[i] }]);

  const bytes = crearXlsx(hojas, { titulo: `Informe ${negocio}`.trim(), fecha: ahora });
  const nombre = `informe-ventas-${filtro.desde}-al-${filtro.hasta}.xlsx`;
  return { bytes, nombre, estadisticas: e };
}

export { PERIODOS, inicioDia };
