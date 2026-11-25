// Pantalla: Nuevo pedido / Editar pedido.
import { h, agregar, reemplazar } from '../ui/dom.js';
import { encabezado } from '../ui/componentes.js';
import { obtenerBD } from '../core/db.js';
import { formatearFecha, formatearFechaHora } from '../core/dates.js';
import { formatearMonto, parsearMonto, multiplicarCentavos } from '../core/money.js';
import { normalizarWhatsapp } from '../core/validation.js';
import { buscarPorWhatsapp, codigoPaisPorDefecto, resumenCliente } from '../services/clientes.js';
import { crearPedido, editarPedido, obtenerPedido, posiblesDuplicados } from '../services/pedidos.js';
import { crearTransmision, listarTransmisiones, transmisionActiva, elegirTransmision } from '../services/transmisiones.js';
import { procesarFoto } from '../services/imagenes.js';
import { crearGaleria } from '../ui/fotos.js';
import { confirmar } from '../ui/dialogo.js';
import { mostrarAviso } from '../ui/actualizacion.js';

let contadorCampos = 0;
const idCampo = (base) => `${base}-${++contadorCampos}`;

const montoATexto = (c) => (c ? formatearMonto(c, { simbolo: false }) : '');

export async function render(contenedor, { params }) {
  const db = obtenerBD();
  const galeria = crearGaleria();
  const editandoId = params.id ? Number(params.id) : null;
  let existente = null;
  if (editandoId) {
    existente = await obtenerPedido(editandoId, db);
    if (!existente) {
      agregar(contenedor, encabezado('Pedido no encontrado'));
      return undefined;
    }
    if (existente.pedido.estado !== 'pendiente') {
      agregar(contenedor, encabezado('No se puede editar'), h('p', { class: 'texto-secundario' }, 'Solo se editan pedidos pendientes.'));
      return undefined;
    }
  }

  const codigoPais = await codigoPaisPorDefecto(db);
  let clienteEncontrado = existente?.cliente ?? null;

  // --- Transmisión --------------------------------------------------------------
  const selTransmision = h('select', { class: 'entrada', id: 'pedido-transmision' });
  async function llenarTransmisiones(elegida) {
    const lista = await listarTransmisiones(db);
    reemplazar(selTransmision, 
      h('option', { value: '' }, 'Sin transmisión'),
      ...lista.map((t) => h('option', { value: String(t.id), selected: t.id === elegida }, `${t.nombre} · ${formatearFecha(t.fecha)}`)),
    );
  }
  await llenarTransmisiones(existente ? existente.pedido.transmisionId : (await transmisionActiva(db))?.id ?? null);
  selTransmision.addEventListener('change', () => {
    if (!existente) elegirTransmision(selTransmision.value ? Number(selTransmision.value) : null, db);
  });
  const botonNuevaTransmision = h('button', { class: 'boton boton--secundario', type: 'button' }, 'Nueva');
  botonNuevaTransmision.addEventListener('click', async () => {
    const r = await crearTransmision({}, db);
    if (r.ok) {
      await llenarTransmisiones(r.id);
      mostrarAviso('Transmisión creada.');
    }
  });

  // --- Clienta ------------------------------------------------------------------
  const pais = h('input', { class: 'entrada entrada--pais numero', type: 'text', inputmode: 'numeric', maxlength: '3', value: codigoPais, 'aria-label': 'Código de país' });
  const numero = h('input', { class: 'entrada numero', id: 'pedido-whatsapp', type: 'tel', inputmode: 'tel', autocomplete: 'off', placeholder: '71234567' });
  const nombre = h('input', { class: 'entrada', id: 'pedido-nombre', type: 'text', maxlength: '80', autocomplete: 'off', autocapitalize: 'words' });
  const infoCliente = h('p', { class: 'cliente-info' });
  const campoNombre = h('div', { class: 'campo', hidden: true },
    h('label', { class: 'campo__etiqueta', for: 'pedido-nombre' }, 'Nombre de la clienta'), nombre);

  async function revisarCliente() {
    const w = normalizarWhatsapp(numero.value, pais.value || codigoPais);
    if (!w.ok) {
      clienteEncontrado = null;
      infoCliente.textContent = '';
      campoNombre.hidden = true;
      return;
    }
    const c = await buscarPorWhatsapp(w.valor, { db });
    clienteEncontrado = c;
    if (c) {
      const r = await resumenCliente(c.id, db);
      reemplazar(infoCliente, h('strong', {}, c.nombre), ` · ${r.pedidos} ${r.pedidos === 1 ? 'pedido' : 'pedidos'}`);
      campoNombre.hidden = true;
    } else {
      infoCliente.textContent = 'Clienta nueva';
      campoNombre.hidden = false;
    }
  }
  let esperaCliente = null;
  const alEscribirNumero = () => {
    clearTimeout(esperaCliente);
    esperaCliente = setTimeout(revisarCliente, 250);
  };
  numero.addEventListener('input', alEscribirNumero);
  pais.addEventListener('input', alEscribirNumero);

  // --- Prendas ------------------------------------------------------------------
  const prendas = [];
  const zonaPrendas = h('div', { class: 'prendas' });
  const totalTexto = h('span', { class: 'barra-guardar__total numero' });

  function prendaNueva(datos = {}) {
    return {
      id: datos.id ?? null,
      descripcion: datos.descripcion ?? '',
      talla: datos.talla ?? '',
      color: datos.color ?? '',
      extra: datos.extra ?? '',
      precioTexto: montoATexto(datos.precio ?? 0),
      cantidad: datos.cantidad ?? 1,
      fotoId: datos.fotoId ?? null,
      foto: null,
      urlVista: null,
      procesando: false,
    };
  }

  function precioDe(p) {
    return parsearMonto(p.precioTexto);
  }

  function calcularTotal() {
    let total = 0;
    let valido = true;
    for (const p of prendas) {
      const precio = precioDe(p);
      if (precio === null) valido = false;
      else total += multiplicarCentavos(precio, p.cantidad);
    }
    if (modalidad === 'envio') {
      const e = parsearMonto(envio.value || '0');
      if (e === null) valido = false;
      else total += e;
    }
    totalTexto.textContent = valido ? formatearMonto(total) : 'Revisa los precios';
    return valido ? total : null;
  }

  function tarjetaPrenda(p, i) {
    const idDesc = idCampo('desc');
    const idPrecio = idCampo('precio');
    const entradaFoto = h('input', { class: 'solo-lectores', type: 'file', accept: 'image/*', id: idCampo('foto') });
    const vista = h('span', { class: 'prenda__foto' });
    const dibujarFoto = () => {
      reemplazar(vista);
      if (p.procesando) agregar(vista, h('span', { class: 'texto-secundario' }, '…'));
      else if (p.urlVista) {
        // Tocar la foto permite cambiarla.
        agregar(vista, h('img', { src: p.urlVista, alt: `Foto de la prenda ${i + 1}` }));
      } else agregar(vista, h('span', { class: 'prenda__foto-texto' }, '+ Foto'));
    };
    if (!p.urlVista && p.fotoId) {
      galeria.miniatura(p.fotoId).then((u) => {
        p.urlVista = u;
        dibujarFoto();
      });
    }
    dibujarFoto();

    entradaFoto.addEventListener('change', async () => {
      const f = entradaFoto.files?.[0];
      if (!f) return;
      p.procesando = true;
      dibujarFoto();
      try {
        p.foto = await procesarFoto(f);
        p.urlVista = galeria.url(p.foto.miniatura);
      } catch (err) {
        mostrarAviso(err.message || 'No se pudo usar esa foto.');
      }
      p.procesando = false;
      dibujarFoto();
    });

    const campo = (etiqueta, clave, extra = {}) => {
      const id = extra.id ?? idCampo(clave);
      const entrada = h('input', { class: 'entrada', id, type: 'text', value: p[clave], autocomplete: 'off', ...extra.atributos });
      entrada.addEventListener('input', () => {
        p[clave] = entrada.value;
        if (clave === 'precioTexto') calcularTotal();
      });
      return h('div', { class: `campo ${extra.clase ?? ''}` }, h('label', { class: 'campo__etiqueta campo__etiqueta--chica', for: id }, etiqueta), entrada);
    };

    const cantidad = h('span', { class: 'numero cantidad__valor', 'aria-live': 'polite' }, String(p.cantidad));
    const cambiarCantidad = (d) => {
      p.cantidad = Math.min(999, Math.max(1, p.cantidad + d));
      cantidad.textContent = String(p.cantidad);
      calcularTotal();
    };

    return h(
      'section',
      { class: 'tarjeta prenda', 'aria-label': `Prenda ${i + 1}` },
      h('div', { class: 'prenda__cabecera' },
        h('span', { class: 'tarjeta__titulo' }, `Prenda ${i + 1}`),
        prendas.length > 1
          ? h('button', { class: 'boton boton--enlace boton--chico', type: 'button', onclick: () => quitarPrenda(i) }, 'Quitar')
          : null),
      h('div', { class: 'prenda__principal' },
        h('label', { class: 'prenda__foto-boton', for: entradaFoto.id, 'aria-label': 'Elegir foto' }, vista),
        entradaFoto,
        h('div', { class: 'prenda__datos' },
          campo('Descripción', 'descripcion', { id: idDesc, atributos: { maxlength: '120', placeholder: 'Blusa negra' } }),
          h('div', { class: 'fila-campos' },
            campo('Precio (Bs)', 'precioTexto', { id: idPrecio, clase: 'campo--precio', atributos: { inputmode: 'decimal', placeholder: '0,00', class: 'entrada numero' } }),
            h('div', { class: 'campo' },
              h('span', { class: 'campo__etiqueta campo__etiqueta--chica' }, 'Cantidad'),
              h('div', { class: 'cantidad' },
                h('button', { class: 'cantidad__boton', type: 'button', 'aria-label': 'Menos', onclick: () => cambiarCantidad(-1) }, '−'),
                cantidad,
                h('button', { class: 'cantidad__boton', type: 'button', 'aria-label': 'Más', onclick: () => cambiarCantidad(1) }, '+')))))),
      h('div', { class: 'fila-campos fila-campos--3' },
        campo('Talla', 'talla', { atributos: { maxlength: '40' } }),
        campo('Color', 'color', { atributos: { maxlength: '40' } }),
        campo('Otro', 'extra', { atributos: { maxlength: '40' } })),
    );
  }

  function dibujarPrendas() {
    reemplazar(zonaPrendas, ...prendas.map(tarjetaPrenda));
    calcularTotal();
  }
  function quitarPrenda(i) {
    prendas.splice(i, 1);
    dibujarPrendas();
  }
  const agregarPrenda = h('button', { class: 'boton boton--secundario boton--ancho', type: 'button' }, '+ Agregar prenda');
  agregarPrenda.addEventListener('click', () => {
    prendas.push(prendaNueva());
    dibujarPrendas();
    zonaPrendas.lastElementChild?.querySelector('input[type="text"]')?.focus();
  });

  // --- Entrega y observaciones -----------------------------------------------------
  let modalidad = existente?.pedido.modalidad ?? 'recojo';
  const envio = h('input', { class: 'entrada numero', id: 'pedido-envio', type: 'text', inputmode: 'decimal', placeholder: '0,00', value: montoATexto(existente?.pedido.envio ?? 0) });
  envio.addEventListener('input', calcularTotal);
  const campoEnvio = h('div', { class: 'campo' }, h('label', { class: 'campo__etiqueta', for: 'pedido-envio' }, 'Costo de envío (Bs)'), envio);
  const opcion = (valor, texto) => {
    const b = h('button', { class: 'segmento__opcion', type: 'button', 'aria-pressed': String(modalidad === valor) }, texto);
    b.addEventListener('click', () => {
      modalidad = valor;
      for (const o of segmento.children) o.setAttribute('aria-pressed', String(o === b));
      campoEnvio.hidden = modalidad !== 'envio';
      calcularTotal();
    });
    return b;
  };
  const segmento = h('div', { class: 'segmento', role: 'group', 'aria-label': 'Entrega' }, opcion('recojo', 'Recoge'), opcion('envio', 'Envío'));
  campoEnvio.hidden = modalidad !== 'envio';
  const observaciones = h('textarea', { class: 'entrada', id: 'pedido-obs', rows: '2', maxlength: '500' }, existente?.pedido.observaciones ?? '');

  // --- Guardar ----------------------------------------------------------------------
  const error = h('p', { class: 'aviso aviso--error', role: 'alert', hidden: true });
  const guardar = h('button', { class: 'boton boton--primario', type: 'submit' }, editandoId ? 'Guardar cambios' : 'Guardar pedido');

  const mostrarError = (texto) => {
    error.textContent = texto;
    error.hidden = false;
    error.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  async function enviar(e) {
    e.preventDefault();
    error.hidden = true;
    if (prendas.some((p) => p.procesando)) return mostrarError('Espera a que terminen de cargar las fotos.');
    const total = calcularTotal();
    if (total === null) return mostrarError('Revisa los precios: usa números como 80 o 80,50.');
    const datosPrendas = prendas.map((p) => ({
      id: p.id, descripcion: p.descripcion, talla: p.talla, color: p.color, extra: p.extra,
      precio: precioDe(p), cantidad: p.cantidad, fotoId: p.fotoId, foto: p.foto,
    }));
    const datos = {
      transmisionId: selTransmision.value ? Number(selTransmision.value) : null,
      modalidad,
      envio: modalidad === 'envio' ? parsearMonto(envio.value || '0') : 0,
      observaciones: observaciones.value,
      prendas: datosPrendas,
    };

    guardar.disabled = true;
    try {
      let r;
      if (editandoId) {
        r = await editarPedido(editandoId, datos, { db });
      } else {
        const w = normalizarWhatsapp(numero.value, pais.value || codigoPais);
        if (!w.ok) {
          numero.focus();
          return mostrarError(w.error);
        }
        if (!clienteEncontrado && !nombre.value.trim()) {
          await revisarCliente();
          if (!clienteEncontrado) {
            nombre.focus();
            return mostrarError('Escribe el nombre de la clienta.');
          }
        }
        const parecidos = await posiblesDuplicados({ whatsapp: w.valor, total, db });
        if (parecidos.length) {
          const p = parecidos[parecidos.length - 1];
          const seguir = await confirmar({
            titulo: '¿Pedido repetido?',
            texto: `Esta clienta ya tiene el pedido ${p.codigo} por ${formatearMonto(p.total)} (${formatearFechaHora(p.creadoEn)}). ¿Guardar este también?`,
            aceptar: 'Guardar igual',
          });
          if (!seguir) return undefined;
        }
        r = await crearPedido({ ...datos, whatsapp: w.valor, nombre: nombre.value }, { db });
      }
      if (!r.ok) return mostrarError(r.error);
      mostrarAviso(editandoId ? 'Cambios guardados.' : `Pedido ${r.codigo} guardado.`);
      window.location.replace(`#/pedidos/ver?id=${editandoId ?? r.id}${editandoId ? '' : '&nuevo=1'}`);
    } catch (err) {
      console.error(err);
      mostrarError('No se pudo guardar. Tus datos no se perdieron: vuelve a intentarlo.');
    } finally {
      guardar.disabled = false;
    }
    return undefined;
  }

  // --- Armar pantalla ------------------------------------------------------------------
  if (existente) {
    for (const p of existente.prendas) prendas.push(prendaNueva(p));
  } else {
    prendas.push(prendaNueva());
  }

  const form = h(
    'form',
    { class: 'formulario', novalidate: true },
    h('div', { class: 'campo' },
      h('label', { class: 'campo__etiqueta', for: 'pedido-transmision' }, 'Transmisión'),
      h('div', { class: 'fila-entradas' }, selTransmision, botonNuevaTransmision)),
    existente
      ? h('div', { class: 'campo' }, h('span', { class: 'campo__etiqueta' }, 'Clienta'),
          h('p', {}, h('strong', {}, existente.cliente?.nombre ?? '—'), ` · ${existente.cliente?.whatsapp ?? ''}`))
      : h('div', { class: 'campo' },
          h('label', { class: 'campo__etiqueta', for: 'pedido-whatsapp' }, 'WhatsApp de la clienta'),
          h('div', { class: 'fila-entradas' }, h('span', { class: 'prefijo' }, '+'), pais, numero),
          infoCliente),
    existente ? null : campoNombre,
    h('h2', { class: 'subtitulo' }, 'Prendas'),
    zonaPrendas,
    agregarPrenda,
    h('div', { class: 'campo' }, h('span', { class: 'campo__etiqueta' }, 'Entrega'), segmento),
    campoEnvio,
    h('div', { class: 'campo' }, h('label', { class: 'campo__etiqueta', for: 'pedido-obs' }, 'Observaciones'), observaciones),
    error,
    h('div', { class: 'barra-guardar' }, h('span', { class: 'barra-guardar__etiqueta' }, 'Total', totalTexto), guardar),
  );
  form.addEventListener('submit', enviar);

  agregar(contenedor, 
    h('a', { class: 'boton boton--enlace volver', href: editandoId ? `#/pedidos/ver?id=${editandoId}` : '#/pedidos' }, '‹ Volver'),
    encabezado(editandoId ? `Editar ${existente.pedido.codigo}` : 'Nuevo pedido'),
    form,
  );
  dibujarPrendas();

  return () => {
    clearTimeout(esperaCliente);
    galeria.liberar();
  };
}
