import { useEffect, useRef, useState } from 'react';
import { stockValidation } from '../pages/movementData';
import s from '../pages/Management.module.css';
import ui from '../pages/InventoryUI.module.css';
import { X } from 'lucide-react';

export default function StockDialog({ products, saving, uncertain, error, onSave, onRetry, onClose, onSuccess }) {
  const dialog = useRef(null);
  const locked = useRef(false);
  const [productId, setProductId] = useState('');
  const [action, setAction] = useState('stock_in');
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');
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
  async function submit(event, retry = false) {
    event.preventDefault();
    if (locked.current || saving || (uncertain && !retry)) return;
    const message = retry ? '' : stockValidation(product, action, quantity, reason);
    setValidation(message);
    if (message) return;
    locked.current = true;
    setPending(true);
    try {
      if (await (retry ? onRetry() : onSave(product, action, { quantity: Number(quantity), reason: reason.trim() }))) onSuccess();
    } catch (error) { setValidation(error.message); }
    finally { locked.current = false; setPending(false); }
  }
  const valid = !stockValidation(product, action, quantity, reason);
  return <dialog ref={dialog} className={`${s.accountDialog} ${ui.compactDialog}`} aria-labelledby="stock-title" onCancel={e => { e.preventDefault(); if (!disabled) onClose(); }}>
    <header className={ui.dialogHeading}><div><span className={ui.eyebrow}>CONTROL DE EXISTENCIAS</span><h2 id="stock-title">Registrar movimiento de stock</h2></div><button type="button" className={ui.close} aria-label="Cerrar movimiento" disabled={disabled} onClick={onClose}><X size={18} aria-hidden="true" /></button></header>
    <form className={s.stack} onSubmit={submit}>
      <label className={s.field}>Producto / SKU<select required disabled={disabled} value={productId} onChange={e => setProductId(e.target.value)}><option value="">Selecciona un SKU</option>{products.map(p => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select></label>
      <label className={s.field}>Tipo<select disabled={disabled} value={action} onChange={e => setAction(e.target.value)}><option value="stock_in">Entrada</option><option value="stock_out">Salida</option><option value="stock_adjust">Ajuste de inventario</option></select></label>
      <label className={s.field}>{action === 'stock_adjust' ? 'Variación (+ agrega / − retira)' : 'Cantidad'}<input type="number" required step="1" min={action === 'stock_adjust' ? '-2147483647' : '1'} max="2147483647" value={quantity} disabled={disabled} onChange={e => setQuantity(e.target.value)} /></label>
      <label className={s.field}>Motivo obligatorio<input required maxLength={500} value={reason} disabled={disabled} onChange={e => setReason(e.target.value)} /></label>
      {product && <p className={s.muted}>Stock actual: {product.stock}{valid ? ` → Stock final: ${product.stock + (action === 'stock_out' ? -Number(quantity) : Number(quantity))}` : ''}</p>}
      {(error || validation) && <p className={ui.alert} role="alert">{error || validation}</p>}
      {uncertain && <p className={s.muted}>Confirmación pendiente. Reintenta el mismo movimiento sin duplicarlo.</p>}
      <div className={s.companyActions}><button type="button" className={ui.secondary} disabled={disabled} onClick={onClose}>Cancelar</button>{uncertain ? <button type="button" className={ui.primary} disabled={saving || pending} onClick={e => submit(e, true)}>Reintentar guardado</button> : <button className={ui.primary} disabled={disabled}>{saving || pending ? 'Guardando…' : 'Confirmar movimiento'}</button>}</div>
    </form>
  </dialog>;
}
