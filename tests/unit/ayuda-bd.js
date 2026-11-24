// Base de datos temporal para pruebas.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { crearBaseDeDatos, establecerBD } from '../../src/core/db.js';

let n = 0;
export async function bdDePrueba() {
  const db = crearBaseDeDatos(`prueba-servicios-${Date.now()}-${n++}`);
  await db.open();
  establecerBD(db);
  return db;
}

export async function cerrarBD(db) {
  db.close();
  await Dexie.delete(db.name);
  establecerBD(null);
}
