import { preparePredictionData } from './predictionData.js';
import { forecastDemand } from './predictionModel.js';

export const methodLabels = {
  daily_mean: 'Promedio diario', moving_average_14: 'Media móvil de 14 días',
  moving_average_28: 'Media móvil de 28 días', moving_average_56: 'Media móvil de 56 días',
  sba: 'SBA · demanda intermitente', zero_baseline: 'Línea base de cero',
};

// Explicit seam for a future authorized evidence source. No manufactured
// classification, coverage or model policy. readOnly does NOT deny sales reads.
export function preparePredictionView({ products, sales, salesEnabled, historyAccess, status = 'ready', asOf, evidence } = {}) {
  if (status === 'loading') return { state: 'loading' };
  if (historyAccess === 'denied') return { state: 'access_denied' };
  if (status !== 'ready') return { state: 'processing_error' };
  if (salesEnabled !== true) return { state: 'sales_disabled' };
  if (!Array.isArray(products) || !Array.isArray(sales)) return { state: 'processing_error' };
  // An explicitly malformed response is not proof that no stockouts occurred.
  // Missing evidence stays unverified; optional lists retain the Phase-2 contract.
  if (evidence != null && (typeof evidence !== 'object' || Array.isArray(evidence)
    || ['classifications', 'coverage', 'stockouts'].some(field => evidence[field] !== undefined && !Array.isArray(evidence[field])))) {
    return { state: 'processing_error' };
  }
  try {
    return { state: 'ready', asOf, prepared: preparePredictionData({ products, sales, asOf,
      classifications: evidence?.classifications, coverage: evidence?.coverage, stockouts: evidence?.stockouts }) };
  } catch { return { state: 'processing_error' }; }
}

export function evaluatePredictionView(view, horizon) {
  if (view.state !== 'ready') return { state: view.state, forecasts: [] };
  try {
    const forecasts = view.prepared.products.map(product => {
      if (!product.active) return { productId: product.productId, horizon, eligible: false, estimatedDemand: null,
        status: 'producto_inactivo', displayState: 'producto_inactivo' };
      const forecast = forecastDemand(product, { cutoff: view.asOf, horizon });
      // Test-only or unclassified history never implies zero commercial sales.
      const noCommercialSales = product.historyKind === 'none' && forecast.historicalData?.totalDays > 0
        && forecast.historicalData.unknownDays === 0 && forecast.historicalData.commercialEvents === 0;
      return { ...forecast, displayState: noCommercialSales ? 'sin_ventas_confirmadas'
        : forecast.status === 'entrada_invalida' ? 'processing_error' : forecast.status };
    });
    return { state: 'ready', forecasts };
  } catch { return { state: 'processing_error', forecasts: [] }; }
}

export function predictionAvailability(result, currentIds) {
  if (result.state !== 'ready') return result.state;
  const forecasts = result.forecasts.filter(row => currentIds.has(row.productId) && row.status !== 'producto_inactivo');
  if (forecasts.some(row => row.eligible)) return 'pronostico_disponible';
  return ['processing_error', 'historial_no_verificado', 'historial_incompleto', 'historial_insuficiente', 'sin_ventas_confirmadas']
    .find(state => forecasts.some(row => row.displayState === state)) ?? 'historial_insuficiente';
}

// Uniform-consumption orientation within the modeled horizon only. Stock affects
// this estimate, never the statistical demand. No supplier lead time is assumed.
export function estimateStockout(forecast, stock) {
  if (!forecast?.eligible || !Number.isSafeInteger(stock) || stock < 0
    || !Number.isFinite(forecast.dailyDemand) || forecast.dailyDemand <= 0
    || !Number.isFinite(forecast.estimatedDemand) || forecast.estimatedDemand <= 0
    || ![7, 30].includes(forecast.horizon)) return { state: 'not_estimable', days: null };
  const days = stock / forecast.dailyDemand;
  if (!Number.isFinite(days)) return { state: 'not_estimable', days: null };
  return days <= forecast.horizon ? { state: 'within_horizon', days } : { state: 'beyond_horizon', days: null };
}
