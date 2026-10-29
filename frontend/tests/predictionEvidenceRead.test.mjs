import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPredictionEvidence, predictionEvidenceState } from '../src/modules/inventario/api/predictionApi.js';
import { preparePredictionView, evaluatePredictionView } from '../src/modules/inventario/pages/predictionViewData.js';

const empty = { classifications: [], coverage: [], stockouts: [] };
const available = { state: 'available', asOf: '2025-08-09T12:00:00.000Z', evidence: empty };

test('lectura de predicción: GET al backend con cookie de sesión, sin credenciales ni evidencias del navegador', async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/inventory/prediction-evidence');
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.signal, controller.signal);
    assert.deepEqual(options.headers, {}); assert.equal(options.body, undefined);
    return new Response(JSON.stringify(available));
  });
  assert.deepEqual(await loadPredictionEvidence(controller.signal), available);
  const result = await predictionEvidenceState(controller.signal);
  assert.deepEqual(result, { evidenceState: 'available', predictionEvidence: empty, asOf: available.asOf });
  const view = preparePredictionView({ products: [{ id: 1 }], sales: [], salesEnabled: true,
    asOf: result.asOf, evidence: result.predictionEvidence, evidenceState: result.evidenceState });
  assert.equal(evaluatePredictionView(view, 7).forecasts[0].eligible, false);
});

test('lectura de predicción: migración ausente, denegación, red y formato inválido conservan estados diferentes', async t => {
  let response;
  t.mock.method(globalThis, 'fetch', async () => {
    if (response instanceof Error) throw response;
    return new Response(JSON.stringify(response.body), { status: response.status ?? 200 });
  });
  for (const [reply, state] of [
    [{ body: { state: 'migration_missing', asOf: null, evidence: null } }, 'migration_missing'],
    [{ status: 403, body: { error: 'Denegado', code: 'PREDICTION_ACCESS_DENIED' } }, 'access_denied'],
    [{ status: 503, body: { error: 'Sin conexión', code: 'PREDICTION_CONNECTION_ERROR' } }, 'connection_error'],
    [{ status: 503, body: { error: 'Lectura fallida', code: 'PREDICTION_READ_ERROR' } }, 'evidence_error'],
    [{ status: 502, body: { error: 'Inválido', code: 'PREDICTION_INVALID_RESPONSE' } }, 'invalid_evidence'],
    [{ body: { ...available, evidence: { classifications: [], coverage: [] } } }, 'invalid_evidence'],
    [{ body: { state: 'migration_missing', asOf: null, evidence: empty } }, 'invalid_evidence'],
    [{ body: { ...available, state: 'unknown' } }, 'invalid_evidence'],
    [new TypeError('fetch failed'), 'connection_error'],
  ]) {
    response = reply;
    const result = await predictionEvidenceState(new AbortController().signal);
    assert.equal(result.evidenceState, state);
    const view = preparePredictionView({ products: [{ id: 1 }], sales: [], salesEnabled: true,
      asOf: available.asOf, evidence: result.predictionEvidence, evidenceState: result.evidenceState });
    const evaluated = evaluatePredictionView(view, 7);
    assert.equal(evaluated.state, state); assert.deepEqual(evaluated.forecasts, []);
    if (state !== 'migration_missing') assert.equal(result.predictionEvidence, undefined);
  }
});

test('lectura de predicción: abortar ignora éxitos y errores tardíos sin recuperar evidencia anterior', async () => {
  for (const reject of [false, true]) {
    const controller = new AbortController();
    let finish;
    const pending = predictionEvidenceState(controller.signal, () => new Promise((resolve, fail) => {
      finish = () => reject ? fail(new Error('late failure')) : resolve(available);
    }));
    controller.abort(); finish(); assert.equal(await pending, null);
  }
  const denied = await predictionEvidenceState(new AbortController().signal, async () => {
    throw Object.assign(new Error('Session expired'), { status: 401 });
  });
  assert.deepEqual(denied, { evidenceState: 'access_denied', predictionEvidence: undefined });
});

test('lectura de predicción: JSON HTTP ilegible es evidencia inválida, no un fallo de conexión', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>upstream error</html>'));
  const result = await predictionEvidenceState(new AbortController().signal);
  assert.equal(result.evidenceState, 'invalid_evidence');
  assert.equal(result.predictionEvidence, undefined);
});

test('lectura de predicción: una solicitud cancelada antes de empezar no consulta el backend', async () => {
  const controller = new AbortController();
  controller.abort();
  let reads = 0;
  const result = await predictionEvidenceState(controller.signal, async () => { reads++; return available; });
  assert.equal(result, null);
  assert.equal(reads, 0);
});
