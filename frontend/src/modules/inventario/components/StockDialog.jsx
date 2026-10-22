import { useEffect, useRef, useState } from 'react';
import { stockValidation } from '../pages/movementData';
import s from '../pages/Management.module.css';
import ui from '../pages/InventoryUI.module.css';
import styles from '../pages/Existencias.module.css';
import { X } from 'lucide-react';

export default function StockDialog({ products, initialProductId = '', saving, uncertain, error, onSave, onRetry, onClose, onSuccess, notify }) {
  const dialog = useRef(null);
  const dismiss = useRef(null);
  const locked = useRef(false);
  const [submittedProduct, setSubmittedProduct] = useState(null);
  const [productId, setProductId] = useState(() => products.some(product => String(product.id) === String(initialProductId)) ? String(initialProductId) : '');
  const [action, setAction] = useState('stock_in');
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');
  const [validation, setValidation] = useState('');
  const [pending, setPending] = useState(false);
  const [closing, setClosing] = useState(false);
  const product = products.find(p => String(p.id) === productId);
  const disabled = pending || saving || uncertain || closing;
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    const overflow = document.body.style.overflow;
    element.showModal();
    dismiss.current?.focus(); document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    if (!closing) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onClose(); return; }
    const timer = window.setTimeout(onClose, 180);
    return () => window.clearTimeout(timer);
  }, [closing, onClose]);
  async function submit(event, retry = false) {
    event.preventDefault();
    if (locked.current || saving || closing || (uncertain && !retry)) return;
    const message = retry ? '' : stockValidation(product, action, quantity, reason);
    setValidation(message);
    if (message) return;
    if (!retry && product) setSubmittedProduct({ ...product });
    locked.current = true;
    setPending(true);
    try {
      if (await (retry ? onRetry() : onSave(product, action, { quantity: Number(quantity), reason: reason.trim() }))) {
        setClosing(true); onSuccess({ productId, action });
      } else setValidation('No se confirmó el movimiento. Revisa el mensaje antes de reintentar.');
    } catch (error) { setValidation(error.message); notify?.(error.message, 'error'); }
    finally { locked.current = false; setPending(false); }
  }
  const previewProduct = (pending || saving || uncertain || closing) && submittedProduct ? submittedProduct : product;
  const valid = !stockValidation(previewProduct, action, quantity, reason);
  return <dialog ref={dialog} className={`${s.accountDialog} ${ui.compactDialog} ${styles.stockDialog} ${closing ? styles.closing : ''}`} aria-labelledby="stock-title"
    onAnimationEnd={event => { if (closing && event.target === event.currentTarget) onClose(); }}
    onCancel={e => { e.preventDefault(); if (!disabled) setClosing(true); }}>
    <header className={ui.dialogHeading}><h2 id="stock-title">Registrar movimiento</h2><button ref={dismiss} type="button" className={ui.close} aria-label="Cerrar movimiento" disabled={disabled} onClick={() => setClosing(true)}><X size={18} aria-hidden="true" /></button></header>
    <form className={s.stack} onSubmit={submit}>
      <label className={`${s.field} ${ui.productFilters}`}>Producto / SKU<select required disabled={disabled} value={productId} onChange={e => setProductId(e.target.value)}><option value="">Selecciona un producto</option>{products.map(p => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select></label>
      <label className={`${s.field} ${ui.productFilters}`}>Tipo<select disabled={disabled} value={action} onChange={e => setAction(e.target.value)}><option value="stock_in">Entrada</option><option value="stock_out">Salida</option><option value="stock_adjust">Ajuste de inventario</option></select></label>
      <label className={s.field}>{action === 'stock_adjust' ? 'Variación (+ agrega / − retira)' : 'Cantidad'}<input type="number" required step="1" min={action === 'stock_adjust' ? '-2147483647' : '1'} max="2147483647" value={quantity} disabled={disabled} onChange={e => setQuantity(e.target.value)} /></label>
      <label className={s.field}>Motivo obligatorio<input required maxLength={500} value={reason} disabled={disabled} onChange={e => setReason(e.target.value)} /></label>
      {previewProduct && <p className={styles.preview}>Stock actual: <strong>{previewProduct.stock}</strong>{valid ? <> · Nuevo stock (estimado): <strong>{previewProduct.stock + (action === 'stock_out' ? -Number(quantity) : Number(quantity))}</strong></> : ''}</p>}
      {(error || validation) && <p className={ui.alert} role="alert">{error || validation}</p>}
      {uncertain && <p className={s.muted}>Confirmación pendiente. Reintenta el mismo movimiento sin duplicarlo.</p>}
      <div className={s.companyActions}><button type="button" className={ui.secondary} disabled={disabled} onClick={() => setClosing(true)}>Cancelar</button>{uncertain ? <button type="button" className={`${ui.primary} ${ui.savingButton}`} aria-busy={Boolean(saving || pending)} disabled={saving || pending || closing} onClick={e => submit(e, true)}>{saving || pending ? 'Registrando…' : 'Reintentar guardado'}</button> : <button className={`${ui.primary} ${ui.savingButton}`} aria-busy={Boolean(saving || pending)} disabled={disabled}>{saving || pending ? 'Registrando…' : 'Confirmar movimiento'}</button>}</div>
    </form>
  </dialog>;
}
