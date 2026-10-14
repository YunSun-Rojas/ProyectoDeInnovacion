import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { saleValidation } from '../pages/salesData';
import s from '../pages/Dashboard.module.css';

const money = value => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(value);

export default function SaleDialog({ products, saving, uncertain, error, onSave, onRetry, onClose, onSuccess, className = '' }) {
  const dialog = useRef(null);
  const locked = useRef(false);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const [validation, setValidation] = useState('');
  const [pending, setPending] = useState(false);
  const product = products.find(p => String(p.id) === productId);
  const disabled = pending || saving || uncertain;
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    element.showModal();
    return () => { element.close(); requestAnimationFrame(() => trigger?.focus()); };
  }, []);
  function selectProduct(event) {
    const id = event.target.value;
    setProductId(id);
    setPrice(String(products.find(p => String(p.id) === id)?.price ?? ''));
    setValidation('');
  }
  async function submit(event, retry = false) {
    event.preventDefault();
    if (locked.current || saving || (uncertain && !retry)) return;
    const message = retry ? '' : saleValidation(product, quantity, price);
    setValidation(message);
    if (message) return;
    locked.current = true;
    setPending(true);
    try {
      const ok = await (retry ? onRetry() : onSave(product, { quantity: Number(quantity), unitPrice: Number(price) }));
      if (ok) onSuccess();
      else setValidation('La venta no se confirmó. Revisa el mensaje antes de reintentar.');
    } catch (reason) { setValidation(reason.message || 'No se pudo guardar la venta.'); }
    finally { locked.current = false; setPending(false); }
  }
  const valid = product && !saleValidation(product, quantity, price);
  return <dialog className={`${s.dialog} ${className}`} ref={dialog} aria-labelledby="sale-title" onCancel={e => { e.preventDefault(); if (!disabled) onClose(); }}>
    <div className={s.dialogHeading}><div><span className={s.eyebrow}>SALIDA POR VENTA</span><h2 id="sale-title">Registrar venta</h2></div><button type="button" className={s.iconButton} aria-label="Cerrar venta" disabled={disabled} onClick={onClose}><X size={20} /></button></div>
    <form onSubmit={submit}>
      <label htmlFor="sale-product">Producto</label><select id="sale-product" value={productId} onChange={selectProduct} required disabled={disabled}><option value="">Selecciona un producto</option>{products.filter(p => p.stock > 0).map(p => <option key={p.id} value={String(p.id)}>{p.name} · {p.sku}</option>)}</select>
      {product && <p className={s.stockPreview}>Disponibles: <strong>{product.stock} unidades</strong></p>}
      <label htmlFor="sale-quantity">Cantidad vendida</label><input id="sale-quantity" type="number" min="1" step="1" max={product?.stock} required disabled={disabled} value={quantity} onChange={e => setQuantity(e.target.value)} />
      <label htmlFor="sale-price">Precio aplicado por unidad (S/)</label><input id="sale-price" type="number" min="0" max="9999999999.99" step="0.01" required disabled={disabled} value={price} onChange={e => setPrice(e.target.value)} />
      <p className={s.stockPreview}></p>
      {valid && <p className={s.stockPreview}>Total: <strong>{money(Math.round(Number(price) * 100) * Number(quantity) / 100)}</strong> · Stock restante: <strong>{product.stock - Number(quantity)}</strong></p>}
      {(validation || error) && <p className={s.error} role="alert">{error || validation}</p>}
      {uncertain && <p className={s.notice}>Hay un guardado pendiente de confirmar. Reintenta para comprobarlo sin duplicar la venta.</p>}
      <div className={s.dialogActions}><button type="button" className={s.button} disabled={disabled} onClick={onClose}>Cancelar</button>{uncertain ? <button type="button" className={s.primary} disabled={saving || pending} onClick={e => submit(e, true)}>Reintentar guardado</button> : <button className={s.primary} disabled={disabled}>{saving || pending ? 'Guardando…' : 'Confirmar venta'}</button>}</div>
    </form>
  </dialog>;
}
