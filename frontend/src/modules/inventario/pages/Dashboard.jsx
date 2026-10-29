import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Boxes,
  CheckCircle2,
  Clock3,
  Package,
  PackagePlus,
  RefreshCw,
  Warehouse,
} from 'lucide-react';

import MovementChart from '../components/MovementChart';
import { minimumStock, movementFlow, numeric, summarizeInventory, summarizeInventoryCost } from './dashboardData';
import s from './Dashboard.module.css';

const integer = value => new Intl.NumberFormat('es-PE').format(value);
const money = value => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(value);

const dateTime = value => Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
  : 'Fecha no disponible';

export default function Dashboard({
  products = [],
  movements = [],
  activity = { series: [], entries: 0, exits: 0, hasFlow: false },
  rangeLabel = 'Últimos 30 días',
  rangeError = '',
  defaultMinStock = 5,
  readOnly = true,
  stockEnabled = false,
  saving = false,
  refreshing = false,
  uncertain = false,
  writeError = '',
  retryWrite,
  retry,
}) {
  const activeProducts = useMemo(
    () => products.filter(product => product.isActive !== false),
    [products]
  );
  const summary = useMemo(
    () => summarizeInventory(activeProducts, defaultMinStock),
    [activeProducts, defaultMinStock]
  );
  const inventoryCost = useMemo(
    () => summarizeInventoryCost(activeProducts),
    [activeProducts]
  );
  const recentMovements = useMemo(
    () => movements
      .filter(movement => Number.isFinite(Date.parse(movement.date)))
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
      .slice(0, 8),
    [movements]
  );

  const canRegisterProducts = !readOnly && !saving && !uncertain;
  const canRegisterStock = !readOnly && stockEnabled && !saving && !uncertain;

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div>
          <h1>Panel de control</h1>
          <p>Resumen general del almacén</p>
        </div>
        <div className={s.headerActions}>
          <span className={s.periodLabel}>Actividad: {rangeLabel}</span>
          <button
            type="button"
            className={s.button}
            aria-busy={Boolean(refreshing)}
            disabled={!retry || refreshing || saving || uncertain}
            onClick={retry}
          >
            <RefreshCw size={15} aria-hidden="true" className={refreshing ? s.spinning : undefined} />
            {refreshing ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      </header>

      {readOnly && (
        <p className={s.notice}>
          Modo de consulta. Las operaciones de escritura y el historial de movimientos no están habilitados para esta sesión.
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

      <section className={s.kpis} aria-label="Indicadores del almacén">
        <Stat
          title="Productos registrados"
          value={integer(activeProducts.length)}
          description="Productos activos en el catálogo"
          icon={Package}
          to="/dashboard/productos"
        />
        <Stat
          title="Unidades en almacén"
          value={integer(summary.units)}
          description="Existencias de productos activos"
          icon={Boxes}
          to="/dashboard/existencias"
        />
        <Stat
          title="Valor del inventario"
          value={inventoryCost.value === null ? 'No disponible' : money(inventoryCost.value)}
          description={inventoryCost.missingCosts
            ? `Falta el costo de compra de ${integer(inventoryCost.missingCosts)} productos`
            : 'Calculado con los costos de compra registrados'}
          icon={Warehouse}
          to="/dashboard/productos"
        />
        <Stat
          title="Productos con stock bajo"
          value={integer(summary.low)}
          description={`${integer(summary.empty)} agotados · requiere reposición`}
          icon={AlertTriangle}
          tone="warning"
          to="/dashboard/alertas"
        />
      </section>

      <div className={s.contentGrid}>
        <section className={s.panel} aria-labelledby="movement-chart-title">
          <PanelTitle
            icon={Boxes}
            title="Movimientos del almacén"
            subtitle={`Entradas y salidas de unidades · ${rangeLabel}`}
            titleId="movement-chart-title"
          />
          {rangeError ? (
            <Empty icon={Clock3} title="Rango de fechas no válido" text={rangeError} />
          ) : !activity.hasFlow ? (
            <Empty
              icon={Clock3}
              title={readOnly ? 'Historial no disponible' : 'Sin movimientos en este período'}
              text={readOnly
                ? 'El historial aparecerá cuando se habilite el registro de movimientos.'
                : 'No hay entradas ni salidas registradas para el período seleccionado.'}
            />
          ) : (
            <>
              <div className={s.legend} aria-label="Leyenda del gráfico">
                <span><i className={s.entryDot} />Entradas <strong>{integer(activity.entries)}</strong></span>
                <span><i className={s.exitDot} />Salidas <strong>{integer(activity.exits)}</strong></span>
              </div>
              <MovementChart activity={activity} />
            </>
          )}
        </section>

        <section className={s.panel} aria-labelledby="inventory-alerts-title">
          <PanelTitle
            icon={AlertTriangle}
            title="Alertas de inventario"
            subtitle={`${integer(summary.attention.length)} productos necesitan atención`}
            titleId="inventory-alerts-title"
          />
          {summary.attention.length ? (
            <>
              <ul className={s.alertList}>
                {summary.attention.slice(0, 6).map(product => {
                  const isEmpty = numeric(product.stock) <= 0;
                  return (
                    <li className={s.alertRow} key={product.id}>
                      <span className={`${s.alertIcon} ${isEmpty ? s.alertIconDanger : s.alertIconWarning}`}>
                        <AlertTriangle size={16} aria-hidden="true" />
                      </span>
                      <Link
                        to={`/dashboard/productos?q=${encodeURIComponent(product.sku)}`}
                        className={s.alertProduct}
                      >
                        <strong>{product.name}</strong>
                        <small>{product.sku} · Mínimo {integer(minimumStock(product, defaultMinStock))}</small>
                      </Link>
                      <span className={s.alertStatus}>
                        <strong>{integer(product.stock)} uds.</strong>
                        <small className={isEmpty ? s.dangerText : s.warningText}>
                          {isEmpty ? 'Sin stock' : 'Stock bajo'}
                        </small>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <Link className={s.footerLink} to="/dashboard/existencias">
                Ver inventario <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </>
          ) : (
            <Empty
              icon={CheckCircle2}
              title={activeProducts.length ? 'Inventario en niveles óptimos' : 'Sin productos activos'}
              text={activeProducts.length
                ? 'No hay productos activos por debajo de su stock mínimo.'
                : 'Registra productos para consultar las alertas del almacén.'}
            />
          )}
        </section>
      </div>

      <section className={s.panel} aria-labelledby="recent-movements-title">
        <div className={s.tableHeading}>
          <PanelTitle
            icon={Clock3}
            title="Movimientos recientes"
            subtitle={readOnly ? 'Historial no disponible' : `${integer(movements.length)} registros disponibles`}
            titleId="recent-movements-title"
          />
          <Link className={s.textLink} to="/dashboard/movimientos">
            Ver historial completo <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
        {recentMovements.length ? (
          <div className={s.tableScroll} role="region" aria-label="Movimientos recientes del almacén" tabIndex={0}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Fecha y hora</th>
                  <th scope="col">Producto</th>
                  <th scope="col">Tipo</th>
                  <th scope="col" className={s.numericCell}>Entrada</th>
                  <th scope="col" className={s.numericCell}>Salida</th>
                  <th scope="col">Responsable</th>
                  <th scope="col">Observación</th>
                </tr>
              </thead>
              <tbody>
                {recentMovements.map(movement => {
                  const flow = movementFlow(movement);
                  const isExit = flow.exits > 0;
                  const isEntry = flow.entries > 0;
                  const movementLabel = movement.type === 'Venta'
                    ? 'Venta · salida de stock'
                    : movement.type;
                  return (
                    <tr key={movement.id}>
                      <td className={s.noWrap}>{dateTime(movement.date)}</td>
                      <td>
                        <strong>{movement.product || 'Producto no disponible'}</strong>
                        {movement.sku && <small>{movement.sku}</small>}
                      </td>
                      <td>
                        <span className={`${s.movementBadge} ${isExit ? s.exitBadge : isEntry ? s.entryBadge : ''}`}>
                          {movementLabel}
                        </span>
                      </td>
                      <td className={s.numericCell}>{flow.entries ? `+${integer(flow.entries)}` : '—'}</td>
                      <td className={s.numericCell}>{flow.exits ? `−${integer(flow.exits)}` : '—'}</td>
                      <td>{movement.user || '—'}</td>
                      <td>{movement.reason || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={Clock3}
            title={readOnly ? 'Historial no disponible' : 'Aún no hay movimientos'}
            text={readOnly
              ? 'Los movimientos se mostrarán aquí cuando el historial esté habilitado.'
              : 'Los movimientos reales de stock aparecerán aquí al registrarse.'}
          />
        )}
      </section>

      <section className={s.quickSection} aria-labelledby="quick-actions-title">
        <div className={s.sectionHeading}>
          <div>
            <h2 id="quick-actions-title">Accesos rápidos</h2>
            <p>Operaciones frecuentes del almacén</p>
          </div>
        </div>
        <div className={s.quickActions}>
          {canRegisterProducts && (
            <QuickAction to="/dashboard/productos?accion=nuevo" icon={PackagePlus} label="Registrar producto" />
          )}
          {canRegisterStock && (
            <>
              <QuickAction to="/dashboard/existencias?accion=entrada" icon={ArrowDownLeft} label="Registrar entrada" />
              <QuickAction to="/dashboard/existencias?accion=salida" icon={ArrowUpRight} label="Registrar salida" />
            </>
          )}
          <QuickAction to="/dashboard/existencias" icon={Warehouse} label="Consultar inventario" />
          <QuickAction to="/dashboard/kardex" icon={BookOpen} label="Consultar Kardex" />
        </div>
      </section>
    </div>
  );
}

function Stat({ title, value, description, icon: Icon, tone = 'neutral', to }) {
  return (
    <Link to={to} className={`${s.stat} ${s[tone] || ''}`}>
      <div className={s.statTop}>
        <span>{title}</span>
        <Icon size={18} aria-hidden="true" />
      </div>
      <strong className={s.statValue}>{value}</strong>
      <span className={s.statDescription}>{description}</span>
    </Link>
  );
}

function PanelTitle({ icon: Icon, title, subtitle, titleId }) {
  return (
    <header className={s.panelTitle}>
      <div>
        <Icon size={17} aria-hidden="true" />
        <h2 id={titleId}>{title}</h2>
      </div>
      {subtitle && <p>{subtitle}</p>}
    </header>
  );
}

function Empty({ icon: Icon, title, text }) {
  return (
    <div className={s.empty}>
      <Icon size={25} aria-hidden="true" />
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function QuickAction({ to, icon: Icon, label }) {
  return (
    <Link to={to} className={s.quickAction}>
      <Icon size={17} aria-hidden="true" />
      <span>{label}</span>
      <ArrowRight size={14} aria-hidden="true" />
    </Link>
  );
}
