import { useMemo } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { BookOpen, Download, RefreshCw, Package, ArrowDownLeft, ArrowUpRight, Scale, AlertTriangle } from 'lucide-react';
import { buildKardex, kardexProducts, kardexPage, kardexCsv, kardexDate } from './kardexData';
import s from './Management.module.css';
import ui from './InventoryUI.module.css';
import k from './Kardex.module.css';

const integer = value => value == null ? '—' : new Intl.NumberFormat('es-PE').format(value);
const types = ['Alta', 'Entrada', 'Salida', 'Ajuste', 'Venta', 'Baja'];

export default function Kardex() {
  const { products = [], movements = [], status, error, retry, readOnly, saving, refreshing, uncertain } = useOutletContext();
  const [params, setParams] = useSearchParams();
  const selected = params.get('producto') || '';
  const query = params.get('q') || '';
  const from = params.get('desde') || '';
  const to = params.get('hasta') || '';
  const type = params.get('tipo') || 'Todos';
  const audit = params.get('auditoria') === '1';
  const choices = useMemo(() => kardexProducts(products, movements), [products, movements]);
  const product = choices.find(item => item.key === selected);
  const matches = choices.filter(item => item.search.includes(query.trim().toLocaleLowerCase('es')));
  const options = product && !matches.some(item => item.key === product.key) ? [product, ...matches] : matches;
  const ledger = useMemo(() => buildKardex(choices.find(item => item.key === selected), movements, { from, to, type, audit }), [choices, selected, movements, from, to, type, audit]);
  const paginated = kardexPage(ledger.rows, params.get('pagina'));
  function update(key, value) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value); else next.delete(key);
      if (key !== 'pagina') next.delete('pagina');
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
    if (!product || ledger.error || readOnly) return;
    const url = URL.createObjectURL(new Blob([kardexCsv(product, ledger, { from, to, type, audit })], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `kardex-${String(product.sku || 'producto').replace(/[^\p{L}\p{N}_-]/gu, '_')}-${from || 'inicio'}-${to || 'actual'}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (status === 'loading') return <div className={`${s.page} ${ui.workspace}`} role="status">Cargando Kardex…</div>;
  if (status === 'error') return <div className={`${s.page} ${ui.workspace}`}><p className={ui.alert} role="alert">{error}</p><button className={ui.secondary} onClick={retry}>Reintentar consulta</button></div>;
  return <div className={`${s.page} ${ui.workspace} ${k.workspace}`}>
    <header className={`${s.header} ${ui.heading}`}><div><span className={ui.eyebrow}>ALMACÉN · CONSULTA POR SKU</span><h1>Kardex de inventario</h1><p className={s.muted}>Sigue la evolución de las cantidades de un producto y consulta el saldo de cada operación.</p></div>
      <div className={s.companyActions}><button className={ui.secondary} disabled={saving || uncertain} onClick={retry}><RefreshCw size={15} aria-hidden="true" />{refreshing ? 'Actualizando…' : 'Actualizar consulta'}</button><button className={ui.primary} disabled={!product || readOnly || Boolean(ledger.error) || !ledger.rows.length} onClick={exportCsv}><Download size={16} aria-hidden="true" />Exportar CSV</button></div>
    </header>
    <section className={`${ui.filters} ${k.selector}`} aria-label="Selección de producto para Kardex">
      <label className={s.field}>Buscar producto o SKU<input type="search" value={query} onChange={e => update('q', e.target.value)} placeholder="Nombre, SKU actual o SKU histórico" /></label>
      <label className={s.field}>Producto<select value={selected} onChange={e => update('producto', e.target.value)}><option value="">Selecciona un producto</option>{options.map(item => <option key={item.key} value={item.key}>{item.sku} · {item.name}{item.legacy ? ' · Sin ID histórico' : item.archived ? ' · Fuera de catálogo' : ''}</option>)}</select></label>
      <p className={s.muted} role="status">{matches.length} referencias encontradas · Consulta de solo lectura</p>
    </section>
    {readOnly ? <div className={ui.notice} role="status"><AlertTriangle size={18} aria-hidden="true" />El historial no está disponible para esta sesión. Solicita al administrador verificar los permisos de consulta del inventario.</div>
      : !product ? <section className={`${s.card} ${k.empty}`}><BookOpen size={36} aria-hidden="true" /><h2>{selected ? 'Producto no disponible' : 'Selecciona un producto para comenzar'}</h2><p className={s.muted}>{selected ? 'La referencia no está en el catálogo ni en el historial autorizado. Selecciona otra referencia.' : choices.length ? 'Busca un nombre o SKU y elige la referencia para consultar sus movimientos y saldos.' : 'Aún no hay productos ni movimientos disponibles.'}</p></section>
        : <>
          <section className={`${s.card} ${k.product}`} aria-label="Producto seleccionado"><span className={k.productIcon}><Package size={23} aria-hidden="true" /></span><div><span className={ui.eyebrow}>{product.legacy ? 'REGISTROS ANTIGUOS SIN IDENTIDAD VERIFICADA' : product.archived ? 'PRODUCTO FUERA DEL CATÁLOGO ACTUAL' : 'PRODUCTO SELECCIONADO'}</span><h2>{product.name}</h2><p className={s.muted}>SKU: <strong>{product.sku}</strong>{product.category ? ` · ${product.category}` : ''}{product.id != null ? ` · ID ${product.id}` : ''}</p></div></section>
          <div className={`${s.filters} ${ui.filters} ${k.periodFilters}`}>
            <label className={s.field}>Desde<input type="date" value={from} max={to || undefined} onChange={e => update('desde', e.target.value)} /></label>
            <label className={s.field}>Hasta<input type="date" value={to} min={from || undefined} onChange={e => update('hasta', e.target.value)} /></label>
            <label className={s.field}>Tipo de movimiento<select value={type} onChange={e => update('tipo', e.target.value)}><option value="Todos">Todos los tipos</option>{[...new Set([...types, ...movements.filter(row => String(row.productId) === product.key).map(row => row.type)])].filter(Boolean).map(value => <option key={value} value={value}>{value === 'Baja' ? 'Baja de producto' : value}</option>)}</select></label>
            <label className={`${s.field} ${k.audit}`}><input type="checkbox" checked={audit} onChange={e => update('auditoria', e.target.checked ? '1' : '')} />Incluir cambios sin variación</label>
            <button className={ui.secondary} onClick={clearFilters} disabled={!from && !to && type === 'Todos' && !audit}>Limpiar filtros</button>
          </div>
          {ledger.error && <p className={ui.alert} role="alert">{ledger.error}</p>}
          <p className={s.muted}>Período: {from || 'Inicio del historial'} → {to || 'Último registro disponible'} · Fechas de Lima (UTC−5).</p>
          <section className={`${ui.summary} ${k.cards}`} aria-label="Saldos y cantidades del período">
            {[
              ['Stock actual', product.archived ? null : product.stock, Package, product.archived ? 'Fuera del catálogo actual' : 'Cantidad actual del catálogo'],
              ['Saldo inicial del período', ledger.opening, Scale, ledger.opening == null ? 'No reconstruible con certeza' : 'Antes de las operaciones del período'],
              ['Entradas registradas', ledger.entries, ArrowDownLeft, 'Incluye altas y ajustes positivos'],
              ['Salidas registradas', ledger.exits, ArrowUpRight, 'Incluye ventas y ajustes negativos'],
              ['Saldo final del período', ledger.closing, Scale, ledger.closing == null ? 'No reconstruible con certeza' : 'Tras las operaciones del período'],
            ].map(([label, value, Icon, detail]) => <article key={label}><div className={k.cardLabel}><Icon size={18} aria-hidden="true" />{label}</div><strong>{integer(value)}</strong><span className={s.muted}>{detail}</span></article>)}
          </section>
          <p className={`${s.muted} ${k.explanation}`}>Las tarjetas incluyen todos los tipos del período. El filtro de tipo y la opción de auditoría solo cambian la tabla y el CSV. Los totales abarcan todas las páginas; las variaciones cero no suman unidades.</p>
          {ledger.warnings.length > 0 && <aside className={k.quality} aria-label="Observaciones sobre el historial"><h2><AlertTriangle size={18} aria-hidden="true" />Historial con limitaciones</h2><ul>{ledger.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></aside>}
          <p className={s.muted} role="status">{ledger.rows.length} registros encontrados · Orden cronológico: del más antiguo al más reciente.</p>
          <p className={ui.tableHint}>Desliza la tabla para consultar todas las columnas.</p>
          <div className={`${s.tableWrap} ${ui.tableSurface}`} role="region" aria-label="Tabla del Kardex" tabIndex={0}>
            {paginated.rows.length ? <table className={`${s.table} ${k.table}`}><thead><tr>{['Fecha y hora (Lima)', 'Tipo', 'Entrada', 'Salida', 'Stock anterior', 'Saldo posterior', 'Motivo', 'Responsable', 'Referencia'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{paginated.rows.map(row => <tr key={row.id}>
              <td>{kardexDate(row.date)}<p className={s.muted}>SKU: {row.sku}</p></td><td><span className={ui.movementBadge} data-kind={row.delta === 0 ? 'Sin variación' : row.type}>{row.delta === 0 ? 'Sin variación' : row.type}</span>{row.delta === 0 && <p className={s.muted}>Tipo original: {row.type}</p>}</td>
              <td>{row.entry ? integer(row.entry) : '—'}</td><td>{row.exit ? integer(row.exit) : '—'}</td><td>{integer(row.before)}</td><td><strong>{integer(row.after)}</strong></td><td>{row.reason || 'Sin motivo registrado'}</td><td>{row.user || 'No registrado'}</td><td>{row.reference}</td>
            </tr>)}</tbody></table> : <div className={`${s.empty} ${k.empty}`}><BookOpen size={32} aria-hidden="true" /><h2>{ledger.error ? 'Revisa las fechas del período' : 'No hay movimientos para esta selección'}</h2><p className={s.muted}>{ledger.periodRows.length ? 'Prueba otro tipo de movimiento o incluye los cambios sin variación.' : 'Prueba otro período. No se crean movimientos ni saldos para completar el historial.'}</p></div>}
          </div>
          <nav className={ui.pagination} aria-label="Paginación del Kardex"><button className={ui.secondary} disabled={paginated.page === 1} onClick={() => update('pagina', String(paginated.page - 1))}>Anterior</button><span className={s.muted}>Página {paginated.page} de {paginated.pages}</span><button className={ui.secondary} disabled={paginated.page === paginated.pages} onClick={() => update('pagina', String(paginated.page + 1))}>Siguiente</button></nav>
        </>}
  </div>;
}
