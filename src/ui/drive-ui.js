// Tarjeta de Google Drive: conectar, subir respaldos, ver y restaurar los guardados en Drive.
import { h, reemplazar } from './dom.js';
import { formatearFechaHora } from '../core/dates.js';
import { formatearBytes } from '../services/almacenamiento.js';
import { conectarDrive, descargarRespaldoDrive, desconectarDrive, listarRespaldosDrive, obtenerConexion, subirRespaldo } from '../services/drive.js';
import { TIPOS_RESPALDO } from '../services/respaldo.js';
import { confirmar } from './dialogo.js';
import { mostrarAviso } from './actualizacion.js';
import { emit, on } from '../core/events.js';

const mensajeError = (err) => (err?.esDrive ? err.message : 'No se pudo completar con Google Drive. Revisa tu internet y vuelve a intentarlo.');

/** Botón que sube un respaldo recién creado a Drive (null si no hay conexión). */
export async function botonSubirADrive(blob, nombre, db) {
  const c = await obtenerConexion(db);
  if (!c) return null;
  const estado = h('p', { class: 'campo__ayuda', 'aria-live': 'polite' });
  const boton = h('button', { class: 'boton boton--primario boton--ancho', type: 'button' }, `Subir a Google Drive (${c.correo})`);
  boton.addEventListener('click', async () => {
    boton.disabled = true;
    estado.textContent = 'Subiendo… 0 %';
    try {
      await subirRespaldo(blob, nombre, { db, alProgreso: (p) => { estado.textContent = `Subiendo… ${Math.round(p * 100)} %`; } });
      estado.textContent = '';
      boton.textContent = '✓ Guardado en Google Drive';
      emit('drive:cambio');
      mostrarAviso('Respaldo guardado en tu Google Drive.');
    } catch (err) {
      console.error(err);
      estado.textContent = mensajeError(err);
      boton.disabled = false;
    }
  });
  return h('div', { class: 'paso' }, boton, estado);
}

/**
 * Tarjeta de Drive. panelRestaurar = elemento devuelto por panelRestaurar() (para restaurar lo elegido).
 * modo: 'completo' (Respaldos) o 'restaurar' (bienvenida de un teléfono nuevo).
 */
export function tarjetaDrive({ db, panelRestaurar, modo = 'completo' }) {
  const cuerpo = h('div', { class: 'paso' });
  const tarjeta = h('section', { class: 'tarjeta', 'aria-labelledby': 'drive-titulo' },
    h('h2', { class: 'tarjeta__titulo', id: 'drive-titulo' }, 'Google Drive'), cuerpo);

  async function dibujar() {
    const c = await obtenerConexion(db);
    if (!c) {
      const boton = h('button', { class: 'boton boton--secundario boton--ancho', type: 'button' }, 'Conectar con Google Drive');
      const estado = h('p', { class: 'campo__ayuda', role: 'alert' });
      boton.addEventListener('click', async () => {
        boton.disabled = true;
        estado.textContent = 'Abriendo Google…';
        try {
          await conectarDrive(db);
          mostrarAviso('Google Drive conectado.');
          await dibujar();
        } catch (err) {
          console.error(err);
          estado.textContent = mensajeError(err);
          boton.disabled = false;
        }
      });
      reemplazar(cuerpo,
        h('p', { class: 'texto-secundario' },
          modo === 'restaurar'
            ? 'Si guardabas tus respaldos en Google Drive, conéctate con el mismo correo para traerlos.'
            : 'Guarda tus respaldos en tu propio Google Drive. La app solo puede ver los archivos que ella misma sube.'),
        boton, estado);
      return;
    }
    const lista = h('div', { class: 'paso' }, h('p', { class: 'texto-secundario' }, 'Buscando respaldos en tu Drive…'));
    reemplazar(cuerpo,
      h('p', {}, 'Conectado: ', h('strong', {}, c.correo)),
      lista,
      modo === 'completo'
        ? h('button', {
            class: 'boton boton--enlace', type: 'button',
            onclick: async () => {
              if (!(await confirmar({ titulo: 'Desconectar Google Drive', texto: 'Los respaldos que ya están en tu Drive no se borran.', aceptar: 'Desconectar' }))) return;
              await desconectarDrive(db);
              await dibujar();
            },
          }, 'Desconectar Google Drive')
        : null);
    try {
      const archivos = await listarRespaldosDrive(db);
      if (!archivos.length) {
        reemplazar(lista, h('p', { class: 'texto-secundario' }, 'Todavía no hay respaldos en tu Drive.'));
        return;
      }
      const elegidos = new Set();
      const restaurar = h('button', { class: 'boton boton--primario boton--ancho', type: 'button', disabled: true }, 'Restaurar los elegidos');
      const estado = h('p', { class: 'campo__ayuda', role: 'alert' });
      // Sugerencia: el más reciente con datos + los de fotos posteriores al último completo.
      const masNuevoConDatos = archivos.find((f) => f.tipo !== 'fotos');
      const filas = archivos.slice(0, 30).map((f) => {
        const casilla = h('input', { type: 'checkbox', 'aria-label': f.nombre });
        casilla.addEventListener('change', () => {
          if (casilla.checked) elegidos.add(f);
          else elegidos.delete(f);
          restaurar.disabled = elegidos.size === 0;
        });
        if (f === masNuevoConDatos) {
          casilla.checked = true;
          elegidos.add(f);
          restaurar.disabled = false;
        }
        return h('label', { class: 'casilla casilla--fila' }, casilla,
          h('span', {}, h('strong', {}, TIPOS_RESPALDO[f.tipo] ?? f.tipo), ` · ${formatearFechaHora(f.creado)} · ${formatearBytes(f.bytes)}`));
      });
      restaurar.addEventListener('click', async () => {
        restaurar.disabled = true;
        const bajados = [];
        try {
          let i = 0;
          for (const f of elegidos) {
            i += 1;
            estado.textContent = `Descargando de Drive ${i} de ${elegidos.size}…`;
            bajados.push(await descargarRespaldoDrive(f));
          }
          estado.textContent = '';
          panelRestaurar.restaurarArchivos(bajados);
          panelRestaurar.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (err) {
          console.error(err);
          estado.textContent = mensajeError(err);
        } finally {
          restaurar.disabled = elegidos.size === 0;
        }
      });
      reemplazar(lista,
        h('p', { class: 'campo__ayuda' }, 'Para restaurar, elige el respaldo de datos o completo más reciente y, si tienes, los de fotos.'),
        ...filas, restaurar, estado);
    } catch (err) {
      console.error(err);
      reemplazar(lista, h('p', { class: 'aviso aviso--error' }, mensajeError(err)),
        h('button', { class: 'boton boton--secundario', type: 'button', onclick: () => dibujar() }, 'Volver a intentar'));
    }
  }
  dibujar();
  // Se actualiza al subir un respaldo; deja de escuchar cuando la tarjeta sale de la pantalla.
  const quitar = on('drive:cambio', () => (tarjeta.isConnected ? dibujar() : quitar()));
  return tarjeta;
}

