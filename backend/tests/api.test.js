import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApi } from '../src/app.js';

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
    mapProduct: value => value,
    mapMovement: value => value,
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
