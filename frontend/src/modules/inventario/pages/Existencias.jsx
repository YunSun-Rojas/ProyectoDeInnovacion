import { useMemo, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { Package, Boxes, AlertTriangle, PackageX, RefreshCw, Plus, Info } from 'lucide-react';
import { summarizeInventory, minimumStock } from './dashboardData';
import { filterStock, stockState } from './existenciasData';
import s from './Management.module.css';
import styles from './Existencias.module.css';
import StockDialog from '../components/StockDialog';
import ui from './InventoryUI.module.css';

const labels = { normal: 'Stock normal', bajo: 'Stock bajo', 'sin-stock': 'Agotado' };
const integer = value => new Intl.NumberFormat('es-PE').format(value);

export default function Existencias() {
  const { products = [], categories = [], defaultMinStock = 5, status, error, retry,
    stockEnabled, readOnly, saving, refreshing, uncertain, writeError, onStock, retryWrite, notify } = useOutletContext();
  const [stockOpen, setStockOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const category = params.get('categoria') || '';
  const state = params.get('estado') || '';
  const sort = params.get('orden') === 'stock-desc' ? 'stock-desc' : 'stock-asc';
  const summary = useMemo(() => summarizeInventory(products, defaultMinStock), [products, defaultMinStock]);
  const rows = useMemo(() => filterStock(products, { query, category, state, sort, fallback: defaultMinStock }), [products, query, category, state, sort, defaultMinStock]);
  const names = [...new Set([...categories.map(item => typeof item === 'string' ? item : item.name), ...products.map(product => product.category)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const pages = Math.max(1, Math.ceil(rows.length / 20));
  const requestedPage = Number(params.get('pagina'));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(pages, requestedPage) : 1;
  function update(key, value) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value); else next.delete(key);
      if (key !== 'pagina') next.delete('pagina');
      return next;
    });
  }
  if (status === 'loading') return <div className={s.page} role="status">Cargando existencias…</div>;
  if (status === 'error') return <div className={s.page}><p className={s.formError} role="alert">{error}</p><button className={s.button} onClick={retry}>Reintentar</button></div>;
  return <div className={`${s.page} ${ui.workspace}`}>
    <header className={`${s.header} ${ui.heading}`}><div><span className={ui.eyebrow}>INVENTARIO POR SKU</span><h1 className={s.title}>Control de existencias</h1><p className={s.muted}>Consulta las cantidades disponibles y el estado de los productos registrados en el almacén.</p></div><div className={s.companyActions}><button className={ui.secondary} disabled={saving || uncertain} onClick={retry}><RefreshCw size={15} aria-hidden="true" />{refreshing ? 'Actualizando…' : 'Actualizar existencias'}</button><button className={ui.primary} disabled={readOnly || !stockEnabled || saving || uncertain || !products.length} onClick={() => setStockOpen(true)}><Plus size={16} aria-hidden="true" />Registrar movimiento</button></div></header>
    {!stockEnabled && <p className={ui.notice} role="status"><Info size={16} aria-hidden="true" />Entradas, salidas y ajustes por cantidad pendientes de habilitar mediante la migración SQL de Fase 3.</p>}
    {!stockOpen && writeError && <p className={ui.alert} role="alert">{writeError}</p>}
    {!stockOpen && uncertain && <button className={s.button} disabled={saving} onClick={retryWrite}>Reintentar guardado pendiente</button>}
    <section className={`${styles.cards} ${ui.summary}`} aria-label="Resumen de existencias del almacén">
      {[
        ['Productos registrados', products.length, Package], ['Unidades disponibles', summary.units, Boxes],
        ['Productos con stock bajo', summary.low, AlertTriangle], ['Productos agotados', summary.empty, PackageX],
      ].map(([label, value, Icon]) => <article className={s.card} key={label}><div className={styles.cardLabel}><Icon size={19} aria-hidden="true" />{label}</div><strong className={s.number}>{integer(value)}</strong></article>)}
    </section>
    <div className={`${s.filters} ${ui.filters}`}>
      <label className={`${s.field} ${styles.search}`}>Buscar producto<input type="search" value={query} placeholder="Nombre o SKU" onChange={event => update('q', event.target.value)} /></label>
      <label className={s.field}>Categoría<select value={category} onChange={event => update('categoria', event.target.value)}><option value="">Todas las categorías</option>{names.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      <label className={s.field}>Estado<select value={state} onChange={event => update('estado', event.target.value)}><option value="">Todos los estados</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className={s.field}>Ordenar por cantidad<select value={sort} onChange={event => update('orden', event.target.value)}><option value="stock-asc">Menor a mayor stock</option><option value="stock-desc">Mayor a menor stock</option></select></label>
    </div>
    <p className={s.muted} role="status">{integer(rows.length)} productos encontrados · Consulta del stock actual</p>
    <p className={ui.tableHint}>Desliza la tabla para consultar todas las columnas.</p>
    <div className={`${s.tableWrap} ${ui.tableSurface}`} role="region" aria-label="Tabla de existencias" tabIndex={0}>
      {rows.length ? <table className={`${s.table} ${ui.stockTable}`}><caption className={styles.srOnly}>Existencias actuales por producto</caption><thead><tr>{['SKU', 'Producto', 'Categoría', 'Stock actual', 'Stock mínimo', 'Estado', 'Acciones'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{rows.slice((page - 1) * 20, page * 20).map(product => <tr key={product.id}>
          <td>{product.sku}</td><td><strong>{product.name}</strong></td><td>{product.category}</td>
          <td>{integer(product.stock)}</td><td>{integer(minimumStock(product, defaultMinStock))}</td>
          <td><span className={`${styles.badge} ${styles[stockState(product, defaultMinStock)]}`}>{labels[stockState(product, defaultMinStock)]}</span></td>
          <td><Link className={styles.link} to={`/dashboard/productos?q=${encodeURIComponent(product.sku)}`} aria-label={`Ver producto ${product.name}`}>Ver producto</Link></td>
        </tr>)}</tbody></table> : <div className={s.empty}><Package size={32} aria-hidden="true" /><h2>{products.length ? 'No hay coincidencias' : 'No hay productos registrados'}</h2><p className={s.muted}>{products.length ? 'Cambia o limpia los filtros para consultar otros productos.' : 'Los artículos del catálogo aparecerán aquí con sus existencias.'}</p></div>}
    </div>
    <nav className={`${styles.pagination} ${ui.pagination}`} aria-label="Paginación de existencias">
      <button className={ui.secondary} disabled={page === 1} onClick={() => update('pagina', String(page - 1))}>Anterior</button>
      <span className={s.muted}>Página {page} de {pages}</span>
      <button className={ui.secondary} disabled={page === pages} onClick={() => update('pagina', String(page + 1))}>Siguiente</button>
    </nav>
    {stockOpen && <StockDialog products={products} saving={saving} uncertain={uncertain} error={writeError} onSave={onStock} onRetry={retryWrite} onClose={() => setStockOpen(false)} onSuccess={() => { setStockOpen(false); notify?.('Movimiento confirmado.'); }} />}
  </div>;
}
