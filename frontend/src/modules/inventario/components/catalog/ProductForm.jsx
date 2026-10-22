import { useId, useRef, useState } from 'react';
import { catalogFormValues, validateCatalogForm, quantity } from '../../../../../../shared/catalogProduct.js';
import styles from './ProductCatalog.module.css';
import ui from '../../pages/InventoryUI.module.css';

export default function ProductForm({ product, products = [], categories = [], currentUser = null, readOnly = false,
  onSave, onRetry, busy = false, uncertain = false, error = '', defaultMinStock = 5 }) {
  const id = useId();
  const [form, setForm] = useState(() => ({ ...catalogFormValues(product, categories[0]),
    minStock: product?.minStock ?? defaultMinStock, stock: 0 }));
  const author = product
    ? product.createdByName || product.createdByEmail || product.created_by_name || product.created_by_email || ''
    : [currentUser?.name, currentUser?.fullName, currentUser?.user_metadata?.full_name,
      currentUser?.user_metadata?.name, currentUser?.email].find(value => typeof value === 'string' && value.trim())?.trim() || '';
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
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
    if (disabled || submitLock.current) return;
    const data = { ...form };
    // Omitir atributos ocultos conserva sus valores históricos en el patch.
    delete data.purchaseCost;
    delete data.barcode;
    delete data.unitOfMeasure;
    if (!product) data.unitOfMeasure = 'Unidad';
    try {
      const payload = validateCatalogForm(data, { products, productId: product?.id, categories });
      if (!product) payload.stock = quantity(form.stock, 'Stock inicial');
      if (!product && onSave) {
        if (!author) throw new Error('No se pudo identificar tu sesión. Vuelve a iniciar sesión antes de registrar el producto.');
        if (author.length > 120) throw new Error('El nombre de tu cuenta supera los 120 caracteres permitidos. Actualiza tu perfil.');
        payload.createdByName = author;
      }
      if (!onSave) { setMessage('Datos válidos para revisión. No se guardó ningún cambio.'); return; }
      submitLock.current = true;
      setSubmitting(true);
      const confirmed = await onSave(payload);
      if (!confirmed) setMessage('No se confirmó el guardado. Revisa el mensaje del servidor.');
    } catch (error) { setMessage(error.message); }
    finally { submitLock.current = false; setSubmitting(false); }
  }
  return <form className={`${styles.panel} ${styles.productForm}`} onSubmit={validate}>
    <header><p className={styles.eyebrow}>CATÁLOGO DE PRODUCTOS</p><h2>{product ? 'Editar producto' : 'Nuevo producto'}</h2>
      <p>{onSave ? 'Completa los datos del producto.' : 'Vista de revisión sin guardado.'}</p></header>
    <fieldset><legend>Datos del producto</legend><div className={styles.grid}>
      {field('sku', 'SKU', { maxLength: 100, required: true })}
      {field('name', 'Nombre del producto', { maxLength: 500, required: true })}
      <label className={styles.field} htmlFor={`${id}-category`}><span>Categoría</span>
        <select id={`${id}-category`} value={form.category} disabled={disabled} required onChange={e => change('category', e.target.value)}>
          <option value="">Selecciona una categoría</option>{categories.map(category => <option key={category}>{category}</option>)}
        </select></label>
      {field('brand', 'Marca (opcional)', { maxLength: 120 })}{field('model', 'Modelo (opcional)', { maxLength: 160 })}
    </div></fieldset>
    <fieldset><legend>Características</legend><div className={styles.grid}>
      <label className={`${styles.field} ${styles.full}`} htmlFor={`${id}-characteristics`}><span>Descripción o características (opcional)</span>
        <textarea id={`${id}-characteristics`} rows={2} maxLength={4000} value={form.characteristics} disabled={disabled}
          onChange={e => change('characteristics', e.target.value)} /></label>
    </div></fieldset>
    <fieldset><legend>Precio y existencias</legend><div className={styles.grid}>
      <label className={styles.field} htmlFor={`${id}-price`}><span>Precio de venta (PEN)</span>
        <div className={styles.moneyInput}><span aria-hidden="true">S/</span>
          <input id={`${id}-price`} aria-label="Precio de venta en soles peruanos" inputMode="decimal" required
            pattern="[0-9]+([.][0-9]{1,2})?" title="Usa números con hasta dos decimales, por ejemplo 50.90"
            placeholder="0.00" value={form.price} disabled={disabled}
            onChange={e => { if (/^\d*(?:\.\d{0,2})?$/.test(e.target.value)) change('price', e.target.value); }} />
        </div></label>
      {!product && onSave && field('stock', 'Stock inicial', { inputMode: 'numeric', required: true })}
      {field('minStock', 'Stock mínimo', { inputMode: 'numeric', required: true })}
      <label className={styles.field} htmlFor={`${id}-active`}><span>Estado administrativo</span>
        <select id={`${id}-active`} value={String(form.isActive)} disabled={disabled} onChange={e => change('isActive', e.target.value === 'true')}>
          <option value="true">Activo</option><option value="false">Inactivo</option></select></label>
    </div></fieldset>
    <fieldset><legend>Información de registro</legend>
      <label className={styles.field} htmlFor={`${id}-createdByName`}><span>Registrado por</span>
        <input id={`${id}-createdByName`} value={author} readOnly disabled={disabled} placeholder={product ? 'No registrado' : 'Sesión no disponible'} />
      </label></fieldset>
    {error && <p role="alert">{error}</p>}
    <p role="status" aria-live="polite">{error ? '' : message}</p>
    <footer className={styles.actions}>
      {uncertain && onRetry && <button type="button" className={ui.savingButton} aria-busy={busy || submitting} disabled={busy || submitting} onClick={onRetry}>{busy || submitting ? 'Guardando…' : 'Reintentar guardado'}</button>}
      <button type="submit" className={ui.savingButton} aria-busy={busy || submitting} disabled={disabled}>{busy || submitting ? 'Guardando…' : onSave ? (product ? 'Guardar cambios' : 'Registrar producto') : 'Validar borrador'}</button>
      {!onSave && <button type="button" disabled>Guardar · vista de revisión</button>}
    </footer>
  </form>;
}
