import { useId } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import s from './SalesChart.module.css';

const money = value => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(value);
const compact = value => `S/ ${new Intl.NumberFormat('es-PE', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`;

function SalesTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const day = payload[0].payload;
  const date = new Date(`${day.date}T12:00:00Z`).toLocaleDateString('es-PE', {
    timeZone: 'America/Lima', day: 'numeric', month: 'long', year: 'numeric',
  });
  return <div className={s.tooltip}>
    <span>{date}</span><strong>{money(day.amount)}</strong>
    <small>{day.units} unidades vendidas</small>
  </div>;
}

export default function SalesChart({ summary }) {
  const gradientId = `sales-area-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return <div className={s.chart} role="img" aria-label={`Ventas diarias del período: ${money(summary.total)}`}>
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={summary.series} margin={{ top: 24, right: 18, bottom: 14, left: 4 }} accessibilityLayer>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--inventory-border, #e5e7eb)" strokeDasharray="4 10" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={12} minTickGap={25}
          tick={{ fontSize: 11, fill: 'var(--inventory-muted, #667085)' }} />
        <YAxis tickLine={false} axisLine={false} width={70} domain={[0, 'auto']} tickFormatter={compact}
          tick={{ fontSize: 11, fill: 'var(--inventory-muted, #667085)' }} />
        <Tooltip content={<SalesTooltip />} cursor={{ stroke: '#8b5cf6', strokeWidth: 1 }} />
        <Area type="linear" dataKey="amount" name="Vendido" stroke="#8b5cf6" strokeWidth={2.5}
          fill={`url(#${gradientId})`} isAnimationActive={false}
          dot={summary.series.length <= 31 ? { r: summary.series.length === 1 ? 6 : 3, fill: '#8b5cf6', stroke: 'var(--inventory-surface, #fff)', strokeWidth: 2 } : false}
          activeDot={{ r: 6, fill: '#8b5cf6', stroke: 'var(--inventory-surface, #fff)', strokeWidth: 3 }} />
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}
