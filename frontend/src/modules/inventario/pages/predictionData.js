import { limaDate } from './dashboardData.js';

const DAY = 86400000;
const text = value => typeof value === 'string' && value.trim().length > 0;
const productKey = value => Number.isSafeInteger(value) && value > 0 ? String(value) : null;
const list = value => Array.isArray(value) ? value : [];
const dayNumber = value => Date.parse(`${value}T00:00:00Z`);
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(dayNumber(value)) && new Date(dayNumber(value)).toISOString().slice(0, 10) === value;

// Require an explicit offset: timezone-less timestamps depend on the host clock.
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.test(value)
    || !validDay(value.slice(0, 10)) || Number(value.slice(11, 13)) > 23
    || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return NaN;
  return Date.parse(value);
}

function verifiedRanges(rows, today) {
  return list(rows).filter(row => row && productKey(row.productId) && text(row.evidence)
    && validDay(row.from) && validDay(row.to) && row.from <= row.to && row.to < today);
}

/**
 * Pure frontend-contract adapter. Only pass inventory.sales, never movements.
 * asOf: explicit ISO instant; no Date.now(). classifications: [{saleId, kind:
 * 'commercial'|'test', evidence}]. Missing/conflicting evidence stays unclassified.
 * coverage/stockouts: [{productId, from, to, evidence}], inclusive CLOSED Lima days.
 * A coverage assertion means complete commercial recording for that product/day,
 * not merely a successful API request. Stockouts require independent evidence.
 * range is optional and only selects output dates; it never asserts coverage.
 * requirements: {7: {minCoveredDays, minSaleDays}, 30: {...}}, supplied by a future
 * validated policy. Prepared data is not a claim of forecast accuracy.
 */
export function preparePredictionData({ products = [], sales = [], asOf, classifications = [],
  coverage = [], stockouts = [], range, requirements = {} } = {}) {
  const cutoff = timestamp(asOf);
  if (!Number.isFinite(cutoff)) throw new TypeError('asOf debe ser una fecha ISO válida con zona horaria.');
  const today = limaDate(asOf);
  if (range && (!validDay(range.from) || !validDay(range.to) || range.from > range.to || range.to > today)) {
    throw new TypeError('Rango de días de Lima inválido.');
  }
  const covered = verifiedRanges(coverage, today);
  const unavailable = verifiedRanges(stockouts, today);
  const quality = { invalidRecords: 0, duplicateRecords: 0, testRecords: 0, unclassifiedRecords: 0,
    commercialRecords: 0, missingCatalogRecords: 0,
    rejectedCoverage: list(coverage).length - covered.length,
    rejectedStockouts: list(stockouts).length - unavailable.length };
  const decisions = new Map();
  for (const item of list(classifications)) {
    if (!item || !text(item.saleId)) continue;
    const kind = text(item.evidence) && ['commercial', 'test'].includes(item.kind) ? item.kind : 'unclassified';
    const previous = decisions.get(item.saleId);
    decisions.set(item.saleId, previous && previous !== kind ? 'unclassified' : kind);
  }
  const groups = new Map();
  const ensure = id => {
    const key = productKey(id);
    if (!key) return null;
    if (!groups.has(key)) groups.set(key, { productId: id, catalog: null, records: [], invalid: false });
    return groups.get(key);
  };
  for (const product of list(products)) {
    if (product && productKey(product.id)) {
      const group = ensure(product.id);
      group.catalog = { id: product.id, sku: product.sku ?? null, name: product.name ?? null,
        isActive: product.isActive !== false };
    }
  }
  const counts = new Map();
  for (const sale of list(sales)) {
    if (sale && text(sale.id)) counts.set(sale.id, (counts.get(sale.id) ?? 0) + 1);
  }
  const records = list(sales).map(sale => {
    const group = ensure(sale?.productId);
    const instant = timestamp(sale?.date);
    const errors = [];
    if (!text(sale?.id)) errors.push('invalid_sale_id');
    if (!group) errors.push('invalid_product_id');
    if (!Number.isSafeInteger(sale?.quantity) || sale.quantity <= 0) errors.push('invalid_quantity');
    if (!Number.isFinite(instant)) errors.push('invalid_date');
    else if (instant > cutoff) errors.push('future_date');
    if (!text(sale?.product) || !text(sale?.sku) || !text(sale?.movementId)) errors.push('incomplete_sale');
    if (counts.get(sale?.id) > 1) errors.push('duplicate_sale_id');
    const classification = decisions.get(sale?.id) ?? 'unclassified';
    const valid = errors.length === 0;
    quality.invalidRecords += Number(!valid);
    quality.duplicateRecords += Number(errors.includes('duplicate_sale_id'));
    quality.testRecords += Number(classification === 'test');
    quality.unclassifiedRecords += Number(classification === 'unclassified');
    quality.commercialRecords += Number(valid && classification === 'commercial');
    quality.missingCatalogRecords += Number(Boolean(group && !group.catalog));
    // Deliberately omit actor, prices and evidence contents from the output.
    const record = { saleId: text(sale?.id) ? sale.id : null, productId: group?.productId ?? null,
      sku: text(sale?.sku) ? sale.sku : null, name: text(sale?.product) ? sale.product : null,
      date: Number.isFinite(instant) ? sale.date : null,
      day: Number.isFinite(instant) ? limaDate(sale.date) : null,
      quantity: Number.isSafeInteger(sale?.quantity) && sale.quantity > 0 ? sale.quantity : null,
      classification, validation: valid ? 'valid' : 'invalid', errors,
      catalogRelation: group?.catalog ? (group.catalog.isActive ? 'active' : 'inactive') : 'missing',
      eligibleForModeling: valid && classification === 'commercial' };
    if (group) { group.records.push(record); group.invalid ||= !valid; }
    return record;
  });
  for (const row of [...covered, ...unavailable]) ensure(row.productId);
  const result = [...groups.values()].sort((a, b) => a.productId - b.productId).map(group => {
    const ownCoverage = covered.filter(row => row.productId === group.productId);
    const ownStockouts = unavailable.filter(row => row.productId === group.productId);
    const ordered = [...group.records].sort((a, b) => (timestamp(a.date) || 0) - (timestamp(b.date) || 0)
      || (a.saleId ?? '').localeCompare(b.saleId ?? ''));
    const commercial = ordered.filter(row => row.eligibleForModeling);
    const dates = [...ordered.map(row => row.day).filter(day => day && day <= today),
      ...ownCoverage.flatMap(row => [row.from, row.to]), ...ownStockouts.flatMap(row => [row.from, row.to])].sort();
    const from = range?.from ?? dates[0];
    const to = range?.to ?? dates.at(-1);
    const series = [];
    for (let cursor = from ? dayNumber(from) : NaN; cursor <= dayNumber(to); cursor += DAY) {
      const date = new Date(cursor).toISOString().slice(0, 10);
      const daily = ordered.filter(row => row.day === date);
      const confirmed = ownCoverage.some(row => row.from <= date && date <= row.to);
      const stockout = ownStockouts.some(row => row.from <= date && date <= row.to);
      const observations = daily.filter(row => row.eligibleForModeling);
      const sum = observations.reduce((total, row) => total + row.quantity, 0);
      const overflow = !Number.isSafeInteger(sum);
      const blocked = daily.some(row => row.validation === 'invalid' || row.classification === 'unclassified');
      const complete = confirmed && !stockout && !blocked && !overflow;
      series.push({ date, units: observations.length && !overflow ? sum : complete ? 0 : null,
        state: stockout ? 'possible_stockout' : blocked || overflow ? 'unknown'
          : observations.length ? 'recorded_sales' : complete ? 'confirmed_zero' : 'unknown',
        complete, overflow });
    }
    let trailingCoveredDays = 0;
    for (let i = series.length - 1; i >= 0 && series[i].complete; i--) trailingCoveredDays++;
    const hasUnverified = ordered.some(row => row.classification === 'unclassified');
    const historyKind = hasUnverified ? 'unclassified' : commercial.length ? 'validated'
      : ordered.some(row => row.classification === 'test') ? 'test' : 'none';
    const horizons = Object.fromEntries([7, 30].map(horizon => {
      const policy = requirements?.[horizon];
      const policyValid = Number.isSafeInteger(policy?.minCoveredDays) && policy.minCoveredDays > 0
        && Number.isSafeInteger(policy?.minSaleDays) && policy.minSaleDays > 0;
      const tail = series.slice(series.length - trailingCoveredDays);
      const saleDays = tail.filter(day => day.units > 0).length;
      const prepared = policyValid && commercial.length > 0 && !group.invalid && !hasUnverified
        && trailingCoveredDays >= policy.minCoveredDays && saleDays >= policy.minSaleDays;
      return [horizon, { status: prepared ? 'datos_preparados' : 'historial_insuficiente',
        policyProvided: policyValid, canEvaluate: prepared && group.catalog?.isActive === true }];
    }));
    const status = hasUnverified ? 'historial_no_verificado' : group.invalid || series.some(day => !day.complete)
      ? 'historial_incompleto' : !commercial.length && series.length ? 'sin_ventas_confirmadas'
        : Object.values(horizons).some(value => value.status === 'datos_preparados') ? 'datos_preparados' : 'historial_insuficiente';
    return { productId: group.productId, catalog: group.catalog,
      historicalIdentity: ordered.filter(row => row.name && row.sku).map(row => ({ saleId: row.saleId, name: row.name, sku: row.sku })),
      active: group.catalog?.isActive === true, status, historyKind, horizons,
      records: ordered, series, commercialSales: commercial,
      // Keep calendar gaps explicit; never compress unknown days out of time.
      modelingSeries: series.map(day => ({ date: day.date, units: day.complete ? day.units : null })), trailingCoveredDays };
  });
  return { products: result, records, quality, summary: {
    productsAnalyzed: result.length,
    productsWithValidatedCommercialHistory: result.filter(row => row.commercialSales.length > 0).length,
    productsWithoutSufficientHistory: result.filter(row => !Object.values(row.horizons).some(h => h.canEvaluate)).length,
    productsWithUnverifiedHistory: result.filter(row => row.historyKind === 'unclassified').length,
    discardedByValidation: quality.invalidRecords,
    coveredDates: [...new Set(result.flatMap(row => row.series.filter(day => day.complete).map(day => day.date)))].sort(),
  } };
}
