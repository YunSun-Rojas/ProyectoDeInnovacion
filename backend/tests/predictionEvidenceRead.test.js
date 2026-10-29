import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApi } from '../src/app.js';
import { loadPredictionEvidence } from '../src/modules/inventory/inventoryService.js';
import { validatePredictionEvidence } from '../../shared/predictionEvidence.js';
import { preparePredictionView, evaluatePredictionView } from '../../frontend/src/modules/inventario/pages/predictionViewData.js';
import { predictionFixture } from '../../frontend/tests/prediction-review/fixtures.mjs';

const asOf = '2025-08-09T12:00:00.000Z';
const empty = () => ({ classifications: [], coverage: [], stockouts: [] });
const fixture = () => ({
  classifications: [{ saleId: '10000000-0000-4000-8000-000000000001', kind: 'commercial', evidence: 'sale-review:1', verifiedAt: asOf }],
  coverage: [{ productId: 1, from: '2025-08-08', to: '2025-08-08', evidence: 'day-review:1', verifiedAt: asOf }],
  stockouts: [],
});
const db = response => ({ rpc: async () => response });

test('evidencias: lectura usa exclusivamente la RPC GET del cliente autenticado con corte del servidor', async () => {
  let calls = 0;
  const client = { rpc: async (name, args, options) => {
    calls++;
    assert.equal(name, 'inventory_prediction_evidence');
    assert.deepEqual(Object.keys(args), ['p_as_of']);
    assert.ok(Number.isFinite(Date.parse(args.p_as_of)));
    assert.deepEqual(options, { get: true });
    return { data: fixture(), error: null, status: 200 };
  } };
  const response = await loadPredictionEvidence(client, 'session-member');
  assert.equal(response.state, 'available');
  assert.deepEqual(response.evidence, fixture());
  assert.equal(calls, 1);
  await assert.rejects(loadPredictionEvidence(client, null), error => error.status === 401);
  await assert.rejects(loadPredictionEvidence(null, 'session-member'), error => error.status === 401);
  assert.equal(calls, 1);
});

test('evidencias: migración ausente se distingue de dependencias rotas y errores de lectura', async () => {
  for (const error of [{ code: 'PGRST202' }, { code: '42883', message: 'function public.inventory_prediction_evidence(timestamp with time zone) does not exist' }]) {
    assert.deepEqual(await loadPredictionEvidence(db({ error }), 'member'), { state: 'migration_missing', asOf: null, evidence: null });
  }
  for (const error of [{ code: '42P01' }, { code: 'PGRST205' }, { code: '42883', message: 'function auth.uid() does not exist' }, { code: 'XX000' }]) {
    await assert.rejects(loadPredictionEvidence(db({ error }), 'member'), value => value.status === 503 && value.code === 'PREDICTION_READ_ERROR');
  }
});

test('evidencias: permisos denegados y sesión inválida nunca se transforman en listas vacías', async () => {
  for (const error of [{ code: '42501' }, { message: 'PREDICTION_FORBIDDEN' }]) {
    await assert.rejects(loadPredictionEvidence(db({ data: empty(), error }), 'member'), value => value.status === 403 && value.code === 'PREDICTION_ACCESS_DENIED');
  }
  await assert.rejects(loadPredictionEvidence(db({ status: 403, error: { code: 'PGRST202' } }), 'member'), value => value.status === 403);
  await assert.rejects(loadPredictionEvidence({ rpc: async () => { throw Object.assign(new Error('denied'), { code: '42501' }); } }, 'member'), value => value.status === 403);
  for (const code of ['PGRST301', 'PGRST302']) {
    await assert.rejects(loadPredictionEvidence(db({ error: { code } }), 'member'), value => value.status === 401 && value.code === 'PREDICTION_SESSION_REQUIRED');
  }
});

test('evidencias: conexión rechazada, fetch fallido y timeout tienen un error explícito y saneado', async () => {
  for (const response of [{ status: 0, error: { message: 'private host' } }, { error: { message: 'TypeError: fetch failed private host' } },
    { error: { code: '08006' } }, { error: { code: '57014' } }, { error: { code: 'PGRST002' } }]) {
    await assert.rejects(loadPredictionEvidence(db(response), 'member'), value => value.status === 503
      && value.code === 'PREDICTION_CONNECTION_ERROR' && !value.message.includes('private host'));
  }
  await assert.rejects(loadPredictionEvidence({ rpc: async () => { throw Error('private credentials'); } }, 'member'),
    value => value.status === 503 && value.code === 'PREDICTION_CONNECTION_ERROR' && !value.message.includes('credentials'));
});

test('evidencias: esquema estricto rechaza respuestas parciales, fechas, IDs, referencias, duplicados y campos privados', async () => {
  const mutations = [
    () => null, () => [], () => ({}), value => { delete value.stockouts; return value; },
    value => ({ ...value, coverage: null }), value => ({ ...value, stockouts: {} }),
    value => ({ ...value, extra: 'not in SQL contract' }),
    value => { value.classifications[0].verified_by = 'private-user'; return value; },
    value => { value.classifications[0].kind = 'verified'; return value; },
    value => { value.classifications[0].saleId = 'invalid'; return value; },
    value => { value.classifications[0].evidence = 'sale-review:0'; return value; },
    value => { value.classifications[0].evidence = 'sale-review:9223372036854775808'; return value; },
    value => { value.classifications.push({ ...value.classifications[0], evidence: 'sale-review:2' }); return value; },
    value => { value.classifications[0].verifiedAt = '2025-02-30T12:00:00Z'; return value; },
    value => { value.classifications[0].verifiedAt = '2025-08-09T12:00:00'; return value; },
    value => { value.classifications[0].verifiedAt = '2025-08-09T24:00:00Z'; return value; },
    value => { value.classifications[0].verifiedAt = '2025-08-09T12:00:00+16:00'; return value; },
    value => { value.classifications[0].verifiedAt = '2025-08-10T00:00:00Z'; return value; },
    value => { value.coverage[0].productId = Number.MAX_SAFE_INTEGER + 1; return value; },
    value => { value.coverage[0].productId = '1'; return value; },
    value => { value.coverage[0].to = '2025-08-09'; return value; },
    value => { value.coverage[0].from = value.coverage[0].to = '2025-08-09'; return value; },
    value => { value.coverage[0].evidence = 'unverified'; return value; },
    value => { value.stockouts.push({ ...value.coverage[0], evidence: 'day-review:2' }); return value; },
    value => { value.stockouts.push({ ...value.coverage[0], from: '2025-08-07', to: '2025-08-07' }); return value; },
    value => { value.coverage.push({ ...value.coverage[0] }); return value; },
  ];
  for (const mutate of mutations) assert.throws(() => validatePredictionEvidence(mutate(fixture()), asOf), TypeError);
  for (const response of [undefined, { data: null }, { data: empty(), status: 500 }, { data: { ...empty(), coverage: null } }]) {
    await assert.rejects(loadPredictionEvidence(db(response), 'member'), value => value.status === 502 && value.code === 'PREDICTION_INVALID_RESPONSE');
  }
  assert.deepEqual(validatePredictionEvidence(empty(), asOf), empty());
  const valid = fixture();
  valid.classifications[0].verifiedAt = '2025-08-09T07:00:00.000000-05:00';
  assert.deepEqual(validatePredictionEvidence(valid, asOf), valid);
});

test('evidencias: ausencia, pruebas e historia insuficiente bloquean; historia sintética verificada suficiente usa el motor existente', async t => {
  const base = predictionFixture();
  t.mock.timers.enable({ apis: ['Date'], now: new Date(base.asOf) });
  for (const [length, kind, available] of [[4, 'commercial', false], [220, 'test', false], [220, 'unclassified', false], [220, 'commercial', true]]) {
    const props = predictionFixture({ length });
    props.sales = props.sales.map((sale, i) => ({ ...sale, id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}` }));
    const evidence = { classifications: kind === 'unclassified' ? [] : props.sales.map((sale, i) => ({ saleId: sale.id,
      kind, evidence: `sale-review:${i + 1}`, verifiedAt: base.asOf })),
    coverage: props.predictionEvidence.coverage.map((row, i) => ({ ...row, evidence: `day-review:${i + 1}`, verifiedAt: base.asOf })), stockouts: [] };
    const response = await loadPredictionEvidence(db({ data: evidence }), 'member');
    const view = preparePredictionView({ ...props, asOf: response.asOf, evidence: response.evidence, evidenceState: response.state });
    for (const horizon of [7, 30]) {
      const forecast = evaluatePredictionView(view, horizon).forecasts[0];
      assert.equal(forecast.eligible, available);
      assert.equal(forecast.estimatedDemand, available ? horizon * 2 : null);
    }
    if (kind === 'unclassified') {
      const missing = await loadPredictionEvidence(db({ error: { code: 'PGRST202' } }), 'member');
      const result = evaluatePredictionView(preparePredictionView({ ...props, evidenceState: missing.state }), 7);
      assert.equal(result.state, 'migration_missing'); assert.deepEqual(result.forecasts, []);
    }
  }
  const noHistory = preparePredictionView({ products: [{ id: 1 }], sales: [], salesEnabled: true, asOf: base.asOf, evidence: empty(), evidenceState: 'available' });
  assert.equal(evaluatePredictionView(noHistory, 7).forecasts[0].estimatedDemand, null);
});

test('evidencias HTTP: sesión, aislamiento de clientes, GET exclusivo y otros endpoints intactos', async t => {
  const clients = [], calls = [];
  let response = { data: fixture(), status: 200 };
  const clientFactory = () => {
    let user;
    const client = { auth: {
      signInWithPassword: async ({ email }) => { user = { id: email }; return { data: { user, session: { access_token: 'private-token' } } }; },
      getUser: async () => ({ data: { user } }),
    }, rpc: async (...args) => { calls.push({ client, user, args }); return response; } };
    clients.push(client); return client;
  };
  const server = createApi({ secure: false }, { clientFactory, inventory: {
    loadPredictionEvidence, loadInventory: async () => ({ products: [], sales: [], salesEnabled: true }),
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (url, cookie, method = 'GET', body) => fetch(base + url, { method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const login = async email => {
    const result = await request('/auth/login', null, 'POST', { email, password: 'synthetic-password' });
    assert.equal(result.status, 200); return result.headers.get('set-cookie').split(';')[0];
  };
  assert.equal((await request('/inventory/prediction-evidence')).status, 401);
  assert.equal(calls.length, 0);
  const one = await login('one@example.test'), two = await login('two@example.test');
  for (const [cookie, index] of [[one, 0], [two, 1]]) {
    const result = await request('/inventory/prediction-evidence?userId=forged&p_as_of=9999&evidence=forged', cookie);
    assert.equal(result.status, 200);
    const body = await result.json();
    assert.equal(body.state, 'available'); assert.ok(!JSON.stringify(body).includes('private-token'));
    const call = calls.at(-1);
    assert.equal(call.client, clients[index]);
    assert.equal(call.user.id, index ? 'two@example.test' : 'one@example.test');
    assert.notEqual(call.args[1].p_as_of, '9999');
  }
  const count = calls.length;
  for (const url of ['/inventory/prediction-evidence', '/inventory/prediction-reviewers', '/inventory/prediction-classify']) {
    assert.equal((await request(url, one, 'POST', { evidence: fixture() })).status, 404);
  }
  assert.equal((await request('/inventory', one)).status, 200);
  assert.equal((await request('/health')).status, 200);
  assert.equal(calls.length, count);
  for (const [reply, status, code] of [
    [{ error: { code: 'PGRST202' } }, 200, null],
    [{ error: { code: '42501', message: 'private database details' } }, 403, 'PREDICTION_ACCESS_DENIED'],
    [{ error: { code: '08006', message: 'private database details' } }, 503, 'PREDICTION_CONNECTION_ERROR'],
    [{ data: { classifications: [] } }, 502, 'PREDICTION_INVALID_RESPONSE'],
  ]) {
    response = reply;
    const result = await request('/inventory/prediction-evidence', one);
    assert.equal(result.status, status);
    const body = await result.json();
    if (code) assert.equal(body.code, code);
    else assert.deepEqual(body, { state: 'migration_missing', asOf: null, evidence: null });
    assert.ok(!JSON.stringify(body).includes('private database details'));
  }
});
