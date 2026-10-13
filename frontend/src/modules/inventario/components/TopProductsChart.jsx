import { useId } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import s from './MovementChart.module.css';

const integer = value => new Intl.NumberFormat('es-PE').format(value);
const money = value => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(value);

function ProductTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const product = payload[0].payload;
  return <div className={s.tooltip}>
    <strong className={s.date}>{product.name}</strong>
    <div className={s.row}><span>SKU</span><strong>{product.sku}</strong></div>
    <div className={s.row}><i style={{ backgroundColor: '#e32636' }} aria-hidden="true" /><span>Unidades vendidas</span><strong>{integer(product.units)}</strong></div>
    <div className={s.row}><span>Monto vendido</span><strong>{money(product.amount)}</strong></div>
  </div>;
}

export default function TopProductsChart({ products }) {
  const gradientId = `top-products-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return <div className={s.chart} role="img"
    aria-label={`Productos más vendidos: ${products.map(product => `${product.name}, ${integer(product.units)} unidades`).join('; ')}`}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={products} margin={{ top: 24, right: 12, bottom: 12, left: -12 }} accessibilityLayer>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f34c5a" />
            <stop offset="100%" stopColor="#d91c31" />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--inventory-border, #e5e7eb)" strokeDasharray="3 5" strokeOpacity={0.6} />
        <XAxis dataKey="name" axisLine={false} tickLine={false} tickMargin={10} interval={0}
          tickFormatter={name => name.length > 12 ? `${name.slice(0, 11)}…` : name}
          tick={{ fontSize: 11, fill: 'var(--inventory-muted, #667085)' }} />
        <YAxis allowDecimals={false} axisLine={false} tickLine={false}
          tick={{ fontSize: 11, fill: 'var(--inventory-muted, #667085)' }} />
        <Tooltip cursor={false} content={<ProductTooltip />} />
        <Bar dataKey="units" name="Unidades vendidas" fill={`url(#${gradientId})`} stroke="#e32636" strokeWidth={1}
          radius={[4, 4, 4, 4]} maxBarSize={40} isAnimationActive={false}
          label={{ position: 'top', fill: 'var(--inventory-ink, #182230)', fontSize: 12, formatter: integer }} />
      </BarChart>
    </ResponsiveContainer>
  </div>;
}
