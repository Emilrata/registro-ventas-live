// Mensajes de WhatsApp preparados. Funciones puras: no tocan la base de datos.
// La app solo ABRE WhatsApp con el texto listo; la persona decide si lo envía.
import { formatearMonto } from '../core/money.js';
import { formatearFecha, diasEntre } from '../core/dates.js';
import { saldoPendiente } from '../core/calculos.js';

export const TIPOS_MENSAJE = {
  listo: 'Pedido listo para recoger',
  recordatorio: 'Recordatorio de vencimiento',
  saldo: 'Recordar saldo',
  enviado: 'Aviso de envío',
};

const primerNombre = (nombre) => (nombre ?? '').trim().split(/\s+/)[0] || '';

function lineasPrendas(prendas) {
  return prendas.map((p) => {
    const detalle = [p.talla && `talla ${p.talla}`, p.color].filter(Boolean).join(', ');
    const desc = p.descripcion || 'Prenda';
    return `• ${p.cantidad > 1 ? `${p.cantidad} × ` : ''}${desc}${detalle ? ` (${detalle})` : ''}: ${formatearMonto(p.subtotal)}`;
  });
}

function resumenImportes(pedidos) {
  const total = pedidos.reduce((s, p) => s + p.total, 0);
  const pagado = pedidos.reduce((s, p) => s + (p.pagado - p.reembolsado), 0);
  const saldo = pedidos.reduce((s, p) => s + saldoPendiente(p), 0);
  const l = [`Total: ${formatearMonto(total)}`];
  if (pagado > 0) l.push(`Pagado: ${formatearMonto(pagado)}`);
  l.push(saldo > 0 ? `Saldo a pagar: ${formatearMonto(saldo)}` : 'Está todo pagado. ¡Gracias!');
  return l;
}

/**
 * Arma el texto del mensaje.
 * datos = { negocio, cliente, pedidos: [pedido], prendas: { [pedidoId]: [prenda] }, entrega?, ahora? }
 */
export function armarMensaje(tipo, { negocio, cliente, pedidos, prendas = {}, entrega = null, ahora = new Date() }) {
  if (!pedidos?.length) throw new TypeError('El mensaje necesita al menos un pedido');
  const hola = `Hola ${primerNombre(cliente?.nombre)}`.trim();
  const firma = negocio ? `\n${negocio}` : '';
  const codigos = pedidos.map((p) => p.codigo).join(', ');
  const varios = pedidos.length > 1;
  const detalle = pedidos.flatMap((p) => {
    const l = lineasPrendas(prendas[p.id] ?? []);
    return varios ? [`${p.codigo}:`, ...l] : l;
  });
  const limite = pedidos.map((p) => p.fechaLimite).sort()[0];

  switch (tipo) {
    case 'listo':
      return [
        `${hola}, ${varios ? `tus pedidos ${codigos} están listos` : `tu pedido ${codigos} está listo`} para recoger.`,
        '',
        ...detalle,
        '',
        ...resumenImportes(pedidos),
        '',
        `Puedes recoger${varios ? 'los' : 'lo'} hasta el ${formatearFecha(limite)}.`,
      ].join('\n') + firma;

    case 'recordatorio': {
      const d = diasEntre(ahora, limite);
      const cuando =
        d < 0 ? `venció el ${formatearFecha(limite)}` : d === 0 ? 'vence hoy' : d === 1 ? 'vence mañana' : `vence el ${formatearFecha(limite)} (en ${d} días)`;
      return [
        `${hola}, te recordamos que ${varios ? `tus pedidos ${codigos}` : `tu pedido ${codigos}`} ${cuando}.`,
        '',
        ...resumenImportes(pedidos),
        '',
        d < 0 ? 'Escríbenos para coordinar la entrega.' : 'Te esperamos para que lo recojas.',
      ].join('\n') + firma;
    }

    case 'saldo':
      return [`${hola}, te escribimos por ${varios ? `tus pedidos ${codigos}` : `tu pedido ${codigos}`}.`, '', ...resumenImportes(pedidos)].join('\n') + firma;

    case 'enviado': {
      const l = [`${hola}, ${varios ? `tus pedidos ${codigos} fueron enviados` : `tu pedido ${codigos} fue enviado`}.`];
      if (entrega?.transportista) l.push(`Transportista: ${entrega.transportista}`);
      if (entrega?.ciudad) l.push(`Destino: ${entrega.ciudad}${entrega.direccion ? `, ${entrega.direccion}` : ''}`);
      if (entrega?.destinatario) l.push(`A nombre de: ${entrega.destinatario}`);
      if (entrega?.seguimiento) l.push(`Número de seguimiento: ${entrega.seguimiento}`);
      return [...l, '', ...resumenImportes(pedidos)].join('\n') + firma;
    }

    default:
      throw new TypeError(`Tipo de mensaje desconocido: ${tipo}`);
  }
}

/** Enlace que abre WhatsApp con el mensaje listo. numero = "+59171234567". */
export function enlaceWhatsApp(numero, texto = '') {
  const digitos = String(numero ?? '').replace(/\D/g, '');
  if (!digitos) throw new TypeError('Falta el número de WhatsApp');
  return `https://wa.me/${digitos}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`;
}
