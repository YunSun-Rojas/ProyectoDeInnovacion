import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePredictionData } from '../src/modules/inventario/pages/predictionData.js';
import { dailyMean, movingAverage, crostonSba, forecastMetrics, backtestDemand, forecastDemand } from '../src/modules/inventario/pages/predictionModel.js';

// Entirely synthetic fixtures for mathematical checks, never production data.
const date = index => new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const repeated = (length, units = 2) => Array.from({ length }, () => units);
function fixture(values, { unclassified = [], tests = [], unknown = [], stockouts = [], productId = 1, catalog = true, edit = {} } = {}) {
  const sales = values.flatMap((quantity, index) => quantity > 0 ? [{ id: `synthetic-${index}`, productId,
    product: 'Historical synthetic product', sku: 'SYN-1', movementId: `synthetic-movement-${index}`,
    quantity, date: `${date(index)}T12:00:00Z` }] : []);
  const classifications = sales.filter(sale => !unclassified.includes(Number(sale.id.split('-').at(-1))))
    .map(sale => ({ saleId: sale.id, kind: tests.includes(Number(sale.id.split('-').at(-1))) ? 'test' : 'commercial', evidence: 'Synthetic audit' }));
  const prepared = preparePredictionData({ products: catalog ? [{ id: productId, name: 'Current synthetic product',
    sku: 'SYN-1', isActive: true, stock: 10, ...edit }] : [], sales, classifications,
    asOf: `${date(values.length)}T12:00:00Z`, range: values.length ? { from: date(0), to: date(values.length - 1) } : undefined,
    coverage: values.flatMap((_, index) => unknown.includes(index) ? [] : [{ productId,
      from: date(index), to: date(index), evidence: 'Synthetic closed day' }]),
    stockouts: stockouts.map(index => ({ productId, from: date(index), to: date(index), evidence: 'Synthetic stockout evidence' })) });
  return prepared.products.find(product => product.productId === productId);
}
const options = (length, horizon = 7, extra = {}) => ({ cutoff: date(length - 1), horizon, ...extra });

test('daily mean includes confirmed zero values and keeps fractional precision', () => {
  close(dailyMean([0, 1, 3, 0]), 1);
  close(dailyMean([1, 2, 2]), 5 / 3);
  for (const input of [[], null, [NaN], [Infinity], [-1], ['2']]) assert.equal(dailyMean(input), null);
});

test('moving averages use the last 14, 28 and 56 consecutive values', () => {
  const values = Array.from({ length: 70 }, (_, index) => index + 1);
  for (const window of [14, 28, 56]) close(movingAverage(values, window), (71 - window + 70) / 2);
  assert.equal(movingAverage([1, 2], 14), null);
  assert.equal(movingAverage([1, null, 2], 2), null);
  assert.equal(movingAverage([1, 2], 0), null);
});

test('SBA uses hand-checked size and interval updates without imputation', () => {
  // first: size=4, interval=2; next: size=6, interval=2 => (1-.5/2)*6/2=2.25
  close(crostonSba([0, 4, 0, 8], 0.5), 2.25);
  close(crostonSba([0, 4, 0, 4, 0, 4], 0.1), 1.9);
  for (const values of [[], [0, 0], [0, 4], [1, null, 2], [1, -1, 2]]) assert.equal(crostonSba(values), null);
  assert.equal(crostonSba([1, 2], 0), null);
});

test('constant demand forecasts 7 days using actual cumulative units', () => {
  const output = forecastDemand(fixture(repeated(100)), options(100));
  assert.equal(output.status, 'pronostico_disponible');
  assert.equal(output.eligible, true);
  assert.equal(output.method, 'daily_mean');
  close(output.estimatedDemand, 14);
  close(output.dailyDemand, 2);
  assert.equal(output.from, date(100));
  assert.equal(output.to, date(106));
  assert.equal(output.evaluation.selectedMetrics.mae, 0);
  assert.equal(output.historicalData.contiguousDays, 100);
});

test('30-day horizon needs more history and independent full target periods', () => {
  const short = forecastDemand(fixture(repeated(100)), options(100, 30));
  assert.equal(short.eligible, false);
  assert.equal(short.estimatedDemand, null);
  const long = forecastDemand(fixture(repeated(220, 3)), options(220, 30));
  close(long.estimatedDemand, 90);
  assert.equal(long.to, date(249));
  assert.equal(long.evaluation.commonFolds.length, 3);
});

test('changing demand is compared on identical folds and reproducibly selects a moving mean', () => {
  const values = [...repeated(90, 1), ...repeated(90, 5)];
  const product = fixture(values);
  const output = forecastDemand(product, options(values.length));
  assert.equal(output.eligible, true);
  assert.equal(output.method, 'moving_average_14');
  assert.equal(output.estimatedDemand, 35);
  assert.equal(output.historicalData.methodDays, 14);
  assert.equal(output.historicalData.methodFrom, date(166));
  const candidates = output.evaluation.candidates.filter(candidate => candidate.status === 'evaluado');
  assert.ok(candidates.find(candidate => candidate.method === 'daily_mean').metrics.mae > output.evaluation.selectedMetrics.mae);
  for (const fold of output.evaluation.commonFolds) assert.equal(Object.keys(fold.predictions).length, candidates.length);
  assert.deepEqual(forecastDemand(product, options(values.length)), output);
});

test('intermittent demand allows optional SBA only with enough prior nonzero events', () => {
  const values = Array.from({ length: 160 }, (_, index) => index % 4 === 1 ? 8 : 0);
  const product = fixture(values);
  const enabled = backtestDemand(product, options(values.length, 7, { policy: { includeSba: true } }));
  assert.equal(enabled.status, 'evaluado');
  assert.equal(enabled.candidates.find(candidate => candidate.method === 'sba').status, 'evaluado');
  assert.ok(enabled.commonFolds.every(fold => fold.predictions.sba >= 0));
  assert.ok(!backtestDemand(product, options(values.length)).candidates.some(candidate => candidate.method === 'sba'));
  const insufficient = backtestDemand(product, options(values.length, 7, { policy: { includeSba: true, sbaMinSaleDays: 100 } }));
  assert.equal(insufficient.candidates.find(candidate => candidate.method === 'sba').status, 'metodo_no_aplicable');
});

test('zero demand with independently confirmed coverage is distinct from missing history', () => {
  const product = fixture(repeated(100, 0));
  const defaultResult = forecastDemand(product, options(100));
  assert.equal(defaultResult.estimatedDemand, null); // conservative default event requirement
  const explicitPolicy = forecastDemand(product, options(100, 7, { policy: { 7: { minEvents: 0, minSaleDays: 0 } } }));
  assert.equal(explicitPolicy.eligible, true);
  assert.equal(explicitPolicy.estimatedDemand, 0);
  assert.equal(explicitPolicy.evaluation.selectedMetrics.wape, null);
});

test('unknown days and stockouts are never compressed into zeros or evaluated as targets', () => {
  for (const extra of [{ unknown: [80] }, { stockouts: [80] }, { unknown: [99] }]) {
    const output = forecastDemand(fixture(repeated(100), extra), options(100));
    assert.equal(output.status, 'historial_incompleto');
    assert.equal(output.estimatedDemand, null);
    assert.equal(output.historicalData.unknownDays, 1);
  }
  const product = fixture(repeated(160), { unknown: [80], stockouts: [90] });
  const evaluation = backtestDemand(product, options(160, 7, { policy: { 7: { maxUnknownFraction: 0.1 } } }));
  for (const fold of evaluation.commonFolds) {
    assert.ok(!(fold.from <= date(80) && fold.to >= date(80)));
    assert.ok(!(fold.from <= date(90) && fold.to >= date(90)));
  }
});

test('a missing calendar row cannot make a moving window consecutive', () => {
  const product = fixture(repeated(100));
  product.series.splice(90, 1);
  assert.equal(forecastDemand(product, options(100)).status, 'historial_incompleto');
});

test('insufficient events, days or backtest folds produce null demand and no fake accuracy', () => {
  for (const values of [repeated(5), repeated(60), Array.from({ length: 100 }, (_, index) => index === 0 ? 1 : 0)]) {
    const output = forecastDemand(fixture(values), options(values.length));
    assert.equal(output.status, 'historial_insuficiente');
    assert.equal(output.estimatedDemand, null);
    assert.equal(output.method, null);
    assert.equal(output.evaluation.selectedMetrics, null);
  }
});

test('unclassified sales fail closed without relying on a global prepared status', () => {
  const product = fixture(repeated(100), { unclassified: [20] });
  product.status = 'datos_preparados';
  product.horizons = { 7: { canEvaluate: true } };
  const output = forecastDemand(product, options(100));
  assert.equal(output.status, 'historial_no_verificado');
  assert.equal(output.estimatedDemand, null);
});

test('test sales never supply quantities or sufficient commercial events', () => {
  const values = repeated(100);
  const output = forecastDemand(fixture(values, { tests: values.map((_, index) => index) }), options(100));
  assert.equal(output.eligible, false);
  assert.equal(output.estimatedDemand, null);
  assert.equal(output.historicalData.commercialEvents, 0);
  assert.equal(output.historicalData.excludedTestRecords, 100);
  const valuesWithTest = [...values, 1000];
  const mixed = forecastDemand(fixture(valuesWithTest, { tests: [100] }), options(101));
  assert.equal(mixed.historicalData.commercialEvents, 100);
  assert.ok(mixed.estimatedDemand < 100);
});

test('four synthetic development sales cannot yield a commercial forecast', () => {
  const product = fixture([4, 10, 20, 10], { tests: [0, 1, 2, 3] });
  const output = forecastDemand(product, options(4));
  assert.equal(output.estimatedDemand, null);
  assert.equal(output.evaluation.selectedMetrics, null);
});

test('ISO cutoffs exclude the current partial Lima day around UTC midnight', () => {
  const product = fixture(repeated(110));
  const afterMidnightUtc = forecastDemand(product, { cutoff: `${date(100)}T04:59:59Z` });
  assert.equal(afterMidnightUtc.cutoff, date(98));
  const midnightLima = forecastDemand(product, { cutoff: `${date(100)}T05:00:00Z` });
  assert.equal(midnightLima.cutoff, date(99));
  assert.deepEqual(midnightLima, forecastDemand(product, options(100)));
});

test('future quantities and unclassified records cannot affect forecasts or eligibility at an earlier cutoff', () => {
  const original = fixture(repeated(100));
  const extended = fixture([...repeated(100), ...repeated(20, 10000)], { unclassified: [105] });
  assert.deepEqual(forecastDemand(extended, options(100)), forecastDemand(original, options(100)));
});

test('30-day method selection is frozen before a separate synthetic temporal holdout', () => {
  const selectionHistory = fixture(repeated(220));
  const selected = forecastDemand(selectionHistory, options(220, 30));
  assert.equal(selected.eligible, true);
  const withHoldout = fixture([...repeated(220), ...repeated(30, 10)]);
  // Neither held-out units nor future classification change model selection.
  assert.deepEqual(forecastDemand(withHoldout, options(220, 30)), selected);
  assert.ok(selected.evaluation.commonFolds.every(fold => fold.to <= date(219)));
  const heldOut = withHoldout.series.filter(day => day.date > date(219));
  assert.equal(heldOut.length, 30);
  assert.ok(heldOut.every(day => day.complete));
  const independent = forecastMetrics([{ actual: heldOut.reduce((sum, day) => sum + day.units, 0), predicted: selected.estimatedDemand }]);
  assert.equal(selected.evaluation.selectedMetrics.mae, 0);
  assert.equal(independent.mae, 240);
  assert.equal(independent.rmse, 240);
  assert.equal(independent.bias, -240);
  assert.equal(independent.wape, 0.8);
  // This demonstrates evaluation separation, not commercial model accuracy.
});

test('rolling training predictions use no target sales; future shocks change actuals, not the preceding prediction', () => {
  const before = backtestDemand(fixture(repeated(100)), options(100));
  const values = repeated(100);
  values[99] = 1000;
  const after = backtestDemand(fixture(values), options(100));
  const lastBefore = before.commonFolds.at(-1), lastAfter = after.commonFolds.at(-1);
  assert.equal(lastBefore.cutoff, lastAfter.cutoff);
  assert.deepEqual(lastBefore.predictions, lastAfter.predictions);
  assert.notEqual(lastBefore.actual, lastAfter.actual);
  for (let index = 0; index < before.commonFolds.length; index++) {
    const fold = before.commonFolds[index];
    assert.ok(fold.cutoff < fold.from && fold.to <= date(99));
    if (index) assert.ok(before.commonFolds[index - 1].to < fold.from);
  }
});

test('metrics are computed on accumulated horizon units with explicit bias direction', () => {
  const metrics = forecastMetrics([{ actual: 10, predicted: 12 }, { actual: 0, predicted: 3 }]);
  close(metrics.mae, 2.5);
  close(metrics.rmse, Math.sqrt(6.5));
  close(metrics.bias, 2.5);
  close(metrics.wape, 0.5);
  close(forecastMetrics([{ actual: 4, predicted: 0 }]).bias, -4);
  assert.equal(forecastMetrics([{ actual: 0, predicted: 0 }]).wape, null);
  for (const input of [[], null, [{}], [{ actual: -1, predicted: 2 }], [{ actual: 1, predicted: Infinity }]]) {
    assert.equal(forecastMetrics(input), null);
  }
});

test('edited products and stock entries preserve demand while recreated/deleted products do not receive active forecasts', () => {
  const values = repeated(100);
  const output = forecastDemand(fixture(values), options(100));
  const edited = forecastDemand(fixture(values, { edit: { name: 'New name', sku: 'New SKU', stock: 9999, minStock: 888 } }), options(100));
  assert.deepEqual(edited, output);
  const deleted = fixture(values, { catalog: false });
  assert.equal(forecastDemand(deleted, options(100)).status, 'producto_inactivo');
  assert.equal(forecastDemand(deleted, options(100)).estimatedDemand, null);
  const recreated = fixture([], { productId: 2 });
  assert.equal(forecastDemand(recreated, options(100)).estimatedDemand, null);
  const wrongCatalog = fixture(values);
  wrongCatalog.catalog.id = 2;
  assert.equal(forecastDemand(wrongCatalog, options(100)).eligible, false);
});

test('invalid inputs and unknown configurations cannot yield numeric forecasts', () => {
  const product = fixture(repeated(100));
  for (const extra of [{ horizon: 1 }, { horizon: 30.5 }, { cutoff: 'invalid' }, { cutoff: '2025-02-30' },
    { cutoff: '2025-01-01T25:00:00Z' }, { policy: { 7: { minFolds: 0 } } },
    { policy: { 7: { minTrainDays: NaN } } }, { policy: { 7: { maxUnknownFraction: 2 } } },
    { policy: { 7: 'invalid' } }, { policy: { sbaAlpha: '0.1' } }, { cutoff: '9999-12-31' }]) {
    assert.equal(forecastDemand(product, { ...options(100), ...extra }).estimatedDemand, null);
  }
  for (const input of [undefined, null, {}, { productId: 1, active: true, catalog: { id: 1, isActive: true } }]) {
    assert.equal(forecastDemand(input, options(100)).estimatedDemand, null);
  }
  for (const input of [null, [], false, 'invalid']) assert.equal(forecastDemand(product, input).status, 'entrada_invalida');
});

test('methods without enough comparable windows return no metrics', () => {
  const evaluation = backtestDemand(fixture(repeated(42)), options(42, 7, { policy: {
    7: { minTrainDays: 14, minEvents: 2, minSaleDays: 2 } } }));
  assert.equal(evaluation.status, 'evaluado');
  assert.equal(evaluation.candidates.find(candidate => candidate.method === 'moving_average_56').metrics, null);
  assert.equal(evaluation.candidates.find(candidate => candidate.method === 'moving_average_28').metrics, null);
  assert.equal(evaluation.candidates.find(candidate => candidate.method === 'moving_average_14').status, 'evaluado');
});

test('selection is isolated by product ID and does not depend on array ordering', () => {
  const product = fixture(repeated(100));
  const reversed = structuredClone(product);
  reversed.series.reverse();
  reversed.records.reverse();
  assert.deepEqual(forecastDemand(reversed, options(100)), forecastDemand(product, options(100)));
  reversed.records[0].productId = 2;
  assert.equal(forecastDemand(reversed, options(100)).estimatedDemand, null);
});

test('inconsistent prepared totals, invalid records and duplicate calendar days are rejected', () => {
  const incorrect = fixture(repeated(100));
  incorrect.series[90].units = 999;
  assert.equal(forecastDemand(incorrect, options(100)).status, 'historial_incompleto');
  const invalid = fixture(repeated(100));
  invalid.records[0].validation = 'invalid';
  assert.equal(forecastDemand(invalid, options(100)).estimatedDemand, null);
  const duplicated = fixture(repeated(100));
  duplicated.series.push(duplicated.series[0]);
  assert.equal(forecastDemand(duplicated, options(100)).estimatedDemand, null);
});

test('overflow is rejected and successful output contains only finite nonnegative forecasts', () => {
  const output = forecastDemand(fixture(repeated(100, Number.MAX_SAFE_INTEGER)), options(100));
  assert.equal(output.estimatedDemand, null);
  for (const values of [repeated(100), Array.from({ length: 130 }, (_, index) => index % 3 ? 1 : 9)]) {
    const result = forecastDemand(fixture(values), options(values.length));
    assert.equal(result.eligible, true);
    assert.ok(Number.isFinite(result.estimatedDemand) && result.estimatedDemand >= 0);
    assert.ok(Number.isFinite(result.dailyDemand) && result.dailyDemand >= 0);
  }
});

test('model processing leaves the prepared data and policy unchanged', () => {
  const product = fixture(repeated(100));
  const config = options(100, 7, { policy: { includeSba: true } });
  const saved = structuredClone({ product, config });
  forecastDemand(product, config);
  assert.deepEqual({ product, config }, saved);
});
