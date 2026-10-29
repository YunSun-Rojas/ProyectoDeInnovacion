import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import InventoryLoading from '../components/InventoryLoading';
import { AlertTriangle, PackageX, RefreshCw, Plus, Info, X, BookOpen } from 'lucide-react';
import { summarizeInventory } from './dashboardData';
import { confirmedStockChange, movementQuantity, productMovements, recentStockMovements } from './existenciasData';
import { limaDay } from './kardexData';
import s from './Management.module.css';
import styles from './Existencias.module.css';
import StockDialog from '../components/StockDialog';
import ui from './InventoryUI.module.css';
import kardexStyles from './Kardex.module.css';

const integer = value => new Intl.NumberFormat('es-PE').format(value);
const recorded = value => value == null || value === '' ? 'No registrado' : value;
const movementDate = value => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima' }).format(new Date(value)) : 'No registrada';

export function StockMovementFacts({ movement, detailed = false }) {
  const facts = detailed ? [
    ['Tipo de movimiento', recorded(movement.type)], ['Stock anterior', recorded(movement.before)],
    ['Cantidad', movementQuantity(movement.quantity)], ['Stock posterior confirmado', recorded(movement.after)],
  ] : [['Anterior', recorded(movement.before)], [recorded(movement.type), movementQuantity(movement.quantity)], ['Actual', recorded(movement.after)]];
  return <><dl className={detailed ? styles.facts : styles.balance}>{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {detailed && <dl className={styles.metadata}>{[['Motivo', recorded(movement.reason)], ['Fecha y hora (Perú)', movementDate(movement.date)],
      ...(movement.user ? [['Responsable', movement.user]] : []), ...(movement.id != null ? [['N.º de movimiento', movement.id]] : [])].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}</>;
}

export function StockHistoryDialog({ product, movements, initialMovement, onClose }) {
  const dialog = useRef(null);
  const dismiss = useRef(null);
  const id = useId();
  const [selected, setSelected] = useState(initialMovement ?? null);
  const [closing, setClosing] = useState(false);
  const [page, setPage] = useState(1);
  const rows = productMovements(movements, product.id);
  const pages = Math.max(1, Math.ceil(rows.length / 20));
  const currentPage = Math.min(page, pages);
  useEffect(() => {
    const element = dialog.current, trigger = document.activeElement, overflow = document.body.style.overflow;
    element.showModal(); dismiss.current?.focus(); document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = overflow; if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    if (!closing) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onClose(); return; }
    const timer = window.setTimeout(onClose, 180);
    return () => window.clearTimeout(timer);
  }, [closing, onClose]);
  return <dialog ref={dialog} className={`${s.accountDialog} ${ui.compactDialog} ${styles.stockDialog} ${closing ? styles.closing : ''}`}
    aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); setClosing(true); }}
    onAnimationEnd={event => { if (closing && event.target === event.currentTarget) onClose(); }}>
    <header className={ui.dialogHeading}><div><h2 id={`${id}-title`}>{selected ? 'Detalle del movimiento' : 'Movimientos del producto'}</h2><p className={s.muted}>{selected ? recorded(selected.product) : product.name} · SKU {selected ? recorded(selected.sku) : product.sku}</p></div>
      <button ref={dismiss} type="button" className={ui.close} aria-label="Cerrar detalle de movimientos" onClick={() => setClosing(true)}><X size={18} aria-hidden="true" /></button></header>
    {selected ? <><StockMovementFacts movement={selected} detailed />{!initialMovement && <button type="button" className={ui.secondary} onClick={() => { setSelected(null); dismiss.current?.focus(); }}>Volver a los movimientos</button>}</>
      : rows.length ? <><ul className={styles.historyList}>{rows.slice((currentPage - 1) * 20, currentPage * 20).map((movement, index) => <li key={movement.id ?? index}>
        <div><strong>{recorded(movement.type)} · {movementQuantity(movement.quantity)}</strong><small>{movementDate(movement.date)}</small></div>
        <button type="button" className={ui.secondary} aria-label={`Ver detalle del movimiento ${movement.id ?? index + 1}`} onClick={() => { setSelected(movement); dismiss.current?.focus(); }}>Ver detalle</button>
      </li>)}</ul>{pages > 1 && <nav className={ui.pagination} aria-label="Paginación de movimientos del producto"><button className={ui.secondary} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Anterior</button><span>Página {currentPage} de {pages}</span><button className={ui.secondary} disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Siguiente</button></nav>}</>
        : <p className={ui.notice}>No hay movimientos disponibles para este producto. Los registros sin una relación verificable no se muestran aquí.</p>}
    {selected?.productId != null && <Link className={`${ui.secondary} ${styles.detailKardex}`} to={`/dashboard/kardex?producto=${encodeURIComponent(selected.productId)}`}>Ver en Kardex →</Link>}
  </dialog>;
}

export default function Existencias() {
  const { products = [], movements = [], defaultMinStock = 5, status, error, retry,
    stockEnabled, readOnly, saving, refreshing, uncertain, writeError, onStock, retryWrite, notify, getConfirmedChange } = useOutletContext();
  const [params, setParams] = useSearchParams();
  const requestedAction = params.get('accion') === 'entrada'
    ? 'stock_in'
    : params.get('accion') === 'salida'
      ? 'stock_out'
      : '';
  const entryProduct = params.get('accion') === 'entrada' ? products.find(product => String(product.id) === params.get('producto')) : null;
  const [stockOpen, setStockOpen] = useState(() => Boolean(
    (entryProduct || requestedAction) && stockEnabled && !readOnly && !saving && !uncertain && products.length
  ));
  const [confirmedMovement, setConfirmedMovement] = useState(null);
  const [highlightedId, setHighlightedId] = useState(null);
  const [history, setHistory] = useState(null);
  const [today, setToday] = useState(() => limaDay(new Date()));
  useEffect(() => {
    let timer;
    function updateDay() {
      window.clearTimeout(timer);
      const now = new Date(), day = limaDay(now);
      setToday(day);
      timer = window.setTimeout(updateDay, Math.max(50, Date.parse(`${day}T00:00:00-05:00`) + 86400000 - now.getTime() + 50));
    }
    updateDay();
    window.addEventListener('focus', updateDay);
    document.addEventListener('visibilitychange', updateDay);
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', updateDay); document.removeEventListener('visibilitychange', updateDay); };
  }, []);
  const previousRequest = useRef(null);
  useEffect(() => { if (stockOpen && !saving && writeError) notify?.(writeError, 'error'); }, [stockOpen, saving, writeError, notify]);
  useEffect(() => {
    if (highlightedId == null || stockOpen) return;
    const timer = window.setTimeout(() => setHighlightedId(null), 2400);
    return () => window.clearTimeout(timer);
  }, [highlightedId, stockOpen]);
  const latest = useMemo(() => readOnly ? [] : recentStockMovements(movements, products, confirmedMovement, today), [movements, products, readOnly, confirmedMovement, today]);
  const summary = useMemo(() => summarizeInventory(products, defaultMinStock), [products, defaultMinStock]);
  function closeStock() { setStockOpen(false); setParams(previous => { const next = new URLSearchParams(previous); next.delete('accion'); next.delete('producto'); return next; }, { replace: true }); }
  if (status === 'loading') return <InventoryLoading label="Cargando existencias…" />;
  if (status === 'error') return <div className={s.page}><p className={s.formError} role="alert">{error}</p><button className={s.button} onClick={retry}>Reintentar</button></div>;
  return <div className={`${s.page} ${ui.workspace} ${styles.workspace}`}>
    <header className={`${s.header} ${ui.heading} ${styles.heading}`}><div><h1 className={s.title}>Control de existencias</h1></div><div className={s.companyActions}><button className={`${ui.secondary} ${styles.refreshButton}`} aria-busy={Boolean(refreshing)} disabled={saving || uncertain} onClick={retry}><RefreshCw size={15} aria-hidden="true" />{refreshing ? 'Actualizando…' : 'Actualizar'}</button><button className={ui.primary} disabled={readOnly || !stockEnabled || saving || uncertain || !products.length} onClick={() => { previousRequest.current = getConfirmedChange?.()?.requestId; setStockOpen(true); }}><Plus size={16} aria-hidden="true" />Registrar movimiento</button></div></header>
    {!stockEnabled && <p className={ui.notice} role="status"><Info size={16} aria-hidden="true" />Entradas, salidas y ajustes por cantidad pendientes de habilitar mediante la migración SQL de Fase 3.</p>}
    {!stockOpen && writeError && <p className={ui.alert} role="alert">{writeError}</p>}
    {!stockOpen && uncertain && <button className={s.button} disabled={saving} onClick={retryWrite}>Reintentar guardado pendiente</button>}
    <section className={`${styles.cards} ${ui.summary}`} aria-label="Resumen de existencias del almacén">
      {[
        ['Productos con stock bajo', summary.low, AlertTriangle, 'bajo'], ['Productos agotados', summary.empty, PackageX, 'agotado'],
      ].map(([label, value, Icon, filter]) => <article className={`${s.card} ${styles.summaryCard}`} key={label}><Link className={styles.cardLink} to={`/dashboard/alertas?estado=${filter}`}><div className={styles.cardLabel}><Icon size={19} aria-hidden="true" />{label}</div><strong className={s.number}>{integer(value)}</strong><span className={styles.cardAction}>Ver productos →</span></Link></article>)}
    </section>
    <section className={`${s.card} ${styles.recent}`} aria-labelledby="recent-stock-title">
      <h2 id="recent-stock-title">Movimientos de hoy</h2>
      {latest.length ? <ul className={styles.historyList}>{latest.map((movement, index) => <li key={movement.id ?? index} className={highlightedId != null && String(movement.id) === String(highlightedId) ? styles.highlighted : undefined}>
        <div className={styles.movementName}><strong>{recorded(movement.product)}</strong><span>{movement.type} · <strong>{movementQuantity(movement.quantity)}</strong></span></div>
        <button type="button" className={ui.secondary} onClick={() => setHistory({ product: { id: movement.productId, name: movement.product, sku: movement.sku }, movement })}>Ver detalle</button>
      </li>)}</ul> : <div className={kardexStyles.empty}><BookOpen size={30} aria-hidden="true" /><h3>Sin movimientos registrados hoy</h3><p className={s.muted}>Registra una entrada, salida o ajuste para ver actividad aquí.</p></div>}
    </section>
    {history && <StockHistoryDialog product={history.product} movements={movements} initialMovement={history.movement} onClose={() => setHistory(null)} />}
    {stockOpen && <StockDialog products={products} initialProductId={entryProduct?.id} initialAction={requestedAction} saving={saving} uncertain={uncertain} error={writeError} onSave={(product, action, data) => { previousRequest.current = getConfirmedChange?.()?.requestId; return onStock(product, action, data); }} onRetry={retryWrite} notify={notify} onClose={closeStock} onSuccess={intent => {
      const confirmed = confirmedStockChange(getConfirmedChange?.(), intent, previousRequest.current);
      if (confirmed) { setConfirmedMovement(confirmed.movement); setHighlightedId(confirmed.movement.id); }
      notify?.('Movimiento registrado con éxito');
    }} />}
  </div>;
}
