// Pantalla: Respaldos — datos (diario), fotos nuevas (semanal), completo; contraseña opcional; restaurar.
import { h, agregar, reemplazar } from '../ui/dom.js';
import { encabezado, fila } from '../ui/componentes.js';
import { obtenerBD } from '../core/db.js';
import { formatearFechaHora } from '../core/dates.js';
import { formatearBytes } from '../services/almacenamiento.js';
import { crearRespaldo, fotosSinRespaldar, TIPOS_RESPALDO } from '../services/respaldo.js';
import { panelRestaurar } from '../ui/restaurar-ui.js';
import { mostrarAviso } from '../ui/actualizacion.js';

function puedeCompartir(blob, nombre) {
  try {
    return Boolean(navigator.canShare?.({ files: [new File([blob], nombre, { type: 'application/zip' })] }));
  } catch {
    return false;
  }
}

async function guardarArchivo(blob, nombre) {
  const archivo = new File([blob], nombre, { type: 'application/zip' });
  if (navigator.canShare?.({ files: [archivo] })) {
    try {
      await navigator.share({ files: [archivo], title: nombre });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  descargar(blob, nombre);
}

function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: nombre, hidden: true });
  agregar(document.body, a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function render(contenedor) {
  const db = obtenerBD();
  const [ultimo, ultimoFotos, sinRespaldar, historial] = await Promise.all([
    db.ajustes.get('respaldo.ultimo').then((a) => a?.valor ?? null),
    db.ajustes.get('respaldo.ultimoFotos').then((a) => a?.valor ?? null),
    fotosSinRespaldar(db),
    db.respaldos.orderBy('fecha').reverse().limit(10).toArray(),
  ]);

  // Contraseña opcional (vale para cualquier tipo de respaldo)
  const usarClave = h('input', { type: 'checkbox', id: 'resp-usar-clave' });
  const clave = h('input', { class: 'entrada', type: 'password', id: 'resp-clave', autocomplete: 'new-password', minlength: '6', placeholder: 'Mínimo 6 caracteres' });
  const clave2 = h('input', { class: 'entrada', type: 'password', id: 'resp-clave2', autocomplete: 'new-password', placeholder: 'Repítela' });
  const camposClave = h('div', { class: 'formulario', hidden: true },
    h('div', { class: 'campo' }, h('label', { class: 'campo__etiqueta', for: 'resp-clave' }, 'Contraseña'), clave),
    h('div', { class: 'campo' }, h('label', { class: 'campo__etiqueta', for: 'resp-clave2' }, 'Repetir contraseña'), clave2),
    h('p', { class: 'aviso aviso--error' }, 'Si olvidas esta contraseña, el respaldo NO se podrá abrir. Nadie puede recuperarla.'));
  usarClave.addEventListener('change', () => {
    camposClave.hidden = !usarClave.checked;
  });

  const resultado = h('div', { class: 'paso' });
  const botones = [];

  async function hacer(tipo, boton) {
    let contrasena = '';
    if (usarClave.checked) {
      if (clave.value.length < 6) return mostrarAviso('La contraseña debe tener al menos 6 caracteres.');
      if (clave.value !== clave2.value) return mostrarAviso('Las contraseñas no coinciden.');
      contrasena = clave.value;
    }
    for (const b of botones) b.disabled = true;
    const texto = boton.textContent;
    boton.textContent = 'Preparando…';
    reemplazar(resultado);
    try {
      const r = await crearRespaldo({ tipo, contrasena, db });
      agregar(resultado,
        h('p', { class: 'aviso' },
          `Listo: respaldo ${TIPOS_RESPALDO[tipo].toLowerCase()}${r.conteos ? ` con ${r.conteos.pedidos} pedidos` : ''}${tipo !== 'datos' ? `, ${r.archivos} fotos y comprobantes` : ''} (${formatearBytes(r.bytes)})${contrasena ? ', con contraseña' : ''}. Guárdalo fuera del teléfono, por ejemplo en Google Drive.`),
        // El botón de compartir solo aparece si el navegador de verdad puede abrir el menú
        // de compartir del teléfono (Chrome sí; Brave, por ejemplo, no comparte archivos).
        puedeCompartir(r.blob, r.nombre)
          ? h('button', { class: 'boton boton--primario boton--ancho', type: 'button', onclick: () => guardarArchivo(r.blob, r.nombre) }, 'Compartir (elige Drive en el menú)')
          : null,
        h('button', { class: `boton ${puedeCompartir(r.blob, r.nombre) ? 'boton--secundario' : 'boton--primario'} boton--ancho`, type: 'button', onclick: () => descargar(r.blob, r.nombre) }, 'Descargar al teléfono'),
        h('p', { class: 'campo__ayuda' },
          'La app no entra a tu Drive. Para guardarlo ahí: abre la app Google Drive → botón + → Subir → carpeta Descargas → elige el archivo ',
          h('strong', {}, r.nombre), '.'));
      resultado.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error(err);
      agregar(resultado, h('p', { class: 'aviso aviso--error' }, err.esValidacion ? err.message : 'No se pudo crear el respaldo. Vuelve a intentarlo.'));
    } finally {
      for (const b of botones) b.disabled = false;
      boton.textContent = texto;
    }
    return undefined;
  }
  const boton = (tipo, texto, clase = 'boton--secundario', deshabilitado = false) => {
    const b = h('button', { class: `boton ${clase} boton--ancho`, type: 'button', disabled: deshabilitado }, texto);
    b.addEventListener('click', () => hacer(tipo, b));
    botones.push(b);
    return b;
  };

  agregar(
    contenedor,
    h('a', { class: 'boton boton--enlace volver', href: '#/mas' }, '‹ Más'),
    encabezado('Respaldos'),
    h('section', { class: 'tarjeta' },
      h('h2', { class: 'tarjeta__titulo' }, 'Crear respaldo'),
      fila('Último respaldo de datos', ultimo ? formatearFechaHora(ultimo.fecha) : 'Nunca', { alerta: !ultimo }),
      fila('Último respaldo de fotos', ultimoFotos ? formatearFechaHora(ultimoFotos.fecha) : 'Nunca'),
      fila('Fotos sin respaldar', String(sinRespaldar), { alerta: sinRespaldar > 0 && !ultimoFotos }),
      boton('datos', 'Respaldo de datos (diario, liviano)', 'boton--primario'),
      boton('fotos', sinRespaldar ? `Respaldo de fotos nuevas (${sinRespaldar})` : 'Sin fotos nuevas', 'boton--secundario', sinRespaldar === 0),
      boton('completo', 'Respaldo completo (datos y todas las fotos)'),
      h('p', { class: 'campo__ayuda' }, 'Recomendado: datos todos los días y fotos nuevas una vez por semana. Guarda todos los archivos: para restaurar se usan juntos.'),
      h('label', { class: 'casilla', for: 'resp-usar-clave' }, usarClave, h('span', {}, 'Proteger con contraseña')),
      camposClave,
      resultado),
    h('section', { class: 'tarjeta' },
      h('h2', { class: 'tarjeta__titulo' }, 'Restaurar'),
      h('p', { class: 'texto-secundario' }, 'Se revisa todo antes de cambiar nada.'),
      panelRestaurar({
        db,
        alRestaurar: () => {
          mostrarAviso('Respaldo restaurado.');
          setTimeout(() => window.location.reload(), 800);
        },
      })),
    historial.length
      ? h('details', { class: 'tarjeta' },
          h('summary', { class: 'tarjeta__titulo' }, `Respaldos hechos (${historial.length})`),
          ...historial.map((r) => fila(`${TIPOS_RESPALDO[r.tipo] ?? r.tipo}${r.rango?.cifrado ? ' · con contraseña' : ''}`, `${formatearFechaHora(r.fecha)} · ${formatearBytes(r.tamano)}`)))
      : null,
  );
}
