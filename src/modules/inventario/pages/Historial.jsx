import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { History, ArrowDownLeft, ArrowUpRight, SlidersHorizontal } from 'lucide-react';
import s from './Management.module.css';

export default function Historial() {
  const { movements } = useOutletContext();
  const [query, setQuery] = useState('');
  const [type, setType] = useState('Todos');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const localDate = date => new Date(date).toLocaleDateString('sv-SE', { timeZone: 'America/Lima' });
  const filtered = movements.filter(m => {
    const date = localDate(m.date);
    return (m.product + ' ' + m.sku).toLowerCase().includes(query.toLowerCase()) &&
      (type === 'Todos' || m.type === type) && (!from || date >= from) && (!to || date <= to);
  });
  return <div className={s.page}>
    <div className={s.header}><div><h1 className={s.title}>Historial de movimientos</h1><p className={s.muted}>Consulta las entradas, salidas y cambios de tu inventario.</p></div>
    </div>
    <div className={s.cards}>{[['Entradas', 'Entrada', ArrowDownLeft], ['Salidas', 'Salida', ArrowUpRight], ['Otros cambios', 'Otros', SlidersHorizontal]].map(([label, kind, Icon]) =>
      <div className={s.card} key={kind}><div className={s.sectionTitle}><Icon size={20} color="#d62839" />{label}</div><strong className={s.number}>{filtered.filter(m => kind === 'Otros' ? !['Entrada', 'Salida'].includes(m.type) : m.type === kind).length}</strong><span className={s.muted}>Movimientos según los filtros</span></div>)}</div>
    <div className={s.filters}>
      <label className={s.field} style={{ flex: 1, minWidth: 200 }}>Buscar producto<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nombre o SKU" /></label>
      <label className={s.field}>Movimiento<select value={type} onChange={e => setType(e.target.value)}>{['Todos', 'Entrada', 'Salida', 'Ajuste', 'Alta', 'Baja'].map(t => <option key={t}>{t}</option>)}</select></label>
      <label className={s.field}>Desde<input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} /></label>
      <label className={s.field}>Hasta<input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></label>
    </div>
    <div className={s.tableWrap}>{filtered.length ? <table className={s.table}><thead><tr>{['Fecha y hora', 'Producto', 'Movimiento', 'Cantidad', 'Stock', 'Usuario / Motivo'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{filtered.map(m => <tr key={m.id}>
      <td>{new Date(m.date).toLocaleString('es-PE', { timeZone: 'America/Lima' })}</td><td><strong>{m.product}</strong><p className={s.muted}>{m.sku}</p></td><td><span className={s.badge}>{m.type}</span></td><td>{m.quantity > 0 ? '+' : ''}{m.quantity}</td><td>{m.before} → {m.after}</td><td>{m.user}<p className={s.muted}>{m.reason}</p></td>
    </tr>)}</tbody></table> : <div className={s.empty}><History size={36} color="#a8a29e" style={{ marginBottom: 12 }} /><h2 className={s.sectionTitle} style={{ justifyContent: 'center' }}>{movements.length ? 'No hay coincidencias' : 'Aún no hay movimientos'}</h2><p className={s.muted}>{movements.length ? 'Prueba con otros filtros.' : 'Agrega un producto o modifica sus existencias en Inventario para ver el registro aquí.'}</p></div>}</div>
  </div>;
}
