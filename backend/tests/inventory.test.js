import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { loadInventory, productPayload, saveInventoryChange } from '../src/services/inventoryService.js';
import { productosDashboard, categoriasDashboard } from './fixtures/inventarioReal.js';

const userId = '00000000-0000-4000-8000-000000000001';
const categories = categoriasDashboard.map(c => ({ id: Number(c.id.slice(1)), name: c.name }));
const products = productosDashboard.map(p => ({
  id: p.id, sku: p.sku, name: p.name,
  category_id: categories.find(c => c.name === p.category).id,
  stock: p.stock, price: p.price.toFixed(2), min_stock: p.minStock,
}));

function server({ member = true, rows = products, categoryRows = categories, cap = 500, failure, missingCount = false, enabled = false, movements = [] } = {}) {
  const requests = [];
  const client = createClient('https://inventory-test.invalid', 'test-publishable-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, options) => {
      options.signal?.throwIfAborted();
      const url = new URL(input);
      const table = url.pathname.split('/').at(-1);
      requests.push({ table, method: options.method, query: url.searchParams });
      if (table === 'inventory_write_enabled') return enabled === null
        ? new Response(JSON.stringify({ code: 'PGRST202', message: 'Missing function' }), { status: 404 })
        : new Response(JSON.stringify(enabled));
      if (table === failure) return new Response(JSON.stringify({ code: '42P01', message: 'Missing table' }), { status: 404 });
      let data;
      if (table === 'inventory_members') data = member ? [{ user_id: userId }] : [];
      else data = table === 'products' ? rows : table === 'inventory_movements' ? movements : categoryRows;
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Math.min(cap, Number(url.searchParams.get('limit') || 500));
      const page = data.slice(offset, offset + limit);
      return new Response(JSON.stringify(page), {
        headers: {
          'Content-Type': 'application/json',
          ...(!missingCount ? { 'Content-Range': `${offset}-${offset + page.length - 1}/${data.length}` } : {}),
        },
      });
    } },
  });
  return { client, requests };
}

test('conserva los 173 productos, categorías y totales del inventario importado', async () => {
  const { client, requests } = server();
  const result = await loadInventory(client, userId);
  assert.deepEqual(result.products, productosDashboard);
  assert.deepEqual(result.categories, categoriasDashboard);
  assert.equal(result.products.reduce((sum, p) => sum + p.stock, 0), 1169);
  assert.equal(result.products.reduce((sum, p) => sum + p.stock * p.price, 0), 618895);
  assert.equal(requests[0].query.get('user_id'), `eq.${userId}`);
  assert(requests.every(request => request.method === 'GET'));
});

test('lee más de 1000 productos incluso cuando el servidor limita cada página', async () => {
  const rows = Array.from({ length: 1005 }, (_, i) => ({ ...products[0], id: i + 1, sku: `TEST-${i}` }));
  const { client, requests } = server({ rows, cap: 80 });
  const result = await loadInventory(client, userId);
  assert.equal(result.products.length, 1005);
  assert.equal(new Set(result.products.map(p => p.id)).size, 1005);
  assert.equal(requests.filter(r => r.table === 'products').length, 13);
});

test('una cuenta sin autorización no consulta productos ni categorías', async () => {
  const { client, requests } = server({ member: false });
  await assert.rejects(loadInventory(client, userId), /no está autorizada/);
  assert.deepEqual(requests.map(r => r.table), ['inventory_members']);
});

test('una tabla inexistente produce error, nunca productos locales', async () => {
  const { client } = server({ failure: 'products' });
  await assert.rejects(loadInventory(client, userId), /No se encontraron las tablas/);
});

test('un inventario vacío autorizado permanece vacío', async () => {
  const { client } = server({ rows: [], categoryRows: [] });
  assert.deepEqual(await loadInventory(client, userId), { products: [], categories: [], movements: [], readOnly: true });
});

test('habilita la edición y adapta el historial cuando la fase 4 está instalada', async () => {
  const { client } = server({ enabled: true, rows: [{ ...products[0], version: 3 }], movements: [
    { id: 1, created_at: '2026-09-27T12:00:00Z', product_name: 'Producto', sku: 'A', type: 'Entrada', stock_before: 2, stock_after: 3, quantity: 1, actor_email: 'usuario@example.test', reason: 'Cambio manual' },
  ] });
  const result = await loadInventory(client, userId);
  assert.equal(result.readOnly, false);
  assert.equal(result.products[0].version, 3);
  assert.equal(result.movements[0].user, 'usuario@example.test');
  assert.equal(result.movements[0].before, 2);
  assert.equal(result.movements[0].after, 3);
});

test('conserva la lectura mientras el SQL de la fase 4 todavía no está instalado', async () => {
  const { client, requests } = server({ enabled: null });
  const result = await loadInventory(client, userId);
  assert.equal(result.readOnly, true);
  assert.equal(result.products.length, 173);
  assert(!requests.some(r => r.table === 'inventory_movements'));
});

test('valida los formularios antes de enviar cantidades o precios incorrectos', () => {
  const good = { name: ' Nuevo ', sku: ' SKU ', category: 'Altavoces', stock: '0', minStock: '5', price: '10.25' };
  assert.deepEqual(productPayload(good), { name: 'Nuevo', sku: 'SKU', category: 'Altavoces', stock: 0, min_stock: 5, price: 10.25 });
  for (const invalid of [{ name: ' ' }, { sku: '' }, { stock: '-1' }, { stock: '1.5' }, { price: '' }, { price: '1.555' }, { minStock: 'Infinity' }]) {
    assert.throws(() => productPayload({ ...good, ...invalid }), /Completa nombre/);
  }
});

test('la escritura usa solo RPC y conserva la identidad del reintento', async () => {
  const seen = [];
  const request = { p_request_id: 'request-1', p_action: 'adjust', p_product_id: 1, p_expected_version: 2, p_data: { delta: 1 } };
  const result = { product: { id: 1, stock: 3 }, movement: { id: 1 } };
  const client = { rpc: async (name, data) => {
    seen.push({ name, data });
    if (seen.length === 1) return { error: { message: 'Failed to fetch', code: '' } };
    return { data: result };
  } };
  await assert.rejects(saveInventoryChange(client, request), error => error.uncertain === true);
  assert.deepEqual(await saveInventoryChange(client, request), result);
  assert.equal(seen[0].name, 'inventory_mutate');
  assert.deepEqual(seen[0], seen[1]);
});

test('distingue conflictos confirmados de fallos con resultado desconocido', async () => {
  for (const error of [{ code: '23505', message: 'duplicate' }, { code: '40001', message: 'INVENTORY_STALE_VERSION' }]) {
    await assert.rejects(saveInventoryChange({ rpc: async () => ({ error }) }, {}), e => e.uncertain === false);
  }
  await assert.rejects(saveInventoryChange({ rpc: async () => { throw new Error('offline'); } }, {}), e => e.uncertain === true);
});

test('rechaza referencias de categoría rotas y precios ausentes', async () => {
  for (const rows of [[{ ...products[0], category_id: -1 }], [{ ...products[0], price: null }]]) {
    const { client } = server({ rows });
    await assert.rejects(loadInventory(client, userId), /datos incompletos/);
  }
});

test('no acepta una respuesta paginada sin total', async () => {
  const { client } = server({ missingCount: true });
  await assert.rejects(loadInventory(client, userId), /respuesta del inventario está incompleta/);
});

test('no consulta el servidor si la petición fue cancelada o falta la sesión', async () => {
  const { client, requests } = server();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadInventory(client, userId, controller.signal), { name: 'AbortError' });
  await assert.rejects(loadInventory(client, null), /Inicia sesión/);
  await assert.rejects(loadInventory(null, userId), /No se ha configurado/);
  assert.equal(requests.length, 0);
});
