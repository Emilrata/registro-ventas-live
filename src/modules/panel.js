// Pantalla: Panel (inicio).
import { h, agregar, reemplazar } from '../ui/dom.js';
import { encabezado, estadoVacio, tarjetaInstalacion } from '../ui/componentes.js';
import { claveDia, diasEntre, formatearFecha } from '../core/dates.js';
import { formatearMonto } from '../core/money.js';
import { on } from '../core/events.js';
import { obtenerBD } from '../core/db.js';
import { listarPedidos } from '../services/pedidos.js';
import { agregarFotoPrincipal, tarjetaPedido } from '../ui/pedidos-ui.js';
import { crearGaleria } from '../ui/fotos.js';
import { pedidosPorVencer } from '../services/vencimientos.js';
import { fotosSinRespaldar } from '../services/respaldo.js';
import { estadoAlmacenamiento } from '../services/almacenamiento.js';
import { clientasPorAvisar } from '../services/avisos.js';
import { licenciaActual } from '../services/licencia.js';

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
  // Dinero cobrado hoy (pagos menos anulaciones hechas hoy), aparte de las ventas.
  const cobradoHoy = (await db.pagos.where('fechaHora').aboveOrEqual(inicio.toISOString()).toArray())
    .filter((p) => claveDia(p.fechaHora) === hoy)
    .reduce((s, p) => s + p.monto, 0);
  const totalPedidos = await db.pedidos.count();
  const ultimo = (await db.ajustes.get('respaldo.ultimo'))?.valor ?? null;
  const horasSinRespaldo = ultimo ? (Date.now() - new Date(ultimo.fecha).getTime()) / 3600000 : Infinity;
  const { vencidos, porVencer } = await pedidosPorVencer({ db });
  // Fotos nuevas sin respaldar: aviso si el último respaldo de fotos tiene más de 7 días.
  const ultimoFotos = (await db.ajustes.get('respaldo.ultimoFotos'))?.valor ?? null;
  const sinRespaldar = await fotosSinRespaldar(db);
  const diasSinFotos = ultimoFotos ? (Date.now() - new Date(ultimoFotos.fecha).getTime()) / 86400000 : Infinity;
  const avisoFotos = sinRespaldar > 0 && diasSinFotos > 7;
  // Espacio: aviso si se usa más del 80 % de lo que el navegador permite.
  const alm = await estadoAlmacenamiento();
  const espacioLleno = alm.usado !== null && alm.cuota ? alm.usado / alm.cuota > 0.8 : false;
  const { grupos: porAvisar } = await clientasPorAvisar({ db });
  // Licencia por tiempo: aviso desde 7 días antes de vencer.
  const licencia = await licenciaActual({ db });
  const venceEn = licencia.ok && licencia.datos.vence ? diasEntre(new Date(), `${licencia.datos.vence}T12:00:00`) : null;
  const recientes = await agregarFotoPrincipal(await listarPedidos({ limite: 5 }, db), db);

  agregar(contenedor, 
    encabezado('Panel', formatearFecha(new Date())),
    zonaInstalar,
    venceEn !== null && venceEn <= 7
      ? h('a', { class: 'aviso aviso--error aviso--enlace', href: '#/mas' },
          `Tu licencia vence ${venceEn <= 0 ? 'hoy' : venceEn === 1 ? 'mañana' : `en ${venceEn} días`} (${formatearFecha(`${licencia.datos.vence}T12:00:00`)}). Pide tu código nuevo y escríbelo en Más → Licencia. Tus datos no se borran.`)
      : null,
    totalPedidos > 0 && horasSinRespaldo > 24
      ? h('a', { class: 'aviso aviso--error aviso--enlace', href: '#/mas/respaldos' },
          ultimo ? 'Hace más de 24 h que no haces un respaldo. Toca para hacerlo.' : 'Todavía no hiciste ningún respaldo. Toca para hacerlo.')
      : null,
    avisoFotos
      ? h('a', { class: 'aviso aviso--error aviso--enlace', href: '#/mas/respaldos' },
          `${sinRespaldar} ${sinRespaldar === 1 ? 'foto' : 'fotos'} sin respaldar${ultimoFotos ? ' desde hace más de una semana' : ''}. Toca para hacer el respaldo de fotos.`)
      : null,
    espacioLleno
      ? h('a', { class: 'aviso aviso--error aviso--enlace', href: '#/mas' }, 'El espacio para la app está casi lleno. Haz un respaldo completo y guárdalo fuera del teléfono.')
      : null,
    h(
      'div',
      { class: 'indicadores' },
      h('div', { class: 'indicador' }, h('span', { class: 'indicador__valor numero' }, String(deHoy.length)), h('span', { class: 'indicador__etiqueta' }, 'Pedidos de hoy')),
      h('div', { class: 'indicador' }, h('span', { class: 'indicador__valor numero' }, formatearMonto(ventasHoy)), h('span', { class: 'indicador__etiqueta' }, 'Ventas generadas hoy')),
      h('a', { class: 'indicador indicador--ancho indicador--enlace', href: '#/cobros' }, h('span', { class: 'indicador__valor numero' }, formatearMonto(cobradoHoy)), h('span', { class: 'indicador__etiqueta' }, 'Cobrado hoy (dinero recibido)')),
    ),
    vencidos.length || porVencer.length
      ? h('a', { class: `aviso aviso--enlace${vencidos.length ? ' aviso--error' : ''}`, href: '#/vencimientos' },
          [vencidos.length ? `${vencidos.length} ${vencidos.length === 1 ? 'pedido vencido' : 'pedidos vencidos'}` : null,
            porVencer.length ? `${porVencer.length} por vencer` : null].filter(Boolean).join(' · ') + '. Toca para ver.')
      : null,
    porAvisar.length
      ? h('a', { class: 'aviso aviso--enlace', href: '#/avisos' },
          `${porAvisar.length} ${porAvisar.length === 1 ? 'clienta por avisar' : 'clientas por avisar'} que recoja su pedido. Toca para ver.`)
      : null,
    h('a', { class: 'boton boton--primario boton--ancho', href: '#/pedidos/nuevo' }, '+ Nuevo pedido'),
    totalPedidos > 0 ? h('a', { class: 'boton boton--secundario boton--ancho', href: '#/informes' }, 'Ver informes y estadísticas') : null,
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
