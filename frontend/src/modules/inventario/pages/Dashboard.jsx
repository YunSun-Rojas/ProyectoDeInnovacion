import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, ArrowRight, Package, Wallet, AlertTriangle, PackageX, Clock, CheckCircle2, BarChart3, ShoppingCart, TrendingUp } from 'lucide-react';
import TopProductsChart from '../components/TopProductsChart';
import { summarizeInventory, minimumStock, numeric } from './dashboardData';
import s from './Dashboard.module.css';
import CategoryDonut from '../components/CategoryDonut';
import MovementChart from '../components/MovementChart';
import SalesChart from '../components/SalesChart';

const money = value => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', maximumFractionDigits: 2 }).format(value);
const integer = value => new Intl.NumberFormat('es-PE').format(value);
const dateTime = value => new Date(value).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Dashboard({ products = [], activity = { recent: [], series: [], entries: 0, exits: 0, hasFlow: false }, rangeLabel = 'Este mes', salesEnabled = false, salesSummary = { recent: [], series: [], top: [], total: 0, units: 0 }, defaultMinStock = 5, readOnly = true, saving = false, uncertain = false, writeError = '', retryWrite }) {
  const summary = useMemo(() => summarizeInventory(products, defaultMinStock), [products, defaultMinStock]);
  const history = activity;

  return <div className={s.page}>
    <header className={s.header}>
      <div><span className={s.eyebrow}>EAGLE GAMING / INVENTARIO</span><h1>Panel de control</h1><p>Lo que necesitas saber para gestionar tu inventario</p></div>
    </header>
    {readOnly && <p className={s.notice}>Modo de consulta. El registro de productos y movimientos está deshabilitado para esta sesión.</p>}
    {uncertain && <div className={s.notice} role="alert">Hay un guardado pendiente de confirmar. {writeError}<button className={s.button} disabled={saving} onClick={retryWrite}>Reintentar guardado</button></div>}

    <div className={s.sectionLabel}><span>RESUMEN DEL INVENTARIO</span><span>Stock actual</span></div>
    <section className={s.kpis} aria-label="Indicadores actuales">
      <Stat title="Valor del inventario" value={money(summary.value)} description={`${integer(products.length)} productos registrados`} icon={Wallet} to="/dashboard/productos" />
      <Stat title="Unidades disponibles" value={integer(summary.units)} description="Existencias totales en almacén" icon={Package} to="/dashboard/productos?estado=disponible" />
      <Stat title="Stock bajo" value={integer(summary.low)} description="Con existencias, en el mínimo o por debajo" icon={AlertTriangle} tone="warning" to="/dashboard/productos?estado=bajo" />
      <Stat title="Productos agotados" value={integer(summary.empty)} description="Sin unidades disponibles" icon={PackageX} tone="danger" to="/dashboard/productos?estado=sin-stock" />
    </section>

    {products.length > 0 && <div className={s.insights} aria-label="Avisos del inventario">
      {summary.empty > 0 && <div className={s.dangerInsight}><span aria-hidden="true">🚨</span><span>{summary.empty} producto{summary.empty === 1 ? '' : 's'} sin stock. Reposición inmediata recomendada.</span></div>}
      {!salesEnabled && <div className={s.warningInsight}><span aria-hidden="true">⚠️</span><span>El registro de ventas está pendiente de habilitación.</span></div>}
    </div>}

    <div className={s.mainGrid}>
      <section className={s.panel}>
        <PanelTitle icon={AlertTriangle} title="Productos que requieren atención" subtitle="Agotados primero, seguidos de los productos con menor stock." />
        {summary.attention.length ? <>
          <div className={s.tableScroll}><table className={s.table}><thead><tr><th>Producto</th><th>Stock / mínimo</th><th>Estado</th></tr></thead><tbody>
            {summary.attention.slice(0, 5).map(p => <tr key={p.id}><td><Link className={s.productLink} to={`/dashboard/productos?q=${encodeURIComponent(p.sku)}`}>{p.name}</Link><small>{p.sku}</small></td><td className={s.noWrap}><strong>{integer(p.stock)}</strong><span className={s.muted}> / {integer(minimumStock(p, defaultMinStock))}</span></td><td><span className={p.stock === 0 ? s.dangerBadge : s.warningBadge}>{p.stock === 0 ? 'Agotado' : 'Stock bajo'}</span></td></tr>)}
          </tbody></table></div>
          <Link className={s.footerLink} to="/dashboard/productos?estado=alertas">Ver productos que requieren atención ({summary.attention.length}) <ArrowRight size={15} /></Link>
        </> : <Empty icon={CheckCircle2} title={products.length ? 'Inventario sin alertas' : 'Empieza con tu primer producto'} text={products.length ? 'Todos los productos tienen existencias por encima de su mínimo.' : 'Registra productos para consultar aquí sus niveles de stock.'} />}
      </section>
      <section className={s.panel}>
        <PanelTitle icon={Clock} title="Últimos movimientos" subtitle={`${rangeLabel} · ${integer(history.recent.length)} movimientos`} />
        {history.recent.length ? <><div className={s.movements}>
          {history.recent.slice(0, 5).map(m => <article className={s.movement} key={m.id}>
            <span className={s.movementIcon}>{m.type === 'Entrada' ? <ArrowDownLeft size={17} /> : ['Salida', 'Venta'].includes(m.type) ? <ArrowUpRight size={17} /> : <Package size={17} />}</span>
            <div className={s.movementBody}><strong>{m.product}</strong><span>{m.type === 'Baja' ? 'Eliminado' : m.type} · {dateTime(m.date)}</span><small title={m.user}>Responsable: {m.user || 'No registrado'}</small>{m.saleId && <small>Venta: {money(m.total)} · {money(m.unitPrice)} por unidad</small>}</div>
            <div className={s.quantity}><strong>{numeric(m.quantity) > 0 ? '+' : ''}{integer(numeric(m.quantity))}</strong><small>unidades</small></div>
          </article>)}
        </div><Link className={s.footerLink} to="/dashboard/historial">Ver historial completo <ArrowRight size={15} /></Link></> : <Empty icon={Clock} title={readOnly ? 'Historial no disponible' : `Sin movimientos · ${rangeLabel.toLowerCase()}`} text={readOnly ? 'El historial estará disponible cuando se habilite el registro de movimientos.' : 'Las operaciones registradas aparecerán aquí con su fecha y responsable.'} />}
      </section>
    </div>

    <div className={s.charts}>
      <section className={s.panel}>
        <PanelTitle icon={BarChart3} title="Entradas y salidas" subtitle={`Unidades por día · ${rangeLabel.toLowerCase()}`} />
        <div className={s.flowTotals}><span><i className={s.entryDot} /> Entradas <strong>{integer(history.entries)}</strong></span><span><i className={s.exitDot} /> Salidas <strong>{integer(history.exits)}</strong></span></div>
        {history.hasFlow ? <MovementChart activity={history} /> : <Empty icon={BarChart3} title={readOnly ? 'Historial no disponible' : `Sin entradas o salidas · ${rangeLabel.toLowerCase()}`} text="Sin movimientos registrados" />}
        <p className={s.chartNote}>Registro de movimientos que modifican las existencias del inventario</p>
      </section>
      <section className={s.panel}>
        <PanelTitle icon={Wallet} title="Valor por categoría" subtitle="Valor del stock actual" />
        {summary.value > 0 ? <CategoryDonut categories={summary.categories} total={summary.value} /> : <Empty icon={Package} title="Sin valor de inventario para mostrar" text="El gráfico aparecerá cuando haya productos con existencias y precio registrado." />}
        <p className={s.chartNote}>Stock × precio registrado de cada producto</p>
      </section>
      <section className={s.panel}>
        <PanelTitle icon={TrendingUp} title="Monto vendido por día" subtitle={rangeLabel} />
        <div className={s.salesTotal}><span>Total vendido</span><strong>{salesEnabled ? money(salesSummary.total) : '—'}</strong></div>
        {salesEnabled && salesSummary.recent.length > 0 ? <SalesChart summary={salesSummary} /> : <Empty icon={TrendingUp} title={salesEnabled ? 'Sin ventas registradas en este período' : 'Ventas pendientes de habilitación'} text="Solo se incluyen operaciones registradas como venta, con su precio aplicado." />}
        <p className={s.chartNote}>Los cambios posteriores de precio no modifican estos importes.</p>
      </section>
      <section className={s.panel}>
        <PanelTitle icon={ShoppingCart} title="Productos más vendidos" subtitle={`Cinco productos por unidades vendidas · ${rangeLabel.toLowerCase()}`} />
        {salesEnabled && salesSummary.top.length > 0 ? <TopProductsChart products={salesSummary.top} /> : <Empty icon={ShoppingCart} title={salesEnabled ? 'Aún no hay productos vendidos en este período' : 'Ventas pendientes de habilitación'} text="Las salidas por ajustes o bajas no se cuentan como ventas." />}
      </section>
    </div>
  </div>;
}

function Stat({ title, value, description, icon: Icon, tone = 'neutral', to }) {
  return <Link to={to} className={`${s.stat} ${s[tone] || ''}`}><div className={s.statTop}><span>{title}</span><Icon size={19} /></div><strong className={s.statValue}>{value}</strong><span className={s.statDescription}>{description}</span></Link>;
}
function PanelTitle({ icon: Icon, title, subtitle }) {
  return <header className={s.panelTitle}><div><Icon size={17} /><h2>{title}</h2></div><p>{subtitle}</p></header>;
}
function Empty({ icon: Icon, title, text }) {
  return <div className={s.empty}><Icon size={28} /><strong>{title}</strong><p>{text}</p></div>;
}
