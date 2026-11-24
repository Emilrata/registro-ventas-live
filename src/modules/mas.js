// Pantalla: Más — estado de la app, almacenamiento e instalación.
import { h } from '../ui/dom.js';
import { encabezado, fila, tarjetaInstalacion } from '../ui/componentes.js';
import { obtenerBD, VERSION_ESQUEMA } from '../core/db.js';
import { contarRegistros } from '../repositories/ajustes.repo.js';
import {
  estaInstalada,
  estadoAlmacenamiento,
  formatearBytes,
  pedirPersistencia,
} from '../services/almacenamiento.js';
import { mostrarAviso } from '../ui/actualizacion.js';

export async function render(contenedor) {
  const tarjetaEstado = h('section', { class: 'tarjeta', 'aria-labelledby': 'estado-titulo' });
  const tarjetaDatos = h('section', { class: 'tarjeta', 'aria-labelledby': 'datos-titulo' });

  async function dibujarEstado() {
    const alm = await estadoAlmacenamiento();
    const conexion = navigator.onLine ? 'En línea' : 'Sin conexión';
    tarjetaEstado.replaceChildren(
      h('h2', { class: 'tarjeta__titulo', id: 'estado-titulo' }, 'Estado de la app'),
      fila('Versión', __APP_VERSION__),
      fila('Modo', estaInstalada() ? 'Instalada' : 'En el navegador', { alerta: !estaInstalada() }),
      fila('Conexión', conexion),
      fila('Datos protegidos', alm.persistente ? 'Sí' : 'No', { alerta: !alm.persistente }),
      fila('Espacio usado', formatearBytes(alm.usado)),
      fila('Espacio disponible', formatearBytes(alm.cuota)),
      alm.soportado && !alm.persistente
        ? h(
            'button',
            {
              class: 'boton boton--secundario',
              type: 'button',
              onclick: async () => {
                const ok = await pedirPersistencia();
                mostrarAviso(
                  ok
                    ? 'Listo: el navegador no borrará los datos.'
                    : 'El navegador no lo permitió. Instala la app y vuelve a intentarlo.',
                );
                await dibujarEstado();
              },
            },
            'Proteger datos',
          )
        : null,
    );
  }

  async function dibujarDatos() {
    const conteos = await contarRegistros(obtenerBD());
    const total = Object.values(conteos).reduce((a, b) => a + b, 0);
    tarjetaDatos.replaceChildren(
      h('h2', { class: 'tarjeta__titulo', id: 'datos-titulo' }, 'Base de datos'),
      fila('Versión del esquema', String(VERSION_ESQUEMA)),
      fila('Tablas', String(Object.keys(conteos).length)),
      fila('Registros', String(total)),
    );
  }

  contenedor.append(
    encabezado('Más'),
    tarjetaInstalacion(() => dibujarEstado()) ?? '',
    tarjetaEstado,
    tarjetaDatos,
  );
  await Promise.all([dibujarEstado(), dibujarDatos()]);

  const alCambiarConexion = () => dibujarEstado();
  window.addEventListener('online', alCambiarConexion);
  window.addEventListener('offline', alCambiarConexion);
  return () => {
    window.removeEventListener('online', alCambiarConexion);
    window.removeEventListener('offline', alCambiarConexion);
  };
}
