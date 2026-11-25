import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bdDePrueba, cerrarBD } from './ayuda-bd.js';
import { fotoFalsa } from '../data/generador.js';
import {
  buscarPedidos,
  crearPedido,
  editarPedido,
  listarPedidos,
  obtenerPedido,
  posiblesDuplicados,
} from '../../src/services/pedidos.js';
import { buscarClientes, buscarPorWhatsapp, editarCliente, resumenCliente } from '../../src/services/clientes.js';
import { crearTransmision, elegirTransmision, transmisionActiva } from '../../src/services/transmisiones.js';
import { agregarAGrupo, crearGrupo, obtenerGrupo, quitarDeGrupo } from '../../src/services/grupos.js';

let db;
beforeEach(async () => {
  db = await bdDePrueba();
});
afterEach(async () => cerrarBD(db));

const prenda = (extra = {}) => ({ descripcion: 'Blusa negra', talla: 'M', color: 'Negro', precio: 8050, cantidad: 1, ...extra });
const nuevo = (extra = {}) =>
  crearPedido({ whatsapp: '71234567', nombre: 'Ana Pérez', prendas: [prenda()], ...extra }, { db });

describe('crear pedido', () => {
  it('crea clienta, pedido, prendas, foto e historial en una sola operación', async () => {
    const foto = await fotoFalsa(1);
    const r = await crearPedido(
      {
        whatsapp: '7123 4567',
        nombre: '  Ana   Pérez ',
        modalidad: 'envio',
        envio: 1500,
        observaciones: 'Envío a Cochabamba',
        prendas: [prenda({ cantidad: 2, foto }), prenda({ descripcion: '', precio: 12000, foto: await fotoFalsa(2) })],
      },
      { ahora: new Date('2026-11-24T22:00:00Z'), db },
    );
    expect(r).toMatchObject({ ok: true, codigo: 'LIVE-00001' });
    const { pedido, cliente, prendas } = await obtenerPedido(r.id, db);
    expect(cliente).toMatchObject({ nombre: 'Ana Pérez', nombreNormalizado: 'ana perez', whatsapp: '+59171234567' });
    expect(pedido).toMatchObject({
      codigo: 'LIVE-00001', seq: 1, estado: 'pendiente', modalidad: 'envio',
      totalPrendas: 28100, envio: 1500, total: 29600, pagado: 0, reembolsado: 0, estadoPago: 'sin-pago',
      creadoEn: '2026-11-24T22:00:00.000Z', fechaLimite: '2026-12-24T22:00:00.000Z', grupoId: null,
    });
    expect(prendas.map((p) => [p.orden, p.subtotal])).toEqual([[1, 16100], [2, 12000]]);
    const archivo = await db.archivos.get(prendas[0].fotoId);
    expect(archivo).toMatchObject({ tipo: 'foto', refTipo: 'prenda', refId: prendas[0].id, sha256: foto.sha256, ancho: 1280 });
    expect(archivo.miniatura).toBeInstanceOf(Blob);
    expect(await db.historial.where('tipo').anyOf('pedido-creado', 'cliente-creada').count()).toBe(2);
    expect((await db.ajustes.get('codigos.ultimoSeq')).valor).toBe(1);
  });

  it('reutiliza la clienta por WhatsApp (escrito de otra forma) sin cambiarle el nombre', async () => {
    const a = await nuevo();
    const b = await crearPedido({ whatsapp: '+591 7123-4567', nombre: 'Otro nombre', prendas: [prenda()] }, { db });
    expect(b.clienteId).toBe(a.clienteId);
    expect(await db.clientes.count()).toBe(1);
    expect((await db.clientes.get(a.clienteId)).nombre).toBe('Ana Pérez');
    expect(b.codigo).toBe('LIVE-00002');
  });

  it('valida los datos y no guarda nada si algo falla', async () => {
    expect(await nuevo({ whatsapp: '123' })).toMatchObject({ ok: false, campo: 'whatsapp' });
    expect(await nuevo({ nombre: '' })).toMatchObject({ ok: false, campo: 'nombre' });
    expect(await nuevo({ prendas: [] })).toMatchObject({ ok: false, campo: 'prendas' });
    expect(await nuevo({ prendas: [prenda({ descripcion: '' })] })).toMatchObject({ ok: false });
    expect(await nuevo({ prendas: [prenda({ precio: 80.5 })] })).toMatchObject({ ok: false });
    expect(await nuevo({ prendas: [prenda({ cantidad: 0 })] })).toMatchObject({ ok: false });
    expect(await nuevo({ transmisionId: 999 })).toMatchObject({ ok: false, campo: 'transmision' });
    expect(await db.pedidos.count()).toBe(0);
    expect(await db.clientes.count()).toBe(0);
    expect((await db.ajustes.get('codigos.ultimoSeq')).valor).toBe(0);
  });

  it('recojo no cobra envío aunque se mande un monto', async () => {
    const r = await nuevo({ modalidad: 'recojo', envio: 1500 });
    expect((await db.pedidos.get(r.id)).total).toBe(8050);
  });

  it('20 pedidos a la vez: códigos únicos y continuos', async () => {
    const rs = await Promise.all(
      Array.from({ length: 20 }, (_, i) => crearPedido({ whatsapp: `7${String(1234500 + i)}`, nombre: `C${i}`, prendas: [prenda()] }, { db })),
    );
    const seqs = rs.map((r) => Number(r.codigo.slice(5))).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('el contador nunca retrocede aunque se altere', async () => {
    await nuevo();
    await nuevo();
    await db.ajustes.put({ clave: 'codigos.ultimoSeq', valor: 0 });
    expect((await nuevo()).codigo).toBe('LIVE-00003');
  });

  it('avisa posibles duplicados (misma clienta, mismo total, 10 min)', async () => {
    const t0 = new Date('2026-11-24T20:00:00Z');
    await crearPedido({ whatsapp: '71234567', nombre: 'Ana', prendas: [prenda()] }, { ahora: t0, db });
    const en5 = new Date(t0.getTime() + 5 * 60000);
    const en11 = new Date(t0.getTime() + 11 * 60000);
    expect(await posiblesDuplicados({ whatsapp: '71234567', total: 8050, ahora: en5, db })).toHaveLength(1);
    expect(await posiblesDuplicados({ whatsapp: '71234567', total: 9000, ahora: en5, db })).toHaveLength(0);
    expect(await posiblesDuplicados({ whatsapp: '71234567', total: 8050, ahora: en11, db })).toHaveLength(0);
    expect(await posiblesDuplicados({ whatsapp: '79999999', total: 8050, ahora: en5, db })).toHaveLength(0);
  });
});

describe('editar pedido', () => {
  it('cambia prendas y recalcula; no cambia código, fechas ni fotos de prendas quitadas', async () => {
    const r = await nuevo({ prendas: [prenda({ foto: await fotoFalsa(1) }), prenda({ descripcion: 'Falda' })] });
    const antes = await obtenerPedido(r.id, db);
    const [p1, p2] = antes.prendas;
    const res = await editarPedido(
      r.id,
      {
        modalidad: 'envio',
        envio: 2000,
        prendas: [
          { ...p2, cantidad: 3 },
          { descripcion: 'Jean', precio: 15000, cantidad: 1, foto: await fotoFalsa(3) },
        ],
      },
      { db },
    );
    expect(res.ok).toBe(true);
    const despues = await obtenerPedido(r.id, db);
    expect(despues.pedido).toMatchObject({
      codigo: antes.pedido.codigo, creadoEn: antes.pedido.creadoEn, fechaLimite: antes.pedido.fechaLimite,
      totalPrendas: 3 * 8050 + 15000, envio: 2000, total: 3 * 8050 + 15000 + 2000,
    });
    expect(despues.prendas.map((p) => p.descripcion)).toEqual(['Falda', 'Jean']);
    expect(await db.archivos.get(p1.fotoId)).toBeTruthy(); // la foto de la prenda quitada sigue
    expect(await db.archivos.count()).toBe(2);
    const h = await db.historial.where('tipo').equals('pedido-editado').first();
    expect(h.antes.prendas).toHaveLength(2);
    expect(h.despues.total).toBe(despues.pedido.total);
  });

  it('bloquea dejar el total por debajo de lo pagado', async () => {
    const r = await nuevo({ prendas: [prenda({ precio: 10000 })] });
    await db.pedidos.update(r.id, { pagado: 8000 });
    const { prendas } = await obtenerPedido(r.id, db);
    expect((await editarPedido(r.id, { prendas: [{ ...prendas[0], precio: 5000 }] }, { db })).ok).toBe(false);
    expect((await editarPedido(r.id, { prendas: [{ ...prendas[0], precio: 9000 }] }, { db })).ok).toBe(true);
    expect((await db.pedidos.get(r.id)).estadoPago).toBe('parcial');
  });

  it('rechaza prendas de otro pedido', async () => {
    const a = await nuevo();
    const b = await nuevo();
    const otra = (await obtenerPedido(b.id, db)).prendas[0];
    expect((await editarPedido(a.id, { prendas: [otra] }, { db })).ok).toBe(false);
  });
});

describe('clientas', () => {
  it('busca por nombre sin tildes y por número; edita sin duplicar WhatsApp', async () => {
    const a = await crearPedido({ whatsapp: '71234567', nombre: 'María José Peñaranda', prendas: [prenda()] }, { db });
    const b = await crearPedido({ whatsapp: '62223333', nombre: 'Lucía Rojas', prendas: [prenda()] }, { db });
    expect((await buscarClientes('maria pena', { db })).map((c) => c.id)).toEqual([a.clienteId]);
    expect((await buscarClientes('2223', { db })).map((c) => c.id)).toEqual([b.clienteId]);
    expect((await buscarPorWhatsapp('+591 62223333', { db })).id).toBe(b.clienteId);
    expect(await editarCliente(b.clienteId, { nombre: 'Lucía', whatsapp: '71234567' }, db)).toMatchObject({ ok: false, campo: 'whatsapp' });
    expect((await editarCliente(b.clienteId, { nombre: 'Lucía R.', whatsapp: '62223334', notas: 'VIP' }, db)).ok).toBe(true);
    expect(await db.clientes.get(b.clienteId)).toMatchObject({ nombre: 'Lucía R.', whatsapp: '+59162223334', notas: 'VIP' });
    expect(await resumenCliente(a.clienteId, db)).toEqual({ pedidos: 1, total: 8050, pendientes: 1 });
  });
});

describe('transmisiones', () => {
  it('la nueva queda activa', async () => {
    const r = await crearTransmision({ nombre: 'LIVE sábado' }, db);
    expect((await transmisionActiva(db)).nombre).toBe('LIVE sábado');
    expect((await elegirTransmision(999, db)).ok).toBe(false);
    await elegirTransmision(null, db);
    expect(await transmisionActiva(db)).toBeNull();
    const p = await nuevo({ transmisionId: r.id });
    expect((await listarPedidos({ transmisionId: r.id }, db)).map((x) => x.id)).toEqual([p.id]);
  });
});

describe('búsqueda', () => {
  it('por código, nombre o número', async () => {
    const a = await crearPedido({ whatsapp: '71234567', nombre: 'Ana Pérez', prendas: [prenda()] }, { db });
    const b = await crearPedido({ whatsapp: '62223333', nombre: 'Lucía Rojas', prendas: [prenda()] }, { db });
    expect((await buscarPedidos('LIVE-00002', { db })).map((p) => p.id)).toEqual([b.id]);
    expect((await buscarPedidos('2', { db })).map((p) => p.id)).toEqual([b.id]);
    expect((await buscarPedidos('perez', { db })).map((p) => p.id)).toEqual([a.id]);
    expect((await buscarPedidos('6222', { db }))[0].cliente.nombre).toBe('Lucía Rojas');
    expect(await buscarPedidos('nadie', { db })).toEqual([]);
  });
});

describe('grupos', () => {
  it('agrupa sin tocar códigos, fechas, pagos ni plazos', async () => {
    const ps = [await nuevo(), await nuevo(), await nuevo()];
    const otra = await crearPedido({ whatsapp: '62223333', nombre: 'Otra', prendas: [prenda()] }, { db });
    const antes = await db.pedidos.bulkGet(ps.map((p) => p.id));

    expect((await crearGrupo([ps[0].id], {}, db)).ok).toBe(false);
    expect((await crearGrupo([ps[0].id, otra.id], {}, db)).ok).toBe(false);
    const g = await crearGrupo([ps[0].id, ps[1].id], {}, db);
    expect(g.ok).toBe(true);
    expect((await crearGrupo([ps[1].id, ps[2].id], {}, db)).ok).toBe(false); // ya agrupado
    expect((await agregarAGrupo(g.id, [ps[2].id], db)).ok).toBe(true);

    const despues = await db.pedidos.bulkGet(ps.map((p) => p.id));
    despues.forEach((d, i) => {
      const { grupoId, ...resto } = d;
      const { grupoId: _, ...restoAntes } = antes[i];
      expect(resto).toEqual(restoAntes);
      expect(grupoId).toBe(g.id);
    });
    expect((await obtenerGrupo(g.id, db)).total).toBe(3 * 8050);

    await quitarDeGrupo(ps[0].id, db);
    expect((await db.grupos.get(g.id)).estado).toBe('abierto');
    await quitarDeGrupo(ps[1].id, db);
    expect((await db.grupos.get(g.id)).estado).toBe('deshecho'); // no se borra
    expect((await db.pedidos.get(ps[2].id)).grupoId).toBeNull();
  });
});

describe('filtro por estado', () => {
  it('lista por estado con paginación correcta, también dentro de una transmisión', async () => {
    const t = await crearTransmision({ nombre: 'LIVE' }, db);
    const ids = [];
    for (let i = 0; i < 6; i += 1) ids.push((await nuevo({ transmisionId: t.id })).id);
    for (const id of ids.slice(0, 4)) await db.pedidos.update(id, { estado: 'entregado' });
    expect((await listarPedidos({ estado: 'pendiente' }, db)).map((p) => p.id)).toEqual([ids[5], ids[4]]);
    expect((await listarPedidos({ estado: 'entregado', limite: 3 }, db)).map((p) => p.id)).toEqual([ids[3], ids[2], ids[1]]);
    expect((await listarPedidos({ estado: 'entregado', desde: 3, limite: 3 }, db)).map((p) => p.id)).toEqual([ids[0]]);
    expect((await listarPedidos({ estado: 'pendiente', transmisionId: t.id, limite: 1 }, db)).map((p) => p.id)).toEqual([ids[5]]);
    expect((await listarPedidos({ estado: 'pendiente', transmisionId: t.id, desde: 1, limite: 1 }, db)).map((p) => p.id)).toEqual([ids[4]]);
  });
});
