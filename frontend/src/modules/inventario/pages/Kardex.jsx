import { useEffect, useMemo, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { BookOpen, Download, RefreshCw, Search, AlertTriangle, ChevronLeft, ChevronRight, Scale, ArrowDownLeft, ArrowUpRight, CircleCheck } from 'lucide-react';
import { buildKardex, kardexProducts, kardexPage, kardexCsv, kardexDate, kardexToday, limaDay } from './kardexData';
import s from './Management.module.css';
import ui from './InventoryUI.module.css';
import k from './Kardex.module.css';

const integer = value => value == null ? '—' : new Intl.NumberFormat('es-PE').format(value);
const signed = value => `${value > 0 ? '+' : '−'}${integer(Math.abs(value))}`;
const types = ['Alta', 'Entrada', 'Salida', 'Ajuste', 'Venta', 'Baja'];

export default function Kardex() {
  const { products = [], movements = [], status, error, retry, readOnly, saving, refreshing, uncertain } = useOutletContext();
  const [params, setParams] = useSearchParams();
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
  const selected = params.get('producto') || '';
  const query = params.get('q') || '';
  const from = params.get('desde') || '';
  const to = params.get('hasta') || '';
  const type = params.get('tipo') || 'Todos';
  const choices = useMemo(() => kardexProducts(products, movements), [products, movements]);
  const product = choices.find(item => item.key === selected);
  const matches = choices.filter(item => item.search.includes(query.trim().toLocaleLowerCase('es')));
  const options = product && !matches.some(item => item.key === product.key) ? [product, ...matches] : matches;
  const ledger = useMemo(() => buildKardex(choices.find(item => item.key === selected), movements, { from, to, type }), [choices, selected, movements, from, to, type]);
  const daily = useMemo(() => kardexToday(movements, `${today}T12:00:00-05:00`), [movements, today]);
  const paginated = kardexPage(product ? ledger.rows : daily, params.get('pagina'));
  const busy = Boolean(saving || refreshing || uncertain);
  function update(key, value) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.delete('auditoria');
      if (key === 'producto') for (const field of ['desde', 'hasta', 'tipo']) next.delete(field);
      if (value) next.set(key, value); else next.delete(key);
      if (key !== 'pagina') next.delete('pagina');
      return next;
    }, { replace: true });
  }
  function back() {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      for (const key of ['producto', 'q', 'desde', 'hasta', 'tipo', 'auditoria', 'pagina']) next.delete(key);
      return next;
    }, { replace: true });
  }
  function clearFilters() {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      for (const key of ['desde', 'hasta', 'tipo', 'auditoria', 'pagina']) next.delete(key);
      return next;
    }, { replace: true });
  }
  function exportCsv() {
    if (!product || ledger.error || readOnly || busy || !ledger.rows.length || status !== 'ready') return;
    const url = URL.createObjectURL(new Blob([kardexCsv(product, ledger, { from, to, type })], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `kardex-${String(product.sku || 'producto').replace(/[^\p{L}\p{N}_-]/gu, '_')}-${from || 'inicio'}-${to || 'actual'}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (status === 'loading') return <div className={`${s.page} ${ui.workspace}`} role="status">Cargando Kardex…</div>;
  if (status === 'error') return <div className={`${s.page} ${ui.workspace}`}><p className={ui.alert} role="alert">{error}</p><button className={ui.secondary} onClick={retry}>Reintentar consulta</button></div>;
  return <div className={`${s.page} ${ui.workspace} ${k.workspace}`}>
    <header className={`${s.header} ${ui.heading} ${k.heading}`}><div><h1>Kardex de inventario</h1></div>
      <div className={s.companyActions}><button className={ui.secondary} disabled={busy} onClick={retry}><RefreshCw size={15} aria-hidden="true" />{refreshing ? 'Actualizando…' : 'Actualizar'}</button><button className={ui.primary} disabled={!product || readOnly || busy || Boolean(ledger.error) || !ledger.rows.length} onClick={exportCsv}><Download size={16} aria-hidden="true" />Exportar CSV</button></div>
    </header>
    <section className={`${ui.filters} ${ui.productFilters} ${k.selector}`} aria-label="Selección de producto para Kardex">
      <label className={s.field}>Buscar producto o SKU<span className={ui.searchControl}><Search size={16} aria-hidden="true" /><input type="search" value={query} onChange={e => update('q', e.target.value)} placeholder="Nombre, SKU actual o SKU histórico" /></span></label>
      <label className={s.field}>Producto<select value={selected} onChange={e => update('producto', e.target.value)}><option value="">Selecciona un producto</option>{options.map(item => <option key={item.key} value={item.key}>{item.sku} · {item.name}{item.legacy ? ' · Sin ID histórico' : item.archived ? ' · Fuera de catálogo' : ''}</option>)}</select></label>
      {query && <p className={s.muted} role="status">{matches.length} referencias</p>}
    </section>
    {readOnly ? <div className={ui.notice} role="status"><AlertTriangle size={18} aria-hidden="true" />El historial no está disponible para esta sesión. Solicita al administrador verificar los permisos de consulta del inventario.</div>
      : selected && !product ? <section className={`${s.card} ${k.empty}`}><h2>Producto no disponible</h2><p className={s.muted}>La referencia no está en el catálogo ni en el historial autorizado. Selecciona otra referencia.</p><button className={ui.secondary} onClick={back}>← Volver</button></section>
        : !product ? <section className={`${s.card} ${k.today}`} aria-labelledby="kardex-today-title">
          <h2 id="kardex-today-title">Movimientos de hoy</h2>
          {daily.length ? <><ul className={k.todayList}>{paginated.rows.map(row => <li key={row.id}><div><strong>{row.product || 'Nombre no registrado'}</strong><span>{row.type} · {signed(row.delta)}</span></div><button className={ui.secondary} onClick={() => update('producto', row.productKey)}>Consultar →</button></li>)}</ul><p className={s.muted} role="status">{daily.length} movimientos</p></>
            : <div className={k.empty}><BookOpen size={30} aria-hidden="true" /><h3>Sin movimientos registrados hoy</h3><p className={s.muted}>Selecciona un producto para consultar su historial</p></div>}
        </section>
          : <>
          <button className={`${ui.secondary} ${k.back}`} onClick={back}>← Volver</button>
          <section className={`${s.card} ${k.product}`} aria-label="Producto seleccionado"><div><h2>{product.name}</h2><p className={s.muted}>SKU: <strong>{product.sku}</strong>{product.archived ? ' · Fuera del catálogo' : product.stock != null ? ` · Stock actual: ${integer(product.stock)}` : ''}</p></div></section>
          <div className={`${s.filters} ${ui.filters} ${ui.productFilters} ${k.periodFilters}`}>
            <label className={s.field}>Desde<input type="date" value={from} max={to || undefined} onChange={e => update('desde', e.target.value)} /></label>
            <label className={s.field}>Hasta<input type="date" value={to} min={from || undefined} onChange={e => update('hasta', e.target.value)} /></label>
            <label className={s.field}>Tipo de movimiento<select value={type} onChange={e => update('tipo', e.target.value)}><option value="Todos">Todos los tipos</option>{[...new Set([...types, ...movements.filter(row => String(row.productId) === product.key).map(row => row.type)])].filter(Boolean).map(value => <option key={value} value={value}>{value === 'Baja' ? 'Baja de producto' : value}</option>)}</select></label>
            <button className={ui.secondary} onClick={clearFilters} disabled={!from && !to && type === 'Todos' && !params.has('auditoria')}>Limpiar filtros</button>
          </div>
          {ledger.error && <p className={ui.alert} role="alert">{ledger.error}</p>}
          {(from || to) && <p className={`${s.muted} ${k.period}`}>{from || 'Inicio'} → {to || 'Último registro'} · Perú</p>}
          <section className={`${s.card} ${k.summary}`} aria-label="Resumen del producto"><h2>Resumen del producto</h2><dl>{[['Inicial', ledger.opening, Scale, 'initial'], ['Entradas', ledger.entries, ArrowDownLeft, 'entry'], ['Salidas', ledger.exits, ArrowUpRight, 'exit'], ['Final', ledger.closing, CircleCheck, 'final']].map(([label, value, Icon, tone]) => <div key={label} className={k.metric} data-tone={tone}><dt><Icon size={28} aria-hidden="true" />{label}</dt><dd title={value == null ? 'No reconstruible con certeza' : undefined}>{integer(value)}</dd></div>)}</dl></section>
          {ledger.warnings.length > 0 && <aside className={k.quality} aria-label="Observaciones sobre el historial"><h2><AlertTriangle size={18} aria-hidden="true" />Historial con limitaciones</h2><ul>{ledger.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></aside>}
          <p className={s.muted} role="status">{ledger.rows.length} registros</p>
          <p className={ui.tableHint}>Desliza la tabla para consultar todas las columnas.</p>
          <div className={`${s.tableWrap} ${ui.tableSurface}`} role="region" aria-label="Tabla del Kardex" tabIndex={0}>
            {paginated.rows.length ? <table className={`${s.table} ${k.table}`}><thead><tr>{['Fecha y hora (Perú)', 'Tipo', 'Entrada', 'Salida', 'Stock anterior', 'Saldo posterior', 'Motivo'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{paginated.rows.map(row => <tr key={row.id}>
              <td>{kardexDate(row.date)}<p className={s.muted}>SKU: {row.sku}</p></td><td><span className={ui.movementBadge} data-kind={row.type}>{row.type}</span></td>
              <td>{row.entry ? integer(row.entry) : '—'}</td><td>{row.exit ? integer(row.exit) : '—'}</td><td>{integer(row.before)}</td><td><strong>{integer(row.after)}</strong></td><td>{row.reason || 'Sin motivo registrado'}</td>
            </tr>)}</tbody></table> : <div className={`${s.empty} ${k.empty}`}><BookOpen size={32} aria-hidden="true" /><h2>{ledger.error ? 'Revisa las fechas del período' : 'No hay movimientos para esta selección'}</h2><p className={s.muted}>{ledger.periodRows.length ? 'Prueba otro tipo de movimiento. Los cambios sin variación se consultan en Movimientos de inventario.' : 'Prueba otro período. No se crean movimientos ni saldos para completar el historial.'}</p></div>}
          </div>
        </>}
    {!readOnly && (!selected || product) && paginated.pages > 1 && <nav className={ui.pagination} aria-label={product ? 'Paginación del Kardex' : 'Paginación de movimientos de hoy'}><button className={ui.secondary} disabled={paginated.page === 1} onClick={() => update('pagina', String(paginated.page - 1))}><ChevronLeft size={16} aria-hidden="true" />Anterior</button><span className={s.muted} aria-live="polite">Página {paginated.page} de {paginated.pages}</span><button className={ui.secondary} disabled={paginated.page === paginated.pages} onClick={() => update('pagina', String(paginated.page + 1))}>Siguiente<ChevronRight size={16} aria-hidden="true" /></button></nav>}
  </div>;
}
