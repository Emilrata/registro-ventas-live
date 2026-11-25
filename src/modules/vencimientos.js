// Pantalla: Vencimientos — pedidos pendientes vencidos y por vencer, con recordatorio por WhatsApp.
import { h, agregar } from '../ui/dom.js';
import { encabezado, estadoVacio } from '../ui/componentes.js';
import { obtenerBD } from '../core/db.js';
import { formatearFecha } from '../core/dates.js';
import { formatearMonto } from '../core/money.js';
import { pedidosPorVencer } from '../services/vencimientos.js';
import { armarMensaje, enlaceWhatsApp } from '../services/mensajes.js';

export async function render(contenedor) {
  const db = obtenerBD();
  const { vencidos, porVencer } = await pedidosPorVencer({ db });
  const negocio = (await db.ajustes.get('marca'))?.valor?.nombre ?? '';

  const tarjeta = (p) => {
    const urgente = p.venc.estado === 'vencido';
    const cuando = urgente ? `Venció el ${formatearFecha(p.fechaLimite)}` : p.venc.restantes === 0 ? 'Vence hoy' : `Vence en ${p.venc.restantes} ${p.venc.restantes === 1 ? 'día' : 'días'}`;
    const texto = p.cliente ? armarMensaje('recordatorio', { negocio, cliente: p.cliente, pedidos: [p] }) : null;
    return h('div', { class: 'tarjeta tarjeta--compacta' },
      h('a', { class: 'tarjeta-pedido__fila enlace-limpio', href: `#/pedidos/ver?id=${p.id}` },
        h('span', { class: 'tarjeta-pedido__codigo numero' }, p.codigo),
        h('span', { class: 'numero' }, `Saldo ${formatearMonto(p.saldo)}`)),
      h('span', {}, p.cliente?.nombre ?? '—'),
      h('span', { class: urgente ? 'texto-alerta' : 'texto-secundario' }, cuando),
      texto ? h('a', { class: 'boton boton--secundario boton--chico', href: enlaceWhatsApp(p.cliente.whatsapp, texto), target: '_blank', rel: 'noopener' }, 'Enviar recordatorio') : null);
  };

  agregar(
    contenedor,
    h('a', { class: 'boton boton--enlace volver', href: '#/panel' }, '‹ Panel'),
    encabezado('Vencimientos', 'Pedidos pendientes de entrega según su fecha límite.'),
    h('h2', { class: 'subtitulo' }, `Vencidos (${vencidos.length})`),
    vencidos.length ? h('div', { class: 'lista' }, ...vencidos.map(tarjeta)) : estadoVacio('Ningún pedido vencido'),
    h('h2', { class: 'subtitulo' }, `Por vencer (${porVencer.length})`),
    porVencer.length ? h('div', { class: 'lista' }, ...porVencer.map(tarjeta)) : estadoVacio('Ninguno por vencer'),
  );
}
