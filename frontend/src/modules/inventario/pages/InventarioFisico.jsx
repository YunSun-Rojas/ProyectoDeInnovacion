import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { CircleCheck, Clock3, AlertTriangle, Plus, RefreshCw, Save, Send, ArrowLeft, ArrowRight } from 'lucide-react';
import { listPhysicalCounts, physicalCount } from '../api/inventoryApi';
import { countIssue, difference, reviewIssue, summarizeCount } from './physicalData';
import s from './Management.module.css';
import ui from './InventoryUI.module.css';

const statusLabel = status => ({ borrador: 'Borrador', 'en revisión': 'En revisión', finalizado: 'Confirmada', cancelado: 'Cancelada' }[status] || status);
const sessionDate = date => {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? 'Fecha no disponible' : parsed.toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' });
};
function sessionLabel(session, sessions) {
  const label = `${sessionDate(session.created_at)} · ${statusLabel(session.status)}`;
  return sessions.filter(x => sessionDate(x.created_at) === sessionDate(session.created_at) && x.status === session.status).length > 1
    ? `${label} · ${session.id.slice(-8)}` : label;
}

export default function InventarioFisico() {
  const { retry, readOnly } = useOutletContext();
  const [sessions, setSessions] = useState([]);
  const [current, setCurrent] = useState(null);
  const [lines, setLines] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [operation, setOperation] = useState('');
  const [dirty, setDirty] = useState(false);
  const [observation, setObservation] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('todos');
  const [page, setPage] = useState(1);
  const [conflicts, setConflicts] = useState([]);
  const [pending, setPending] = useState(null);
  const lock = useRef(false);
  const dialog = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    listPhysicalCounts(controller.signal).then(data => { setSessions(data.sessions); setLoadingSessions(false); }).catch(e => { if (e.name !== 'AbortError') { setError(e.message); setLoadingSessions(false); } });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function run(request) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setOperation(request.action); setError(''); setMessage('');
    try {
      const data = await physicalCount(request);
      setPending(null);
      if (data.conflicts) { setConflicts(data.conflicts); return; }
      setCurrent(data.session); setLines(data.lines); setDirty(false); setConflicts([]); setPage(1);
      setMessage(({ save: 'Avance guardado. El stock no cambió.', create: 'Sesión de conteo creada.', review: 'Conteo enviado a revisión.', cancel: 'Sesión cancelada.', confirm: 'Ajustes confirmados.', reopen: 'Sesión abierta como borrador.', rebase: 'Referencias actualizadas.' })[request.action] || 'Sesión cargada.');
      setSessions(old => [data.session, ...old.filter(x => x.id !== data.session.id)]);
      if (data.session.status === 'finalizado') retry();
    } catch (e) {
      setError(e.message);
      if (e.uncertain) setPending(request); else setPending(null);
    } finally { lock.current = false; setBusy(false); setOperation(''); }
  }
  async function refreshSessions() {
    if (lock.current || pending) return;
    lock.current = true; setBusy(true); setError('');
    try { setSessions((await listPhysicalCounts()).sessions); }
    catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(false); }
  }
  function action(name) {
    if (lock.current || !current || pending || readOnly) return;
    const issue = name === 'review' ? reviewIssue({ current, lines, readOnly, pending, busy, dirty, conflicts })
      : name === 'save' ? (current.status !== 'borrador' ? 'Selecciona una sesión editable.' : countIssue(lines)) : '';
    if (issue) { setError(issue); return; }
    if (['reopen', 'confirm'].includes(name) && current.status !== 'en revisión') return;
    if (name === 'confirm' && conflicts.length) return;
    if (name === 'cancel' && (dirty || ['finalizado', 'cancelado'].includes(current.status))) return;
    return run({ action: name, id: current.id, revision: current.revision,
      data: name === 'save' ? { lines: lines.map(l => ({ productId: l.product_id, quantity: l.physical_quantity === '' ? null : l.physical_quantity, reason: l.reason })) } : {} });
  }
  function edit(id, key, value) {
    if (lock.current || !editable) return;
    setLines(old => old.map(l => l.product_id === id ? { ...l, [key]: value } : l)); setDirty(true);
  }
  const summary = summarizeCount(lines);
  const editable = current?.status === 'borrador' && !readOnly && !pending;
  const reviewHelp = reviewIssue({ current, lines, readOnly, pending, busy, dirty, conflicts });
  const saveHelp = countIssue(lines);
  const filtered = lines.filter(l => `${l.sku} ${l.product_name}`.toLowerCase().includes(query.toLowerCase()) &&
    (filter === 'todos' || (filter === 'pendientes' ? difference(l) === null : filter === 'faltantes' ? difference(l) !== null && difference(l) < 0 : filter === 'sobrantes' ? difference(l) !== null && difference(l) > 0 : difference(l) === 0)));
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const visiblePage = Math.min(page, pages);
  return <div className={`${s.page} ${ui.workspace} ${s.physicalPage}`} aria-busy={busy}>
    <header className={`${s.header} ${ui.heading}`}><div><h1>Inventario físico</h1></div></header>
    {error && <p role="alert" className={ui.alert}>{error}</p>}
    {message && <p role="status" className={ui.notice}>{message}</p>}
    {pending && <div className={ui.alert}>La respuesta no está confirmada. Reintenta la misma solicitud para recuperar el resultado.<button className={ui.secondary} disabled={busy} onClick={() => run(pending)}>Reintentar operación</button></div>}
    <section className={`${s.card} ${s.countSession}`} aria-labelledby="count-session-title">
      <div className={s.countSessionHeading}><h2 id="count-session-title">Sesión de conteo</h2><button className={`${ui.secondary} ${ui.savingButton}`} aria-busy={busy && !operation} disabled={busy || !!pending || loadingSessions} onClick={refreshSessions}><RefreshCw size={15} aria-hidden="true" />Actualizar historial</button></div>
      <fieldset disabled={busy || dirty || !!pending || loadingSessions} className={s.countSessionFields}>
        <div className={ui.productFilters}><label className={`${s.field} ${s.countSelect}`}>Sesiones anteriores<select value={current?.id || ''} onChange={e => e.target.value && run({ action: 'get', id: e.target.value })}><option value="">{loadingSessions ? 'Cargando sesiones…' : 'Seleccionar sesión'}</option>{sessions.map(x => <option key={x.id} value={x.id}>{sessionLabel(x, sessions)}</option>)}</select></label></div>
        {current && <div className={s.countSessionMeta}><span className={s.countBadge}>{statusLabel(current.status)}</span><span>{sessionDate(current.created_at)}</span>{current.observation && <p>{current.observation}</p>}</div>}
        <div className={s.countNew}><label className={s.field}>Observación del nuevo conteo <span className={s.muted}>Opcional</span><input maxLength={500} value={observation} onChange={e => setObservation(e.target.value)} /></label>
        <button className={`${ui.primary} ${ui.savingButton}`} aria-busy={busy && operation === 'create'} disabled={readOnly} onClick={() => { if (!lock.current && !dirty && !pending && !readOnly) run({ action: 'create', id: crypto.randomUUID(), data: { observation } }); }}><Plus size={16} aria-hidden="true" />{operation === 'create' ? 'Creando…' : 'Crear conteo'}</button></div>
      </fieldset>
    </section>
    {current && <>
      <section aria-label="Resumen del conteo" className={s.countSummary}>
        <div className={s.countCards}>{[['Contados',summary.counted,CircleCheck,'Productos revisados','counted'],['Pendientes',summary.pending,Clock3,'Faltan por contar','pending'],['Diferencias',summary.differences,AlertTriangle,'Requieren revisión',summary.differences ? 'differences' : 'neutral']].map(([label,n,Icon,help,tone]) => <article className={s.countMetric} data-tone={tone} key={label}><div><Icon size={30} aria-hidden="true" /><span>{label}</span></div><strong>{n}</strong><p>{help}</p></article>)}</div>
        <label className={s.countProgress}>{summary.counted} de {lines.length} productos contados<progress max={lines.length || 1} value={summary.counted} /></label>
      </section>
      {dirty && <p role="status" className={ui.notice}>Hay cambios sin guardar. Guarda el avance antes de cambiar de sesión o módulo.</p>}
      {conflicts.length > 0 && <div role="alert" className={ui.alert}><p>El stock o la versión cambiaron. No se aplicó ningún ajuste. Actualiza las referencias y vuelve a contar los productos afectados.</p>{conflicts.map(c => <p key={c.sku}>{c.sku}: referencia {c.reference}, vigente {c.current}</p>)}<button className={ui.secondary} disabled={busy || !!pending} onClick={() => action('rebase')}>Actualizar referencias y exigir nuevo conteo</button></div>}
      <div className={`${s.filters} ${ui.filters} ${ui.productFilters} ${s.countFilters}`}><label className={s.field}>Buscar SKU o producto<input type="search" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} /></label><label className={s.field}>Resultado<select value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}><option value="todos">Todos</option><option value="pendientes">Pendientes</option><option value="coincidencias">Sin diferencia</option><option value="faltantes">Faltantes</option><option value="sobrantes">Sobrantes</option></select></label></div>
      <div className={`${s.tableWrap} ${ui.tableSurface}`}><table className={`${s.table} ${s.countTable}`}><thead><tr>{['SKU / Producto','Referencia','Cantidad física','Diferencia','Motivo del ajuste'].map(x => <th key={x} scope="col">{x}</th>)}</tr></thead><tbody>{filtered.slice((visiblePage-1)*20,visiblePage*20).map(l => {
        const delta = difference(l);
        const requiresReason = delta !== null && delta !== 0;
        return <tr key={l.product_id}><td><strong>{l.product_name}</strong><p>{l.sku}</p></td><td>{l.reference_stock}</td><td><input aria-label={`Cantidad física ${l.sku}`} type="number" min="0" max="2147483647" step="1" disabled={!editable || busy} value={l.physical_quantity ?? ''} placeholder="Sin contar" onChange={e => { const v=e.target.value; if (v === '' || (Number.isInteger(Number(v)) && Number(v)>=0 && Number(v)<=2147483647)) edit(l.product_id,'physical_quantity',v === '' ? null : Number(v)); }} /></td><td><span className={s.countBadge} data-result={delta === null ? 'pending' : delta === 0 ? 'equal' : delta > 0 ? 'surplus' : 'shortage'}>{delta === null ? 'Pendiente' : delta === 0 ? 'Sin diferencia' : `${delta > 0 ? '+' : ''}${delta} · ${delta > 0 ? 'Sobrante' : 'Faltante'}`}</span></td><td><input aria-label={`Motivo ${l.sku}`} aria-required={requiresReason} aria-invalid={requiresReason && !l.reason.trim()} placeholder={requiresReason ? 'Motivo obligatorio' : 'Opcional'} maxLength={400} disabled={!editable || busy} value={l.reason} onChange={e => edit(l.product_id,'reason',e.target.value)} /></td></tr>;
      })}</tbody></table>{!filtered.length && <p className={s.empty}>No hay productos para mostrar.</p>}</div>
      {pages > 1 && <nav className={ui.pagination} aria-label="Páginas del conteo"><button className={ui.secondary} disabled={visiblePage<=1} onClick={() => setPage(visiblePage-1)}><ArrowLeft size={16} aria-hidden="true" />Anterior</button><span>Página {visiblePage} de {pages}</span><button className={ui.secondary} disabled={visiblePage>=pages} onClick={() => setPage(visiblePage+1)}>Siguiente<ArrowRight size={16} aria-hidden="true" /></button></nav>}
      <div className={s.countActions}>
        <button className={ui.secondary} disabled={busy || !!pending} onClick={() => run({ action: 'get', id: current.id })}>Descartar cambios locales y recargar sesión</button>
        {editable && <div className={s.countMainActions}><button className={`${dirty ? ui.primary : ui.secondary} ${ui.savingButton}`} aria-busy={operation === 'save'} disabled={busy || !dirty || !!saveHelp} onClick={() => action('save')}><Save size={16} aria-hidden="true" />{operation === 'save' ? 'Guardando…' : 'Guardar avance'}</button><button className={`${dirty ? ui.secondary : ui.primary} ${ui.savingButton}`} aria-describedby={reviewHelp ? 'count-review-help' : undefined} aria-busy={operation === 'review'} disabled={!!reviewHelp} onClick={() => action('review')}><Send size={16} aria-hidden="true" />{operation === 'review' ? 'Enviando…' : 'Enviar a revisión'}</button></div>}
        {current.status === 'en revisión' && !readOnly && <><button className={ui.secondary} disabled={busy || !!pending} onClick={() => action('reopen')}>Volver a borrador</button><button className={ui.primary} disabled={busy || !!pending || conflicts.length>0} onClick={() => dialog.current.showModal()}>Confirmar ajustes</button></>}
        {!['finalizado','cancelado'].includes(current.status) && <button className={ui.secondary} disabled={busy || dirty || !!pending || readOnly} onClick={() => action('cancel')}>Cancelar sesión</button>}
      </div>
      {editable && (saveHelp || reviewHelp) && <p id="count-review-help" className={`${s.muted} ${s.countHelp}`}>{saveHelp || reviewHelp}</p>}
      <dialog ref={dialog} className={ui.compactDialog} aria-labelledby="confirm-count-title"><h2 id="confirm-count-title">Confirmar inventario físico</h2><p>Se comprobará el stock vigente de todos los productos. Se registrarán {summary.differences} ajustes de forma atómica. Una sesión finalizada no admite cambios.</p><p>Verifica las cantidades y los motivos antes de continuar.</p><button className={ui.secondary} onClick={() => dialog.current.close()}>Volver</button> <button className={ui.primary} onClick={() => { dialog.current.close(); action('confirm'); }}>Confirmar y finalizar</button></dialog>
    </>}
  </div>;
}
