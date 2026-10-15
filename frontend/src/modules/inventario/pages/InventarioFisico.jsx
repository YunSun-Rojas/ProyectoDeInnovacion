import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { listPhysicalCounts, physicalCount } from '../api/inventoryApi';
import { difference, summarizeCount } from './physicalData';
import s from './Management.module.css';
import ui from './InventoryUI.module.css';

export default function InventarioFisico() {
  const { retry, readOnly } = useOutletContext();
  const [sessions, setSessions] = useState([]);
  const [current, setCurrent] = useState(null);
  const [lines, setLines] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
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
    listPhysicalCounts(controller.signal).then(data => setSessions(data.sessions)).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
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
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const data = await physicalCount(request);
      setPending(null);
      if (data.conflicts) { setConflicts(data.conflicts); return; }
      setCurrent(data.session); setLines(data.lines); setDirty(false); setConflicts([]); setPage(1);
      setMessage(request.action === 'save' ? 'Avance guardado. El stock no cambió.' : 'Sesión cargada.');
      setSessions(old => [data.session, ...old.filter(x => x.id !== data.session.id)]);
      if (data.session.status === 'finalizado') retry();
    } catch (e) {
      setError(e.message);
      if (e.uncertain) setPending(request); else setPending(null);
    } finally { lock.current = false; setBusy(false); }
  }
  async function refreshSessions() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { setSessions((await listPhysicalCounts()).sessions); }
    catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(false); }
  }
  function action(name) { return run({ action: name, id: current.id, revision: current.revision,
    data: name === 'save' ? { lines: lines.map(l => ({ productId: l.product_id, quantity: l.physical_quantity, reason: l.reason })) } : {} }); }
  function edit(id, key, value) {
    setLines(old => old.map(l => l.product_id === id ? { ...l, [key]: value } : l)); setDirty(true);
  }
  const summary = summarizeCount(lines);
  const editable = current?.status === 'borrador' && !readOnly && !pending;
  const filtered = lines.filter(l => `${l.sku} ${l.product_name}`.toLowerCase().includes(query.toLowerCase()) &&
    (filter === 'todos' || (filter === 'pendientes' ? difference(l) === null : filter === 'diferencias' ? difference(l) !== null && difference(l) !== 0 : difference(l) === 0)));
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  return <div className={`${s.page} ${ui.workspace}`} aria-busy={busy}>
    <header className={`${s.header} ${ui.heading}`}><div><span className={ui.eyebrow}>ALMACÉN · FASE 5</span><h1>Inventario físico</h1><p className={s.muted}>Cuenta, revisa diferencias y confirma ajustes con trazabilidad.</p></div></header>
    {error && <p role="alert" className={ui.alert}>{error}</p>}
    {message && <p role="status" className={ui.notice}>{message}</p>}
    {pending && <div className={ui.alert}>La respuesta no está confirmada. Reintenta la misma solicitud para recuperar el resultado.<button className={ui.secondary} disabled={busy} onClick={() => run(pending)}>Reintentar operación</button></div>}
    <button className={ui.secondary} disabled={busy} onClick={refreshSessions}>Actualizar historial</button>
    <fieldset disabled={busy || dirty || !!pending} className={s.card}>
      <div className={s.filters}><label className={s.field}>Sesiones anteriores<select value={current?.id || ''} onChange={e => e.target.value && run({ action: 'get', id: e.target.value })}><option value="">Seleccionar sesión</option>{sessions.map(x => <option key={x.id} value={x.id}>{new Date(x.created_at).toLocaleString('es-PE', { timeZone: 'America/Lima' })} · {x.status} · {x.id}</option>)}</select></label>
      <label className={s.field}>Observación del nuevo conteo<input maxLength={500} value={observation} onChange={e => setObservation(e.target.value)} /></label>
      <button className={ui.primary} disabled={readOnly} onClick={() => run({ action: 'create', id: crypto.randomUUID(), data: { observation } })}>Crear conteo</button></div>
    </fieldset>
    {current && <>
      <h2>{current.status} · {current.id}</h2><p className={s.muted}>Responsable: {current.actor_email} · {new Date(current.created_at).toLocaleString('es-PE', { timeZone: 'America/Lima' })}</p><p>{current.observation}</p>
      <div className={`${s.cards} ${ui.summary}`}>{[['Contados',summary.counted],['Pendientes',summary.pending],['Diferencias',summary.differences]].map(([label,n]) => <article key={label}><div>{label}</div><strong>{n}</strong></article>)}</div>
      {dirty && <p role="status" className={ui.notice}>Hay cambios sin guardar. Guarda el avance antes de cambiar de sesión o módulo.</p>}
      {conflicts.length > 0 && <div role="alert" className={ui.alert}><p>El stock o la versión cambiaron. No se aplicó ningún ajuste. Actualiza las referencias y vuelve a contar los productos afectados.</p>{conflicts.map(c => <p key={c.sku}>{c.sku}: referencia {c.reference}, vigente {c.current}</p>)}<button className={ui.secondary} disabled={busy || !!pending} onClick={() => action('rebase')}>Actualizar referencias y exigir nuevo conteo</button></div>}
      <div className={`${s.filters} ${ui.filters}`}><label className={s.field}>Buscar SKU o producto<input value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} /></label><label className={s.field}>Resultado<select value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}><option value="todos">Todos</option><option value="pendientes">Pendientes</option><option value="diferencias">Diferencias</option><option value="coincidencias">Coincidencias</option></select></label></div>
      <div className={`${s.tableWrap} ${ui.tableSurface}`}><table className={s.table}><thead><tr>{['SKU / Producto','Referencia','Cantidad física','Diferencia','Motivo del ajuste'].map(x => <th key={x} scope="col">{x}</th>)}</tr></thead><tbody>{filtered.slice((page-1)*20,page*20).map(l => {
        const delta = difference(l);
        return <tr key={l.product_id}><td><strong>{l.product_name}</strong><p>{l.sku}</p></td><td>{l.reference_stock}</td><td><input aria-label={`Cantidad física ${l.sku}`} type="number" min="0" max="2147483647" step="1" disabled={!editable || busy} value={l.physical_quantity ?? ''} placeholder="Sin contar" onChange={e => { const v=e.target.value; if (v === '' || (Number.isInteger(Number(v)) && Number(v)>=0 && Number(v)<=2147483647)) edit(l.product_id,'physical_quantity',v === '' ? null : Number(v)); }} /></td><td><span className={ui.quantity} data-sign={delta > 0 ? 'positive' : delta < 0 ? 'negative' : ''}>{delta === null ? 'Pendiente' : delta === 0 ? 'Coincide' : `${delta > 0 ? '+' : ''}${delta} ${delta > 0 ? 'sobrante' : 'faltante'}`}</span></td><td><input aria-label={`Motivo ${l.sku}`} maxLength={400} disabled={!editable || busy} value={l.reason} onChange={e => edit(l.product_id,'reason',e.target.value)} /></td></tr>;
      })}</tbody></table>{!filtered.length && <p className={s.empty}>No hay productos para mostrar.</p>}</div>
      <div className={ui.pagination}><button className={ui.secondary} disabled={page<=1} onClick={() => setPage(page-1)}>Anterior</button><span>Página {page} de {pages}</span><button className={ui.secondary} disabled={page>=pages} onClick={() => setPage(page+1)}>Siguiente</button></div>
      <div className={s.filters}>
        <button className={ui.secondary} disabled={busy || !!pending} onClick={() => run({ action: 'get', id: current.id })}>Descartar cambios locales y recargar sesión</button>
        {editable && <><button className={ui.primary} disabled={busy || !dirty} onClick={() => action('save')}>Guardar avance</button><button className={ui.secondary} disabled={busy || dirty || summary.pending>0 || !lines.length || lines.some(l => difference(l)!==0 && !l.reason.trim())} onClick={() => action('review')}>Enviar a revisión</button></>}
        {current.status === 'en revisión' && !readOnly && <><button className={ui.secondary} disabled={busy || !!pending} onClick={() => action('reopen')}>Volver a borrador</button><button className={ui.primary} disabled={busy || !!pending || conflicts.length>0} onClick={() => dialog.current.showModal()}>Confirmar ajustes</button></>}
        {!['finalizado','cancelado'].includes(current.status) && <button className={ui.secondary} disabled={busy || dirty || !!pending || readOnly} onClick={() => action('cancel')}>Cancelar sesión</button>}
      </div>
      <dialog ref={dialog} className={ui.compactDialog} aria-labelledby="confirm-count-title"><h2 id="confirm-count-title">Confirmar inventario físico</h2><p>Se comprobará el stock vigente de todos los productos. Se registrarán {summary.differences} ajustes de forma atómica. Una sesión finalizada no admite cambios.</p><p>Verifica las cantidades y los motivos antes de continuar.</p><button className={ui.secondary} onClick={() => dialog.current.close()}>Volver</button> <button className={ui.primary} onClick={() => { dialog.current.close(); action('confirm'); }}>Confirmar y finalizar</button></dialog>
    </>}
  </div>;
}
