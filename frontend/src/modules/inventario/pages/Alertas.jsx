import { useEffect, useRef, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { Bell, AlertTriangle, PackageX, ClipboardCheck, RefreshCw, ArrowLeft, ArrowRight } from 'lucide-react';
import InventoryLoading from '../components/InventoryLoading';
import { loadPendingDifferences } from '../api/inventoryApi';
import { buildAlerts, filterAlerts, STOCK_LABELS } from './alertsData';
import s from './Management.module.css';
import ui from './InventoryUI.module.css';
import styles from './Alertas.module.css';

const priorities = { critica: 'Crítica', alta: 'Alta', media: 'Media' };
const labels = { ...STOCK_LABELS, diferencia: 'Diferencia pendiente' };
const icons = { agotado: PackageX, bajo: AlertTriangle, diferencia: ClipboardCheck };

export default function Alertas() {
  const { products = [], retry, refreshing, saving, uncertain, readOnly, stockEnabled, status = 'ready', error: inventoryError } = useOutletContext() || {};
  const [params, setParams] = useSearchParams();
  const refreshInventory = useRef(retry);
  useEffect(() => { refreshInventory.current = retry; }, [retry]);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const state = ['agotado', 'bajo', 'diferencia'].includes(params.get('estado')) ? params.get('estado') : '';
  function setState(value) { setParams(previous => { const next = new URLSearchParams(previous); if (value) next.set('estado', value); else next.delete('estado'); return next; }); }
  const [priority, setPriority] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    refreshInventory.current?.();
    const controller = new AbortController();
    loadPendingDifferences(controller.signal).then(data => {
      if (!controller.signal.aborted) { setPending(data); setLoading(false); }
    }).catch(e => {
      if (!controller.signal.aborted) { setError(e.message); setLoading(false); }
    });
    return () => controller.abort();
  }, [attempt]);
  let result;
  let dataError = '';
  try { result = buildAlerts(products, pending || undefined); }
  catch (e) { dataError = e.message; }
  const rows = result ? filterAlerts(result.alerts, { query, category, state, priority }) : [];
  const categories = [...new Set([...products.map(p => p.category), ...(result?.alerts.map(a => a.category) || [])].filter(Boolean))].sort((a,b) => a.localeCompare(b, 'es'));
  const pages = Math.max(1, Math.ceil(rows.length / 20));
  const currentPage = Math.min(page, pages);
  const busy = loading || refreshing || saving || status === 'loading';
  const differencesKnown = pending?.enabled === true && !loading && !error;
  const canRegister = stockEnabled && !readOnly && !saving && !uncertain && status === 'ready';
  function update(setter, value) { setter(value); setPage(1); }
  function refresh() { setLoading(true); setError(''); setAttempt(n => n + 1); }
  function clearFilters() { setQuery(''); setCategory(''); setState(''); setPriority(''); setPage(1); }
  if (status === 'loading') return <InventoryLoading label="Cargando alertas…" />;
  return <div className={`${s.page} ${ui.workspace} ${styles.workspace}`} aria-busy={busy}>
    <header className={`${s.header} ${ui.heading} ${styles.heading}`}><div><h1>Alertas y notificaciones</h1></div><button className={ui.secondary} aria-busy={Boolean(busy)} disabled={busy || uncertain} onClick={refresh}>{busy ? <InventoryLoading compact label="Actualizando…" /> : <RefreshCw size={16} aria-hidden="true" />}{busy ? 'Actualizando…' : 'Actualizar'}</button></header>
    {uncertain && <p className={ui.notice} role="status">Hay un movimiento pendiente de confirmar. Resuélvelo en <Link to="/dashboard/existencias">Existencias</Link> antes de actualizar el stock de referencia de las alertas.</p>}
    {(error || inventoryError || dataError) && <div className={ui.alert} role="alert">{error || inventoryError || dataError} Las diferencias no disponibles no se interpretan como cero.</div>}
    {pending?.enabled === false && <p className={ui.notice} role="status">Las diferencias pendientes requieren habilitar las tablas y políticas de Inventario físico (Fase 5). Las alertas de stock siguen disponibles.</p>}
    <section className={`${styles.cards} ${ui.summary}`} aria-label="Resumen de alertas">
      {[['bajo','Stock bajo',AlertTriangle],['agotado','Agotados',PackageX],['diferencias','Diferencias pendientes',ClipboardCheck]].map(([key,label,Icon]) => <article key={key} data-state={key} className={styles.card}><div><Icon size={20} aria-hidden="true" />{label}</div><strong>{key === 'diferencias' && (!pending || pending.enabled === false) || !result ? '—' : result.summary[key]}</strong></article>)}
    </section>
    <div className={`${s.filters} ${ui.filters} ${ui.productFilters} ${styles.filters}`}>
      <label className={s.field}>Buscar producto o SKU<input type="search" value={query} onChange={e => update(setQuery,e.target.value)} placeholder="Nombre o SKU" /></label>
      <label className={s.field}>Estado<select value={state} onChange={e => update(setState,e.target.value)}><option value="">Todos los que requieren atención</option><option value="bajo">Stock bajo</option><option value="agotado">Agotados</option><option value="diferencia">Diferencias pendientes</option></select></label>
      <label className={s.field}>Categoría<select value={category} onChange={e => update(setCategory,e.target.value)}><option value="">Todas las categorías</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
      <label className={s.field}>Prioridad<select value={priority} onChange={e => update(setPriority,e.target.value)}><option value="">Todas</option>{Object.entries(priorities).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <button className={`${ui.secondary} ${styles.clear}`} onClick={clearFilters}>Limpiar filtros</button>
    </div>
    <p className={s.muted} role="status">{rows.length} alertas  {differencesKnown ? '' : 'Diferencias sin confirmar'}</p>
    <div className={`${s.tableWrap} ${ui.tableSurface}`} role="region" aria-label="Listado de alertas" tabIndex={0}>
      {rows.length ? <table className={`${s.table} ${styles.table}`}><caption className={styles.srOnly}>Alertas de stock y diferencias pendientes de revisión</caption><thead><tr>{['Producto / SKU','Estado','Prioridad','Stock / mínimo','Atención sugerida','Acción'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{rows.slice((currentPage-1)*20,currentPage*20).map(a => {
        const Icon = icons[a.state];
        return <tr key={a.id}><td><strong>{a.name}</strong><p>{a.sku} · {a.category}</p></td><td><span className={styles.badge} data-state={a.state}><Icon size={15} aria-hidden="true" />{labels[a.state]}</span></td><td><span className={styles.priority} data-priority={a.priority}>{priorities[a.priority]}</span></td><td>{a.state === 'diferencia' ? 'Según conteo' : `${a.stock} / ${a.minimum}`}</td><td>{a.state === 'diferencia' ? `Revisar ${a.counts.length} ${a.counts.length === 1 ? 'conteo' : 'conteos'}` : a.suggested > 0 ? <span title="Cantidad estimada de reposición">Reponer {a.suggested} {a.suggested === 1 ? 'unidad' : 'unidades'}</span> : a.state === 'agotado' && a.minimum === 0 ? 'Revisar reposición; mínimo en cero' : 'En el mínimo; revisar reposición'}</td><td><Link className={`${ui.secondary} ${styles.action}`} to={a.state === 'diferencia' ? '/dashboard/inventario-fisico' : canRegister ? `/dashboard/existencias?accion=entrada&producto=${encodeURIComponent(a.productId)}` : `/dashboard/existencias?vista=productos&q=${encodeURIComponent(a.sku)}`}>{a.state === 'diferencia' ? 'Ver conteo →' : canRegister ? 'Registrar entrada →' : 'Ver existencias →'}</Link></td></tr>;
      })}</tbody></table> : <div className={`${s.empty} ${ui.emptyState}`}><Bell aria-hidden="true" /><h2>{busy ? 'Cargando alertas' : error || dataError || inventoryError || !differencesKnown ? 'Consulta incompleta' : result?.alerts.length ? 'No se encontraron alertas' : 'Todo al día'}</h2><p className={s.muted}>{busy ? 'Consultando el inventario.' : error || dataError || inventoryError || !differencesKnown ? 'Las diferencias pendientes aún no están confirmadas.' : result?.alerts.length ? 'Prueba con otros filtros' : 'No hay situaciones pendientes de atención.'}</p></div>}
    </div>
    {pages > 1 && <nav className={ui.pagination} aria-label="Paginación de alertas"><button className={ui.secondary} disabled={currentPage <= 1} onClick={() => setPage(currentPage-1)}><ArrowLeft size={16} aria-hidden="true" />Anterior</button><span>Página {currentPage} de {pages}</span><button className={ui.secondary} disabled={currentPage >= pages} onClick={() => setPage(currentPage+1)}>Siguiente<ArrowRight size={16} aria-hidden="true" /></button></nav>}
  </div>;
}
