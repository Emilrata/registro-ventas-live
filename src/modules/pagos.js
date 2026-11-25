import { agregar } from '../ui/dom.js';
// Pantalla: Cobros.
import { encabezado, estadoVacio } from '../ui/componentes.js';

export async function render(contenedor) {
  agregar(contenedor, 
    encabezado('Cobros'),
    estadoVacio('Todavía no hay cobros', 'Los pagos en efectivo y QR aparecerán aquí.'),
  );
}
