// Pantalla: Panel (inicio).
import { h, agregar, reemplazar } from '../ui/dom.js';
import { encabezado, estadoVacio, tarjetaInstalacion } from '../ui/componentes.js';
import { claveDia, formatearFecha } from '../core/dates.js';
import { formatearMonto } from '../core/money.js';
import { on } from '../core/events.js';
import { obtenerBD } from '../core/db.js';
import { listarPedidos } from '../services/pedidos.js';
import { agregarFotoPrincipal, tarjetaPedido } from '../ui/pedidos-ui.js';
import { crearGaleria } from '../ui/fotos.js';

export async function render(contenedor) {
  const db = obtenerBD();
  const galeria = crearGaleria();
  const zonaInstalar = h('div');
  const dibujarInstalar = () => {
    reemplazar(zonaInstalar, tarjetaInstalacion(() => dibujarInstalar()) ?? '');
  };
  dibujarInstalar();

  // Ventas generadas hoy (pedidos creados hoy, sin cancelados). No es dinero cobrado.
  const hoy = claveDia(new Date());
  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  const deHoy = (await db.pedidos.where('creadoEn').aboveOrEqual(inicio.toISOString()).toArray()).filter(
    (p) => claveDia(p.creadoEn) === hoy && p.estado !== 'cancelado',
  );
  const ventasHoy = deHoy.reduce((s, p) => s + p.total, 0);
  const totalPedidos = await db.pedidos.count();
  const ultimo = (await db.ajustes.get('respaldo.ultimo'))?.valor ?? null;
  const horasSinRespaldo = ultimo ? (Date.now() - new Date(ultimo.fecha).getTime()) / 3600000 : Infinity;
  const recientes = await agregarFotoPrincipal(await listarPedidos({ limite: 5 }, db), db);

  agregar(contenedor, 
    encabezado('Panel', formatearFecha(new Date())),
    zonaInstalar,
    totalPedidos > 0 && horasSinRespaldo > 24
      ? h('a', { class: 'aviso aviso--error aviso--enlace', href: '#/mas/respaldos' },
          ultimo ? 'Hace más de 24 h que no haces un respaldo. Toca para hacerlo.' : 'Todavía no hiciste ningún respaldo. Toca para hacerlo.')
      : null,
    h(
      'div',
      { class: 'indicadores' },
      h('div', { class: 'indicador' }, h('span', { class: 'indicador__valor numero' }, String(deHoy.length)), h('span', { class: 'indicador__etiqueta' }, 'Pedidos de hoy')),
      h('div', { class: 'indicador' }, h('span', { class: 'indicador__valor numero' }, formatearMonto(ventasHoy)), h('span', { class: 'indicador__etiqueta' }, 'Ventas generadas hoy')),
    ),
    h('a', { class: 'boton boton--primario boton--ancho', href: '#/pedidos/nuevo' }, '+ Nuevo pedido'),
    totalPedidos === 0
      ? estadoVacio('Todavía no hay pedidos', 'Aquí verás las ventas, los cobros y lo pendiente del día.')
      : h('div', { class: 'paso' }, h('h2', { class: 'subtitulo' }, 'Últimos pedidos'), h('div', { class: 'lista' }, ...recientes.map((p) => tarjetaPedido(p, galeria)))),
  );

  const quitar = [on('instalacion:disponible', dibujarInstalar), on('instalacion:hecha', dibujarInstalar)];
  return () => {
    quitar.forEach((fn) => fn());
    galeria.liberar();
  };
}
