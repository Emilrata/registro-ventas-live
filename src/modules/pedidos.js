// Pantalla: Pedidos.
import { encabezado, estadoVacio } from '../ui/componentes.js';

export async function render(contenedor) {
  contenedor.append(
    encabezado('Pedidos'),
    estadoVacio('Todavía no hay pedidos', 'Los pedidos de cada transmisión aparecerán aquí.'),
  );
}
