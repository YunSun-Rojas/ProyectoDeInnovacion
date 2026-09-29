import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Building2, UserRound, KeyRound, Moon, ChevronRight, Pencil, Palette } from 'lucide-react';
import s from './Management.module.css';
import { useAuthSession } from '../../auth/hooks/useAuthSession';
import AccountDialog from '../components/AccountDialog';

const description = 'Eagle Gaming Perú es una empresa dedicada a la venta de productos de tecnología y gaming. Importamos las mejores marcas del mercado para ofrecer a nuestros clientes lo último en hardware. Nos destacamos por nuestra variedad de productos, precios competitivos y un fuerte compromiso con la calidad y el servicio al cliente.';

export default function Config() {
  const { settings, setSettings, darkMode, toggleDarkMode, themeError } = useOutletContext();
  const { session, loading } = useAuthSession();
  const user = session?.user;
  const [draft, setDraft] = useState(null);
  const [message, setMessage] = useState('');
  const [accountMode, setAccountMode] = useState(null);
  const [accountMessage, setAccountMessage] = useState('');
  const updateDraft = (event) => setDraft(previous => ({ ...previous, [event.target.name]: event.target.value }));
  const saveCompany = (event) => {
    event.preventDefault();
    const company = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()]));
    try {
      localStorage.setItem('eagle-company-settings', JSON.stringify(company));
    } catch {
      setMessage('No se pudo guardar la información en este navegador. Inténtalo nuevamente.');
      return;
    }
    setSettings(previous => ({ ...previous, ...company }));
    setDraft(null);
    setMessage('Información guardada en este navegador.');
  };
  return (
    <div className={s.page}>
      <div className={s.header}>
        <div><h1 className={s.title}>Configuración</h1><p className={s.muted}>Información de la empresa, opciones de tu cuenta y apariencia.</p></div>
      </div>
      <div className={s.stack}>
        <section className={s.card}>
          <div className={s.companyHeading}>
            <h2 className={s.sectionTitle}><Building2 size={21} color="#E71950" /> Empresa</h2>
            {!draft && <button type="button" className={`${s.button} ${s.companyEdit}`} onClick={() => {
              setDraft({ company: settings.company, ruc: settings.ruc, address: settings.address, phone: settings.phone, description: settings.description ?? description });
              setMessage('');
            }}><Pencil size={14} /> Editar información</button>}
          </div>
          {message && <p className={s.muted} role="status">{message}</p>}
          {draft ? (
            <form onSubmit={saveCompany} className={s.stack}>
              <div className={s.grid}>
                <label className={s.field}>Nombre de la empresa
                  <input autoFocus name="company" value={draft.company} onChange={updateDraft} required pattern=".*\S.*" maxLength={100} />
                </label>
                <label className={s.field}>RUC
                  <input name="ruc" value={draft.ruc} onChange={updateDraft} required inputMode="numeric" pattern="[0-9]{11}" maxLength={11} title="Ingresa los 11 dígitos del RUC." />
                </label>
                <label className={s.field}>Dirección
                  <input name="address" value={draft.address} onChange={updateDraft} required pattern=".*\S.*" maxLength={200} />
                </label>
                <label className={s.field}>Celular
                  <input type="tel" name="phone" value={draft.phone} onChange={updateDraft} required pattern="[+]?[0-9 \(\)\-]{9,20}" maxLength={20} title="Ingresa un teléfono válido, con código de país si corresponde." />
                </label>
              </div>
              <label className={s.field}>Descripción de la empresa
                <textarea className={s.companyDescription} name="description" value={draft.description} onChange={updateDraft} rows={4} maxLength={1000} />
              </label>
              <div className={s.companyActions}>
                <button type="button" className={s.secondaryButton} onClick={() => { setDraft(null); setMessage(''); }}>Cancelar</button>
                <button type="submit" className={`${s.button} ${s.companyEdit}`}>Guardar cambios</button>
              </div>
            </form>
          ) : <div className={s.companyGrid}>
            <div>
              <div className={s.companyBrand}>
                <img src="/logo-Eagle.png" alt="Logo de Eagle Gaming" width="72" height="72" style={{ objectFit: 'contain' }} />
                <strong>{settings.company}</strong>
              </div>
              <p className={s.muted}>{settings.description ?? description}</p>
            </div>
            <dl className={s.companyDetails}>
              <div><dt>RUC</dt><dd>{settings.ruc}</dd></div>
              <div><dt>Dirección</dt><dd>{settings.address}</dd></div>
              <div><dt>Celular</dt><dd>{settings.phone}</dd></div>
            </dl>
          </div>}
        </section>
        <section className={s.card}>
          <h2 className={s.sectionTitle}><UserRound size={21} color="#E71950" /> Mi cuenta</h2>
          <div className={s.accountSummary}><strong>{loading ? 'Cargando cuenta…' : user?.email || 'Sesión no disponible'}</strong></div>
          {accountMessage && <p className={s.muted} role="status">{accountMessage}</p>}
          <div className={s.accountOptions}>
            <button type="button" disabled={!user || loading} className={s.accountOption} onClick={() => { setAccountMessage(''); setAccountMode('profile'); }}>
              <UserRound size={20} /><span>Personalización de perfil</span><ChevronRight size={18} />
            </button>
            <button type="button" disabled={!user || loading} className={s.accountOption} onClick={() => { setAccountMessage(''); setAccountMode('password'); }}>
              <KeyRound size={20} /><span>Cambiar contraseña</span><ChevronRight size={18} />
            </button>
          </div>
        </section>
        <section className={s.card}>
          <h2 className={s.sectionTitle}><Palette size={21} color="#E71950" /> Apariencia</h2>
          <div className={s.accountOptions}>
            <button type="button" className={s.accountOption} role="switch" aria-checked={darkMode} onClick={toggleDarkMode}>
              <Moon size={20} /><span>Modo oscuro</span><span className={s.previewSwitch} aria-hidden="true" />
            </button>
          </div>
          {themeError && <p className={s.formError} role="status">{themeError}</p>}
        </section>
      </div>
      {accountMode && user && <AccountDialog key={`${user.id}-${accountMode}`} mode={accountMode} user={user}
        onDismiss={() => setAccountMode(null)} onSaved={text => { setAccountMessage(text); setAccountMode(null); }} />}
    </div>
  );
}
