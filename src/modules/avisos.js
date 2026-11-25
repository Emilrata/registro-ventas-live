// Pantalla: Avisos a clientas — pedidos para recoger a los que hay que escribir (listo / recordatorio).
import { h, agregar, reemplazar } from '../ui/dom.js';
import { encabezado, estadoVacio } from '../ui/componentes.js';
import { obtenerBD } from '../core/db.js';
import { formatearFecha } from '../core/dates.js';
import { formatearMonto } from '../core/money.js';
import { clientasPorAvisar, registrarAviso } from '../services/avisos.js';
import { revisarAvisos } from '../services/notificaciones.js';
import { armarMensaje, enlaceWhatsApp } from '../services/mensajes.js';
import { mostrarAviso } from '../ui/actualizacion.js';

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

function textoEspera(g) {
  const reservado = g.diasReservado === 0 ? 'Reservó hoy' : `Reservó hace ${plural(g.diasReservado, 'día', 'días')}`;
  if (!g.ultimoAviso) return `${reservado} · todavía no le avisaste`;
  return `${reservado} · último aviso el ${formatearFecha(g.ultimoAviso)}`;
}

export async function render(contenedor) {
  const db = obtenerBD();
  const lista = h('div', { class: 'lista' });
  const resumen = h('p', { class: 'texto-secundario' });

  async function dibujar() {
    const { grupos, dias } = await clientasPorAvisar({ db });
    const negocio = (await db.ajustes.get('marca'))?.valor?.nombre ?? '';
    resumen.textContent = `Pedidos para recoger que todavía no se recogieron. Después de avisar, la clienta vuelve a aparecer en ${plural(dias, 'día', 'días')} si sigue sin recoger (se cambia en Más → Avisos a clientas).`;

    const tarjetas = [];
    for (const g of grupos) {
      const prendas = {};
      for (const p of g.pedidos) prendas[p.id] = await db.prendas.where('pedidoId').equals(p.id).sortBy('orden');
      const texto = armarMensaje(g.tipo, { negocio, cliente: g.cliente, pedidos: g.pedidos, prendas });
      const ids = g.pedidos.map((p) => p.id);
      const urgente = g.pedidos.some((p) => p.fechaLimite && new Date(p.fechaLimite) < new Date());
      const marcar = async (medio) => {
        await registrarAviso({ pedidoIds: ids, tipo: g.tipo, medio, db });
        revisarAvisos({ db }).catch(() => {});
      };
      tarjetas.push(h('div', { class: 'tarjeta tarjeta--compacta' },
        h('a', { class: 'tarjeta-pedido__fila enlace-limpio', href: `#/clientes/ver?id=${g.cliente.id}` },
          h('strong', {}, g.cliente.nombre),
          g.saldo > 0 ? h('span', { class: 'numero' }, `Debe ${formatearMonto(g.saldo)}`) : h('span', { class: 'texto-secundario' }, 'Pagado')),
        h('span', { class: 'numero' }, g.pedidos.map((p) => p.codigo).join(', ')),
        h('span', { class: urgente ? 'texto-alerta' : 'texto-secundario' }, textoEspera(g)),
        h('a', {
          class: 'boton boton--primario boton--chico',
          href: enlaceWhatsApp(g.cliente.whatsapp, texto),
          target: '_blank',
          rel: 'noopener',
          onclick: () => { marcar('whatsapp').then(() => setTimeout(dibujar, 500)).catch((e) => console.error(e)); },
        }, g.tipo === 'listo' ? 'Avisar que está listo' : 'Recordar que recoja'),
        h('button', {
          class: 'boton boton--secundario boton--chico',
          type: 'button',
          onclick: async () => {
            await marcar('manual');
            mostrarAviso(`Listo: ${g.cliente.nombre} queda avisada.`);
            await dibujar();
          },
        }, 'Ya le avisé'),
      ));
    }
    reemplazar(lista, ...(tarjetas.length ? tarjetas : [estadoVacio('No hay a quién avisar', 'Todas las clientas con pedidos para recoger ya fueron avisadas.')]));
  }

  agregar(
    contenedor,
    h('a', { class: 'boton boton--enlace volver', href: '#/panel' }, '‹ Panel'),
    encabezado('Avisos a clientas', 'A quién escribir hoy'),
    resumen,
    lista,
    h('a', { class: 'boton boton--secundario boton--ancho', href: '#/vencimientos' }, 'Ver vencimientos'),
  );
  await dibujar();
}
