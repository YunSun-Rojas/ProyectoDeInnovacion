import { useId, useState } from 'react';
import { catalogFormValues, validateCatalogForm, quantity } from '../../../../../../shared/catalogProduct.js';
import ProductImage from './ProductImage';
import styles from './ProductCatalog.module.css';

export default function ProductForm({ product, products = [], categories = [], canReadPurchaseCost = false, readOnly = false,
  onSave, onRetry, busy = false, uncertain = false, error = '', defaultMinStock = 5 }) {
  const id = useId();
  const [form, setForm] = useState(() => ({ ...catalogFormValues(product, categories[0]),
    minStock: product?.minStock ?? defaultMinStock, stock: 0, createdByName: product?.createdByName ?? '' }));
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const disabled = readOnly || busy || uncertain || submitting;
  function change(key, value) { setForm(previous => ({ ...previous, [key]: value })); setMessage(''); }
  function field(key, label, options = {}) {
    return <label className={styles.field} htmlFor={`${id}-${key}`} key={key}>
      <span>{label}</span><input id={`${id}-${key}`} value={form[key]} disabled={disabled}
        onChange={event => change(key, event.target.value)} {...options} />
    </label>;
  }
  async function validate(event) {
    event.preventDefault();
    if (disabled) return;
    const data = { ...form };
    if (!canReadPurchaseCost) delete data.purchaseCost;
    try {
      const payload = validateCatalogForm(data, { products, productId: product?.id, categories, canWritePurchaseCost: canReadPurchaseCost });
      if (!product) payload.stock = quantity(form.stock, 'Stock inicial');
      if (form.createdByName.trim()) {
        if (form.createdByName.trim().length > 120) throw new Error('El nombre de registro admite hasta 120 caracteres.');
        payload.createdByName = form.createdByName.trim();
      } else if (!product && onSave) throw new Error('Escribe el nombre de quien registra el producto.');
      if (!onSave) { setMessage('Datos válidos para revisión. No se guardó ningún cambio.'); return; }
      setSubmitting(true);
      const confirmed = await onSave(payload);
      if (!confirmed) setMessage('No se confirmó el guardado. Revisa el mensaje del servidor.');
    } catch (error) { setMessage(error.message); }
    finally { setSubmitting(false); }
  }
  return <form className={styles.panel} onSubmit={validate}>
    <header><p className={styles.eyebrow}>CATÁLOGO DE PRODUCTOS</p><h2>{product ? 'Editar producto' : 'Nuevo producto'}</h2>
      <p>{onSave ? 'Completa los datos del producto.' : 'Vista de revisión sin guardado.'}</p></header>
    <fieldset><legend>A · Identificación</legend><div className={styles.grid}>
      {field('sku', 'SKU', { maxLength: 100, required: true })}
      {field('name', 'Nombre del producto', { maxLength: 500, required: true })}
      <label className={styles.field} htmlFor={`${id}-category`}><span>Categoría</span>
        <select id={`${id}-category`} value={form.category} disabled={disabled} required onChange={e => change('category', e.target.value)}>
          <option value="">Selecciona una categoría</option>{categories.map(category => <option key={category}>{category}</option>)}
        </select></label>
      {field('brand', 'Marca (opcional)', { maxLength: 120 })}{field('model', 'Modelo (opcional)', { maxLength: 160 })}
    </div></fieldset>
    <fieldset><legend>B · Características</legend><div className={styles.grid}>
      <label className={`${styles.field} ${styles.full}`} htmlFor={`${id}-characteristics`}><span>Descripción o características (opcional)</span>
        <textarea id={`${id}-characteristics`} rows={4} maxLength={4000} value={form.characteristics} disabled={disabled}
          onChange={e => change('characteristics', e.target.value)} /></label>
      {field('barcode', 'Código de barras (opcional)', { maxLength: 100 })}
      <div className={styles.field}><span>Fotografía (opcional)</span><ProductImage name={form.name} />
        <small>Disponible cuando se habilite el almacenamiento seguro.</small><button type="button" disabled>Cargar fotografía</button></div>
    </div></fieldset>
    <fieldset><legend>C · Información comercial</legend><div className={styles.grid}>
      {canReadPurchaseCost && field('purchaseCost', 'Costo de compra referencial (S/, opcional)', { inputMode: 'decimal' })}
      {field('price', 'Precio de venta (S/)', { inputMode: 'decimal', required: true })}
      {field('unitOfMeasure', 'Unidad de medida', { maxLength: 40, required: true })}
    </div></fieldset>
    <fieldset><legend>D · Control básico</legend><div className={styles.grid}>
      {field('minStock', 'Stock mínimo', { inputMode: 'numeric', required: true })}
      {!product && onSave && field('stock', 'Stock inicial', { inputMode: 'numeric', required: true })}
      {field('createdByName', 'Registrado por', { maxLength: 120, required: !product && Boolean(onSave) })}
      <label className={styles.field} htmlFor={`${id}-active`}><span>Estado administrativo</span>
        <select id={`${id}-active`} value={String(form.isActive)} disabled={disabled} onChange={e => change('isActive', e.target.value === 'true')}>
          <option value="true">Activo</option><option value="false">Inactivo</option></select></label>
    </div><p>Las existencias se administran mediante las operaciones de inventario existentes.</p></fieldset>
    {error && <p role="alert">{error}</p>}
    <p role="status" aria-live="polite">{message}</p>
    <footer className={styles.actions}>
      {uncertain && onRetry && <button type="button" disabled={busy || submitting} onClick={onRetry}>Reintentar guardado</button>}
      <button type="submit" disabled={disabled}>{busy || submitting ? 'Guardando…' : onSave ? (product ? 'Guardar cambios' : 'Registrar producto') : 'Validar borrador'}</button>
      {!onSave && <button type="button" disabled>Guardar · vista de revisión</button>}
    </footer>
  </form>;
}
