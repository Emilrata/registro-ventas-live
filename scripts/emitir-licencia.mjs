// Emite un código de activación para un negocio.
// Uso:
//   node scripts/emitir-licencia.mjs --clave /ruta/clave-privada-licencias.json --negocio "Boutique Ana" [--id L-0001] [--vence 2027-12-31]
import { readFileSync } from 'node:fs';
import { firmarLicencia, importarClavePrivada, importarClavePublica, verificarLicencia } from '../src/core/licencia-formato.js';
import { CLAVE_PUBLICA_LICENCIAS } from '../src/core/licencia-clave-publica.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
if (!args.clave || !args.negocio) {
  console.error('Uso: node scripts/emitir-licencia.mjs --clave clave-privada-licencias.json --negocio "Nombre" [--id L-0001] [--vence AAAA-MM-DD]');
  process.exit(1);
}

const archivo = JSON.parse(readFileSync(args.clave, 'utf8'));
const jwk = archivo.jwk ?? archivo;
if (jwk.x !== CLAVE_PUBLICA_LICENCIAS.x || jwk.y !== CLAVE_PUBLICA_LICENCIAS.y) {
  console.error('Esta clave privada NO corresponde a la clave pública de la app. Los códigos no funcionarían.');
  process.exit(1);
}
const hoy = new Date().toISOString().slice(0, 10);
const id = (args.id ?? `L-${hoy.replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6)}`).toUpperCase();
const codigo = await firmarLicencia(
  { id, negocio: args.negocio.trim(), emitida: hoy, vence: args.vence ?? null },
  await importarClavePrivada(jwk),
);
const prueba = await verificarLicencia(codigo, await importarClavePublica(CLAVE_PUBLICA_LICENCIAS), hoy);
if (!prueba.ok) {
  console.error('Error interno: el código generado no se pudo verificar.');
  process.exit(1);
}
console.log(`Negocio: ${prueba.datos.negocio}\nNúmero:  ${id}\nVence:   ${prueba.datos.vence ?? 'no vence'}\n\n${codigo}`);
