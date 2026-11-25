// Pantalla: Respaldos (crear, guardar/compartir y restaurar).
import { h, agregar, reemplazar } from '../ui/dom.js';
import { encabezado, fila } from '../ui/componentes.js';
import { obtenerBD } from '../core/db.js';
import { formatearFechaHora } from '../core/dates.js';
import { formatearBytes } from '../services/almacenamiento.js';
import { crearRespaldo, restaurarRespaldo, verificarRespaldo } from '../services/respaldo.js';
import { confirmar } from '../ui/dialogo.js';
import { mostrarAviso } from '../ui/actualizacion.js';

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
  const ultimo = (await db.ajustes.get('respaldo.ultimo'))?.valor ?? null;

  // --- Crear ------------------------------------------------------------------------
  const resultado = h('div', { class: 'paso' });
  const crear = h('button', { class: 'boton boton--primario boton--ancho', type: 'button' }, 'Crear respaldo ahora');
  crear.addEventListener('click', async () => {
    crear.disabled = true;
    crear.textContent = 'Preparando…';
    reemplazar(resultado);
    try {
      const { blob, nombre, conteos } = await crearRespaldo({ db });
      const archivo = new File([blob], nombre, { type: 'application/zip' });
      const puedeCompartir = navigator.canShare?.({ files: [archivo] });
      agregar(resultado, 
        h('p', { class: 'aviso' }, `Listo: ${conteos.pedidos} pedidos, ${conteos.archivos} fotos (${formatearBytes(blob.size)}). Guárdalo fuera del teléfono, por ejemplo en Google Drive.`),
        puedeCompartir
          ? h('button', {
              class: 'boton boton--primario boton--ancho', type: 'button',
              onclick: async () => {
                try {
                  await navigator.share({ files: [archivo], title: nombre });
                } catch {
                  /* cancelado */
                }
              },
            }, 'Guardar en Drive / compartir')
          : null,
        h('button', { class: 'boton boton--secundario boton--ancho', type: 'button', onclick: () => descargar(blob, nombre) }, 'Descargar al teléfono'),
      );
    } catch (err) {
      console.error(err);
      agregar(resultado, h('p', { class: 'aviso aviso--error' }, 'No se pudo crear el respaldo. Vuelve a intentarlo.'));
    } finally {
      crear.disabled = false;
      crear.textContent = 'Crear respaldo ahora';
    }
  });

  // --- Restaurar ----------------------------------------------------------------------
  const entrada = h('input', { class: 'solo-lectores', id: 'archivo-respaldo', type: 'file', accept: '.zip,application/zip' });
  const estadoRestaurar = h('div', { class: 'paso' });
  entrada.addEventListener('change', async () => {
    const f = entrada.files?.[0];
    entrada.value = '';
    if (!f) return;
    reemplazar(estadoRestaurar, h('p', { class: 'texto-secundario' }, 'Revisando el respaldo…'));
    let v;
    try {
      v = await verificarRespaldo(f);
    } catch (err) {
      console.error(err);
      v = { ok: false, error: 'No se pudo leer el archivo. Puede ser muy grande para este teléfono.' };
    }
    if (!v.ok) {
      reemplazar(estadoRestaurar, h('p', { class: 'aviso aviso--error' }, v.error));
      return;
    }
    const c = v.manifiesto.conteos;
    reemplazar(estadoRestaurar, 
      h('p', { class: 'aviso' }, `Respaldo verificado del ${formatearFechaHora(v.manifiesto.creadoEn)}: ${c.pedidos} pedidos, ${c.clientes} clientas, ${c.archivos} fotos.`),
    );
    const ok = await confirmar({
      titulo: '¿Reemplazar todos los datos?',
      texto: 'Todo lo que hay ahora en este teléfono se reemplazará por el respaldo. Tu PIN y la licencia de este teléfono no cambian. Antes se guarda una copia interna de los datos actuales.',
      aceptar: 'Sí, restaurar',
      peligro: true,
    });
    if (!ok) return;
    agregar(estadoRestaurar, h('p', { class: 'texto-secundario' }, 'Restaurando… no cierres la app.'));
    try {
      await restaurarRespaldo(v, { db });
      mostrarAviso('Respaldo restaurado.');
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      console.error(err);
      agregar(estadoRestaurar, h('p', { class: 'aviso aviso--error' }, 'No se pudo restaurar. Tus datos actuales no se tocaron.'));
    }
  });

  agregar(contenedor, 
    h('a', { class: 'boton boton--enlace volver', href: '#/mas' }, '‹ Más'),
    encabezado('Respaldos'),
    h(
      'section',
      { class: 'tarjeta' },
      h('h2', { class: 'tarjeta__titulo' }, 'Crear respaldo'),
      fila('Último respaldo', ultimo ? formatearFechaHora(ultimo.fecha) : 'Nunca', { alerta: !ultimo }),
      h('p', { class: 'texto-secundario' }, 'Incluye pedidos, clientas, fotos y ajustes. Si pierdes o cambias de teléfono, con este archivo recuperas todo.'),
      crear,
      resultado,
    ),
    h(
      'section',
      { class: 'tarjeta' },
      h('h2', { class: 'tarjeta__titulo' }, 'Restaurar'),
      h('p', { class: 'texto-secundario' }, 'Elige un archivo de respaldo (.zip). Se revisa completo antes de cambiar nada.'),
      h('label', { class: 'boton boton--secundario boton--ancho', for: 'archivo-respaldo' }, 'Elegir respaldo'),
      entrada,
      estadoRestaurar,
    ),
  );
}
