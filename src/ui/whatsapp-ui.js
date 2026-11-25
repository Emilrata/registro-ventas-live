// Botones que abren WhatsApp con un mensaje preparado.
import { h } from './dom.js';
import { obtenerBD } from '../core/db.js';
import { armarMensaje, enlaceWhatsApp, TIPOS_MENSAJE } from '../services/mensajes.js';

/**
 * Crea una tarjeta con botones de mensajes para una clienta y sus pedidos.
 * tipos: lista de claves de TIPOS_MENSAJE a mostrar.
 */
export async function tarjetaMensajes({ cliente, pedidos, entrega = null, tipos }, db = obtenerBD()) {
  if (!cliente?.whatsapp || !pedidos.length) return null;
  const negocio = (await db.ajustes.get('marca'))?.valor?.nombre ?? '';
  const prendas = {};
  for (const p of pedidos) prendas[p.id] = await db.prendas.where('pedidoId').equals(p.id).sortBy('orden');
  const botones = tipos.map((tipo) => {
    const texto = armarMensaje(tipo, { negocio, cliente, pedidos, prendas, entrega });
    return h(
      'a',
      { class: 'boton boton--secundario boton--ancho', href: enlaceWhatsApp(cliente.whatsapp, texto), target: '_blank', rel: 'noopener' },
      TIPOS_MENSAJE[tipo],
    );
  });
  return h(
    'section',
    { class: 'tarjeta' },
    h('h2', { class: 'tarjeta__titulo' }, 'Mensaje por WhatsApp'),
    h('p', { class: 'texto-secundario' }, 'Abre WhatsApp con el mensaje listo. Puedes revisarlo antes de enviarlo.'),
    ...botones,
  );
}
