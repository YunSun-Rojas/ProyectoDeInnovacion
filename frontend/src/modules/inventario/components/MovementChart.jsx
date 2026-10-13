import { useId } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import s from './MovementChart.module.css';

const integer = value => new Intl.NumberFormat('es-PE').format(value);
const colors = { entradas: '#239b78', salidas: '#e32636' };

function MovementTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const day = payload[0].payload;
  const date = new Date(`${day.date}T12:00:00Z`).toLocaleDateString('es-PE', {
    timeZone: 'America/Lima', day: 'numeric', month: 'long', year: 'numeric',
  });
  return <div className={s.tooltip}>
    <strong className={s.date}>{date}</strong>
    {['entradas', 'salidas'].map(key => <div className={s.row} key={key}>
      <i style={{ backgroundColor: colors[key] }} aria-hidden="true" />
      <span>{key === 'entradas' ? 'Entradas' : 'Salidas'}</span>
      <strong>{integer(day[key])} uds.</strong>
    </div>)}
  </div>;
}

export default function MovementChart({ activity }) {
  const gradientId = `movement-gradient-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return <div className={s.chart} role="img"
    aria-label={`Entradas y salidas diarias: ${integer(activity.entries)} unidades de entrada y ${integer(activity.exits)} de salida`}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={activity.series} margin={{ top: 20, right: 12, bottom: 12, left: -12 }} barGap={6} accessibilityLayer>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#36b995" />
            <stop offset="100%" stopColor="#168768" />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--inventory-border, #e5e7eb)" strokeDasharray="3 5" strokeOpacity={0.6} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} minTickGap={25}
          tick={{ fontSize: 11, fill: 'var(--inventory-muted, #667085)' }} />
        <YAxis allowDecimals={false} axisLine={false} tickLine={false}
          tick={{ fontSize: 11, fill: 'var(--inventory-muted, #667085)' }} />
        <Tooltip cursor={false} content={<MovementTooltip />} />
        <Bar dataKey="entradas" name="Entradas" fill={`url(#${gradientId})`} stroke={colors.entradas}
          strokeWidth={1} radius={[4, 4, 4, 4]} maxBarSize={40} isAnimationActive={false} />
        <Bar dataKey="salidas" name="Salidas" fill={colors.salidas} stroke={colors.salidas}
          strokeWidth={1} radius={[4, 4, 4, 4]} maxBarSize={40} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  </div>;
}
