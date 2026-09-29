import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LogOut } from 'lucide-react';
import styles from './LogoutDialog.module.css';

export default function LogoutDialog({ onDismiss, onConfirm, busy, error }) {
  const dialogRef = useRef(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  // Still dismiss if an extension or browser setting disables CSS animations.
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(onDismiss, 200);
    return () => window.clearTimeout(timer);
  }, [closing, onDismiss]);

  const dismiss = () => {
    if (!busy) setClosing(true);
  };

  return createPortal(
    <dialog
      id="logout-dialog"
      ref={dialogRef}
      className={`${styles.dialog} ${closing ? styles.closing : ''}`}
      aria-labelledby="logout-title"
      aria-busy={busy}
      onCancel={event => { event.preventDefault(); dismiss(); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismiss();
      }}
      onAnimationEnd={event => {
        if (closing && event.target === event.currentTarget) {
          dialogRef.current.close();
          onDismiss();
        }
      }}
    >
      <div className={styles.icon}><LogOut size={25} aria-hidden="true" /></div>
      <h2 id="logout-title" className={styles.title}>¿Estás seguro de que deseas cerrar tu sesión?</h2>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" autoFocus className={styles.cancel} disabled={busy || closing} onClick={dismiss}>Cancelar</button>
        <button type="button" className={styles.confirm} disabled={busy || closing} onClick={onConfirm}>
          {busy ? 'Cerrando sesión…' : 'Cerrar sesión'}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
