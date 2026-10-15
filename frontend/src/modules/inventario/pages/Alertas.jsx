import { useEffect, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Bell, CircleCheck, AlertTriangle, PackageX, ClipboardCheck, RefreshCw } from 'lucide-react';
import { loadPendingDifferences } from '../api/inventoryApi';
import { buildAlerts, filterAlerts, STOCK_LABELS } from './alertsData';
import s from './Management.module.css';
import ui from './InventoryUI.module.css';
import styles from './Alertas.module.css';

const priorities = { critica: 'Crítica', alta: 'Alta', media: 'Media' };
const labels = { ...STOCK_LABELS, diferencia: 'Diferencia pendiente' };
const icons = { agotado: PackageX, bajo: AlertTriangle, normal: CircleCheck, diferencia: ClipboardCheck };

export default function Alertas() {
  const { products = [], retry, refreshing, saving, uncertain, status = 'ready', error: inventoryError } = useOutletContext();
  const refreshInventory = useRef(retry);
  useEffect(() => { refreshInventory.current = retry; }, [retry]);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [state, setState] = useState('');
  const [priority, setPriority] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    refreshInventory.current?.();
    const controller = new AbortController();
    loadPendingDifferences(controller.signal).then(data => {
      if (!controller.signal.aborted) { setPending(data); setLoading(false); }
    }).catch(e => {
      if (!controller.signal.aborted) { setError(e.message); setPending(null); setLoading(false); }
    });
    return () => controller.abort();
  }, [attempt]);
  let result;
  let dataError = '';
  try { result = buildAlerts(products, pending || undefined); }
  catch (e) { dataError = e.message; }
  const rows = result ? filterAlerts(result.alerts, { query, category, state, priority }) : [];
  const categories = [...new Set(result?.alerts.map(a => a.category))].sort((a,b) => a.localeCompare(b, 'es'));
  const pages = Math.max(1, Math.ceil(rows.length / 20));
  const currentPage = Math.min(page, pages);
  const busy = loading || refreshing || saving || status === 'loading';
  const differencesKnown = pending?.enabled === true && !loading && !error;
  function update(setter, value) { setter(value); setPage(1); }
  function refresh() { setLoading(true); setError(''); setPending(null); setAttempt(n => n + 1); }
  return <div className={`${s.page} ${ui.workspace}`} aria-busy={busy}>
    <header className={`${s.header} ${ui.heading}`}><div><span className={ui.eyebrow}>ALMACÉN · SUPERVISIÓN DE INVENTARIO</span><h1>Alertas y notificaciones</h1><p className={s.muted}>Situaciones que requieren atención, calculadas desde las existencias y los conteos registrados.</p></div><button className={ui.secondary} disabled={busy || uncertain} onClick={refresh}><RefreshCw size={16} aria-hidden="true" />{busy ? 'Actualizando…' : 'Actualizar'}</button></header>
    {uncertain && <p className={ui.notice} role="status">Hay un movimiento pendiente de confirmar. Resuélvelo en <Link to="/dashboard/existencias">Existencias</Link> antes de actualizar el stock de referencia de las alertas.</p>}
    {busy && <p className={ui.notice} role="status">Consultando información actual de inventario…</p>}
    {(error || inventoryError || dataError) && <div className={ui.alert} role="alert">{error || inventoryError || dataError} Las diferencias no disponibles no se interpretan como cero.</div>}
    {pending?.enabled === false && <p className={ui.notice} role="status">Las diferencias pendientes requieren habilitar las tablas y políticas de Inventario físico (Fase 5). Las alertas de stock siguen disponibles.</p>}
    <section className={`${styles.cards} ${ui.summary}`} aria-label="Resumen de alertas">
      {[['normal','Productos normales',CircleCheck],['bajo','Stock bajo',AlertTriangle],['agotado','Agotados',PackageX],['diferencias','Diferencias pendientes',ClipboardCheck]].map(([key,label,Icon]) => <article key={key} data-state={key} className={styles.card}><div><Icon size={20} aria-hidden="true" />{label}</div><strong>{key === 'diferencias' && !differencesKnown || !result ? '—' : result.summary[key]}</strong><span>{key === 'diferencias' ? 'Productos con diferencias en sesiones abiertas' : 'Productos del catálogo actual'}</span></article>)}
    </section>
    <div className={`${s.filters} ${ui.filters}`}>
      <label className={s.field}>Buscar nombre o SKU<input type="search" value={query} onChange={e => update(setQuery,e.target.value)} placeholder="Nombre o SKU" /></label>
      <label className={s.field}>Estado<select value={state} onChange={e => update(setState,e.target.value)}><option value="">Todos los que requieren atención</option>{['agotado','bajo','diferencia'].map(key => <option key={key} value={key}>{labels[key]}</option>)}</select></label>
      <label className={s.field}>Categoría<select value={category} onChange={e => update(setCategory,e.target.value)}><option value="">Todas</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
      <label className={s.field}>Prioridad<select value={priority} onChange={e => update(setPriority,e.target.value)}><option value="">Todas</option>{Object.entries(priorities).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    </div>
    <p className={s.muted} role="status">{rows.length} alertas · Ordenadas por prioridad · {differencesKnown ? 'Diferencias consultadas' : 'Diferencias sin confirmar'}</p>
    <div className={`${s.tableWrap} ${ui.tableSurface}`} role="region" aria-label="Listado de alertas" tabIndex={0}>
      {rows.length ? <table className={`${s.table} ${styles.table}`}><caption className={styles.srOnly}>Alertas de stock y diferencias pendientes de revisión</caption><thead><tr>{['Producto / SKU','Estado','Prioridad','Stock / Mínimo','Atención sugerida','Consulta'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{rows.slice((currentPage-1)*20,currentPage*20).map(a => {
        const Icon = icons[a.state];
        return <tr key={a.id}><td><strong>{a.name}</strong><p>{a.sku} · {a.category}</p></td><td><span className={styles.badge} data-state={a.state}><Icon size={15} aria-hidden="true" />{labels[a.state]}</span></td><td>{priorities[a.priority]}</td><td>{a.state === 'diferencia' ? 'Ver referencias de cada conteo' : `${a.stock} / ${a.minimum}`}</td><td>{a.state === 'diferencia' ? <details><summary>Revisar {a.counts.length} conteo(s)</summary>{a.counts.map(c => <p key={c.session_id}><strong>{c.delta > 0 ? '+' : ''}{c.delta}</strong> · Referencia {c.reference_stock}, físico {c.physical_quantity}<br />Sesión {c.session_id} · {c.session.status} · {c.session.actor_email}</p>)}</details> : a.suggested > 0 ? `${a.suggested} unidades estimadas de reposición` : a.state === 'agotado' && a.minimum === 0 ? 'Revisar reposición; mínimo configurado en cero' : 'En el mínimo; revisar reposición (estimación: 0)'}</td><td><Link to={a.state === 'diferencia' ? '/dashboard/inventario-fisico' : `/dashboard/existencias?q=${encodeURIComponent(a.sku)}`}>{a.state === 'diferencia' ? 'Ver conteos' : 'Ver existencias'}</Link></td></tr>;
      })}</tbody></table> : <div className={`${s.empty} ${ui.emptyState}`}><Bell aria-hidden="true" /><h2>{busy ? 'Cargando alertas' : error || dataError || inventoryError ? 'Consulta incompleta' : result?.alerts.length ? 'No hay coincidencias' : 'No hay alertas de stock'}</h2><p className={s.muted}>{query || category || state || priority ? 'Ajusta los filtros para consultar otras alertas.' : 'Las alertas aparecerán automáticamente cuando los datos requieran atención.'}</p></div>}
    </div>
    <nav className={ui.pagination} aria-label="Paginación de alertas"><button className={ui.secondary} disabled={currentPage <= 1} onClick={() => setPage(currentPage-1)}>Anterior</button><span>Página {currentPage} de {pages}</span><button className={ui.secondary} disabled={currentPage >= pages} onClick={() => setPage(currentPage+1)}>Siguiente</button></nav>
  </div>;
}
