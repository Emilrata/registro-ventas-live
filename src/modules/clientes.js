// Pantalla: Clientes.
import { encabezado, estadoVacio } from '../ui/componentes.js';

export async function render(contenedor) {
  contenedor.append(
    encabezado('Clientes'),
    estadoVacio('Todavía no hay clientas', 'Se registran solas al crear su primer pedido.'),
  );
}
