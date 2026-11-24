import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bdDePrueba, cerrarBD } from './ayuda-bd.js';
import {
  _usarIteraciones,
  cambiarPin,
  crearPinInicial,
  debeBloquearsePorInactividad,
  desbloquearSesion,
  bloquearSesion,
  esperaDeSerie,
  estadoIntentos,
  finalizarConfiguracion,
  formatearCodigoRecuperacion,
  generarCodigoRecuperacion,
  normalizarCodigoRecuperacion,
  recuperarConCodigo,
  registrarActividad,
  renovarCodigoRecuperacion,
  sesionDesbloqueada,
  tienePin,
  validarPinNuevo,
  verificarPin,
} from '../../src/services/seguridad.js';

let db;
beforeAll(() => _usarIteraciones(1000)); // rápido en pruebas; la app usa 300.000
beforeEach(async () => {
  db = await bdDePrueba();
});
afterEach(async () => cerrarBD(db));

const T0 = 1_800_000_000_000;

async function fallar(n, ahora = T0) {
  let r;
  for (let i = 0; i < n; i += 1) r = await verificarPin('999999', { ahora, db });
  return r;
}

describe('PIN', () => {
  it('valida el formato y rechaza PIN obvios', () => {
    expect(validarPinNuevo('482915').ok).toBe(true);
    for (const malo of ['12345', '1234567', 'abcdef', '48291a', '', '000000', '111111', '123456', '654321']) {
      expect(validarPinNuevo(malo).ok).toBe(false);
    }
  });

  it('crea y verifica; guarda solo el hash', async () => {
    expect(await tienePin(db)).toBe(false);
    expect((await crearPinInicial('482915', db)).ok).toBe(true);
    expect(await tienePin(db)).toBe(true);
    const guardado = (await db.ajustes.get('seguridad.pin')).valor;
    expect(JSON.stringify(guardado)).not.toContain('482915');
    expect(guardado.algoritmo).toBe('PBKDF2-SHA256');
    expect((await verificarPin('482915', { ahora: T0, db })).ok).toBe(true);
    expect((await verificarPin('482916', { ahora: T0, db })).ok).toBe(false);
    expect((await db.historial.where('tipo').equals('pin-creado').count())).toBe(1);
  });

  it('5 intentos fallidos → espera de 30 s; luego se duplica', async () => {
    await crearPinInicial('482915', db);
    const r4 = await fallar(4);
    expect(r4).toMatchObject({ ok: false, error: 'PIN incorrecto.', intentosRestantes: 1 });

    const r5 = await fallar(1);
    expect(r5.esperaMs).toBe(30000);
    // Durante la espera ni el PIN correcto entra
    expect((await verificarPin('482915', { ahora: T0 + 29999, db })).esperaMs).toBe(1);
    expect((await estadoIntentos({ ahora: T0 + 10000, db })).esperaMs).toBe(20000);

    // Segunda serie: 60 s
    const t1 = T0 + 30000;
    const r10 = await fallar(5, t1);
    expect(r10.esperaMs).toBe(60000);
    // Tercera serie: 120 s
    const t2 = t1 + 60000;
    expect((await fallar(5, t2)).esperaMs).toBe(120000);

    // Al acertar se reinicia todo
    const t3 = t2 + 120000;
    expect((await verificarPin('482915', { ahora: t3, db })).ok).toBe(true);
    expect((await fallar(5, t3)).esperaMs).toBe(30000);
  });

  it('las esperas se guardan (recargar la app no las salta)', async () => {
    await crearPinInicial('482915', db);
    await fallar(5);
    const fila = (await db.ajustes.get('seguridad.intentosPin')).valor;
    expect(fila).toMatchObject({ fallidos: 0, series: 1, bloqueadoHasta: T0 + 30000 });
  });

  it('si el reloj se atrasa, la espera no crece', async () => {
    await crearPinInicial('482915', db);
    await fallar(5);
    expect((await estadoIntentos({ ahora: T0 - 10 * 60 * 1000, db })).esperaMs).toBe(30000);
  });

  it('la espera tiene un tope de 24 h', () => {
    expect(esperaDeSerie(1)).toBe(30000);
    expect(esperaDeSerie(2)).toBe(60000);
    expect(esperaDeSerie(50)).toBe(24 * 60 * 60 * 1000);
  });

  it('cambiar PIN exige el actual', async () => {
    await crearPinInicial('482915', db);
    expect((await cambiarPin('000001', '739204', { ahora: T0, db })).ok).toBe(false);
    expect((await cambiarPin('482915', '111111', { ahora: T0, db })).ok).toBe(false);
    expect((await cambiarPin('482915', '739204', { ahora: T0, db })).ok).toBe(true);
    expect((await verificarPin('739204', { ahora: T0, db })).ok).toBe(true);
    expect((await verificarPin('482915', { ahora: T0, db })).ok).toBe(false);
  });

  it('no se puede volver a crear el PIN inicial después de terminar la configuración', async () => {
    await crearPinInicial('482915', db);
    await finalizarConfiguracion(generarCodigoRecuperacion(), db);
    expect((await crearPinInicial('739204', db)).ok).toBe(false);
    expect((await verificarPin('482915', { ahora: T0, db })).ok).toBe(true);
  });
});

describe('código de recuperación', () => {
  it('12 caracteres sin letras confusas', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generarCodigoRecuperacion()).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{12}$/);
    }
    expect(formatearCodigoRecuperacion('ABCD1234EFGH')).toBe('ABCD-1234-EFGH');
    expect(normalizarCodigoRecuperacion(' abcd-1234 efgh ')).toBe('ABCD1234EFGH');
    expect(normalizarCodigoRecuperacion('O0Il')).toBe('0011');
  });

  it('recupera el acceso con un PIN nuevo y entrega otro código; el usado deja de servir', async () => {
    await crearPinInicial('482915', db);
    const codigo = generarCodigoRecuperacion();
    await finalizarConfiguracion(codigo, db);
    expect(JSON.stringify((await db.ajustes.get('seguridad.recuperacion')).valor)).not.toContain(codigo);

    // Aunque el PIN esté en espera, la recuperación funciona
    await fallar(5);
    const escrito = formatearCodigoRecuperacion(codigo).toLowerCase();
    const r = await recuperarConCodigo(escrito, '739204', { ahora: T0, db });
    expect(r.ok).toBe(true);
    expect(r.codigo).toMatch(/^[0-9A-Z]{12}$/);
    expect(r.codigo).not.toBe(codigo);

    expect((await verificarPin('739204', { ahora: T0, db })).ok).toBe(true); // espera reiniciada
    expect((await recuperarConCodigo(codigo, '582047', { ahora: T0, db })).ok).toBe(false);
    expect((await recuperarConCodigo(r.codigo, '582047', { ahora: T0, db })).ok).toBe(true);
    expect(await db.historial.where('tipo').equals('pin-recuperado').count()).toBe(2);
  });

  it('código incorrecto: también tiene esperas', async () => {
    await crearPinInicial('482915', db);
    await finalizarConfiguracion(generarCodigoRecuperacion(), db);
    let r;
    for (let i = 0; i < 5; i += 1) r = await recuperarConCodigo('AAAA-BBBB-CCCC', '739204', { ahora: T0, db });
    expect(r.esperaMs).toBe(30000);
    expect((await estadoIntentos({ recuperacion: true, ahora: T0, db })).esperaMs).toBe(30000);
    expect((await verificarPin('482915', { ahora: T0, db })).ok).toBe(true); // el PIN no se tocó
  });

  it('PIN nuevo inválido no gasta el código', async () => {
    await crearPinInicial('482915', db);
    const codigo = generarCodigoRecuperacion();
    await finalizarConfiguracion(codigo, db);
    expect((await recuperarConCodigo(codigo, '111111', { ahora: T0, db })).ok).toBe(false);
    expect((await recuperarConCodigo(codigo, '739204', { ahora: T0, db })).ok).toBe(true);
  });

  it('renovar el código exige el PIN', async () => {
    await crearPinInicial('482915', db);
    const viejo = generarCodigoRecuperacion();
    await finalizarConfiguracion(viejo, db);
    expect((await renovarCodigoRecuperacion('000001', { ahora: T0, db })).ok).toBe(false);
    const r = await renovarCodigoRecuperacion('482915', { ahora: T0, db });
    expect(r.ok).toBe(true);
    expect((await recuperarConCodigo(viejo, '739204', { ahora: T0, db })).ok).toBe(false);
    expect((await recuperarConCodigo(r.codigo, '739204', { ahora: T0, db })).ok).toBe(true);
  });

  it('finalizar sin PIN falla', async () => {
    await expect(finalizarConfiguracion(generarCodigoRecuperacion(), db)).rejects.toThrow();
  });
});

describe('sesión', () => {
  it('bloqueo por inactividad', () => {
    desbloquearSesion();
    registrarActividad(T0);
    expect(sesionDesbloqueada()).toBe(true);
    expect(debeBloquearsePorInactividad(5, T0 + 4 * 60 * 1000)).toBe(false);
    expect(debeBloquearsePorInactividad(5, T0 + 5 * 60 * 1000)).toBe(true);
    expect(debeBloquearsePorInactividad(0, T0 + 999 * 60 * 1000)).toBe(false);
    bloquearSesion();
    expect(sesionDesbloqueada()).toBe(false);
    expect(debeBloquearsePorInactividad(5, T0 + 60 * 60 * 1000)).toBe(false);
  });
});
