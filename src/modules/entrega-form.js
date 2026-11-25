// Pantalla: entregar un pedido (#/pedidos/entregar?id=) o un grupo (#/pedidos/entregar?grupo=).
import { h, agregar } from '../ui/dom.js';
import { encabezado, fila } from '../ui/componentes.js';
import { obtenerBD } from '../core/db.js';
import { diasEntre, formatearFecha } from '../core/dates.js';
import { formatearMonto, parsearMonto } from '../core/money.js';
import { saldoPendiente } from '../core/calculos.js';
import { registrarEntrega } from '../services/entregas.js';
import { confirmar } from '../ui/dialogo.js';
import { mostrarAviso } from '../ui/actualizacion.js';

let n = 0;
function campo(etiqueta, atributos = {}, ayuda = '') {
  const id = `entrega-${++n}`;
  const entrada = atributos.multilinea
    ? h('textarea', { class: 'entrada', id, rows: '2', ...atributos, multilinea: undefined })
    : h('input', { class: 'entrada', id, type: 'text', autocomplete: 'off', ...atributos });
  const nodo = h('div', { class: 'campo' }, h('label', { class: 'campo__etiqueta', for: id }, etiqueta), entrada, ayuda ? h('p', { class: 'campo__ayuda' }, ayuda) : null);
  return { nodo, entrada };
}

export async function render(contenedor, { params }) {
  const db = obtenerBD();
  let pedidos;
  let grupoId = null;
  if (params.grupo) {
    grupoId = Number(params.grupo);
    pedidos = (await db.pedidos.where('grupoId').equals(grupoId).toArray()).filter((p) => p.estado === 'pendiente').sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));
  } else {
    const p = await db.pedidos.get(Number(params.id));
    pedidos = p && p.estado === 'pendiente' ? [p] : [];
  }
  const volverA = `#/pedidos/ver?id=${params.id ?? pedidos[0]?.id ?? ''}`;
  const volver = h('a', { class: 'boton boton--enlace volver', href: params.id || pedidos[0] ? volverA : '#/pedidos' }, '‹ Volver');
  if (!pedidos.length) {
    agregar(contenedor, volver, encabezado('Entregar'), h('p', { class: 'aviso' }, 'No hay pedidos pendientes para entregar.'));
    return;
  }
  const cliente = await db.clientes.get(pedidos[0].clienteId);
  const saldo = pedidos.reduce((s, p) => s + saldoPendiente(p), 0);
  const vencidos = pedidos.filter((p) => diasEntre(new Date(), p.fechaLimite) < 0);
  let modalidad = pedidos.some((p) => p.modalidad === 'envio') ? 'envio' : 'recojo';

  const destinatario = campo('Quién recibe', { maxlength: '80', value: cliente?.nombre ?? '' }, 'Si recoge otra persona, escribe su nombre.');
  const ciudad = campo('Ciudad', { maxlength: '60' });
  const direccion = campo('Dirección o punto de entrega', { maxlength: '200' });
  const telefono = campo('Teléfono de quien recibe', { type: 'tel', inputmode: 'tel', maxlength: '20', value: cliente?.whatsapp ?? '' });
  const transportista = campo('Transportista', { maxlength: '60', placeholder: 'Flota, courier, delivery…' });
  const seguimiento = campo('Número de guía o seguimiento', { maxlength: '60' });
  const costo = campo(grupoId ? 'Costo del envío (uno para todo el grupo, Bs)' : 'Costo del envío (Bs)', { inputmode: 'decimal', placeholder: '0,00' }, 'Lo que cobra el transportista. Queda anotado en la entrega.');
  const nota = campo('Nota', { maxlength: '300', multilinea: true });
  const camposEnvio = h('div', { class: 'formulario' }, ciudad.nodo, direccion.nodo, telefono.nodo, transportista.nodo, seguimiento.nodo, costo.nodo);

  const opcion = (valor, texto) => {
    const b = h('button', { class: 'segmento__opcion', type: 'button', 'aria-pressed': String(modalidad === valor) }, texto);
    b.addEventListener('click', () => {
      modalidad = valor;
      for (const o of segmento.children) o.setAttribute('aria-pressed', String(o === b));
      camposEnvio.hidden = modalidad !== 'envio';
      boton.textContent = modalidad === 'envio' ? 'Registrar envío' : 'Confirmar entrega';
    });
    return b;
  };
  const segmento = h('div', { class: 'segmento', role: 'group', 'aria-label': 'Tipo de entrega' }, opcion('recojo', 'Recoge'), opcion('envio', 'Envío'));
  camposEnvio.hidden = modalidad !== 'envio';
  const error = h('p', { class: 'aviso aviso--error', role: 'alert', hidden: true });
  const boton = h('button', { class: 'boton boton--primario boton--ancho', type: 'submit' }, modalidad === 'envio' ? 'Registrar envío' : 'Confirmar entrega');

  const form = h('form', { class: 'formulario', novalidate: true },
    h('div', { class: 'campo' }, h('span', { class: 'campo__etiqueta' }, 'Entrega'), segmento),
    destinatario.nodo, camposEnvio, nota.nodo, error, boton);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const mostrar = (t) => {
      error.textContent = t;
      error.hidden = false;
    };
    const costoEnvio = modalidad === 'envio' ? parsearMonto(costo.entrada.value || '0') : 0;
    if (costoEnvio === null) return mostrar('El costo de envío no es válido.');
    const datos = {
      pedidoId: grupoId ? undefined : pedidos[0].id,
      grupoId: grupoId ?? undefined,
      modalidad,
      destinatario: destinatario.entrada.value,
      ciudad: ciudad.entrada.value,
      direccion: direccion.entrada.value,
      telefono: telefono.entrada.value,
      transportista: transportista.entrada.value,
      seguimiento: seguimiento.entrada.value,
      costoEnvio,
      nota: nota.entrada.value,
    };
    if (saldo > 0) {
      const seguir = await confirmar({
        titulo: 'Tiene saldo pendiente',
        texto: `Falta cobrar ${formatearMonto(saldo)}. ¿Entregar igual? El saldo seguirá pendiente y podrás cobrarlo después.`,
        aceptar: 'Entregar igual',
      });
      if (!seguir) return undefined;
      datos.aceptarSaldo = true;
    }
    boton.disabled = true;
    try {
      const r = await registrarEntrega(datos, { db });
      if (!r.ok) return mostrar(r.error ?? 'No se pudo registrar la entrega.');
      mostrarAviso(modalidad === 'envio' ? 'Envío registrado.' : 'Entrega registrada.');
      window.location.replace(volverA);
    } catch (err) {
      console.error(err);
      mostrar('No se pudo registrar la entrega. Vuelve a intentarlo.');
    } finally {
      boton.disabled = false;
    }
    return undefined;
  });

  agregar(
    contenedor,
    volver,
    encabezado(grupoId ? 'Entregar grupo' : `Entregar ${pedidos[0].codigo}`, cliente?.nombre ?? ''),
    h('section', { class: 'tarjeta' },
      ...pedidos.map((p) => fila(p.codigo, formatearMonto(p.total))),
      fila('Saldo pendiente', formatearMonto(saldo), { alerta: saldo > 0 })),
    vencidos.length
      ? h('p', { class: 'aviso aviso--error' }, `${vencidos.map((p) => p.codigo).join(', ')} venció el ${formatearFecha(vencidos[0].fechaLimite)}. Se puede entregar igual; quedará registrado como entrega de pedido vencido.`)
      : null,
    form,
  );
}
