// Pantalla: Panel (inicio).
import { h } from '../ui/dom.js';
import { encabezado, estadoVacio, tarjetaInstalacion } from '../ui/componentes.js';
import { formatearFecha } from '../core/dates.js';
import { on } from '../core/events.js';
import { obtenerBD } from '../core/db.js';

export async function render(contenedor) {
  const zonaInstalar = h('div');
  const dibujarInstalar = () => {
    zonaInstalar.replaceChildren(tarjetaInstalacion(() => dibujarInstalar()) ?? '');
  };
  dibujarInstalar();

  const totalPedidos = await obtenerBD().pedidos.count();

  contenedor.append(
    encabezado('Panel', formatearFecha(new Date())),
    zonaInstalar,
    totalPedidos === 0
      ? estadoVacio('Todavía no hay pedidos', 'Aquí verás las ventas, los cobros y lo pendiente del día.')
      : null,
  );

  const quitar = [
    on('instalacion:disponible', dibujarInstalar),
    on('instalacion:hecha', dibujarInstalar),
  ];
  return () => quitar.forEach((fn) => fn());
}
