import { useEffect, useId, useMemo, useState } from 'react';
import { CircleAlert, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import InventoryLoading from '../components/InventoryLoading';
import { limaDate } from './dashboardData.js';
import { preparePredictionView, evaluatePredictionView, predictionAvailability, methodLabels, estimateStockout } from './predictionViewData.js';
import s from './Management.module.css';
import ui from './InventoryUI.module.css';
import styles from './Prediccion.module.css';

const EMPTY = Object.freeze([]);
const numbers = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 });
const daysFormat = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 });
const dateLabel = day => day ? day.split('-').reverse().join('/') : '—';
const descriptions = {
  historial_insuficiente: 'Todavía no existe historial comercial verificado suficiente para estimar la demanda.',
  historial_no_verificado: 'Hay ventas pendientes de verificación comercial. No se utilizan para pronosticar.',
  historial_incompleto: 'La cobertura histórica no permite estimar la demanda de forma fiable.',
  sin_ventas_confirmadas: 'El período con cobertura confirmada no registra ventas comerciales.',
  sales_disabled: 'El historial de ventas no está habilitado para esta sesión.',
  access_denied: 'La sesión no tiene acceso al historial de ventas.',
  processing_error: 'No se pudo procesar el historial. Vuelve a cargar el inventario.',
  migration_missing: 'La verificación comercial todavía no está habilitada. No hay predicciones disponibles.',
  connection_error: 'No se pudo conectar con el servicio de evidencias. Vuelve a cargar el inventario.',
  invalid_evidence: 'Las evidencias recibidas son inválidas o están incompletas. No se utilizan para pronosticar.',
  evidence_error: 'No se pudieron consultar las evidencias. Vuelve a cargar el inventario.',
};

function Pagination({ page, pages, setPage, label }) {
  if (pages <= 1) return null;
  return <nav className={styles.pagination} aria-label={label}>
    <button type="button" className={ui.secondary} disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft size={16} aria-hidden="true" />Anterior</button>
    <span>Página {page} de {pages}</span>
    <button type="button" className={ui.secondary} disabled={page === pages} onClick={() => setPage(page + 1)}>Siguiente<ChevronRight size={16} aria-hidden="true" /></button>
  </nav>;
}

export default function Prediccion({ products = EMPTY, sales = EMPTY, salesEnabled = false,
  status = 'ready', historyAccess, predictionEvidence, evidenceState, asOf, initialHorizon = 7,
  predictionControls, predictionNotice }) {
  const id = useId();
  const [openedAt, setOpenedAt] = useState(() => new Date().toISOString());
  useEffect(() => {
    if (asOf) return;
    // Roll the closed-day cutoff after Lima midnight without another HTTP read.
    const timer = window.setInterval(() => {
      const now = new Date().toISOString();
      setOpenedAt(previous => limaDate(previous) === limaDate(now) ? previous : now);
    }, 60000);
    return () => window.clearInterval(timer);
  }, [asOf]);
  const snapshotAt = asOf ?? openedAt;
  const [horizon, setHorizon] = useState(initialHorizon === 30 ? 30 : 7);
  const [forecastPage, setForecastPage] = useState(1);
  // Stock/label edits update presentation without repeating historical backtests.
  const catalogKey = Array.isArray(products) ? JSON.stringify(products.map(product => ({ id: product?.id, isActive: product?.isActive !== false }))) : 'null';
  const view = useMemo(() => preparePredictionView({ products: JSON.parse(catalogKey), sales,
    salesEnabled, status, historyAccess, asOf: snapshotAt, evidence: predictionEvidence, evidenceState }),
  [catalogKey, sales, salesEnabled, status, historyAccess, snapshotAt, predictionEvidence, evidenceState]);
  const result = useMemo(() => evaluatePredictionView(view, horizon), [view, horizon]);
  const current = Array.isArray(products) ? products.filter(product => Number.isSafeInteger(product?.id) && product.id > 0) : [];
  const byId = new Map(result.forecasts.map(row => [row.productId, row]));
  const state = predictionAvailability(result, new Set(current.map(product => product.id)));
  const description = state === 'access_denied' && evidenceState === 'access_denied' && historyAccess !== 'denied'
    ? 'La sesión no tiene permiso para consultar las evidencias de predicción.' : descriptions[state];
  const eligible = current.filter(product => product.isActive !== false && byId.get(product.id)?.eligible);
  const forecastPages = Math.max(1, Math.ceil(eligible.length / 12));
  const activeForecastPage = Math.min(forecastPage, forecastPages);
  const visibleForecasts = eligible.slice((activeForecastPage - 1) * 12, activeForecastPage * 12);
  const period = byId.get(eligible[0]?.id);

  if (view.state === 'loading') return <>{predictionControls && <div className={styles.loadingControls}>{predictionControls}</div>}<InventoryLoading label="Cargando predicción de demanda" /></>;
  return <div className={`${s.page} ${ui.workspace} ${styles.workspace}`}>
    {predictionNotice}
    <header className={`${s.header} ${ui.heading} ${styles.heading}`}>
      <div><h1>Predicción de demanda</h1></div>
      <div className={styles.toolbar}>
        {predictionControls}
        <label className={styles.horizon} htmlFor={`${id}-horizon`}>Horizonte
          <select id={`${id}-horizon`} value={horizon} onChange={event => {
            setHorizon(Number(event.target.value)); setForecastPage(1);
          }}><option value={7}>7 días</option><option value={30}>30 días</option></select>
        </label>
      </div>
    </header>
    {period ? <section aria-label={`Pronósticos a ${horizon} días`}>
      <p className={styles.summary} role="status" data-prediction-state={state}>
        <strong>Predicciones disponibles</strong>
        <span>{eligible.length === 1 ? '1 producto con pronóstico' : `${eligible.length} productos con pronóstico`}</span>
      </p>
      <div className={styles.grid}>{visibleForecasts.map(product => {
        const forecast = byId.get(product.id);
        const risk = estimateStockout(forecast, product.stock);
        return <article key={product.id} className={styles.card} data-horizon={forecast.horizon}>
          <header className={styles.product}><h2>{product.name}</h2></header>
          <dl className={styles.metrics}>
            <div className={styles.demand}>
              <dt>Demanda prevista <span className={styles.horizonBadge}>{forecast.horizon} días</span></dt>
              <dd>{numbers.format(forecast.estimatedDemand)} <span>unidades</span></dd>
            </div>
            <div className={styles.stock}><dt>Stock:</dt><dd>{Number.isSafeInteger(product.stock) && product.stock >= 0 ? numbers.format(product.stock) : 'No disponible'}</dd></div>
            <div className={styles.stock}><dt><span className={styles.stockSeparator} aria-hidden="true">·</span>Mínimo:</dt><dd>{Number.isSafeInteger(product.minStock) && product.minStock >= 0 ? numbers.format(product.minStock) : 'No disponible'}</dd></div>
            <div className={styles.risk}><dt><Clock size={13} aria-hidden="true" /> Agotamiento</dt><dd data-risk={risk.state}>{risk.state === 'within_horizon'
              ? risk.days === 0 ? 'Sin stock' : risk.days < 1 ? 'Menos de 1 día' : `≈ ${daysFormat.format(risk.days)} días`
              : risk.state === 'beyond_horizon' ? 'Fuera del horizonte' : 'No estimable'}</dd></div>
          </dl>
          <footer className={styles.cardDetails}>
            <span>SKU: {product.sku}</span>
            <span>Método: {methodLabels[forecast.method] ?? 'No disponible'}</span>
          </footer>
        </article>;
      })}</div>
      <footer className={styles.notes}>
        <p>Corte al <time dateTime={period.cutoff}>{dateLabel(period.cutoff)}</time> · Del <time dateTime={period.from}>{dateLabel(period.from)}</time> al <time dateTime={period.to}>{dateLabel(period.to)}</time> · Días completos de America/Lima</p>
        <p>{!predictionNotice && 'Estimación basada en ventas observadas. '}El agotamiento supone consumo uniforme y la fecha puede variar.</p>
        {visibleForecasts.some(product => byId.get(product.id).method === 'zero_baseline') &&
          <p>La estimación de cero se limita a este horizonte y no descarta ventas futuras.</p>}
      </footer>
      <Pagination page={activeForecastPage} pages={forecastPages} setPage={setForecastPage} label="Paginación de pronósticos" />
    </section> : <section className={styles.availability}
      role={['processing_error', 'connection_error', 'invalid_evidence', 'evidence_error'].includes(state) ? 'alert' : 'status'} aria-live="polite" data-prediction-state={state}>
      <CircleAlert size={22} aria-hidden="true" />
      <h2>Predicciones no disponibles</h2>
      <p>{description}</p>
    </section>}
  </div>;
}
