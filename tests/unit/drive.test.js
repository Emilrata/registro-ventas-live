// Conexión con Google Drive contra un Drive SIMULADO (mismas URLs y respuestas que la API real).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bdDePrueba, cerrarBD } from './ayuda-bd.js';
import { _usarEntorno, conectarDrive, descargarRespaldoDrive, desconectarDrive, limpiarDatosViejos, listarRespaldosDrive, obtenerConexion, subirRespaldo } from '../../src/services/drive.js';
import { crearRespaldo, verificarRespaldo } from '../../src/services/respaldo.js';
import { crearPedido } from '../../src/services/pedidos.js';
import { DRIVE_SCOPE, GOOGLE_CLIENT_ID, NOMBRE_CARPETA } from '../../src/core/drive-config.js';

function driveSimulado() {
  const archivos = new Map();
  const subidas = new Map();
  let n = 0;
  const log = { tokens: 0, trozos: 0, pedidosToken: [] };
  const json = (cuerpo, status = 200, headers = {}) => new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const fetch = async (url, op = {}) => {
    const u = new URL(url);
    const metodo = op.method ?? 'GET';
    if (!url.includes('/upload/') || metodo === 'POST') {
      if (op.headers?.Authorization !== 'Bearer TOKEN-OK') return json({ error: {} }, 401);
    }
    if (u.pathname === '/drive/v3/about') return json({ user: { emailAddress: 'soporte.ventaslive@gmail.com', displayName: 'Ventas Live' } });
    if (u.pathname === '/drive/v3/files' && metodo === 'GET') {
      const q = u.searchParams.get('q');
      let lista = [...archivos.values()].filter((f) => !f.trashed);
      if (q.includes("mimeType='application/vnd.google-apps.folder'")) lista = lista.filter((f) => f.mimeType === 'application/vnd.google-apps.folder' && f.name === NOMBRE_CARPETA);
      else {
        const padre = q.match(/'([^']+)' in parents/)[1];
        lista = lista.filter((f) => f.parents?.includes(padre) && f.mimeType !== 'application/vnd.google-apps.folder').sort((a, b) => b.createdTime.localeCompare(a.createdTime));
      }
      return json({ files: lista.map(({ datos, ...f }) => ({ ...f, size: String(datos?.length ?? 0) })) });
    }
    if (u.pathname === '/drive/v3/files' && metodo === 'POST') {
      const meta = JSON.parse(op.body);
      const id = `id${++n}`;
      archivos.set(id, { id, ...meta, createdTime: new Date(Date.now() + n).toISOString() });
      return json({ id });
    }
    const m = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (m) {
      const f = archivos.get(m[1]);
      if (!f) return json({ error: {} }, 404);
      if (metodo === 'DELETE') { archivos.delete(m[1]); return new Response(null, { status: 204 }); }
      if (u.searchParams.get('alt') === 'media') return new Response(new Blob([f.datos]));
      return json({ id: f.id, trashed: false });
    }
    if (u.pathname === '/upload/drive/v3/files' && metodo === 'POST') {
      const meta = JSON.parse(op.body);
      const sid = `s${++n}`;
      subidas.set(sid, { meta, total: Number(op.headers['X-Upload-Content-Length']), partes: [] });
      return new Response(null, { status: 200, headers: { Location: `https://www.googleapis.com/upload/sesion/${sid}` } });
    }
    const s = u.pathname.match(/^\/upload\/sesion\/(.+)$/);
    if (s && metodo === 'PUT') {
      const sub = subidas.get(s[1]);
      const [, a, b, total] = op.headers['Content-Range'].match(/bytes (\d+)-(\d+)\/(\d+)/).map(Number);
      expect(a).toBe(sub.partes.reduce((x, p) => x + p.length, 0));
      sub.partes.push(new Uint8Array(await op.body.arrayBuffer()));
      log.trozos += 1;
      if (b + 1 < total) return new Response(null, { status: 308, headers: { Range: `bytes=0-${b}` } });
      const datos = new Uint8Array(total);
      let o = 0;
      for (const p of sub.partes) { datos.set(p, o); o += p.length; }
      const id = `id${++n}`;
      archivos.set(id, { id, ...sub.meta, datos, createdTime: new Date(Date.now() + n).toISOString() });
      return json({ id, name: sub.meta.name });
    }
    return json({ error: { message: `no simulado: ${metodo} ${url}` } }, 500);
  };
  const oauth2 = {
    initTokenClient: (cfg) => {
      expect(cfg.client_id).toBe(GOOGLE_CLIENT_ID);
      expect(cfg.scope).toBe(DRIVE_SCOPE);
      return { requestAccessToken: (op) => { log.tokens += 1; log.pedidosToken.push(op.prompt); cfg.callback({ access_token: 'TOKEN-OK', expires_in: 3599 }); } };
    },
    hasGrantedAllScopes: () => true,
  };
  return { archivos, log, fetch, oauth2 };
}

let db;
let d;
beforeEach(async () => {
  db = await bdDePrueba();
  d = driveSimulado();
  _usarEntorno({ fetch: d.fetch, cargarGis: async () => d.oauth2 });
});
afterEach(async () => cerrarBD(db));

describe('Google Drive', () => {
  it('conectar: pide permiso eligiendo cuenta, guarda el correo y crea UNA carpeta', async () => {
    const c = await conectarDrive(db);
    expect(c.correo).toBe('soporte.ventaslive@gmail.com');
    expect(d.log.pedidosToken[0]).toContain('select_account');
    await conectarDrive(db); // reconectar no duplica la carpeta
    expect([...d.archivos.values()].filter((f) => f.name === NOMBRE_CARPETA)).toHaveLength(1);
    expect((await obtenerConexion(db)).carpetaId).toBe(c.carpetaId);
  });

  it('sube por trozos un respaldo grande y lo recupera idéntico', async () => {
    await conectarDrive(db);
    const bytes = new Uint8Array(20 * 1024 * 1024 + 123);
    for (let i = 0; i < bytes.length; i += 4093) bytes[i] = (i * 31) % 251;
    const progreso = [];
    const r = await subirRespaldo(new Blob([bytes]), 'respaldo-ventas-live-completo-2026-11-25-12-00.zip', { db, alProgreso: (p) => progreso.push(p) });
    expect(d.log.trozos).toBe(3); // 8 + 8 + 4 MB
    expect(progreso.at(-1)).toBe(1);
    const [f] = await listarRespaldosDrive(db);
    expect(f).toMatchObject({ id: r.id, tipo: 'completo', bytes: bytes.length });
    const bajado = await descargarRespaldoDrive(f);
    expect(new Uint8Array(await bajado.arrayBuffer())).toEqual(bytes);
    expect((await db.ajustes.get('drive.ultimaSubida')).valor.nombre).toContain('completo');
  }, 60000);

  it('un respaldo real sube, baja y se verifica', async () => {
    await crearPedido({ whatsapp: '71234567', nombre: 'Ana', prendas: [{ descripcion: 'Blusa', precio: 8050, cantidad: 1 }] }, { db });
    await conectarDrive(db);
    const resp = await crearRespaldo({ tipo: 'completo', db, contrasena: 'secreto-1' });
    await subirRespaldo(resp.blob, resp.nombre, { db });
    const [f] = await listarRespaldosDrive(db);
    const v = await verificarRespaldo(await descargarRespaldoDrive(f), { contrasena: 'secreto-1' });
    expect(v.ok).toBe(true);
    expect(v.tablas.pedidos).toHaveLength(1);
  });

  it('conserva solo los últimos 7 de datos; nunca borra fotos ni completos', async () => {
    await conectarDrive(db);
    for (let i = 0; i < 10; i += 1) await subirRespaldo(new Blob([`d${i}`]), `respaldo-ventas-live-datos-2026-11-${10 + i}.zip`, { db });
    await subirRespaldo(new Blob(['f']), 'respaldo-ventas-live-fotos-2026-11-20.zip', { db });
    await subirRespaldo(new Blob(['c']), 'respaldo-ventas-live-completo-2026-11-01.zip', { db });
    const lista = await listarRespaldosDrive(db);
    expect(lista.filter((f) => f.tipo === 'datos')).toHaveLength(7);
    expect(lista.filter((f) => f.tipo === 'fotos')).toHaveLength(1);
    expect(lista.filter((f) => f.tipo === 'completo')).toHaveLength(1);
    expect(lista.filter((f) => f.tipo === 'datos').map((f) => f.nombre).at(-1)).toContain('2026-11-13'); // los más nuevos
    expect(await limpiarDatosViejos(db)).toBe(0);
  });

  it('si borraron la carpeta a mano, crea otra al subir', async () => {
    const c = await conectarDrive(db);
    d.archivos.delete(c.carpetaId);
    await subirRespaldo(new Blob(['x']), 'respaldo-ventas-live-datos-a.zip', { db });
    expect((await obtenerConexion(db)).carpetaId).not.toBe(c.carpetaId);
  });

  it('la conexión es del teléfono: no viaja en los respaldos', async () => {
    await conectarDrive(db);
    const { esAjusteDelDispositivo } = await import('../../src/services/respaldo.js');
    expect(esAjusteDelDispositivo('drive.conexion')).toBe(true);
    await desconectarDrive(db);
    expect(await obtenerConexion(db)).toBeNull();
    await expect(listarRespaldosDrive(db)).rejects.toMatchObject({ esDrive: true });
  });
});
