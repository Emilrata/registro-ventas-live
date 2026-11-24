// Licencia del negocio: código de activación firmado, verificado sin internet.
import { obtenerBD } from '../core/db.js';
import { ahoraISO, claveDia } from '../core/dates.js';
import { importarClavePublica, verificarLicencia } from '../core/licencia-formato.js';
import { registrarHistorial } from '../repositories/historial.repo.js';
import { CLAVE_PUBLICA_LICENCIAS } from '../core/licencia-clave-publica.js';

let clavePublicaCache = null;
async function clavePublica(jwk) {
  if (jwk) return importarClavePublica(jwk);
  clavePublicaCache ??= await importarClavePublica(CLAVE_PUBLICA_LICENCIAS);
  return clavePublicaCache;
}

/** Verifica un código sin guardarlo. */
export async function verificarCodigo(texto, { clavePublicaJwk, ahora = new Date() } = {}) {
  return verificarLicencia(texto, await clavePublica(clavePublicaJwk), claveDia(ahora));
}

/** Verifica y guarda la licencia. Devuelve el resultado de la verificación. */
export async function activarLicencia(texto, { clavePublicaJwk, ahora, db = obtenerBD() } = {}) {
  const r = await verificarCodigo(texto, { clavePublicaJwk, ahora });
  if (!r.ok) return r;
  await db.transaction('rw', db.ajustes, db.historial, async () => {
    const anterior = await db.ajustes.get('licencia');
    await db.ajustes.put({
      clave: 'licencia',
      valor: { codigo: r.codigo, datos: r.datos, activadaEn: ahoraISO() },
      actualizadoEn: ahoraISO(),
    });
    await registrarHistorial(
      {
        entidad: 'licencia',
        tipo: 'licencia-activada',
        antes: anterior ? { id: anterior.valor.datos.id, negocio: anterior.valor.datos.negocio } : null,
        despues: { id: r.datos.id, negocio: r.datos.negocio },
      },
      db,
    );
  });
  return r;
}

/** Licencia guardada, verificada otra vez (por si alguien alteró los datos). */
export async function licenciaActual({ clavePublicaJwk, ahora, db = obtenerBD() } = {}) {
  const fila = await db.ajustes.get('licencia');
  if (!fila?.valor?.codigo) return { ok: false, error: 'No hay licencia activada.' };
  return verificarCodigo(fila.valor.codigo, { clavePublicaJwk, ahora });
}
