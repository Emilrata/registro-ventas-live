// Pantalla: Pedidos (lista con búsqueda y filtro por transmisión).
import { h, agregar, reemplazar } from '../ui/dom.js';
import { encabezado, estadoVacio } from '../ui/componentes.js';
import { obtenerBD } from '../core/db.js';
import { formatearFecha } from '../core/dates.js';
import { buscarPedidos, listarPedidos } from '../services/pedidos.js';
import { listarTransmisiones } from '../services/transmisiones.js';
import { agregarFotoPrincipal, tarjetaPedido } from '../ui/pedidos-ui.js';
import { crearGaleria } from '../ui/fotos.js';

const POR_PAGINA = 30;

export async function render(contenedor, { params }) {
  const db = obtenerBD();
  const galeria = crearGaleria();
  let texto = params.q ?? '';
  let transmisionId = params.t ? Number(params.t) : null;
  let desde = 0;
  let turno = 0;

  const transmisiones = await listarTransmisiones(db);
  const buscador = h('input', {
    class: 'entrada', type: 'search', id: 'buscar-pedidos', placeholder: 'Código, nombre o número',
    'aria-label': 'Buscar pedidos', value: texto, autocomplete: 'off', enterkeyhint: 'search',
  });
  const filtro = h(
    'select',
    { class: 'entrada', id: 'filtro-transmision', 'aria-label': 'Transmisión' },
    h('option', { value: '' }, 'Todas las transmisiones'),
    ...transmisiones.map((t) => h('option', { value: String(t.id), selected: t.id === transmisionId }, `${t.nombre} · ${formatearFecha(t.fecha)}`)),
  );
  const lista = h('div', { class: 'lista' });
  const mas = h('button', { class: 'boton boton--secundario boton--ancho', type: 'button', hidden: true }, 'Ver más');

  async function cargar({ reiniciar = false } = {}) {
    const miTurno = ++turno;
    if (reiniciar) desde = 0;
    let pedidos;
    if (texto.trim()) {
      pedidos = await buscarPedidos(texto, { limite: 100, db });
      if (transmisionId) pedidos = pedidos.filter((p) => p.transmisionId === transmisionId);
    } else {
      pedidos = await listarPedidos({ desde, limite: POR_PAGINA, transmisionId: transmisionId ?? undefined }, db);
    }
    pedidos = await agregarFotoPrincipal(pedidos, db);
    if (miTurno !== turno) return; // llegó otra búsqueda más nueva
    if (reiniciar) {
      galeria.liberar();
      reemplazar(lista);
    }
    for (const p of pedidos) agregar(lista, tarjetaPedido(p, galeria));
    if (lista.childElementCount === 0) {
      agregar(lista, 
        texto.trim()
          ? estadoVacio('Sin resultados', 'Prueba con otro nombre, número o código.')
          : estadoVacio('Todavía no hay pedidos', 'Toca «Nuevo pedido» para registrar el primero.'),
      );
    }
    mas.hidden = Boolean(texto.trim()) || pedidos.length < POR_PAGINA;
    desde += pedidos.length;
  }

  let espera = null;
  buscador.addEventListener('input', () => {
    clearTimeout(espera);
    espera = setTimeout(() => {
      texto = buscador.value;
      cargar({ reiniciar: true });
    }, 200);
  });
  filtro.addEventListener('change', () => {
    transmisionId = filtro.value ? Number(filtro.value) : null;
    cargar({ reiniciar: true });
  });
  mas.addEventListener('click', () => cargar());

  agregar(contenedor, 
    encabezado('Pedidos'),
    h('a', { class: 'boton boton--primario boton--ancho', href: '#/pedidos/nuevo' }, '+ Nuevo pedido'),
    h('div', { class: 'filtros' }, buscador, transmisiones.length ? filtro : null),
    lista,
    mas,
  );
  await cargar({ reiniciar: true });
  return () => {
    clearTimeout(espera);
    galeria.liberar();
  };
}
