// Pantalla: detalle de un pedido.
import { h, agregar } from '../ui/dom.js';
import { encabezado, fila } from '../ui/componentes.js';
import { obtenerBD } from '../core/db.js';
import { formatearFecha, formatearFechaHora } from '../core/dates.js';
import { formatearMonto } from '../core/money.js';
import { saldoPendiente } from '../core/calculos.js';
import { obtenerPedido } from '../services/pedidos.js';
import { obtenerGrupo, quitarDeGrupo } from '../services/grupos.js';
import { historialDe } from '../repositories/historial.repo.js';
import { chipEstado, chipPago, textoVencimiento } from '../ui/pedidos-ui.js';
import { abrirVisor, crearGaleria } from '../ui/fotos.js';
import { confirmar, pedirTexto } from '../ui/dialogo.js';
import { anularPago, pagosDePedido, TEXTO_METODO } from '../services/pagos.js';
import { mostrarAviso } from '../ui/actualizacion.js';
import { cancelarPedido, confirmarRecepcion, deshacerEntrega, obtenerEntrega } from '../services/entregas.js';
import { anularDevolucion, devolucionesDePedido, disponibleParaDevolver } from '../services/devoluciones.js';
import { tarjetaMensajes } from '../ui/whatsapp-ui.js';

const TEXTO_HISTORIAL = {
  'pedido-creado': 'Pedido creado',
  'pedido-editado': 'Pedido editado',
  'pago-registrado': 'Pago registrado',
  'pago-anulado': 'Pago anulado',
  'pedido-entregado': 'Entregado',
  'pedido-enviado': 'Enviado',
  'envio-recibido': 'Envío recibido',
  'entrega-deshecha': 'Entrega deshecha',
  'pedido-cancelado': 'Cancelado',
  'devolucion-registrada': 'Devolución registrada',
  'devolucion-anulada': 'Devolución anulada',
  'aviso-clienta': 'Aviso a la clienta',
};

const recargar = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

export async function render(contenedor, { params }) {
  const db = obtenerBD();
  const id = Number(params.id);
  const datos = await obtenerPedido(id, db);
  if (!datos) {
    agregar(contenedor, h('a', { class: 'boton boton--enlace volver', href: '#/pedidos' }, '‹ Pedidos'), encabezado('Pedido no encontrado'));
    return undefined;
  }
  const { pedido, cliente, prendas, transmision } = datos;
  const galeria = crearGaleria();
  const venc = textoVencimiento(pedido.fechaLimite);

  const listaPrendas = h(
    'div',
    { class: 'lista-prendas' },
    ...prendas.map((p) => {
      const caja = h('button', { class: 'mini-caja mini-caja--grande', type: 'button', 'aria-label': 'Ver foto' });
      if (p.fotoId) {
        galeria.miniatura(p.fotoId).then((u) => u && agregar(caja, h('img', { class: 'mini', src: u, alt: '' })));
        caja.addEventListener('click', async () => abrirVisor(await galeria.completa(p.fotoId), p.descripcion));
      } else {
        caja.classList.add('sin-foto');
        caja.disabled = true;
      }
      const detalles = [p.talla && `Talla ${p.talla}`, p.color, p.extra].filter(Boolean).join(' · ');
      return h(
        'div',
        { class: 'prenda-fila' },
        caja,
        h('div', { class: 'prenda-fila__texto' },
          h('span', {}, p.descripcion || 'Sin descripción'),
          detalles ? h('span', { class: 'texto-secundario' }, detalles) : null,
          h('span', { class: 'texto-secundario numero' }, `${p.cantidad} × ${formatearMonto(p.precio)}`)),
        h('span', { class: 'numero prenda-fila__subtotal' }, formatearMonto(p.subtotal)),
      );
    }),
  );

  // Grupo
  let tarjetaGrupo = null;
  if (pedido.grupoId) {
    const g = await obtenerGrupo(pedido.grupoId, db);
    if (g) {
      tarjetaGrupo = h(
        'section',
        { class: 'tarjeta' },
        h('h2', { class: 'tarjeta__titulo' }, 'Grupo de entrega'),
        h('p', { class: 'texto-secundario' }, `${g.pedidos.length} pedidos · ${formatearMonto(g.total)}`),
        ...g.pedidos.map((p) =>
          h('a', { class: 'accion', href: `#/pedidos/ver?id=${p.id}` }, h('span', { class: 'numero' }, `${p.codigo}${p.id === id ? ' (este)' : ''}`), h('span', { class: 'numero' }, formatearMonto(p.total)))),
        g.pedidos.some((p) => p.estado !== 'cancelado' && saldoPendiente(p) > 0)
          ? h('a', { class: 'boton boton--primario', href: `#/grupos/pagar?grupo=${g.grupo.id}` },
              `Cobrar grupo (${formatearMonto(g.pedidos.filter((p) => p.estado !== 'cancelado').reduce((s2, p) => s2 + saldoPendiente(p), 0))})`)
          : null,
        pedido.estado === 'pendiente'
          ? h('button', {
              class: 'boton boton--secundario', type: 'button',
              onclick: async () => {
                const ok = await confirmar({ titulo: 'Quitar del grupo', texto: `${pedido.codigo} se entregará por separado. No cambia nada más del pedido.`, aceptar: 'Quitar' });
                if (!ok) return;
                const r = await quitarDeGrupo(id, db);
                mostrarAviso(r.ok ? 'Pedido quitado del grupo.' : r.error);
                recargar();
              },
            }, 'Quitar de este grupo')
          : null,
      );
    }
  }

  // Pagos
  const pagos = await pagosDePedido(id, db);
  const cancelado = pedido.estado === 'cancelado';
  const saldo = cancelado ? 0 : saldoPendiente(pedido);
  const aDevolver = disponibleParaDevolver(pedido);
  const filaPago = (p) => {
    const esAnulacion = p.anulaA !== null;
    const caja = h('button', { class: 'mini-caja', type: 'button', 'aria-label': 'Ver comprobante' });
    if (p.comprobanteId) {
      galeria.miniatura(p.comprobanteId).then((u) => u && agregar(caja, h('img', { class: 'mini', src: u, alt: '' })));
      caja.addEventListener('click', async () => abrirVisor(await galeria.completa(p.comprobanteId), 'Comprobante'));
    } else {
      caja.classList.add('sin-foto');
      caja.disabled = true;
    }
    return h(
      'div',
      { class: `pago-fila${p.anulado ? ' pago-fila--anulado' : ''}` },
      caja,
      h('div', { class: 'prenda-fila__texto' },
        h('span', {}, esAnulacion ? 'Anulación' : `${TEXTO_METODO[p.metodo]}${p.grupoId ? ' · pago de grupo' : ''}`),
        h('span', { class: 'texto-secundario numero' }, formatearFechaHora(p.fechaHora)),
        p.nota ? h('span', { class: 'texto-secundario' }, p.nota) : null,
        p.anulado ? h('span', { class: 'texto-secundario' }, 'Anulado') : null),
      h('div', { class: 'pago-fila__derecha' },
        h('span', { class: 'numero prenda-fila__subtotal' }, formatearMonto(p.monto)),
        !esAnulacion && !p.anulado
          ? h('button', {
              class: 'boton boton--enlace boton--chico', type: 'button',
              onclick: async () => {
                const motivo = await pedirTexto({
                  titulo: `Anular pago de ${formatearMonto(p.monto)}`,
                  texto: 'El pago no se borra: queda registrado junto con su anulación.',
                  aceptar: 'Anular', peligro: true,
                });
                if (!motivo) return;
                const r = await anularPago(p.id, { motivo, db });
                mostrarAviso(r.ok ? 'Pago anulado.' : r.error);
                if (r.ok) recargar();
              },
            }, 'Anular')
          : null),
    );
  };
  const tarjetaPagos = h(
    'section',
    { class: 'tarjeta' },
    h('h2', { class: 'tarjeta__titulo' }, 'Pagos'),
    fila('Total', formatearMonto(pedido.total)),
    fila('Pagado', formatearMonto(pedido.pagado - pedido.reembolsado)),
    cancelado ? fila('Por devolver a la clienta', formatearMonto(aDevolver), { alerta: aDevolver > 0 }) : fila('Saldo', formatearMonto(saldo)),
    pagos.length ? h('div', { class: 'lista-prendas' }, ...pagos.map(filaPago)) : null,
    pedido.estado !== 'cancelado' && saldo > 0
      ? h('a', { class: 'boton boton--primario', href: `#/pedidos/pagar?id=${id}` }, 'Registrar pago')
      : null,
  );

  // Entrega / cancelación
  const entrega = pedido.entregaId ? await obtenerEntrega(pedido.entregaId, db) : null;
  let tarjetaEntrega;
  if (pedido.estado === 'pendiente') {
    const grupoPendiente = pedido.grupoId
      ? (await db.pedidos.where('grupoId').equals(pedido.grupoId).toArray()).filter((p) => p.estado === 'pendiente').length > 1
      : false;
    tarjetaEntrega = h('section', { class: 'tarjeta' },
      h('h2', { class: 'tarjeta__titulo' }, 'Entrega'),
      grupoPendiente
        ? h('a', { class: 'boton boton--primario', href: `#/pedidos/entregar?grupo=${pedido.grupoId}&id=${id}` }, 'Entregar todo el grupo')
        : null,
      h('a', { class: `boton ${grupoPendiente ? 'boton--secundario' : 'boton--primario'}`, href: `#/pedidos/entregar?id=${id}` },
        grupoPendiente ? 'Entregar solo este pedido' : 'Marcar como entregado'),
      h('button', {
        class: 'boton boton--enlace', type: 'button',
        onclick: async () => {
          const motivo = await pedirTexto({
            titulo: `Cancelar ${pedido.codigo}`,
            texto: pedido.pagado - pedido.reembolsado > 0
              ? `La clienta pagó ${formatearMonto(pedido.pagado - pedido.reembolsado)}. Después podrás registrar la devolución. No se borra nada.`
              : 'El pedido queda como cancelado. No se borra nada.',
            aceptar: 'Cancelar pedido', peligro: true,
          });
          if (!motivo) return;
          const r = await cancelarPedido(id, { motivo, db });
          mostrarAviso(r.ok ? 'Pedido cancelado.' : r.error);
          if (r.ok) recargar();
        },
      }, 'Cancelar pedido'));
  } else if (pedido.estado === 'entregado' && entrega) {
    const esEnvio = entrega.modalidad === 'envio';
    tarjetaEntrega = h('section', { class: 'tarjeta' },
      h('h2', { class: 'tarjeta__titulo' }, esEnvio ? 'Envío' : 'Entrega'),
      esEnvio ? fila('Despachado', formatearFechaHora(entrega.fechaDespacho)) : null,
      fila(esEnvio ? 'Recibido' : 'Entregado', entrega.entregadoEn ? formatearFechaHora(entrega.entregadoEn) : 'Sin confirmar'),
      entrega.destinatario ? fila('Recibe', entrega.destinatario) : null,
      esEnvio && entrega.ciudad ? fila('Destino', [entrega.ciudad, entrega.direccion].filter(Boolean).join(', ')) : null,
      esEnvio && entrega.transportista ? fila('Transportista', entrega.transportista) : null,
      esEnvio && entrega.seguimiento ? fila('Seguimiento', entrega.seguimiento) : null,
      esEnvio && entrega.costoEnvio ? fila(entrega.grupoId ? 'Costo del envío (grupo)' : 'Costo del envío', formatearMonto(entrega.costoEnvio)) : null,
      entrega.vencido ? fila('Nota', 'Se entregó vencido', { alerta: true }) : null,
      entrega.nota ? h('p', { class: 'observaciones' }, entrega.nota) : null,
      esEnvio && !entrega.entregadoEn
        ? h('button', {
            class: 'boton boton--secundario', type: 'button',
            onclick: async () => {
              const r = await confirmarRecepcion(entrega.id, { db });
              mostrarAviso(r.ok ? 'Recepción confirmada.' : r.error);
              if (r.ok) recargar();
            },
          }, 'La clienta ya lo recibió')
        : null,
      h('button', {
        class: 'boton boton--enlace', type: 'button',
        onclick: async () => {
          const motivo = await pedirTexto({
            titulo: 'Deshacer entrega',
            texto: entrega.pedidos.length > 1 ? `Los ${entrega.pedidos.length} pedidos de esta entrega volverán a pendiente.` : 'El pedido volverá a pendiente. La entrega queda registrada como anulada.',
            aceptar: 'Deshacer', peligro: true,
          });
          if (!motivo) return;
          const r = await deshacerEntrega(entrega.id, { motivo, db });
          mostrarAviso(r.ok ? 'Entrega deshecha.' : r.error);
          if (r.ok) recargar();
        },
      }, 'Deshacer entrega (si fue un error)'));
  } else if (cancelado && pedido.cancelacion) {
    tarjetaEntrega = h('section', { class: 'tarjeta' },
      h('h2', { class: 'tarjeta__titulo' }, 'Cancelación'),
      fila('Fecha', formatearFechaHora(pedido.cancelacion.fecha)),
      h('p', { class: 'observaciones' }, pedido.cancelacion.motivo));
  }

  // Devoluciones
  const devoluciones = await devolucionesDePedido(id, db);
  const tarjetaDevoluciones = devoluciones.length || aDevolver > 0
    ? h('section', { class: 'tarjeta' },
        h('h2', { class: 'tarjeta__titulo' }, 'Devoluciones'),
        ...devoluciones.map((d) => h('div', { class: `pago-fila${d.anulada ? ' pago-fila--anulado' : ''}` },
          h('div', { class: 'prenda-fila__texto' },
            h('span', {}, d.anulaA ? 'Anulación de devolución' : `${TEXTO_METODO[d.metodo]} · ${d.motivo}`),
            h('span', { class: 'texto-secundario numero' }, formatearFechaHora(d.fechaHora)),
            d.excepcion ? h('span', { class: 'texto-secundario' }, `Excepción: ${d.excepcion}`) : null,
            d.anulada ? h('span', { class: 'texto-secundario' }, 'Anulada') : null),
          h('div', { class: 'pago-fila__derecha' },
            h('span', { class: 'numero prenda-fila__subtotal' }, formatearMonto(d.monto)),
            !d.anulaA && !d.anulada
              ? h('button', {
                  class: 'boton boton--enlace boton--chico', type: 'button',
                  onclick: async () => {
                    const motivo = await pedirTexto({ titulo: 'Anular devolución', texto: 'La devolución no se borra: queda con su anulación.', aceptar: 'Anular', peligro: true });
                    if (!motivo) return;
                    const r = await anularDevolucion(d.id, { motivo, db });
                    mostrarAviso(r.ok ? 'Devolución anulada.' : r.error);
                    if (r.ok) recargar();
                  },
                }, 'Anular')
              : null))),
        aDevolver > 0 && (cancelado || pedido.estado === 'entregado')
          ? h('a', { class: `boton ${cancelado ? 'boton--primario' : 'boton--secundario'}`, href: `#/pedidos/devolver?id=${id}` }, 'Registrar devolución')
          : null)
    : null;

  // Mensajes de WhatsApp preparados
  let tipos = [];
  if (pedido.estado === 'pendiente') tipos = ['listo', 'recordatorio'];
  else if (pedido.estado === 'entregado' && entrega?.modalidad === 'envio') tipos = ['enviado'];
  if (!cancelado && saldo > 0) tipos.push('saldo');
  const mensajes = tipos.length ? await tarjetaMensajes({ cliente, pedidos: [pedido], entrega, tipos, registrar: pedido.estado === 'pendiente' }, db) : null;

  // Historial
  const historial = await historialDe('pedido', id, db);
  const tarjetaHistorial = h(
    'details',
    { class: 'tarjeta' },
    h('summary', { class: 'tarjeta__titulo' }, `Historial (${historial.length})`),
    ...historial.reverse().map((e) => fila(TEXTO_HISTORIAL[e.tipo] ?? e.tipo, formatearFechaHora(e.fechaHora))),
  );

  const wa = cliente ? `https://wa.me/${cliente.whatsapp.replace(/\D/g, '')}` : null;

  agregar(contenedor, 
    h('a', { class: 'boton boton--enlace volver', href: '#/pedidos' }, '‹ Pedidos'),
    encabezado(pedido.codigo),
    h('div', { class: 'chips' },
      entrega?.modalidad === 'envio' && !entrega.entregadoEn ? h('span', { class: 'chip chip--pendiente' }, 'Enviado') : chipEstado(pedido.estado),
      chipPago(pedido.estadoPago)),
    params.nuevo ? h('a', { class: 'boton boton--primario boton--ancho', href: '#/pedidos/nuevo' }, '+ Otro pedido') : null,
    h(
      'section',
      { class: 'tarjeta' },
      h('h2', { class: 'tarjeta__titulo' }, 'Clienta'),
      cliente
        ? h('a', { class: 'accion', href: `#/clientes/ver?id=${cliente.id}` }, h('span', {}, cliente.nombre), h('span', { class: 'accion__flecha', 'aria-hidden': 'true' }, '›'))
        : fila('Clienta', '—'),
      cliente ? fila('WhatsApp', cliente.whatsapp) : null,
      wa ? h('a', { class: 'boton boton--secundario', href: wa, target: '_blank', rel: 'noopener' }, 'Abrir WhatsApp') : null,
    ),
    h(
      'section',
      { class: 'tarjeta' },
      h('h2', { class: 'tarjeta__titulo' }, `Prendas (${prendas.length})`),
      listaPrendas,
    ),
    h(
      'section',
      { class: 'tarjeta' },
      h('h2', { class: 'tarjeta__titulo' }, 'Importes'),
      fila('Prendas', formatearMonto(pedido.totalPrendas)),
      pedido.modalidad === 'envio' ? fila('Envío', formatearMonto(pedido.envio)) : null,
      fila('Total', formatearMonto(pedido.total)),
    ),
    tarjetaEntrega,
    tarjetaPagos,
    tarjetaDevoluciones,
    mensajes,
    h(
      'section',
      { class: 'tarjeta' },
      h('h2', { class: 'tarjeta__titulo' }, 'Datos'),
      fila('Entrega', pedido.modalidad === 'envio' ? 'Envío' : 'Recoge'),
      fila('Transmisión', transmision ? transmision.nombre : 'Sin transmisión'),
      fila('Creado', formatearFechaHora(pedido.creadoEn)),
      fila('Fecha límite', formatearFecha(pedido.fechaLimite)),
      pedido.estado === 'pendiente' ? fila('Plazo', venc.texto, { alerta: venc.urgente }) : null,
      pedido.observaciones ? h('p', { class: 'observaciones' }, pedido.observaciones) : null,
    ),
    tarjetaGrupo,
    pedido.estado === 'pendiente' ? h('a', { class: 'boton boton--secundario boton--ancho', href: `#/pedidos/editar?id=${id}` }, 'Editar pedido') : null,
    tarjetaHistorial,
  );
  return () => galeria.liberar();
}
