import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  Package,
  Wallet,
  AlertTriangle,
  Clock,
  CheckCircle2,
  BarChart3,
  ShoppingCart,
  TrendingUp,
  Info,
} from 'lucide-react';

import TopProductsChart from '../components/TopProductsChart';
import CategoryDonut from '../components/CategoryDonut';
import MovementChart from '../components/MovementChart';
import SalesChart from '../components/SalesChart';
import {
  summarizeInventory,
  minimumStock,
  numeric,
} from './dashboardData';
import s from './Dashboard.module.css';

const integer = value =>
  new Intl.NumberFormat('es-PE').format(value);

const dateTime = value =>
  new Date(value).toLocaleString('es-PE', {
    timeZone: 'America/Lima',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function Dashboard({
  products = [],
  activity = {
    recent: [],
    series: [],
    entries: 0,
    exits: 0,
    hasFlow: false,
  },
  rangeLabel = 'Este mes',
  salesEnabled = false,
  salesSummary = {
    recent: [],
    series: [],
    top: [],
    total: 0,
    units: 0,
  },
  defaultMinStock = 5,
  readOnly = true,
  saving = false,
  uncertain = false,
  writeError = '',
  retryWrite,
}) {
  const summary = useMemo(
    () => summarizeInventory(products, defaultMinStock),
    [products, defaultMinStock]
  );

  const history = activity;

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div>
          <h1>Panel de control</h1>
        </div>
      </header>

      {readOnly && (
        <p className={s.notice}>
          Modo de consulta. El registro de productos y movimientos está
          deshabilitado para esta sesión.
        </p>
      )}

      {uncertain && (
        <div className={s.notice} role="alert">
          Hay un guardado pendiente de confirmar. {writeError}
          <button
            type="button"
            className={s.button}
            disabled={saving || !retryWrite}
            onClick={retryWrite}
          >
            Reintentar guardado
          </button>
        </div>
      )}

      <section className={s.kpis} aria-label="Indicadores actuales">
        <Stat
          title="Productos registrados"
          value={integer(products.length)}
          description=""
          icon={Package}
          to="/dashboard/productos"
        />

        <Stat
          title="Unidades disponibles"
          value={integer(summary.units)}
          description=""
          icon={Package}
          to="/dashboard/productos?estado=disponible"
        />

        <Stat
          title="Requieren atención"
          value={integer(summary.empty + summary.low)}
          description={<>{integer(summary.empty)} agotados · {integer(summary.low)} stock bajo</>}
          icon={AlertTriangle}
          tone="danger"
          to="/dashboard/alertas"
        />
      </section>

      <div className={s.mainGrid}>
        <section className={s.panel}>
          <PanelTitle
            icon={AlertTriangle}
            title="Productos que requieren atención"
          />

          {summary.attention.length > 0 ? (
            <>
              <div className={s.tableScroll}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Stock / mínimo</th>
                      <th>Estado</th>
                    </tr>
                  </thead>

                  <tbody>
                    {summary.attention.slice(0, 5).map(product => (
                      <tr key={product.id}>
                        <td>
                          <Link
                            className={s.productLink}
                            to={`/dashboard/productos?q=${encodeURIComponent(product.sku)}`}
                          >
                            {product.name}
                          </Link>
                          <small>{product.sku}</small>
                        </td>

                        <td className={s.noWrap}>
                          <strong>{integer(product.stock)}</strong>
                          <span className={s.muted}>
                            {' / '}
                            {integer(
                              minimumStock(product, defaultMinStock)
                            )}
                          </span>
                        </td>

                        <td>
                          <span
                            className={
                              product.stock === 0
                                ? s.dangerBadge
                                : s.warningBadge
                            }
                          >
                            {product.stock === 0
                              ? 'Agotado'
                              : 'Stock bajo'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Link
                className={s.footerLink}
                to="/dashboard/alertas"
              >
                Ver todas las alertas
                <ArrowRight size={15} />
              </Link>
            </>
          ) : (
            <Empty
              icon={CheckCircle2}
              title={
                products.length > 0
                  ? 'Inventario sin alertas'
                  : 'Empieza con tu primer producto'
              }
              text={
                products.length > 0
                  ? 'Todos los productos tienen existencias por encima de su mínimo.'
                  : 'Registra productos para consultar aquí sus niveles de stock.'
              }
            />
          )}
        </section>

        <section className={s.panel}>
          <PanelTitle
            icon={Clock}
            title="Últimos movimientos"
            subtitle={`${rangeLabel} · ${integer(history.recent.length)} movimientos`}
          />

          {history.recent.length > 0 ? (
            <>
              <div className={s.movements}>
                {history.recent.slice(0, 5).map(movement => (
                  <article
                    className={s.movement}
                    key={movement.id}
                  >
                    <span className={s.movementIcon}>
                      {movement.type === 'Entrada' ? (
                        <ArrowDownLeft size={17} />
                      ) : ['Salida', 'Venta'].includes(movement.type) ? (
                        <ArrowUpRight size={17} />
                      ) : (
                        <Package size={17} />
                      )}
                    </span>

                    <div className={s.movementBody}>
                      <strong>{movement.product}</strong>
                      <span>
                        {movement.type === 'Baja'
                          ? 'Eliminado'
                          : movement.type}
                        {' · '}
                        {dateTime(movement.date)}
                      </span>

                    </div>

                    <div className={s.quantity}>
                      <strong>
                        {numeric(movement.quantity) > 0 ? '+' : ''}
                        {integer(numeric(movement.quantity))}
                      </strong>
                      <small>unidades</small>
                    </div>
                  </article>
                ))}
              </div>

              <Link
                className={s.footerLink}
                to="/dashboard/movimientos"
              >
                Ver movimientos
                <ArrowRight size={15} />
              </Link>
            </>
          ) : (
            <Empty
              icon={Clock}
              title={
                readOnly
                  ? 'Historial no disponible'
                  : `Sin movimientos · ${rangeLabel.toLowerCase()}`
              }
              text={
                readOnly
                  ? 'El historial estará disponible cuando se habilite el registro de movimientos.'
                  : 'Las operaciones registradas aparecerán aquí.'
              }
            />
          )}
        </section>
      </div>

      <div className={s.charts}>
        <section className={s.panel}>
          <PanelTitle
            icon={BarChart3}
            title="Entradas y salidas"
            subtitle={`Unidades por día · ${rangeLabel}`}
          />

          <div className={s.flowTotals}>
            <span>
              <i className={s.entryDot} />
              Entradas <strong>{integer(history.entries)}</strong>
            </span>
            <span>
              <i className={s.exitDot} />
              Salidas <strong>{integer(history.exits)}</strong>
            </span>
          </div>

          {history.hasFlow ? (
            <MovementChart activity={history} />
          ) : (
            <Empty
              icon={BarChart3}
              title={
                readOnly
                  ? 'Historial no disponible'
                  : `Sin entradas o salidas · ${rangeLabel.toLowerCase()}`
              }
              text="Sin movimientos registrados"
            />
          )}

        </section>

        <section className={s.panel}>
          <PanelTitle
            icon={Wallet}
            title="Valor por categoría"
            subtitle="Valor del stock actual"
          />

          {summary.value > 0 ? (
            <CategoryDonut
              categories={summary.categories}
              total={summary.value}
            />
          ) : (
            <Empty
              icon={Package}
              title="Sin valor de inventario para mostrar"
              text="El gráfico aparecerá cuando haya productos con existencias y precio registrado."
            />
          )}

        </section>

        <section className={s.panel}>
          <PanelTitle
            icon={TrendingUp}
            title="Ventas por día"
            subtitle={rangeLabel}
            info="Los cambios posteriores de precio no modifican estos importes."
          />

          {salesEnabled && salesSummary.recent.length > 0 ? (
            <SalesChart summary={salesSummary} />
          ) : (
            <Empty
              icon={TrendingUp}
              title={
                salesEnabled
                  ? 'Sin ventas registradas en este período'
                  : 'Ventas pendientes de habilitación'
              }
              text="Solo se incluyen operaciones registradas como venta, con su precio aplicado."
            />
          )}

        </section>

        <section className={s.panel}>
          <PanelTitle
            icon={ShoppingCart}
            title="Productos más vendidos"
            subtitle={`Top 5 por unidades · ${rangeLabel}`}
          />

          {salesEnabled && salesSummary.top.length > 0 ? (
            <TopProductsChart products={salesSummary.top} />
          ) : (
            <Empty
              icon={ShoppingCart}
              title={
                salesEnabled
                  ? 'Aún no hay productos vendidos en este período'
                  : 'Ventas pendientes de habilitación'
              }
              text="Las salidas por ajustes o bajas no se cuentan como ventas."
            />
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({
  title,
  value,
  description,
  icon: Icon,
  tone = 'neutral',
  to,
}) {
  return (
    <Link
      to={to}
      className={`${s.stat} ${s[tone] || ''}`}
    >
      <div className={s.statTop}>
        <span>{title}</span>
        <Icon size={19} />
      </div>
      <strong className={s.statValue}>{value}</strong>
      <span className={s.statDescription}>{description}</span>
    </Link>
  );
}

function PanelTitle({ icon: Icon, title, subtitle, info }) {
  const infoId = useId();
  const [infoOpen, setInfoOpen] = useState(false);
  return (
    <header className={s.panelTitle}>
      <div>
        <Icon size={17} />
        <h2>{title}</h2>
        {info && (
          <span
            className={s.info}
            onMouseEnter={() => setInfoOpen(true)}
            onMouseLeave={event => {
              if (!event.currentTarget.contains(document.activeElement)) setInfoOpen(false);
            }}
            onFocus={() => setInfoOpen(true)}
            onBlur={() => setInfoOpen(false)}
            onKeyDown={event => {
              if (event.key === 'Escape') setInfoOpen(false);
            }}
          >
            <button type="button" className={s.infoButton} aria-label="Información sobre los precios históricos" aria-describedby={infoId} onClick={() => setInfoOpen(true)}>
              <Info size={15} aria-hidden="true" />
            </button>
            <span id={infoId} role="tooltip" className={s.infoTooltip} hidden={!infoOpen}>{info}</span>
          </span>
        )}
      </div>
      {subtitle && <p>{subtitle}</p>}
    </header>
  );
}

function Empty({ icon: Icon, title, text }) {
  return (
    <div className={s.empty}>
      <Icon size={28} />
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}
