// Pantalla: Cobros — dinero cobrado por día (efectivo / QR) y pedidos por cobrar.
// Lo cobrado es dinero recibido; NO es lo mismo que las ventas generadas.
import { h, agregar, reemplazar } from '../ui/dom.js';
import { encabezado, estadoVacio, fila } from '../ui/componentes.js';
import { obtenerBD } from '../core/db.js';
import { claveDia, formatearFecha, formatearFechaHora } from '../core/dates.js';
import { formatearMonto } from '../core/money.js';
import { cobrosEntre, pedidosPorCobrar, TEXTO_METODO } from '../services/pagos.js';

/** Inicio y fin (ISO) del día local "AAAA-MM-DD". */
export function rangoDia(clave) {
  const [a, m, d] = clave.split('-').map(Number);
  return { desde: new Date(a, m - 1, d).toISOString(), hasta: new Date(a, m - 1, d + 1).toISOString() };
}

export async function render(contenedor, { params }) {
  const db = obtenerBD();
  const hoy = claveDia(new Date());
  let dia = /^\d{4}-\d{2}-\d{2}$/.test(params.dia ?? '') ? params.dia : hoy;

  const selector = h('input', { class: 'entrada', type: 'date', id: 'cobros-dia', value: dia, max: hoy, 'aria-label': 'Día' });
  const resumen = h('div');
  const lista = h('div', { class: 'lista' });

  async function cargarDia() {
    const { desde, hasta } = rangoDia(dia);
    const c = await cobrosEntre(desde, hasta, db);
    reemplazar(
      resumen,
      h('div', { class: 'indicadores' },
        h('div', { class: 'indicador indicador--ancho' },
          h('span', { class: 'indicador__valor numero' }, formatearMonto(c.total)),
          h('span', { class: 'indicador__etiqueta' }, dia === hoy ? 'Cobrado hoy' : `Cobrado el ${formatearFecha(`${dia}T12:00:00`)}`)),
        h('div', { class: 'indicador' }, h('span', { class: 'indicador__valor numero' }, formatearMonto(c.porMetodo.efectivo)), h('span', { class: 'indicador__etiqueta' }, 'Efectivo')),
        h('div', { class: 'indicador' }, h('span', { class: 'indicador__valor numero' }, formatearMonto(c.porMetodo.qr)), h('span', { class: 'indicador__etiqueta' }, 'QR'))),
    );
    reemplazar(
      lista,
      ...c.pagos.map((p) =>
        h('a', { class: `tarjeta-pago${p.anulaA !== null ? ' tarjeta-pago--anulacion' : ''}`, href: `#/pedidos/ver?id=${p.pedidoId}` },
          h('span', { class: 'tarjeta-pedido__cuerpo' },
            h('span', { class: 'tarjeta-pedido__fila' },
              h('span', { class: 'tarjeta-pedido__codigo numero' }, p.pedido?.codigo ?? '—'),
              h('span', { class: 'tarjeta-pedido__total numero' }, formatearMonto(p.monto))),
            h('span', { class: 'tarjeta-pedido__fila tarjeta-pedido__meta' },
              h('span', {}, p.cliente?.nombre ?? '—'),
              h('span', { class: 'texto-secundario' }, `${p.anulaA !== null ? 'Anulación' : TEXTO_METODO[p.metodo]} · ${formatearFechaHora(p.fechaHora).slice(11)}`))))),
    );
    if (!c.pagos.length) agregar(lista, estadoVacio('Sin cobros este día'));
  }
  selector.addEventListener('change', () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selector.value)) return;
    dia = selector.value;
    cargarDia();
  });

  const porCobrar = await pedidosPorCobrar(db);
  const tarjetaPorCobrar = h(
    'details',
    { class: 'tarjeta' },
    h('summary', { class: 'tarjeta__titulo' }, `Por cobrar: ${formatearMonto(porCobrar.total)} (${porCobrar.pedidos.length} ${porCobrar.pedidos.length === 1 ? 'pedido' : 'pedidos'})`),
    ...porCobrar.pedidos.map((p) =>
      h('a', { class: 'accion', href: `#/pedidos/ver?id=${p.id}` },
        h('span', {}, h('span', { class: 'numero' }, p.codigo), ` · ${p.cliente?.nombre ?? '—'}`),
        h('span', { class: 'numero' }, formatearMonto(p.saldo)))),
  );

  agregar(
    contenedor,
    encabezado('Cobros', 'Dinero recibido. Las ventas generadas se ven en el Panel.'),
    h('div', { class: 'campo' }, h('label', { class: 'campo__etiqueta', for: 'cobros-dia' }, 'Día'), selector),
    resumen,
    lista,
    porCobrar.pedidos.length ? tarjetaPorCobrar : fila('Por cobrar', formatearMonto(0)),
  );
  await cargarDia();
}
