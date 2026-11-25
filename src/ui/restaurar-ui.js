// Componente para restaurar uno o varios archivos de respaldo (se usa en Más y en la bienvenida).
import { h, agregar, reemplazar } from './dom.js';
import { formatearFechaHora } from '../core/dates.js';
import { restaurarRespaldo, verificarRespaldo, TIPOS_RESPALDO } from '../services/respaldo.js';
import { confirmar } from './dialogo.js';

let n = 0;

/**
 * alRestaurar() se llama al terminar bien. textoConfirmacion: lo que se explica antes de reemplazar.
 */
export function panelRestaurar({ db, alRestaurar, textoConfirmacion }) {
  const id = `restaurar-${++n}`;
  const entrada = h('input', { class: 'solo-lectores', id, type: 'file', accept: '.zip,application/zip', multiple: true });
  const estado = h('div', { class: 'paso' });
  let archivos = [];

  const mostrar = (...nodos) => reemplazar(estado, ...nodos);

  async function procesar({ contrasena = '', permitirFaltantes = false } = {}) {
    mostrar(h('p', { class: 'texto-secundario' }, `Revisando ${archivos.length === 1 ? 'el respaldo' : `${archivos.length} archivos`}… Puede tardar si hay muchas fotos.`));
    let v;
    try {
      v = await verificarRespaldo(archivos, { contrasena, permitirFaltantes });
    } catch (err) {
      console.error(err);
      v = { ok: false, error: 'No se pudo leer el archivo. Vuelve a intentarlo.' };
    }
    if (!v.ok && v.necesitaContrasena) return pedirContrasena(v.error, permitirFaltantes);
    if (!v.ok && v.puedeContinuar) {
      mostrar(h('p', { class: 'aviso aviso--error' }, v.error));
      const seguir = await confirmar({
        titulo: `Faltan ${v.faltantes} ${v.faltantes === 1 ? 'foto' : 'fotos'}`,
        texto: 'Lo mejor es elegir también tus respaldos de fotos o un respaldo completo. Si no los tienes, puedes restaurar igual: los pedidos quedan completos, pero esas fotos no se podrán ver.',
        aceptar: 'Restaurar sin esas fotos',
        cancelar: 'Elegir más archivos',
      });
      if (seguir) return procesar({ contrasena, permitirFaltantes: true });
      return undefined;
    }
    if (!v.ok) return mostrar(h('p', { class: 'aviso aviso--error' }, v.error));

    const c = v.manifiesto.conteos;
    mostrar(h('p', { class: 'aviso' },
      `Respaldo verificado (${TIPOS_RESPALDO[v.manifiesto.tipo] ?? 'completo'}) del ${formatearFechaHora(v.manifiesto.creadoEn)}: ${c.pedidos} pedidos, ${c.clientes} clientas, ${c.archivos - v.faltantes} fotos y comprobantes.`));
    const ok = await confirmar({
      titulo: '¿Reemplazar todos los datos?',
      texto: textoConfirmacion ?? 'Todo lo que hay ahora en este teléfono se reemplazará por el respaldo. Tu PIN y la licencia de este teléfono no cambian. Antes se guarda una copia interna de los datos actuales.',
      aceptar: 'Sí, restaurar',
      peligro: true,
    });
    if (!ok) return undefined;
    agregar(estado, h('p', { class: 'texto-secundario' }, 'Restaurando… no cierres la app.'));
    try {
      await restaurarRespaldo(v, { db });
      alRestaurar?.();
    } catch (err) {
      console.error(err);
      agregar(estado, h('p', { class: 'aviso aviso--error' }, 'No se pudo restaurar. Tus datos actuales no se tocaron.'));
    }
    return undefined;
  }

  function pedirContrasena(error, permitirFaltantes) {
    const campo = h('input', { class: 'entrada', type: 'password', id: `${id}-clave`, autocomplete: 'off' });
    const boton = h('button', { class: 'boton boton--primario boton--ancho', type: 'submit' }, 'Abrir respaldo');
    const form = h('form', { class: 'formulario', novalidate: true },
      h('p', { class: error.includes('no es correcta') ? 'aviso aviso--error' : 'aviso' }, error),
      h('div', { class: 'campo' }, h('label', { class: 'campo__etiqueta', for: `${id}-clave` }, 'Contraseña del respaldo'), campo),
      boton);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (campo.value) procesar({ contrasena: campo.value, permitirFaltantes });
    });
    mostrar(form);
    campo.focus();
  }

  entrada.addEventListener('change', () => {
    archivos = [...(entrada.files ?? [])];
    entrada.value = '';
    if (archivos.length) procesar();
  });

  return h('div', { class: 'paso' },
    h('label', { class: 'boton boton--secundario boton--ancho', for: id }, 'Elegir archivo(s) de respaldo'),
    entrada,
    h('p', { class: 'campo__ayuda' }, 'Puedes elegir varios a la vez: el último de datos o completo, y los de fotos.'),
    estado);
}
