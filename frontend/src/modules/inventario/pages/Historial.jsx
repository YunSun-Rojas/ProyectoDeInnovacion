import { useOutletContext, useSearchParams } from 'react-router-dom';
import { History, ArrowDownLeft, ArrowUpRight, SlidersHorizontal, Search, Package, ChevronLeft, ChevronRight } from 'lucide-react';
import s from './Management.module.css';
import { filterMovements } from './movementData';
import ui from './InventoryUI.module.css';

const movementTypes = [['Todos', 'Todos'], ['Entrada', 'Entradas'], ['Salida', 'Salidas'], ['Venta', 'Ventas'], ['Ajuste', 'Ajustes'], ['Baja', 'Productos eliminados']];

export default function Historial() {
  const { movements = [], readOnly } = useOutletContext();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const type = movementTypes.some(([value]) => value === params.get('tipo')) ? params.get('tipo') : 'Todos';
  const from = params.get('desde') || '';
  const to = params.get('hasta') || '';
  function update(key, value) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.delete('responsable');
      next.delete('historial');
      if (!movementTypes.some(([value]) => value === next.get('tipo'))) next.delete('tipo');
      if (value) next.set(key, value); else next.delete(key);
      if (key !== 'pagina') next.delete('pagina');
      return next;
    });
  }
  function clearFilters() {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      for (const key of ['q', 'tipo', 'desde', 'hasta', 'pagina', 'historial', 'responsable']) next.delete(key);
      return next;
    });
  }
  const hasFilters = ['q', 'tipo', 'desde', 'hasta', 'pagina', 'historial', 'responsable'].some(key => params.has(key));
  const filtered = filterMovements(movements, { query, type, from, to, scope: 'todos' });
  const pages = Math.max(1, Math.ceil(filtered.length / 25));
  const requestedPage = Number(params.get('pagina'));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(pages, requestedPage) : 1;
  return <div className={`${s.page} ${ui.workspace} ${ui.movementPage}`}>
    <div className={`${s.header} ${ui.heading} ${ui.movementHeading}`}><div><h1 className={s.title}>Movimientos de inventario</h1></div>
    </div>
    <div className={`${s.cards} ${ui.summary} ${ui.movementSummary}`}>{[['Entradas', 'Entrada', ArrowDownLeft], ['Salidas', 'Salida', ArrowUpRight], ['Otros cambios', 'Otros', SlidersHorizontal]].map(([label, kind, Icon]) =>
      <div className={s.card} key={kind} data-kind={kind}><div className={s.sectionTitle}><Icon size={20} aria-hidden="true" />{label}</div><strong className={s.number}>{filtered.filter(m => kind === 'Otros' ? !['Entrada', 'Salida', 'Venta'].includes(m.type) : kind === 'Salida' ? ['Salida', 'Venta'].includes(m.type) : m.type === kind).length}</strong></div>)}</div>
    <div className={ui.sectionHeading}><span>Filtros</span><button type="button" className={ui.secondary} disabled={!hasFilters} onClick={clearFilters}>Limpiar filtros</button></div>
    <div className={`${s.filters} ${ui.filters} ${ui.movementFilters} ${ui.productFilters}`}>
      <label className={s.field}>Buscar producto<span className={ui.searchControl}><Search size={16} aria-hidden="true" /><input type="search" value={query} onChange={e => update('q', e.target.value)} placeholder="Nombre o SKU" /></span></label>
      <label className={s.field}>Movimiento<select value={type} onChange={e => update('tipo', e.target.value)}>{movementTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className={s.field}>Desde<input type="date" value={from} max={to || undefined} onChange={e => update('desde', e.target.value)} /></label>
      <label className={s.field}>Hasta<input type="date" value={to} min={from || undefined} onChange={e => update('hasta', e.target.value)} /></label>
    </div>
    <p className={`${s.muted} ${ui.resultStrip}`} role="status"><span className={ui.resultCount}>{filtered.length} registros</span></p>
    <p className={ui.tableHint}>Desliza la tabla para consultar todas las columnas.</p>
    <div className={`${s.tableWrap} ${ui.tableSurface}`} role="region" aria-label="Tabla de movimientos" tabIndex={0}>{filtered.length ? <table className={`${s.table} ${ui.movementTable}`}><thead><tr>{['Fecha y hora', 'Producto / SKU', 'Movimiento', 'Cantidad', 'Stock anterior', 'Stock final', 'Motivo'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{filtered.slice((page - 1) * 25, page * 25).map(m => <tr key={m.id}>
      <td>{new Date(m.date).toLocaleString('es-PE', { timeZone: 'America/Lima' })}</td><td><div className={ui.productCell}><span className={ui.tableProductIcon}><Package size={17} aria-hidden="true" /></span><div><strong>{m.product}</strong><p className={s.muted}>{m.sku}</p></div></div></td><td><span className={ui.movementBadge} data-kind={m.quantity === 0 ? 'Sin variación' : m.type}>{m.type === 'Baja' ? 'Producto eliminado' : m.quantity === 0 ? 'Sin variación' : m.type}</span>{m.quantity === 0 && <p className={s.muted}>Tipo original: {m.type}</p>}</td><td><span className={ui.quantity} data-sign={m.quantity > 0 ? 'positive' : m.quantity < 0 ? 'negative' : 'zero'}>{m.quantity > 0 ? '+' : ''}{m.quantity}</span></td><td>{m.before}</td><td><strong>{m.after}</strong></td><td>{m.reason}{m.saleId && <p className={s.muted}>{`Venta: S/ ${m.total.toFixed(2)} · S/ ${m.unitPrice.toFixed(2)} por unidad`}</p>}</td>
    </tr>)}</tbody></table> : <div className={`${s.empty} ${ui.emptyState}`}><History size={36} aria-hidden="true" /><h2 className={s.sectionTitle} style={{ justifyContent: 'center' }}>{movements.length ? 'No hay coincidencias' : readOnly ? 'Historial no disponible para esta sesión' : 'Aún no hay movimientos'}</h2><p className={s.muted}>{movements.length ? 'Prueba con otros filtros.' : readOnly ? 'La sesión está en modo de consulta y la API no ha habilitado el historial.' : 'Las operaciones realizadas en el catálogo de productos aparecerán aquí.'}</p></div>}</div>
    <nav className={ui.pagination} aria-label="Paginación de movimientos"><button className={ui.secondary} disabled={page === 1} onClick={() => update('pagina', String(page - 1))}><ChevronLeft size={16} aria-hidden="true" />Anterior</button><span className={s.muted} aria-live="polite">Página {page} de {pages}</span><button className={ui.secondary} disabled={page === pages} onClick={() => update('pagina', String(page + 1))}>Siguiente<ChevronRight size={16} aria-hidden="true" /></button></nav>
  </div>;
}
