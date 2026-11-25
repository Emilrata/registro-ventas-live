// Pantalla: Informes — ventas generadas frente a dinero cobrado, deudas, entregas,
// devoluciones, gráfico por día, filtros y descarga en Excel.
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
import { h, agregar, reemplazar } from '../ui/dom.js';
import { encabezado, fila } from '../ui/componentes.js';
import { obtenerBD } from '../core/db.js';
import { claveDia, formatearFecha } from '../core/dates.js';
import { formatearMonto } from '../core/money.js';
import { calcularEstadisticas, periodoPredefinido, PERIODOS } from '../services/estadisticas.js';
import { crearInformeExcel } from '../services/excel.js';
import { listarTransmisiones } from '../services/transmisiones.js';
import { mostrarAviso } from '../ui/actualizacion.js';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const fechaCorta = (clave) => formatearFecha(`${clave}T12:00:00`).slice(0, 5);
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Si el período es largo, agrupa la serie por mes. */
function serieParaGrafico(serie) {
  if (serie.length <= 62) return serie.map((s) => ({ ...s, etiqueta: fechaCorta(s.dia) }));
  const porMes = new Map();
  for (const s of serie) {
    const k = s.dia.slice(0, 7);
    const m = porMes.get(k) ?? { etiqueta: `${MESES[Number(k.slice(5)) - 1]} ${k.slice(2, 4)}`, ventas: 0, cobros: 0 };
    m.ventas += s.ventas;
    m.cobros += s.cobros;
    porMes.set(k, m);
  }
  return [...porMes.values()];
}

function colores() {
  const css = getComputedStyle(document.documentElement);
  const oscuro = css.getPropertyValue('color-scheme').trim() === 'dark';
  return {
    ventas: css.getPropertyValue('--texto').trim() || '#111111',
    // Gris validado: separación ΔE ≥ 39 con el color de ventas y contraste ≥ 3:1 con la tarjeta.
    cobros: oscuro ? '#77776F' : '#86867F',
    texto: css.getPropertyValue('--secundario').trim() || '#666666',
    linea: css.getPropertyValue('--linea').trim() || '#E7E7E4',
    tarjeta: css.getPropertyValue('--tarjeta').trim() || '#FFFFFF',
  };
}

function tile(valor, etiqueta, { alerta = false, ancho = false } = {}) {
  return h('div', { class: `indicador${ancho ? ' indicador--ancho' : ''}` },
    h('span', { class: `indicador__valor numero${alerta ? ' texto-alerta' : ''}` }, valor),
    h('span', { class: 'indicador__etiqueta' }, etiqueta));
}

async function descargarExcel(bytes, nombre) {
  const tipo = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const archivo = new File([bytes], nombre, { type: tipo });
  if (navigator.canShare?.({ files: [archivo] })) {
    try {
      await navigator.share({ files: [archivo], title: nombre });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(archivo);
  const a = h('a', { href: url, download: nombre, hidden: true });
  agregar(document.body, a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function render(contenedor, { params }) {
  const db = obtenerBD();
  const hoy = claveDia(new Date());
  let tipo = PERIODOS[params.p] ? params.p : (params.desde ? 'personalizado' : 'hoy');
  let { desde, hasta } = tipo === 'personalizado' ? { desde: params.desde, hasta: params.hasta ?? hoy } : periodoPredefinido(tipo);
  let transmisionId = params.t ? Number(params.t) : null;
  let grafico = null;
  let turno = 0;

  const selPeriodo = h('select', { class: 'entrada', id: 'inf-periodo', 'aria-label': 'Período' },
    ...Object.entries(PERIODOS).map(([k, v]) => h('option', { value: k, selected: k === tipo }, v)),
    h('option', { value: 'personalizado', selected: tipo === 'personalizado' }, 'Elegir fechas…'));
  const inDesde = h('input', { class: 'entrada', type: 'date', id: 'inf-desde', value: desde, max: hoy, 'aria-label': 'Desde' });
  const inHasta = h('input', { class: 'entrada', type: 'date', id: 'inf-hasta', value: hasta, max: hoy, 'aria-label': 'Hasta' });
  const fechas = h('div', { class: 'fila-campos', hidden: tipo !== 'personalizado' },
    h('div', { class: 'campo' }, h('label', { class: 'campo__etiqueta campo__etiqueta--chica', for: 'inf-desde' }, 'Desde'), inDesde),
    h('div', { class: 'campo' }, h('label', { class: 'campo__etiqueta campo__etiqueta--chica', for: 'inf-hasta' }, 'Hasta'), inHasta));
  const transmisiones = await listarTransmisiones(db);
  const selTransmision = h('select', { class: 'entrada', id: 'inf-transmision', 'aria-label': 'Transmisión' },
    h('option', { value: '' }, 'Todas las transmisiones'),
    ...transmisiones.map((t) => h('option', { value: String(t.id), selected: t.id === transmisionId }, `${t.nombre} · ${formatearFecha(t.fecha)}`)));

  const cuerpo = h('div', { class: 'paso' });
  const botonExcel = h('button', { class: 'boton boton--secundario boton--ancho', type: 'button' }, 'Descargar en Excel');

  async function cargar() {
    const mio = ++turno;
    if (desde > hasta) {
      reemplazar(cuerpo, h('p', { class: 'aviso aviso--error' }, 'La fecha «desde» es posterior a «hasta».'));
      return;
    }
    const e = await calcularEstadisticas({ desde, hasta, transmisionId }, { db });
    if (mio !== turno) return;
    grafico?.destroy();
    grafico = null;

    const textoPeriodo = desde === hasta ? formatearFecha(`${desde}T12:00:00`) : `${formatearFecha(`${desde}T12:00:00`)} al ${formatearFecha(`${hasta}T12:00:00`)}`;
    const lienzo = h('canvas', { role: 'img', 'aria-label': `Gráfico de ventas y cobros por día, ${textoPeriodo}` });
    const serie = serieParaGrafico(e.serie);
    const hayMovimiento = serie.some((s) => s.ventas || s.cobros);

    reemplazar(
      cuerpo,
      h('p', { class: 'texto-secundario' }, textoPeriodo),
      h('section', { class: 'tarjeta' },
        h('h2', { class: 'tarjeta__titulo' }, 'Ventas y cobros'),
        h('div', { class: 'indicadores' },
          tile(formatearMonto(e.ventas.total), `Ventas generadas · ${e.ventas.pedidos} ${e.ventas.pedidos === 1 ? 'pedido' : 'pedidos'}`),
          tile(formatearMonto(e.cobros.total), 'Dinero cobrado'),
          tile(formatearMonto(e.cobros.efectivo), 'Cobrado en efectivo'),
          tile(formatearMonto(e.cobros.qr), 'Cobrado por QR'),
          tile(formatearMonto(e.devoluciones.total), 'Devuelto a clientas'),
          tile(formatearMonto(e.netoCobrado), 'Neto cobrado')),
        h('p', { class: 'campo__ayuda' }, 'Ventas = pedidos creados en el período (sin cancelados). Cobrado = dinero recibido en el período, sea de pedidos de cuando sea.')),
      hayMovimiento
        ? h('section', { class: 'tarjeta' },
            h('h2', { class: 'tarjeta__titulo' }, e.serie.length > 62 ? 'Por mes' : 'Por día'),
            h('div', { class: 'grafico' }, lienzo),
            h('details', {},
              h('summary', { class: 'texto-secundario' }, 'Ver como tabla'),
              h('table', { class: 'tabla numero' },
                h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Ventas'), h('th', {}, 'Cobrado'))),
                h('tbody', {}, ...serie.filter((s) => s.ventas || s.cobros).map((s) => h('tr', {}, h('td', {}, s.etiqueta), h('td', {}, formatearMonto(s.ventas)), h('td', {}, formatearMonto(s.cobros))))))))
        : null,
      h('section', { class: 'tarjeta' },
        h('h2', { class: 'tarjeta__titulo' }, 'Por cobrar (hoy)'),
        fila('Total por cobrar', formatearMonto(e.deudas.total)),
        fila('Pedidos con deuda', String(e.deudas.pedidos)),
        fila('De 0 a 7 días', formatearMonto(e.deudas.tramos['0-7'])),
        fila('De 8 a 30 días', formatearMonto(e.deudas.tramos['8-30'])),
        fila('De más de 30 días', formatearMonto(e.deudas.tramos['31+']), { alerta: e.deudas.tramos['31+'] > 0 }),
        e.deudas.pedidos ? h('a', { class: 'boton boton--secundario', href: '#/cobros' }, 'Ver quién debe') : null),
      h('section', { class: 'tarjeta' },
        h('h2', { class: 'tarjeta__titulo' }, 'Entregas'),
        fila('Pedidos entregados en el período', String(e.entregas.pedidos)),
        fila('Recojos', String(e.entregas.recojo)),
        fila('Envíos', String(e.entregas.envio)),
        e.entregas.vencidos ? fila('Entregados vencidos', String(e.entregas.vencidos)) : null,
        fila('Pendientes de entrega (hoy)', String(e.pendientesEntrega.pedidos)),
        fila('Pendientes vencidos (hoy)', String(e.pendientesEntrega.vencidos), { alerta: e.pendientesEntrega.vencidos > 0 })),
      h('section', { class: 'tarjeta' },
        h('h2', { class: 'tarjeta__titulo' }, 'Cancelaciones del período'),
        fila('Pedidos cancelados', String(e.cancelaciones.pedidos)),
        fila('Monto cancelado', formatearMonto(e.cancelaciones.total)),
        h('p', { class: 'campo__ayuda' }, 'Un pedido cancelado deja de contar como venta en el día en que se creó.')),
      e.topClientas.length
        ? h('section', { class: 'tarjeta' },
            h('h2', { class: 'tarjeta__titulo' }, 'Clientas que más compraron'),
            ...e.topClientas.map((c) => h('a', { class: 'accion', href: `#/clientes/ver?id=${c.clienteId}` },
              h('span', {}, `${c.nombre} · ${c.pedidos} ${c.pedidos === 1 ? 'pedido' : 'pedidos'}`), h('span', { class: 'numero' }, formatearMonto(c.total)))))
        : null,
      botonExcel,
    );

    if (hayMovimiento) {
      const c = colores();
      grafico = new Chart(lienzo, {
        type: 'bar',
        data: {
          labels: serie.map((s) => s.etiqueta),
          datasets: [
            { label: 'Ventas', data: serie.map((s) => s.ventas / 100), backgroundColor: c.ventas, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 18 },
            { label: 'Cobrado', data: serie.map((s) => s.cobros / 100), backgroundColor: c.cobros, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 18 },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          datasets: { bar: { categoryPercentage: 0.7, barPercentage: 0.9 } },
          plugins: {
            legend: { position: 'top', align: 'start', labels: { color: c.texto, boxWidth: 12, boxHeight: 12, usePointStyle: false, font: { family: 'Inter', size: 12 } } },
            tooltip: {
              callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatearMonto(Math.round(ctx.parsed.y * 100))}` },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: c.texto, maxRotation: 0, autoSkip: true, font: { family: 'Inter', size: 11 } }, border: { color: c.linea } },
            y: {
              beginAtZero: true,
              grid: { color: c.linea },
              border: { display: false },
              ticks: { color: c.texto, maxTicksLimit: 5, font: { family: 'Inter', size: 11 }, callback: (v) => `Bs ${Number(v).toLocaleString('es-BO')}` },
            },
          },
        },
      });
    }
  }

  botonExcel.addEventListener('click', async () => {
    botonExcel.disabled = true;
    botonExcel.textContent = 'Preparando…';
    try {
      const { bytes, nombre } = await crearInformeExcel({ desde, hasta, transmisionId }, { db });
      await descargarExcel(bytes, nombre);
    } catch (err) {
      console.error(err);
      mostrarAviso('No se pudo crear el Excel. Vuelve a intentarlo.');
    } finally {
      botonExcel.disabled = false;
      botonExcel.textContent = 'Descargar en Excel';
    }
  });

  selPeriodo.addEventListener('change', () => {
    tipo = selPeriodo.value;
    fechas.hidden = tipo !== 'personalizado';
    if (tipo !== 'personalizado') ({ desde, hasta } = periodoPredefinido(tipo));
    inDesde.value = desde;
    inHasta.value = hasta;
    cargar();
  });
  for (const input of [inDesde, inHasta]) {
    input.addEventListener('change', () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(inDesde.value) || !/^\d{4}-\d{2}-\d{2}$/.test(inHasta.value)) return;
      desde = inDesde.value;
      hasta = inHasta.value;
      cargar();
    });
  }
  selTransmision.addEventListener('change', () => {
    transmisionId = selTransmision.value ? Number(selTransmision.value) : null;
    cargar();
  });

  agregar(
    contenedor,
    encabezado('Informes'),
    h('div', { class: 'filtros' }, h('div', { class: 'fila-campos' }, selPeriodo, transmisiones.length ? selTransmision : null), fechas),
    cuerpo,
  );
  await cargar();
  return () => grafico?.destroy();
}
