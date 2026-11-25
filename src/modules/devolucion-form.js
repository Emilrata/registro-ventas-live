// Pantalla: registrar devolución de dinero (#/pedidos/devolver?id=).
import { h, agregar, reemplazar } from '../ui/dom.js';
import { encabezado, fila } from '../ui/componentes.js';
import { obtenerBD } from '../core/db.js';
import { formatearMonto, parsearMonto } from '../core/money.js';
import { disponibleParaDevolver, registrarDevolucion } from '../services/devoluciones.js';
import { procesarFoto } from '../services/imagenes.js';
import { crearGaleria } from '../ui/fotos.js';
import { mostrarAviso } from '../ui/actualizacion.js';

export async function render(contenedor, { params }) {
  const db = obtenerBD();
  const galeria = crearGaleria();
  const pedido = await db.pedidos.get(Number(params.id));
  const volverA = `#/pedidos/ver?id=${params.id}`;
  const volver = h('a', { class: 'boton boton--enlace volver', href: volverA }, '‹ Volver');
  if (!pedido) {
    agregar(contenedor, volver, encabezado('Pedido no encontrado'));
    return undefined;
  }
  const disponible = disponibleParaDevolver(pedido);
  if (disponible === 0) {
    agregar(contenedor, volver, encabezado(`Devolución ${pedido.codigo}`), h('p', { class: 'aviso' }, 'La clienta no tiene dinero pagado para devolver.'));
    return undefined;
  }
  const esExcepcion = pedido.estado !== 'cancelado';
  let metodo = 'efectivo';
  let comprobante = null;

  const monto = h('input', { class: 'entrada entrada--monto numero', id: 'dev-monto', type: 'text', inputmode: 'decimal', value: formatearMonto(disponible, { simbolo: false }) });
  const motivo = h('input', { class: 'entrada', id: 'dev-motivo', type: 'text', maxlength: '200', value: pedido.cancelacion?.motivo ?? '' });
  const excepcion = h('input', { class: 'entrada', id: 'dev-excepcion', type: 'text', maxlength: '200' });
  const obs = h('textarea', { class: 'entrada', id: 'dev-obs', rows: '2', maxlength: '300' });
  const opcion = (valor, texto) => {
    const b = h('button', { class: 'segmento__opcion', type: 'button', 'aria-pressed': String(metodo === valor) }, texto);
    b.addEventListener('click', () => {
      metodo = valor;
      for (const o of segmento.children) o.setAttribute('aria-pressed', String(o === b));
    });
    return b;
  };
  const segmento = h('div', { class: 'segmento', role: 'group', 'aria-label': 'Cómo se devolvió' }, opcion('efectivo', 'Efectivo'), opcion('qr', 'QR / transferencia'));
  const entradaFoto = h('input', { class: 'solo-lectores', id: 'dev-comprobante', type: 'file', accept: 'image/*' });
  const vista = h('span', { class: 'prenda__foto' }, h('span', { class: 'prenda__foto-texto' }, '+ Foto'));
  entradaFoto.addEventListener('change', async () => {
    const f = entradaFoto.files?.[0];
    if (!f) return;
    try {
      comprobante = await procesarFoto(f);
      reemplazar(vista, h('img', { src: galeria.url(comprobante.miniatura), alt: 'Comprobante' }));
    } catch (err) {
      mostrarAviso(err.message || 'No se pudo usar esa imagen.');
    }
  });
  const error = h('p', { class: 'aviso aviso--error', role: 'alert', hidden: true });
  const boton = h('button', { class: 'boton boton--primario boton--ancho', type: 'submit' }, 'Registrar devolución');

  const form = h('form', { class: 'formulario', novalidate: true },
    h('div', { class: 'campo' }, h('label', { class: 'campo__etiqueta', for: 'dev-monto' }, 'Monto devuelto (Bs)'), monto),
    h('div', { class: 'campo' }, h('span', { class: 'campo__etiqueta' }, 'Cómo se devolvió'), segmento),
    h('div', { class: 'campo' }, h('label', { class: 'campo__etiqueta', for: 'dev-motivo' }, 'Motivo'), motivo),
    esExcepcion
      ? h('div', { class: 'campo' }, h('label', { class: 'campo__etiqueta', for: 'dev-excepcion' }, 'Por qué es una excepción'), excepcion,
          h('p', { class: 'campo__ayuda' }, 'El pedido no está cancelado. Explica la razón (por ejemplo, descuento por una falla).'))
      : null,
    h('div', { class: 'campo' }, h('span', { class: 'campo__etiqueta' }, 'Comprobante (opcional)'),
      h('label', { class: 'prenda__foto-boton', for: 'dev-comprobante', 'aria-label': 'Elegir comprobante' }, vista), entradaFoto),
    h('div', { class: 'campo' }, h('label', { class: 'campo__etiqueta', for: 'dev-obs' }, 'Observaciones'), obs),
    error, boton);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const mostrar = (t) => {
      error.textContent = t;
      error.hidden = false;
    };
    const centavos = parsearMonto(monto.value);
    if (centavos === null || centavos <= 0) return mostrar('Escribe un monto válido.');
    if (centavos > disponible) return mostrar(`No se puede devolver más de lo pagado (${formatearMonto(disponible)}).`);
    boton.disabled = true;
    try {
      const r = await registrarDevolucion({ pedidoId: pedido.id, monto: centavos, metodo, motivo: motivo.value, excepcion: excepcion.value, observaciones: obs.value, comprobante }, { db });
      if (!r.ok) return mostrar(r.error);
      mostrarAviso(`Devolución de ${formatearMonto(centavos)} registrada.`);
      window.location.replace(volverA);
    } catch (err) {
      console.error(err);
      mostrar('No se pudo registrar la devolución.');
    } finally {
      boton.disabled = false;
    }
    return undefined;
  });

  agregar(
    contenedor,
    volver,
    encabezado(`Devolución ${pedido.codigo}`),
    h('section', { class: 'tarjeta' }, fila('Pagado por la clienta', formatearMonto(pedido.pagado - pedido.reembolsado)), fila('Máximo a devolver', formatearMonto(disponible))),
    form,
  );
  return () => galeria.liberar();
}
