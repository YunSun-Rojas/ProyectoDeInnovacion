import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApi } from '../src/app.js';
import { salePayload, stockPayload, mapSale, mapMovement, productPayload, catalogPayload, mapProduct } from '../src/modules/inventory/inventoryService.js';

async function setup(t, options = {}) {
  const calls = [];
  const clientFactory = () => {
    let user;
    return { auth: {
      signInWithPassword: async ({ email, password }) => {
        if (password !== 'correct-password') return { data: {}, error: { status: 400, message: 'Invalid login credentials' } };
        user = { id: email, email, user_metadata: {} };
        return { data: { user, session: { access_token: 'secret-access', refresh_token: 'secret-refresh' } } };
      },
      getUser: async () => ({ data: { user } }),
      signOut: async () => ({ error: null }),
      reauthenticate: async () => ({ error: null }),
      updateUser: async attributes => { calls.push({ attributes, user }); return { data: { user: { ...user, user_metadata: attributes.data } } }; },
    } };
  };
  const inventory = {
    loadInventory: async (_client, id) => { calls.push({ reader: id }); return { products: [], categories: [], movements: [], readOnly: false }; },
    saveInventoryChange: async (_client, request) => { calls.push({ request }); return { product: null, movement: { id: 1 } }; },
    productPayload: value => value,
    catalogPayload,
    mapProduct: value => value,
    mapMovement: value => value,
    salePayload,
    stockPayload,
    mapSale,
    ...options.inventory,
  };
  const server = createApi({ secure: true }, { clientFactory, inventory });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { cookie, body, method = 'GET', origin } = {}) => fetch(base + '/api' + path, {
    method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(origin ? { Origin: origin } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const login = async (email = 'one@example.test') => {
    const response = await request('/auth/login', { method: 'POST', body: { email, password: 'correct-password' } });
    assert.equal(response.status, 200);
    return { cookie: response.headers.get('set-cookie').split(';')[0], response };
  };
  return { calls, request, login, base };
}

test('catálogo integrado: alta, lectura, edición, versión y reintento sin tocar stock (API en memoria)', async t => {
  let row;
  const history = [], saved = new Map();
  const categories = [{ id: 'c1', name: 'Periféricos' }];
  const { request, login, calls } = await setup(t, { inventory: {
    productPayload, catalogPayload, mapProduct, mapMovement: value => value,
    loadInventory: async () => ({ products: row ? [mapProduct(row, categories)] : [], categories, movements: history, readOnly: false }),
    saveInventoryChange: async (_client, value) => {
      calls.push({ request: value });
      if (saved.has(value.p_request_id)) {
        const previous = saved.get(value.p_request_id);
        if (JSON.stringify(value) !== previous.input) throw Object.assign(new Error('INVENTORY_REQUEST_CONFLICT'), { status: 400 });
        return previous.result;
      }
      if (value.p_action === 'catalog_edit' && value.p_expected_version !== row.version) throw Object.assign(new Error('Otra persona modificó este producto.'), { status: 400 });
      if (value.p_action === 'add' && row?.sku === value.p_data.sku) throw Object.assign(new Error('Ya existe un producto con ese SKU.'), { status: 400 });
      row = { ...(row ?? { id: 1, category_id: 1, version: 0, source_status: 'Datos Correcto', image_path: 'preservada.webp' }), ...value.p_data,
        version: (row?.version ?? 0) + 1 };
      const result = { product: structuredClone(row), movement: { id: history.length + 1 } };
      history.push(result.movement);
      saved.set(value.p_request_id, { input: JSON.stringify(value), result });
      return result;
    },
  } });
  const { cookie } = await login();
  const post = body => request('/inventory/changes', { method: 'POST', cookie, body });
  const initial = { name: 'Mouse', sku: 'CAT-1', category: 'Periféricos', stock: 8, minStock: 2, price: 90,
    brand: 'Marca', model: 'Modelo', characteristics: 'USB', barcode: '000456', purchaseCost: 35.25,
    unitOfMeasure: 'Unidad', isActive: false, createdByName: 'Operador' };
  const add = { requestId: '00000000-0000-4000-8000-000000000021', action: 'add', productId: null, version: null, data: initial };
  assert.equal((await post(add)).status, 200);
  assert.equal(calls.at(-1).request.p_action, 'add');
  const loaded = (await (await request('/inventory', { cookie })).json()).products[0];
  assert.equal(loaded.purchaseCost, 35.25);
  assert.equal(loaded.createdByName, 'Operador');
  assert.equal(loaded.barcode, '000456');
  assert.equal(loaded.isActive, false);
  const { stock, ...data } = initial;
  const edit = { requestId: '00000000-0000-4000-8000-000000000022', action: 'catalog_edit', productId: 1, version: 1, data: { ...data, model: 'Nuevo modelo', purchaseCost: 40 } };
  for (const patch of [{ stock }, { stock: 0 }, { delta: 1 }, { catalog_only: true }]) {
    const count = history.length;
    assert.equal((await post({ ...edit, data: { ...edit.data, ...patch } })).status, 400);
    assert.equal(history.length, count);
  }
  const edited = await post(edit);
  assert.equal(edited.status, 200);
  const result = await edited.json();
  assert.equal(result.product.stock, 8);
  assert.equal(result.product.price, 90);
  assert.equal(result.product.imagePath, 'preservada.webp');
  assert.equal(result.product.sourceStatus, 'Datos Correcto');
  const sent = calls.at(-1).request;
  assert.equal(sent.p_action, 'catalog_edit');
  assert.equal(sent.p_expected_version, 1);
  for (const key of ['stock', 'delta', 'catalog_only', 'image_path', 'source_status']) assert(!Object.hasOwn(sent.p_data, key));
  assert.equal((await post(edit)).status, 200);
  assert.equal(history.length, 2);
  assert.equal((await post({ ...edit, requestId: '00000000-0000-4000-8000-000000000023' })).status, 400);
  const reloaded = (await (await request('/inventory', { cookie })).json()).products[0];
  assert.equal(reloaded.model, 'Nuevo modelo');
  assert.equal(reloaded.purchaseCost, 40);
  assert.equal(reloaded.version, 2);
  assert.equal((await post({ ...add, requestId: '00000000-0000-4000-8000-000000000024' })).status, 400);
  assert.equal((await request('/inventory')).status, 401);
});

test('login a través del proxy Vite conserva el origen y rechaza sitios externos', async t => {
  const { base } = await setup(t);
  const { createServer: createViteServer } = await import('vite');
  const { default: config } = await import('../../frontend/vite.config.js');
  assert.deepEqual(config.preview.proxy, config.server.proxy);
  const original = config.server.proxy['/api'];
  const proxyOptions = typeof original === 'string' ? { changeOrigin: true } : original;
  const vite = await createViteServer({ configFile: false, logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, proxy: { '/api': { ...proxyOptions, target: base } } },
  });
  t.after(() => vite.close());
  await vite.listen();
  const port = vite.httpServer.address().port;
  for (const hostname of ['127.0.0.1', 'localhost']) {
    const host = `${hostname}:${port}`;
    const response = await fetch(`http://${host}/api/auth/login`, {
      method: 'POST', headers: { Origin: `http://${host}`, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'one@example.test', password: 'correct-password' }),
    });
    assert.equal(response.status, 200, `${hostname}: ${await response.text()}`);
    assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  }
  const blocked = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST', headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(blocked.status, 403);
});

test('API exige sesión, usa cookie HttpOnly y no entrega tokens al navegador', async t => {
  const { request, login } = await setup(t);
  assert.equal((await request('/inventory')).status, 401);
  const { cookie, response } = await login();
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  assert.match(response.headers.get('set-cookie'), /Secure/);
  assert.doesNotMatch(JSON.stringify(await response.json()), /secret-access|secret-refresh/);
  assert.equal((await request('/auth/session', { cookie })).status, 200);
  assert.equal((await request('/auth/logout', { cookie, method: 'POST', body: {} })).status, 200);
  assert.equal((await request('/inventory', { cookie })).status, 401);
});

test('abrir la raíz del backend sin sesión informa del estado sin exponer inventario', async t => {
  const { base, request, calls } = await setup(t);
  const response = await fetch(base + '/');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal(response.headers.get('set-cookie'), null);
  const data = await response.json();
  assert.deepEqual(data, { message: 'Eagle Gaming Inventario API funcionando' });
  assert.equal((await request('/inventory')).status, 401);
  assert.equal((await request('/auth/session')).status, 401);
  assert.deepEqual(calls, []);
});

test('rutas públicas, protegidas y desconocidas conservan sus respuestas', async t => {
  const { request, login } = await setup(t);
  const health = await request('/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });
  assert.equal((await request('/auth/session')).status, 401);
  assert.equal((await request('/auth/reauthenticate', { method: 'POST', body: {} })).status, 401);
  assert.equal((await request('/auth/account', { method: 'PATCH', body: {} })).status, 401);
  assert.equal((await request('/unknown')).status, 401);
  const { cookie } = await login();
  assert.equal((await request('/unknown', { cookie })).status, 404);
  assert.equal((await request('/auth/login', { cookie })).status, 404);
  assert.equal((await request('/auth/reauthenticate', { cookie, method: 'POST', body: {} })).status, 200);
  const logout = await request('/auth/logout', { method: 'POST', body: {} });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
});

test('límite de intentos de login se conserva al separar el servicio', async t => {
  const { request } = await setup(t);
  for (let i = 0; i < 30; i++) {
    const response = await request('/auth/login', { method: 'POST', body: { email: 'one@example.test', password: 'wrong' } });
    assert.equal(response.status, 401);
  }
  const blocked = await request('/auth/login', { method: 'POST', body: { email: 'one@example.test', password: 'correct-password' } });
  assert.equal(blocked.status, 429);
});

test('API separa usuarios y obtiene la identidad de la sesión, no del navegador', async t => {
  const { request, login, calls } = await setup(t);
  const one = await login('one@example.test');
  const two = await login('two@example.test');
  await request('/inventory?userId=another', { cookie: one.cookie });
  await request('/inventory', { cookie: two.cookie });
  assert.deepEqual(calls.map(value => value.reader), ['one@example.test', 'two@example.test']);
});

test('API rechaza orígenes externos, credenciales incorrectas y cambios inválidos antes de escribir', async t => {
  const { request, login, calls } = await setup(t);
  assert.equal((await request('/auth/login', { method: 'POST', origin: 'https://other.example', body: {} })).status, 403);
  assert.equal((await request('/auth/login', { method: 'POST', body: { email: 'one@example.test', password: 'wrong' } })).status, 401);
  const { cookie } = await login();
  assert.equal((await request('/inventory/changes', { cookie, method: 'POST', body: { action: 'adjust', data: { delta: -50 } } })).status, 400);
  assert.equal(calls.length, 0);
});

test('API mantiene adjust limitado a +1/-1 antes de escribir', async t => {
  const { request, login, calls } = await setup(t);
  const { cookie } = await login();
  const base = { requestId: '00000000-0000-4000-8000-000000000001', action: 'adjust', productId: 1, version: 2 };
  for (const delta of [0, 1.5, '6', null, 6, -3, 2147483648, -2147483648]) {
    assert.equal((await request('/inventory/changes', { cookie, method: 'POST', body: { ...base, data: { delta } } })).status, 400);
  }
  assert.equal(calls.length, 0);
  for (const delta of [1, -1]) {
    assert.equal((await request('/inventory/changes', { cookie, method: 'POST', body: { ...base, data: { delta } } })).status, 200);
    assert.deepEqual(calls.at(-1).request.p_data, { delta });
    assert.equal(calls.at(-1).request.p_expected_version, 2);
  }
});

test('API valida stock, exige versión y bloquea RPC hasta aplicar migración', async t => {
  let enabled = false;
  const { request, login, calls } = await setup(t, { inventory: {
    loadInventory: async () => ({ readOnly: false, stockEnabled: enabled, categories: [] }),
  } });
  const { cookie } = await login();
  const post = body => request('/inventory/changes', { cookie, method: 'POST', body });
  const body = { requestId: '00000000-0000-4000-8000-000000000051', action: 'stock_in', productId: 1, version: 2, data: { quantity: 6, reason: ' Compra ' } };
  for (const invalid of [{ ...body, version: null }, ...[0, -1, 1.5, '6', null, 2147483648].map(quantity => ({ ...body, data: { ...body.data, quantity } })), { ...body, data: { quantity: 1, reason: ' ' } }]) assert.equal((await post(invalid)).status, 400);
  assert.equal((await post(body)).status, 409);
  assert.equal(calls.length, 0);
  enabled = true;
  for (const action of ['stock_in', 'stock_out', 'stock_adjust']) {
    assert.equal((await post({ ...body, action })).status, 200);
    assert.deepEqual(calls.at(-1).request.p_data, { quantity: 6, reason: 'Compra' });
    assert.equal(calls.at(-1).request.p_expected_version, 2);
  }
  assert.equal((await post({ ...body, action: 'stock_adjust', data: { quantity: -3, reason: 'Conteo' } })).status, 200);
});

test('API conserva requestId y la incertidumbre de un reintento sin duplicar la intención', async t => {
  const writes = [];
  const { request, login } = await setup(t, { inventory: {
    saveInventoryChange: async (_client, value) => {
      writes.push(value);
      if (writes.length === 1) throw Object.assign(new Error('Reintenta'), { uncertain: true });
      return { product: null, movement: { id: 1 } };
    },
  } });
  const { cookie } = await login();
  const body = { requestId: '00000000-0000-4000-8000-000000000001', action: 'delete', productId: 1, version: 2, data: {} };
  const failed = await request('/inventory/changes', { cookie, method: 'POST', body });
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).uncertain, true);
  const confirmed = await request('/inventory/changes', { cookie, method: 'POST', body });
  assert.equal(confirmed.status, 200);
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(writes[0].p_request_id, body.requestId);
});

test('API bloquea escritura de cuentas de solo lectura y comprueba contraseña actual', async t => {
  let writes = 0;
  const { request, login } = await setup(t, { inventory: {
    loadInventory: async () => ({ readOnly: true }),
    saveInventoryChange: async () => { writes++; },
  } });
  const { cookie } = await login();
  assert.equal((await request('/inventory/changes', { cookie, method: 'POST', body: {
    requestId: '00000000-0000-4000-8000-000000000001', action: 'adjust', productId: 1, data: { delta: 1 },
  } })).status, 403);
  assert.equal(writes, 0);
  const failed = await request('/auth/account', { cookie, method: 'PATCH', body: { mode: 'password', currentPassword: 'wrong', password: 'new-password' } });
  assert.equal(failed.status, 400);
  assert.equal((await failed.json()).code, 'invalid_credentials');
  assert.equal((await request('/auth/account', { cookie, method: 'PATCH', body: { mode: 'profile', name: 'Alex' } })).status, 200);
});

test('API valida ventas, exige versión y usa identidad de sesión sin recalcular el precio aplicado', async t => {
  const sale = { id: 'sale-1', product_id: 1, product_name: 'Mouse', sku: 'M1', quantity: 2, unit_price: 80, total: 160, movement_id: '2', created_at: '2026-10-13T18:00:00Z', actor_email: 'one@example.test' };
  const { request, login, calls } = await setup(t, { inventory: {
    loadInventory: async () => ({ readOnly: false, salesEnabled: true, categories: [] }),
    mapMovement,
    saveInventoryChange: async (_client, value) => { calls.push(value); return { product: { id: 1, price: 90, stock: 3 }, movement: { id: 2, type: 'Ajuste', quantity: -2 }, sale }; },
  } });
  const { cookie } = await login();
  const body = { requestId: '00000000-0000-4000-8000-000000000001', action: 'sale', productId: 1, version: 2, data: { quantity: 2, unitPrice: 80, actorId: 'forged' } };
  for (const invalid of [{ ...body, version: null }, { ...body, data: { quantity: 0, unitPrice: 80 } }, { ...body, data: { quantity: 2, unitPrice: 1.234 } }]) {
    assert.equal((await request('/inventory/changes', { cookie, method: 'POST', body: invalid })).status, 400);
  }
  assert.equal(calls.length, 0);
  const response = await request('/inventory/changes', { cookie, method: 'POST', body });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.sale.total, 160);
  assert.equal(result.product.price, 90);
  assert.equal(result.movement.type, 'Venta');
  assert.deepEqual(calls[0].p_data, { quantity: 2, unit_price: 80 });
});

test('API no intenta registrar ventas antes de habilitar el historial en Supabase', async t => {
  let writes = 0;
  const { request, login } = await setup(t, { inventory: { saveInventoryChange: async () => { writes++; } } });
  const { cookie } = await login();
  const response = await request('/inventory/changes', { cookie, method: 'POST', body: { requestId: '00000000-0000-4000-8000-000000000001', action: 'sale', productId: 1, version: 2, data: { quantity: 1, unitPrice: 80 } } });
  assert.equal(response.status, 409);
  assert.equal(writes, 0);
});
