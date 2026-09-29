import { useEffect, useRef, useState } from 'react';
import { updateAccount, sendVerificationCode } from '../../auth/api/authApi';
import s from '../pages/Management.module.css';

const errors = {
  same_password: 'La nueva contraseña debe ser diferente de la actual.',
  weak_password: 'La contraseña no cumple los requisitos de seguridad del servidor. Prueba una más larga con letras, números y símbolos.',
  invalid_credentials: 'La contraseña actual no es correcta.',
  reauthentication_not_valid: 'El código no es válido o ha vencido. Solicita otro código.',
  over_request_rate_limit: 'Demasiados intentos. Espera unos minutos antes de volver a intentar.',
};

export default function AccountDialog({ mode, user, onDismiss, onSaved }) {
  const dialogRef = useRef(null);
  const pending = useRef(false);
  const [name, setName] = useState(typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [nonce, setNonce] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const profile = mode === 'profile';

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  const sendCode = async () => {
    await sendVerificationCode();
    setNotice('Te enviamos un código de verificación. Revísalo en el correo o teléfono asociado a tu cuenta.');
  };

  const save = async event => {
    event.preventDefault();
    if (pending.current) return;
    setError('');
    setNotice('');
    if (profile && !name.trim()) return setError('Ingresa tu nombre.');
    if (!profile && password !== confirmation) return setError('Las contraseñas nuevas no coinciden.');
    if (!profile && password === currentPassword) return setError(errors.same_password);
    pending.current = true;
    setBusy(true);
    try {
      const { error: authError } = await updateAccount(profile
        ? { mode: 'profile', name: name.trim() }
        : { mode: 'password', password, currentPassword, ...(needsCode ? { nonce: nonce.trim() } : {}) });
      if (authError?.code === 'reauthentication_needed') {
        setNeedsCode(true);
        await sendCode();
        return;
      }
      if (authError) throw authError;
      onSaved(profile ? 'Perfil actualizado correctamente.' : 'Contraseña actualizada correctamente.');
    } catch (failure) {
      setError(errors[failure.code] || 'No se pudo guardar el cambio. Revisa tu conexión y vuelve a intentarlo. Si tu sesión venció, inicia sesión nuevamente.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialogRef} className={s.accountDialog} aria-labelledby="account-dialog-title" aria-busy={busy}
      onCancel={event => { event.preventDefault(); if (!pending.current) onDismiss(); }}>
      <h2 id="account-dialog-title" className={s.sectionTitle}>{profile ? 'Personalización de perfil' : 'Cambiar contraseña'}</h2>
      <form onSubmit={save} className={s.stack}>
        {profile ? <>
          <label className={s.field}>Nombre para mostrar
            <input autoFocus autoComplete="name" value={name} onChange={event => setName(event.target.value)} required maxLength={100} disabled={busy} />
          </label>
          <label className={s.field}>Correo de tu cuenta
            <input type="email" value={user.email || ''} readOnly />
          </label>
          <p className={s.muted}>Tu nombre e iniciales aparecerán en la cabecera del inventario.</p>
        </> : <>
          <input type="hidden" autoComplete="username" value={user.email || ''} />
          <label className={s.field}>Contraseña actual
            <input autoFocus type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required disabled={busy} />
          </label>
          <label className={s.field}>Nueva contraseña
            <input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} required minLength={8} disabled={busy} aria-describedby="password-help" />
          </label>
          <p id="password-help" className={s.muted}>Usa al menos 8 caracteres. Combina letras, números y símbolos.</p>
          <label className={s.field}>Confirmar nueva contraseña
            <input type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} required minLength={8} disabled={busy} />
          </label>
          {needsCode && <>
            <label className={s.field}>Código de verificación
              <input autoComplete="one-time-code" inputMode="numeric" value={nonce} onChange={event => setNonce(event.target.value)} required disabled={busy} />
            </label>
            <button type="button" className={s.secondaryButton} disabled={busy} onClick={async () => {
              if (pending.current) return;
              pending.current = true;
              setBusy(true);
              setError('');
              try { await sendCode(); } catch { setError('No se pudo enviar el código. Inténtalo nuevamente.'); }
              finally { pending.current = false; setBusy(false); }
            }}>Enviar otro código</button>
          </>}
        </>}
        {error && <p className={s.formError} role="alert">{error}</p>}
        {notice && <p className={s.muted} role="status">{notice}</p>}
        <div className={s.companyActions}>
          <button type="button" className={s.secondaryButton} disabled={busy} onClick={onDismiss}>Cancelar</button>
          <button type="submit" className={`${s.button} ${s.companyEdit}`} disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
        </div>
      </form>
    </dialog>
  );
}
