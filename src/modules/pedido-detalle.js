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
import { confirmar } from '../ui/dialogo.js';
import { mostrarAviso } from '../ui/actualizacion.js';

const TEXTO_HISTORIAL = {
  'pedido-creado': 'Pedido creado',
  'pedido-editado': 'Pedido editado',
};

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
        pedido.estado === 'pendiente'
          ? h('button', {
              class: 'boton boton--secundario', type: 'button',
              onclick: async () => {
                const ok = await confirmar({ titulo: 'Quitar del grupo', texto: `${pedido.codigo} se entregará por separado. No cambia nada más del pedido.`, aceptar: 'Quitar' });
                if (!ok) return;
                const r = await quitarDeGrupo(id, db);
                mostrarAviso(r.ok ? 'Pedido quitado del grupo.' : r.error);
                window.dispatchEvent(new HashChangeEvent('hashchange'));
              },
            }, 'Quitar de este grupo')
          : null,
      );
    }
  }

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
    h('div', { class: 'chips' }, chipEstado(pedido.estado), chipPago(pedido.estadoPago)),
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
      fila('Pagado', formatearMonto(pedido.pagado - pedido.reembolsado)),
      fila('Saldo', formatearMonto(saldoPendiente(pedido))),
    ),
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
