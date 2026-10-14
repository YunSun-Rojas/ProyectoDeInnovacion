import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { loadInventory, productPayload, saveInventoryChange, salePayload, mapSale, mapMovement } from '../src/modules/inventory/inventoryService.js';
import { productosDashboard, categoriasDashboard } from './fixtures/inventarioReal.js';

const userId = '00000000-0000-4000-8000-000000000001';
const categories = categoriasDashboard.map(c => ({ id: Number(c.id.slice(1)), name: c.name }));
const products = productosDashboard.map(p => ({
  id: p.id, sku: p.sku, name: p.name,
  category_id: categories.find(c => c.name === p.category).id,
  stock: p.stock, price: p.price.toFixed(2), min_stock: p.minStock,
}));

function server({ member = true, rows = products, categoryRows = categories, cap = 500, failure, missingCount = false, enabled = false, movements = [], salesEnabled = false, stockEnabled = false, sales = [], capabilityGate } = {}) {
  const requests = [];
  const client = createClient('https://inventory-test.invalid', 'test-publishable-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, options) => {
      options.signal?.throwIfAborted();
      const url = new URL(input);
      const table = url.pathname.split('/').at(-1);
      requests.push({ table, method: options.method, query: url.searchParams });
      if (table.endsWith('_enabled')) await capabilityGate?.(table);
      if (table === 'inventory_sales_enabled') return new Response(JSON.stringify(salesEnabled));
      if (table === 'inventory_stock_enabled') return stockEnabled === null
        ? new Response(JSON.stringify({ code: 'PGRST202', message: 'Missing function' }), { status: 404 })
        : new Response(JSON.stringify(stockEnabled));
      if (table === 'inventory_write_enabled') return enabled === null
        ? new Response(JSON.stringify({ code: 'PGRST202', message: 'Missing function' }), { status: 404 })
        : new Response(JSON.stringify(enabled));
      if (table === failure) return new Response(JSON.stringify({ code: '42P01', message: 'Missing table' }), { status: 404 });
      let data;
      if (table === 'inventory_members') data = member ? [{ user_id: userId }] : [];
      else data = table === 'products' ? rows : table === 'inventory_movements' ? movements : table === 'inventory_sales' ? sales : categoryRows;
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
  assert.deepEqual(result.products.map((product, index) => Object.fromEntries(Object.keys(productosDashboard[index]).map(key => [key, product[key]]))), productosDashboard);
  assert.equal(result.products[0].purchaseCost, null);
  assert.equal(result.products[0].unitOfMeasure, 'Unidad');
  assert(requests.find(request => request.table === 'products').query.get('select').includes('purchase_cost'));
  assert.deepEqual(result.categories, categoriasDashboard);
  assert.equal(result.products.reduce((sum, p) => sum + p.stock, 0), 1169);
  assert.equal(result.products.reduce((sum, p) => sum + p.stock * p.price, 0), 618895);
  assert.equal(requests[0].query.get('user_id'), `eq.${userId}`);
  assert(requests.every(request => request.method === 'GET'));
});

test('las capacidades se consultan en paralelo después de autorizar al miembro', { timeout: 2000 }, async () => {
  const started = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { client, requests } = server({ capabilityGate: async name => {
    started.push(name);
    if (started.length === 3) release();
    await gate;
    assert.deepEqual(requests.map(request => request.table), ['inventory_members', ...started]);
  } });
  try {
    const result = await loadInventory(client, userId);
    assert.equal(started.length, 3);
    assert.equal(result.products.length, 173);
  } finally { release(); }
});

test('stock se habilita solo con capacidad explícita y conserva lectura sin migración', async () => {
  for (const stockEnabled of [true, false, null]) {
    const { client } = server({ enabled: true, stockEnabled });
    const result = await loadInventory(client, userId);
    assert.equal(result.stockEnabled, stockEnabled === true);
    assert.equal(result.products.length, 173);
  }
});

test('movimientos por cantidad usan RPC nueva y reintentos conservan la solicitud', async () => {
  const calls = [];
  const client = { rpc: async (name, data) => { calls.push({ name, data }); return { data: { movement: { id: 1 }, product: { stock: 5 } } }; } };
  for (const action of ['stock_in', 'stock_out', 'stock_adjust']) {
    const request = { p_request_id: 'same-request', p_product_id: 1, p_expected_version: 2, p_action: action, p_data: { quantity: 3, reason: 'Motivo' } };
    await saveInventoryChange(client, request);
    await saveInventoryChange(client, request);
    assert.deepEqual(calls.at(-1), calls.at(-2));
    assert.deepEqual(calls.at(-1), { name: 'inventory_register_stock', data: { p_request_id: 'same-request', p_product_id: 1, p_expected_version: 2, p_kind: action, p_quantity: 3, p_reason: 'Motivo' } });
  }
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
  assert.deepEqual(await loadInventory(client, userId), { products: [], categories: [], movements: [], sales: [], salesEnabled: false, stockEnabled: false, readOnly: true });
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

test('ventas valida importes y conserva el precio histórico separado del producto', async () => {
  assert.deepEqual(salePayload({ quantity: 2, unitPrice: 80 }), { quantity: 2, unit_price: 80 });
  for (const data of [{ quantity: 0, unitPrice: 80 }, { quantity: 1.5, unitPrice: 80 }, { quantity: 2, unitPrice: -1 }, { quantity: 2, unitPrice: 1.555 }, { quantity: 2, unitPrice: '80' }]) {
    assert.throws(() => salePayload(data), /cantidad entera/);
  }
  const raw = { id: 'sale-1', product_id: 1, product_name: 'Mouse', sku: 'M-1', quantity: 2, unit_price: '80.00', total: '160.00', movement_id: '7', created_at: '2026-10-13T15:00:00Z', actor_email: 'admin@example.test' };
  const { client } = server({ enabled: true, salesEnabled: true, rows: [{ ...products[0], price: '90.00', version: 4 }], sales: [raw], movements: [{ id: 7, type: 'Ajuste', quantity: -2, stock_before: 5, stock_after: 3, created_at: raw.created_at }] });
  const result = await loadInventory(client, userId);
  assert.equal(result.products[0].price, 90);
  assert.equal(result.sales[0].total, 160);
  assert.equal(result.sales[0].unitPrice, 80);
  assert.equal(result.movements[0].type, 'Venta');
  assert.equal(result.movements[0].total, 160);
  assert.equal(result.salesEnabled, true);
  assert.equal(mapMovement({ id: 1, type: 'Salida' }).type, 'Salida');
  assert.throws(() => mapSale({ ...raw, total: '999' }), /incompleto/);
});

test('Kardex recibe identidad de producto y todo el historial paginado sin escrituras', async () => {
  const movements=Array.from({length:1005},(_,index)=>({ id:index+1, product_id:1, product_name:'Mouse histórico', sku:'ANTIGUO',
    type:'Entrada', stock_before:index, stock_after:index+1, quantity:1, created_at:'2026-10-01T15:00:00Z' }));
  const {client,requests}=server({enabled:true,movements,cap:80});
  const result=await loadInventory(client,userId);
  assert.equal(result.movements.length,1005);
  assert.equal(result.movements[0].productId,1);
  assert.equal(result.movements[0].sku,'ANTIGUO');
  const reads=requests.filter(r=>r.table==='inventory_movements');
  assert.equal(reads.length,13);
  assert(reads[0].query.get('select').includes('product_id'));
  assert(requests.every(r=>r.method==='GET'));
  assert.equal(mapMovement({id:1,product_id:2}).productId,2);
  assert.equal(mapMovement({id:1}).productId,null);
});

test('venta usa una RPC atómica con el precio aplicado y el mismo ID al reintentar', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: { product: { id: 1 }, movement: { id: 2 }, sale: { id: 'request-sale' } } }; } };
  const request = { p_action: 'sale', p_request_id: 'request-sale', p_product_id: 1, p_expected_version: 3, p_data: { quantity: 2, unit_price: 80 } };
  await saveInventoryChange(client, request);
  await saveInventoryChange(client, request);
  assert.deepEqual(calls[0], { name: 'inventory_register_sale', args: { p_request_id: 'request-sale', p_product_id: 1, p_expected_version: 3, p_quantity: 2, p_unit_price: 80 } });
  assert.deepEqual(calls[0], calls[1]);
  await assert.rejects(saveInventoryChange({ rpc: async () => ({ data: { movement: { id: 2 } } }) }, request), error => error.uncertain === true);
});
