// Pantallas: Clientes (lista), detalle de clienta (con agrupación de pedidos) y edición.
import { h, agregar, reemplazar } from '../ui/dom.js';
import { encabezado, estadoVacio, fila } from '../ui/componentes.js';
import { obtenerBD } from '../core/db.js';
import { formatearMonto } from '../core/money.js';
import { buscarClientes, editarCliente, resumenCliente } from '../services/clientes.js';
import { listarPedidos } from '../services/pedidos.js';
import { agregarAGrupo, crearGrupo } from '../services/grupos.js';
import { agregarFotoPrincipal, tarjetaPedido } from '../ui/pedidos-ui.js';
import { crearGaleria } from '../ui/fotos.js';
import { mostrarAviso } from '../ui/actualizacion.js';

const recargar = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

// --- #/clientes -------------------------------------------------------------------
export async function render(contenedor) {
  const db = obtenerBD();
  const buscador = h('input', {
    class: 'entrada', type: 'search', placeholder: 'Nombre o número', 'aria-label': 'Buscar clientas', autocomplete: 'off', enterkeyhint: 'search',
  });
  const lista = h('div', { class: 'lista' });
  let turno = 0;

  async function cargar() {
    const miTurno = ++turno;
    const clientes = await buscarClientes(buscador.value, { limite: 100, db });
    if (miTurno !== turno) return;
    reemplazar(lista, 
      ...clientes.map((c) =>
        h('a', { class: 'tarjeta-cliente', href: `#/clientes/ver?id=${c.id}` },
          h('span', { class: 'tarjeta-cliente__nombre' }, c.nombre),
          h('span', { class: 'texto-secundario numero' }, c.whatsapp))),
    );
    if (!clientes.length) {
      agregar(lista, 
        buscador.value.trim()
          ? estadoVacio('Sin resultados', 'Prueba con otro nombre o número.')
          : estadoVacio('Todavía no hay clientas', 'Se registran solas al crear su primer pedido.'),
      );
    }
  }
  let espera = null;
  buscador.addEventListener('input', () => {
    clearTimeout(espera);
    espera = setTimeout(cargar, 200);
  });

  agregar(contenedor, encabezado('Clientes'), buscador, lista);
  await cargar();
  return () => clearTimeout(espera);
}

// --- #/clientes/ver?id= -------------------------------------------------------------
export async function renderDetalle(contenedor, { params }) {
  const db = obtenerBD();
  const id = Number(params.id);
  const cliente = await db.clientes.get(id);
  if (!cliente) {
    agregar(contenedor, h('a', { class: 'boton boton--enlace volver', href: '#/clientes' }, '‹ Clientes'), encabezado('Clienta no encontrada'));
    return undefined;
  }
  const galeria = crearGaleria();
  const resumen = await resumenCliente(id, db);
  const pedidos = await agregarFotoPrincipal(await listarPedidos({ clienteId: id, limite: 500 }, db), db);
  const grupos = await db.grupos.where('clienteId').equals(id).filter((g) => g.estado === 'abierto').toArray();

  // Modo selección para agrupar
  const seleccion = new Set();
  const agrupables = pedidos.filter((p) => p.estado === 'pendiente' && !p.grupoId);
  const barra = h('div', { class: 'barra-seleccion', hidden: true });
  const dibujarBarra = () => {
    barra.hidden = seleccion.size === 0;
    reemplazar(barra, 
      h('span', {}, `${seleccion.size} ${seleccion.size === 1 ? 'pedido' : 'pedidos'}`),
      grupos.length
        ? h('button', {
            class: 'boton boton--secundario boton--chico', type: 'button',
            onclick: async () => {
              const r = await agregarAGrupo(grupos[0].id, [...seleccion], db);
              mostrarAviso(r.ok ? 'Pedidos agregados al grupo.' : r.error);
              if (r.ok) recargar();
            },
          }, 'Al grupo')
        : null,
      h('button', {
        class: 'boton boton--primario boton--chico', type: 'button', disabled: seleccion.size < 2,
        onclick: async () => {
          const r = await crearGrupo([...seleccion], {}, db);
          mostrarAviso(r.ok ? 'Grupo creado.' : r.error);
          if (r.ok) recargar();
        },
      }, 'Agrupar'),
    );
  };

  const filaPedido = (p) => {
    const tarjeta = tarjetaPedido(p, galeria);
    if (!agrupables.includes(p)) return tarjeta;
    const casilla = h('input', { type: 'checkbox', 'aria-label': `Elegir ${p.codigo}` });
    casilla.addEventListener('change', () => {
      if (casilla.checked) seleccion.add(p.id);
      else seleccion.delete(p.id);
      dibujarBarra();
    });
    return h('div', { class: 'pedido-elegible' }, h('label', { class: 'pedido-elegible__casilla' }, casilla), tarjeta);
  };

  agregar(contenedor, 
    h('a', { class: 'boton boton--enlace volver', href: '#/clientes' }, '‹ Clientes'),
    encabezado(cliente.nombre),
    h(
      'section',
      { class: 'tarjeta' },
      fila('WhatsApp', cliente.whatsapp),
      fila('Pedidos', String(resumen.pedidos)),
      fila('Pendientes de entrega', String(resumen.pendientes)),
      fila('Total comprado', formatearMonto(resumen.total)),
      cliente.notas ? h('p', { class: 'observaciones' }, cliente.notas) : null,
      h('div', { class: 'fila-botones' },
        h('a', { class: 'boton boton--secundario', href: `https://wa.me/${cliente.whatsapp.replace(/\D/g, '')}`, target: '_blank', rel: 'noopener' }, 'WhatsApp'),
        h('a', { class: 'boton boton--secundario', href: `#/clientes/editar?id=${id}` }, 'Editar')),
    ),
    h('a', { class: 'boton boton--primario boton--ancho', href: `#/pedidos/nuevo` }, '+ Nuevo pedido'),
    h('h2', { class: 'subtitulo' }, 'Pedidos'),
    agrupables.length >= 2 || (grupos.length && agrupables.length)
      ? h('p', { class: 'texto-secundario' }, 'Marca los pedidos pendientes que quieras entregar juntos y toca «Agrupar».')
      : null,
    pedidos.length ? h('div', { class: 'lista' }, ...pedidos.map(filaPedido)) : estadoVacio('Sin pedidos'),
    barra,
  );
  return () => galeria.liberar();
}

// --- #/clientes/editar?id= ------------------------------------------------------------
export async function renderEditar(contenedor, { params }) {
  const db = obtenerBD();
  const id = Number(params.id);
  const cliente = await db.clientes.get(id);
  if (!cliente) {
    agregar(contenedor, encabezado('Clienta no encontrada'));
    return;
  }
  const nombre = h('input', { class: 'entrada', id: 'cli-nombre', type: 'text', maxlength: '80', value: cliente.nombre });
  const whatsapp = h('input', { class: 'entrada numero', id: 'cli-whatsapp', type: 'tel', value: cliente.whatsapp });
  const notas = h('textarea', { class: 'entrada', id: 'cli-notas', rows: '3', maxlength: '300' }, cliente.notas ?? '');
  const error = h('p', { class: 'error-campo', role: 'alert' });
  const form = h(
    'form',
    { class: 'formulario', novalidate: true },
    h('div', { class: 'campo' }, h('label', { class: 'campo__etiqueta', for: 'cli-nombre' }, 'Nombre'), nombre),
    h('div', { class: 'campo' }, h('label', { class: 'campo__etiqueta', for: 'cli-whatsapp' }, 'WhatsApp'), whatsapp,
      h('p', { class: 'campo__ayuda' }, 'Con +código de país, por ejemplo +59171234567.')),
    h('div', { class: 'campo' }, h('label', { class: 'campo__etiqueta', for: 'cli-notas' }, 'Notas'), notas),
    error,
    h('button', { class: 'boton boton--primario boton--ancho', type: 'submit' }, 'Guardar'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await editarCliente(id, { nombre: nombre.value, whatsapp: whatsapp.value, notas: notas.value }, db);
    if (!r.ok) {
      error.textContent = r.error;
      return;
    }
    mostrarAviso('Clienta guardada.');
    window.location.replace(`#/clientes/ver?id=${id}`);
  });
  agregar(contenedor, 
    h('a', { class: 'boton boton--enlace volver', href: `#/clientes/ver?id=${id}` }, '‹ Volver'),
    encabezado('Editar clienta'),
    h('section', { class: 'tarjeta' }, form),
  );
}
