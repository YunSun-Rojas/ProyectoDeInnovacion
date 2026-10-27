import { limaDate } from './dashboardData.js';

const DAY = 86400000;
const METHODS = ['daily_mean', 'moving_average_14', 'moving_average_28', 'moving_average_56', 'sba', 'zero_baseline'];
const stamp = day => Date.parse(`${day}T00:00:00Z`);
const validDay = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
  && day >= '0001-01-01' && day <= '9998-12-31'
  && Number.isFinite(stamp(day)) && new Date(stamp(day)).toISOString().slice(0, 10) === day;
const shift = (day, offset) => new Date(stamp(day) + offset * DAY).toISOString().slice(0, 10);
const safe = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const validUnits = values => Array.isArray(values) && values.length > 0 && values.every(safe);

// Initial methodological requirements, not universal accuracy guarantees. Each
// non-overlapping test fold needs another full horizon beyond its training data.
// 56 days includes eight weeks and the longest moving window; 120 days gives
// roughly four months before monthly validation. Event/day minima avoid fitting
// to isolated sales. Three folds are a modest starting comparison, not precision
// evidence for the business; all requirements must be revisited with real data.
// Fixed SBA alpha avoids tuning parameters against future evaluation outcomes.
export const DEFAULT_PREDICTION_POLICY = Object.freeze({
  7: Object.freeze({ minTrainDays: 56, minEvents: 8, minSaleDays: 6, minFolds: 3, maxUnknownFraction: 0 }),
  30: Object.freeze({ minTrainDays: 120, minEvents: 12, minSaleDays: 10, minFolds: 3, maxUnknownFraction: 0 }),
  includeSba: false, sbaAlpha: 0.1, sbaMinSaleDays: 10, sbaMinZeroFraction: 0.5,
});

// Numerical primitives only: callers handling commercial data must use the
// prepared-product APIs below, which enforce classification and coverage.
export function dailyMean(values) {
  return validUnits(values) ? values.reduce((mean, value, index) => mean + (value - mean) / (index + 1), 0) : null;
}

export function movingAverage(values, window) {
  return validUnits(values) && positiveInteger(window) && values.length >= window ? dailyMean(values.slice(-window)) : null;
}

/** SBA: initialize size with the first nonzero and interval with its 1-based
 * position; update both at subsequent events; multiply size/interval by 1-a/2.
 * Requires at least two events. No synthetic repetitions or zero imputation.
 * Reference: https://otexts.com/fpp3/practical.html (Croston decomposition).
 */
export function crostonSba(values, alpha = 0.1) {
  if (!validUnits(values) || typeof alpha !== 'number' || !(alpha > 0 && alpha <= 1)) return null;
  const first = values.findIndex(value => value > 0);
  if (first < 0 || values.filter(value => value > 0).length < 2) return null;
  let size = values[first], interval = first + 1, previous = first;
  for (let index = first + 1; index < values.length; index++) {
    if (values[index] === 0) continue;
    size += alpha * (values[index] - size);
    interval += alpha * (index - previous - interval);
    previous = index;
  }
  const estimate = (1 - alpha / 2) * size / interval;
  return safe(estimate) ? estimate : null;
}

/** Metrics for cumulative horizon units. Bias = forecast - actual. WAPE is a
 * ratio, not a percentage; null when sum(actual)=0. Empty/invalid pairs => null.
 */
export function forecastMetrics(pairs) {
  if (!Array.isArray(pairs) || !pairs.length || pairs.some(row => !row || !safe(row.actual) || !safe(row.predicted))) return null;
  const errors = pairs.map(row => row.predicted - row.actual);
  const mae = dailyMean(errors.map(Math.abs));
  const rmse = Math.sqrt(errors.reduce((sum, error) => sum + error * error / errors.length, 0));
  const bias = errors.reduce((sum, error) => sum + error / errors.length, 0);
  const actualMean = dailyMean(pairs.map(row => row.actual));
  const wape = actualMean > 0 ? mae / actualMean : null;
  return [mae, rmse, bias].every(Number.isFinite) && (wape === null || Number.isFinite(wape))
    ? { mae, rmse, bias, wape } : null;
}

// A YYYY-MM-DD is an explicitly closed Lima day. An ISO instant resolves to the
// PREVIOUS Lima day, so a partially observed current day is never used.
function cutoffDay(value) {
  if (validDay(value)) return value;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.test(value)
    || !validDay(value.slice(0, 10)) || Number(value.slice(11, 13)) > 23
    || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59 || !Number.isFinite(Date.parse(value))) return null;
  return shift(limaDate(value), -1);
}

function configuration(horizon, overrides) {
  if (![7, 30].includes(horizon) || (overrides != null && (typeof overrides !== 'object' || Array.isArray(overrides)))) return null;
  if (overrides?.[horizon] != null && (typeof overrides[horizon] !== 'object' || Array.isArray(overrides[horizon]))) return null;
  const base = DEFAULT_PREDICTION_POLICY;
  const config = { ...base[horizon], ...overrides?.[horizon],
    includeSba: overrides?.includeSba ?? base.includeSba,
    sbaAlpha: overrides?.sbaAlpha ?? base.sbaAlpha,
    sbaMinSaleDays: overrides?.sbaMinSaleDays ?? base.sbaMinSaleDays,
    sbaMinZeroFraction: overrides?.sbaMinZeroFraction ?? base.sbaMinZeroFraction };
  return positiveInteger(config.minTrainDays) && positiveInteger(config.minFolds)
    && [config.minEvents, config.minSaleDays].every(value => Number.isSafeInteger(value) && value >= 0)
    && typeof config.maxUnknownFraction === 'number' && config.maxUnknownFraction >= 0 && config.maxUnknownFraction <= 1
    && typeof config.includeSba === 'boolean' && typeof config.sbaAlpha === 'number' && config.sbaAlpha > 0 && config.sbaAlpha <= 1
    && positiveInteger(config.sbaMinSaleDays) && config.sbaMinSaleDays >= 2
    && typeof config.sbaMinZeroFraction === 'number' && config.sbaMinZeroFraction >= 0 && config.sbaMinZeroFraction <= 1 ? config : null;
}

function snapshot(product, cutoff) {
  if (!product || !positiveInteger(product.productId) || !Array.isArray(product.series) || !Array.isArray(product.records)) {
    return { status: 'entrada_invalida', reason: 'invalid_prepared_product' };
  }
  if (product.series.some(day => !day || !validDay(day.date))) return { status: 'entrada_invalida', reason: 'invalid_series_date' };
  const days = product.series.filter(day => day.date <= cutoff).map(day => ({ ...day })).sort((a, b) => a.date.localeCompare(b.date));
  if (new Set(days.map(day => day.date)).size !== days.length) return { status: 'entrada_invalida', reason: 'duplicate_series_day' };
  const records = product.records.filter(row => !row?.day || row.day <= cutoff);
  if (records.some(row => !row || !validDay(row.day) || row.productId !== product.productId || row.validation !== 'valid')) {
    return { status: 'historial_incompleto', reason: 'invalid_sales_records' };
  }
  if (records.some(row => !['commercial', 'test'].includes(row.classification))) {
    return { status: 'historial_no_verificado', reason: 'unclassified_sales' };
  }
  const commercial = records.filter(row => row.classification === 'commercial');
  if (commercial.some(row => row.eligibleForModeling !== true || !positiveInteger(row.quantity)
    || typeof row.saleId !== 'string' || !row.saleId.trim() || !Number.isFinite(Date.parse(row.date)) || limaDate(row.date) !== row.day)
    || new Set(commercial.map(row => row.saleId)).size !== commercial.length) {
    return { status: 'historial_incompleto', reason: 'invalid_commercial_records' };
  }
  const byDay = new Map();
  for (const row of commercial) {
    const daily = byDay.get(row.day) ?? { units: 0, events: 0 };
    daily.units += row.quantity;
    daily.events++;
    byDay.set(row.day, daily);
  }
  for (const day of days) {
    const observed = byDay.get(day.date) ?? { units: 0, events: 0 };
    day.events = observed.events;
    day.valid = day.complete === true && day.overflow !== true && Number.isSafeInteger(day.units) && day.units >= 0
      && ['recorded_sales', 'confirmed_zero'].includes(day.state) && observed.units === day.units;
  }
  const span = days.length ? (stamp(cutoff) - stamp(days[0].date)) / DAY + 1 : 0;
  const validDays = days.filter(day => day.valid).length;
  const unknownDays = span - validDays;
  const tail = [];
  let expected = cutoff;
  for (let index = days.length - 1; index >= 0; index--) {
    if (days[index].date !== expected || !days[index].valid) break;
    tail.unshift(days[index]);
    expected = shift(expected, -1);
  }
  const diagnostics = { totalDays: span, validDays, unknownDays, unknownFraction: span ? unknownDays / span : null,
    stockoutDays: days.filter(day => day.state === 'possible_stockout').length,
    contiguousDays: tail.length, commercialEvents: tail.reduce((sum, day) => sum + day.events, 0),
    commercialSaleDays: tail.filter(day => day.units > 0).length,
    excludedTestRecords: records.filter(row => row.classification === 'test').length };
  return { status: 'ok', days, tail, diagnostics };
}

function sufficiency(view, config) {
  if (view.status !== 'ok') return view;
  if (!view.days.length) return { status: 'historial_insuficiente', reason: 'no_observed_days' };
  if (!view.tail.length || view.diagnostics.unknownFraction > config.maxUnknownFraction) {
    return { status: 'historial_incompleto', reason: 'unknown_days_or_stockouts' };
  }
  if (view.tail.length < config.minTrainDays || view.diagnostics.commercialEvents < config.minEvents
    || view.diagnostics.commercialSaleDays < config.minSaleDays) {
    return { status: 'historial_insuficiente', reason: 'insufficient_days_or_events' };
  }
  return { status: 'ok' };
}

function estimate(method, tail, config) {
  const values = tail.map(day => day.units);
  if (method === 'zero_baseline') return 0;
  if (method === 'daily_mean') return dailyMean(values);
  if (method.startsWith('moving_average_')) return movingAverage(values, Number(method.split('_').at(-1)));
  const saleDays = values.filter(value => value > 0).length;
  return config.includeSba && saleDays >= config.sbaMinSaleDays && 1 - saleDays / values.length >= config.sbaMinZeroFraction
    ? crostonSba(values, config.sbaAlpha) : null;
}

function cumulative(method, view, horizon, config) {
  const rate = estimate(method, view.tail, config);
  return rate !== null && safe(rate * horizon) ? rate * horizon : null;
}

/** Rolling-origin comparison on non-overlapping, fully observed target windows.
 * Metrics describe candidate selection on these folds, NOT an independent test
 * of the selected winner. Requires a frozen, audited Phase-2 snapshot: historical
 * classification/coverage availability times are not present in that contract.
 * Consequently this is retrospective validation, not proof of live performance.
 */
export function backtestDemand(product, options = {}) {
  const { cutoff, horizon = 7, policy } = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  const end = cutoffDay(cutoff);
  const config = configuration(horizon, policy);
  const result = { productId: product?.productId ?? null, cutoff: end, horizon,
    status: 'entrada_invalida', reason: 'invalid_cutoff_horizon_or_policy', diagnostics: null,
    policy: config, candidates: [], selectedMethod: null, selectedMetrics: null, commonFolds: [] };
  if (!end || !config) return result;
  const view = snapshot(product, end);
  const sufficient = sufficiency(view, config);
  result.diagnostics = view.diagnostics ?? null;
  if (sufficient.status !== 'ok') return { ...result, status: sufficient.status, reason: sufficient.reason };
  const methods = METHODS.filter(method => method !== 'sba' || config.includeSba);
  const folds = [];
  // Origins anchored to the caller's cutoff, never to the last future record.
  for (let origin = shift(end, -horizon); origin >= view.days[0].date; origin = shift(origin, -horizon)) {
    const training = snapshot(product, origin);
    if (sufficiency(training, config).status !== 'ok') continue;
    const targets = view.days.filter(day => day.date > origin && day.date <= shift(origin, horizon));
    if (targets.length !== horizon || targets.some((day, index) => !day.valid || day.date !== shift(origin, index + 1))) continue;
    const actual = targets.reduce((sum, day) => sum + day.units, 0);
    if (!safe(actual)) continue;
    folds.push({ cutoff: origin, from: shift(origin, 1), to: shift(origin, horizon), actual,
      predictions: Object.fromEntries(methods.map(method => [method, cumulative(method, training, horizon, config)])) });
  }
  folds.reverse();
  const candidates = methods.map(method => ({ method, currentDemand: cumulative(method, view, horizon, config),
    availableFolds: folds.filter(fold => fold.predictions[method] !== null).length }));
  const comparable = candidates.filter(candidate => candidate.currentDemand !== null && candidate.availableFolds >= config.minFolds);
  const common = folds.filter(fold => comparable.length > 0 && comparable.every(candidate => fold.predictions[candidate.method] !== null));
  result.candidates = candidates.map(candidate => ({ method: candidate.method, availableFolds: candidate.availableFolds,
    status: candidate.currentDemand === null ? 'metodo_no_aplicable' : 'sin_validacion_suficiente', metrics: null }));
  if (common.length < config.minFolds) return { ...result, status: 'historial_insuficiente', reason: 'insufficient_common_backtest_folds' };
  result.commonFolds = common.map(({ cutoff, from, to, actual, predictions }) => ({ cutoff, from, to, actual,
    predictions: Object.fromEntries(comparable.map(candidate => [candidate.method, predictions[candidate.method]])) }));
  result.candidates = result.candidates.map(candidate => {
    if (!comparable.some(item => item.method === candidate.method)) return candidate;
    const metrics = forecastMetrics(common.map(fold => ({ actual: fold.actual, predicted: fold.predictions[candidate.method] })));
    return { ...candidate, status: metrics ? 'evaluado' : 'error_numerico', metrics };
  });
  // Rank by horizon MAE, then RMSE, then fixed method order for exact ties.
  const ranked = result.candidates.filter(candidate => candidate.metrics).sort((a, b) => a.metrics.mae - b.metrics.mae
    || a.metrics.rmse - b.metrics.rmse || METHODS.indexOf(a.method) - METHODS.indexOf(b.method));
  if (!ranked.length) return { ...result, status: 'historial_insuficiente', reason: 'no_finite_metrics' };
  return { ...result, status: 'evaluado', reason: null,
    selectedMethod: ranked[0].method, selectedMetrics: ranked[0].metrics };
}

/** Active forecast API: accepts ONE product returned by preparePredictionData.
 * Does not trust its aggregate status/horizons: rechecks the dated observations
 * at this cutoff, so future records cannot change historical training eligibility.
 * No stock input, rounding, random values, imputation or fallback forecast.
 */
export function forecastDemand(product, options = {}) {
  const evaluation = backtestDemand(product, options);
  const output = { productId: product?.productId ?? null, cutoff: evaluation.cutoff, horizon: evaluation.horizon,
    status: evaluation.status, eligible: false, method: null, estimatedDemand: null, dailyDemand: null,
    from: evaluation.cutoff ? shift(evaluation.cutoff, 1) : null,
    to: evaluation.cutoff && [7, 30].includes(evaluation.horizon) ? shift(evaluation.cutoff, evaluation.horizon) : null,
    historicalData: evaluation.diagnostics, evaluation,
    limitations: ['observed_sales_are_not_unconstrained_demand', 'no_seasonality_or_supplier_lead_time',
      'retrospective_audited_snapshot', 'selection_metrics_are_not_independent_test_accuracy'] };
  if (evaluation.status === 'entrada_invalida') return { ...output, limitations: [...output.limitations, evaluation.reason] };
  if (!product?.active || product.catalog?.id !== product.productId || product.catalog?.isActive !== true) {
    return { ...output, status: 'producto_inactivo', limitations: [...output.limitations, 'missing_or_inactive_current_catalog'] };
  }
  if (evaluation.status !== 'evaluado') return { ...output, limitations: [...output.limitations, evaluation.reason] };
  const view = snapshot(product, evaluation.cutoff);
  const demand = cumulative(evaluation.selectedMethod, view, evaluation.horizon, evaluation.policy);
  if (demand === null) return { ...output, status: 'historial_insuficiente', limitations: [...output.limitations, 'non_finite_forecast'] };
  const window = evaluation.selectedMethod.startsWith('moving_average_') ? Number(evaluation.selectedMethod.split('_').at(-1)) : view.tail.length;
  const historicalData = { ...view.diagnostics, from: view.tail[0].date, to: view.tail.at(-1).date,
    methodDays: window, methodFrom: view.tail.at(-window).date };
  return { ...output, historicalData, status: 'pronostico_disponible', eligible: true,
    method: evaluation.selectedMethod, estimatedDemand: demand, dailyDemand: demand / evaluation.horizon,
    limitations: [...output.limitations, ...(evaluation.selectedMethod === 'zero_baseline' ? ['zero_is_horizon_specific_not_proof_of_no_future_sales'] : [])] };
}
