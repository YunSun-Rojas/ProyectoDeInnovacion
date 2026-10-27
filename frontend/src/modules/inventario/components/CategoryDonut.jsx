import { useState } from 'react';
import s from './CategoryDonut.module.css';

const money = value => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(value);
const percentage = value => new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 }).format(value);

export default function CategoryDonut({ categories, total }) {
  const [hovered, setHovered] = useState(null);
  const [selected, setSelected] = useState(null);
  // Mantener los colores aunque cambie el orden por valor del inventario.
  const names = categories.map(category => category.name).sort();
  const data = categories.map(category => ({ ...category,
    color: `hsl(${(names.indexOf(category.name) * 137.508 + 215) % 360} 62% 48%)`,
  }));
  const active = data.find(category => category.name === (hovered ?? selected));
  const circumference = 2 * Math.PI * 96;
  const segments = data.reduce((result, category) => {
    const offset = result.length ? result.at(-1).offset + result.at(-1).length : 0;
    result.push({ ...category, offset, length: total > 0 ? category.value / total * circumference : 0 });
    return result;
  }, []);

  return <div className={s.layout}>
    <div className={s.donut} onMouseLeave={() => setHovered(null)}>
      <svg viewBox="0 0 240 240" aria-hidden="true">
        <circle cx="120" cy="120" r="96" fill="none" stroke="var(--inventory-border, #e5e7eb)" strokeWidth="26" />
        <g transform="rotate(-90 120 120)">
          {segments.filter(category => category.value > 0).map(category => <circle
            key={category.name} cx="120" cy="120" r="96" fill="none"
            stroke={category.color} strokeWidth={active?.name === category.name ? 32 : 26}
            strokeDasharray={`${category.length} ${circumference}`}
            strokeDashoffset={-category.offset}
            opacity={active && active.name !== category.name ? 0.3 : 1}
            className={s.segment}
            onMouseEnter={() => setHovered(category.name)}
            onClick={() => setSelected(selected === category.name ? null : category.name)}
          />)}
        </g>
      </svg>
      <div className={s.center}>
        <span>{active?.name ?? 'Categorías'}</span>
        <strong>{active ? money(active.value) : categories.length}</strong>
        <small>{active ? `${percentage(active.value / total * 100)}% del inventario` : 'en el inventario'}</small>
      </div>
    </div>
    <ul className={s.legend} aria-label="Valor del inventario por categoría">
      {data.map(category => <li key={category.name}>
        <button type="button" className={s.item} aria-pressed={selected === category.name}
          data-active={active?.name === category.name}
          onMouseEnter={() => setHovered(category.name)} onMouseLeave={() => setHovered(null)}
          onFocus={() => setHovered(category.name)} onBlur={() => setHovered(null)}
          onClick={() => setSelected(selected === category.name ? null : category.name)}>
          <i style={{ background: category.color }} aria-hidden="true" />
          <span className={s.name}>{category.name}</span>
          <span className={s.amount}>{money(category.value)}<small>{percentage(total > 0 ? category.value / total * 100 : 0)}%</small></span>
        </button>
      </li>)}
    </ul>
  </div>;
}
