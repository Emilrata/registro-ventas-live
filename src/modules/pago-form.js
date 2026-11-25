// Pantalla: Registrar pago de un pedido (#/pedidos/pagar?id=) o de un grupo (#/grupos/pagar?id=).
import { h, agregar, reemplazar } from '../ui/dom.js';
import { encabezado, fila } from '../ui/componentes.js';
import { obtenerBD } from '../core/db.js';
import { formatearMonto, parsearMonto } from '../core/money.js';
import { saldoPendiente } from '../core/calculos.js';
import { obtenerPedido } from '../services/pedidos.js';
import { obtenerGrupo } from '../services/grupos.js';
import { pagarGrupo, registrarPago } from '../services/pagos.js';
import { procesarFoto } from '../services/imagenes.js';
import { crearGaleria } from '../ui/fotos.js';
import { mostrarAviso } from '../ui/actualizacion.js';
import { exigePagoCompleto } from '../services/politicas.js';

async function cargarDatos(params, db) {
  if (params.grupo) {
    const g = await obtenerGrupo(Number(params.grupo), db);
    if (!g) return null;
    const pedidos = g.pedidos.filter((p) => p.estado !== 'cancelado');
    const cliente = await db.clientes.get(g.grupo.clienteId);
    return {
      tipo: 'grupo',
      id: g.grupo.id,
      titulo: 'Cobrar grupo',
      volver: `#/pedidos/ver?id=${pedidos[0]?.id ?? ''}`,
      cliente,
      total: pedidos.reduce((s, p) => s + p.total, 0),
      saldo: pedidos.reduce((s, p) => s + saldoPendiente(p), 0),
      detalle: pedidos.map((p) => fila(p.codigo, `${formatearMonto(saldoPendiente(p))} de ${formatearMonto(p.total)}`)),
    };
  }
  const d = await obtenerPedido(Number(params.id), db);
  if (!d) return null;
  return {
    tipo: 'pedido',
    id: d.pedido.id,
    titulo: `Cobrar ${d.pedido.codigo}`,
    volver: `#/pedidos/ver?id=${d.pedido.id}`,
    cliente: d.cliente,
    total: d.pedido.total,
    saldo: saldoPendiente(d.pedido),
    cancelado: d.pedido.estado === 'cancelado',
    detalle: [],
  };
}

export async function render(contenedor, { params }) {
  const db = obtenerBD();
  const galeria = crearGaleria();
  const datos = await cargarDatos(params, db);
  if (!datos) {
    agregar(contenedor, h('a', { class: 'boton boton--enlace volver', href: '#/pedidos' }, '‹ Pedidos'), encabezado('No encontrado'));
    return undefined;
  }
  const volver = h('a', { class: 'boton boton--enlace volver', href: datos.volver }, '‹ Volver');
  if (datos.cancelado || datos.saldo === 0) {
    agregar(contenedor, volver, encabezado(datos.titulo), h('p', { class: 'aviso' }, datos.cancelado ? 'El pedido está cancelado.' : 'No hay saldo pendiente: ya está pagado.'));
    return undefined;
  }

  // Política: sin adelantos → el monto es siempre el saldo completo.
  const soloTotal = await exigePagoCompleto(db);
  let metodo = 'efectivo';
  let comprobante = null;
  let procesando = false;

  const monto = h('input', { class: 'entrada entrada--monto numero', id: 'pago-monto', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: formatearMonto(datos.saldo, { simbolo: false }), readonly: soloTotal });
  const todo = h('button', { class: 'boton boton--secundario', type: 'button', onclick: () => { monto.value = formatearMonto(datos.saldo, { simbolo: false }); } }, 'Todo el saldo');
  const opcion = (valor, texto) => {
    const b = h('button', { class: 'segmento__opcion', type: 'button', 'aria-pressed': String(metodo === valor) }, texto);
    b.addEventListener('click', () => {
      metodo = valor;
      for (const o of segmento.children) o.setAttribute('aria-pressed', String(o === b));
    });
    return b;
  };
  const segmento = h('div', { class: 'segmento', role: 'group', 'aria-label': 'Método de pago' }, opcion('efectivo', 'Efectivo'), opcion('qr', 'QR'));

  const entradaFoto = h('input', { class: 'solo-lectores', id: 'pago-comprobante', type: 'file', accept: 'image/*' });
  const vista = h('span', { class: 'prenda__foto' }, h('span', { class: 'prenda__foto-texto' }, '+ Foto'));
  entradaFoto.addEventListener('change', async () => {
    const f = entradaFoto.files?.[0];
    if (!f) return;
    procesando = true;
    reemplazar(vista, h('span', { class: 'texto-secundario' }, '…'));
    try {
      comprobante = await procesarFoto(f);
      reemplazar(vista, h('img', { src: galeria.url(comprobante.miniatura), alt: 'Comprobante' }));
    } catch (err) {
      comprobante = null;
      reemplazar(vista, h('span', { class: 'prenda__foto-texto' }, '+ Foto'));
      mostrarAviso(err.message || 'No se pudo usar esa imagen.');
    }
    procesando = false;
  });
  const nota = h('input', { class: 'entrada', id: 'pago-nota', type: 'text', maxlength: '200', autocomplete: 'off', placeholder: 'Opcional' });
  const error = h('p', { class: 'aviso aviso--error', role: 'alert', hidden: true });
  const guardar = h('button', { class: 'boton boton--primario boton--ancho', type: 'submit' }, 'Registrar pago');

  const form = h(
    'form',
    { class: 'formulario', novalidate: true },
    h('div', { class: 'campo' },
      h('label', { class: 'campo__etiqueta', for: 'pago-monto' }, 'Monto recibido (Bs)'),
      soloTotal ? monto : h('div', { class: 'fila-entradas' }, monto, todo),
      soloTotal ? h('p', { class: 'campo__ayuda' }, 'Se paga el total. No se aceptan adelantos.') : null),
    h('div', { class: 'campo' }, h('span', { class: 'campo__etiqueta' }, 'Método'), segmento),
    h('div', { class: 'campo' },
      h('span', { class: 'campo__etiqueta' }, 'Comprobante (opcional)'),
      h('div', { class: 'logo-campo' }, h('label', { class: 'prenda__foto-boton', for: 'pago-comprobante', 'aria-label': 'Elegir comprobante' }, vista),
        h('p', { class: 'campo__ayuda' }, 'Captura del QR o foto del recibo.')),
      entradaFoto),
    h('div', { class: 'campo' }, h('label', { class: 'campo__etiqueta', for: 'pago-nota' }, 'Nota'), nota),
    error,
    guardar,
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const mostrar = (t) => {
      error.textContent = t;
      error.hidden = false;
    };
    if (procesando) return mostrar('Espera a que cargue el comprobante.');
    const centavos = parsearMonto(monto.value);
    if (centavos === null || centavos <= 0) return mostrar('Escribe un monto válido, por ejemplo 80 o 80,50.');
    if (centavos > datos.saldo) return mostrar(`No se puede pagar de más: el saldo es ${formatearMonto(datos.saldo)}.`);
    guardar.disabled = true;
    try {
      const base = { monto: centavos, metodo, nota: nota.value, comprobante };
      const r = datos.tipo === 'grupo'
        ? await pagarGrupo({ ...base, grupoId: datos.id }, { db })
        : await registrarPago({ ...base, pedidoId: datos.id }, { db });
      if (!r.ok) return mostrar(r.error);
      mostrarAviso(`Pago de ${formatearMonto(centavos)} registrado.`);
      window.location.replace(datos.volver);
    } catch (err) {
      console.error(err);
      mostrar('No se pudo registrar el pago. Vuelve a intentarlo.');
    } finally {
      guardar.disabled = false;
    }
    return undefined;
  });

  agregar(
    contenedor,
    volver,
    encabezado(datos.titulo, datos.cliente?.nombre ?? ''),
    h('section', { class: 'tarjeta' },
      fila('Total', formatearMonto(datos.total)),
      fila('Saldo pendiente', formatearMonto(datos.saldo)),
      ...datos.detalle),
    datos.tipo === 'grupo' ? h('p', { class: 'texto-secundario' }, 'El pago se reparte del pedido más antiguo al más nuevo.') : null,
    form,
  );
  return () => galeria.liberar();
}
