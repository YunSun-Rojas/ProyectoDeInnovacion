import s from './InventoryLoading.module.css';

export default function InventoryLoading({ label = 'Cargando inventario', compact = false, className = '' }) {
  const Component = compact ? 'span' : 'div';
  return (
    <Component className={`${s.loading} ${compact ? s.compact : ''} ${className}`.trim()} role="status">
      <span className={s.spinner} aria-hidden="true" />
      {label ? <span className={s.label}>{label}</span> : null}
    </Component>
  );
}
