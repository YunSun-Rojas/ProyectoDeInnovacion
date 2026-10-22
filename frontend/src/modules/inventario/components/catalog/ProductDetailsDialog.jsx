import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import ProductDetails from './ProductDetails';
import styles from './ProductCatalog.module.css';

// Consulta el DTO ya autorizado y cargado por el catálogo. No realiza peticiones.
export default function ProductDetailsDialog({ product, onClose }) {
  const dialog = useRef(null);
  const dismiss = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = 'hidden';
    dismiss.current?.focus();
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  return <dialog ref={dialog} className={`${styles.dialog} ${styles.detailsDialog}`} aria-label={`Ficha de ${product?.name || 'producto'}`}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <button className={styles.detailsClose} ref={dismiss} type="button" onClick={onClose} aria-label="Cerrar ficha"><X size={18} aria-hidden="true" /></button>
    <ProductDetails product={product} canReadPurchaseCost />
  </dialog>;
}
