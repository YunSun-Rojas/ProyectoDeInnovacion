import { useOutletContext } from 'react-router-dom';
import { Building2, UserRound, KeyRound, Moon, ChevronRight } from 'lucide-react';
import s from './Management.module.css';

export default function Config() {
  const { settings } = useOutletContext();
  return (
    <div className={s.page}>
      <div className={s.header}>
        <div><h1 className={s.title}>Configuración</h1><p className={s.muted}>Información de la empresa y opciones de tu cuenta.</p></div>
      </div>
      <div className={s.stack}>
        <section className={s.card}>
          <h2 className={s.sectionTitle}><Building2 size={21} color="#d62839" /> Empresa</h2>
          <div className={s.companyGrid}>
            <div>
              <div className={s.companyBrand}>
                <img src="/logo-Eagle.png" alt="Logo de Eagle Gaming" width="72" height="72" style={{ objectFit: 'contain' }} />
                <strong>{settings.company}</strong>
              </div>
              <p className={s.muted}>Eagle Gaming Perú es una empresa dedicada a la venta de productos de tecnología y gaming. Importamos las mejores marcas del mercado para ofrecer a nuestros clientes lo último en hardware. Nos destacamos por nuestra variedad de productos, precios competitivos y un fuerte compromiso con la calidad y el servicio al cliente.</p>
            </div>
            <dl className={s.companyDetails}>
              <div><dt>RUC</dt><dd>{settings.ruc}</dd></div>
              <div><dt>Dirección</dt><dd>{settings.address}</dd></div>
              <div><dt>Celular</dt><dd>{settings.phone}</dd></div>
            </dl>
          </div>
        </section>
        <section className={s.card}>
          <h2 className={s.sectionTitle}><UserRound size={21} color="#d62839" /> Mi cuenta</h2>
          <div className={s.accountSummary}><strong>Admin4@gmail.com</strong></div>
          <div className={s.accountOptions}>
            <button type="button" disabled className={s.accountOption}>
              <UserRound size={20} /><span>Personalización de perfil</span><ChevronRight size={18} />
            </button>
            <button type="button" disabled className={s.accountOption}>
              <KeyRound size={20} /><span>Cambiar contraseña</span><ChevronRight size={18} />
            </button>
            <button type="button" disabled className={s.accountOption}>
              <Moon size={20} /><span>Modo oscuro</span><span className={s.previewSwitch} aria-hidden="true" />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
