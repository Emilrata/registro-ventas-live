// Base de datos temporal para pruebas.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { crearBaseDeDatos, establecerBD } from '../../src/core/db.js';

let n = 0;
/**
 * Base temporal. Por defecto usa el modo FLEXIBLE (permite pedidos sin pago, adelantos y
 * entregar con saldo) para probar esa lógica; con { pagoCompleto: true } usa la política
 * por defecto de la app (todo se paga al reservar).
 */
export async function bdDePrueba({ pagoCompleto = false } = {}) {
  const db = crearBaseDeDatos(`prueba-servicios-${Date.now()}-${n++}`);
  await db.open();
  if (!pagoCompleto) await db.ajustes.put({ clave: 'pedidos.exigirPagoCompleto', valor: false });
  establecerBD(db);
  return db;
}

export async function cerrarBD(db) {
  db.close();
  await Dexie.delete(db.name);
  establecerBD(null);
}
