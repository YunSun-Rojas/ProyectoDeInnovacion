import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import { useInventory } from './hooks/useInventory';
import s from './pages/Management.module.css';

export default function InventarioLayout({ userId }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activePage = pathname.split("/")[2] || "dashboard";
  const setActivePage = (page) => navigate(page === "dashboard" ? "/dashboard" : `/dashboard/${page}`);
  const inventory = useInventory(userId);
  const { products, status, error, retry } = inventory;
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const notify = useCallback((message, type = 'success') => {
    setToast({ message, type });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem('eagle-dark-mode') === 'true'; }
    catch { return false; }
  });
  const [themeError, setThemeError] = useState('');
  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    setThemeError('');
    try { localStorage.setItem('eagle-dark-mode', String(next)); }
    catch { setThemeError('El tema se aplicó, pero no pudo guardarse en este navegador.'); }
  };
  const [settings, setSettings] = useState(() => {
    const defaults = { company: 'Eagle Gaming', ruc: '20607787728', address: 'C.C. Garcilazo de la Vega 1348, Tda. 1B, 133', phone: '986638034', minStock: 5 };
    try {
      const saved = JSON.parse(localStorage.getItem('eagle-company-settings'));
      for (const key of ['company', 'ruc', 'address', 'phone', 'description']) {
        if (typeof saved?.[key] === 'string') defaults[key] = saved[key];
      }
    } catch {
      // Use the company defaults if browser storage is unavailable or invalid.
    }
    return defaults;
  });

  return (
    <div className="inventory-shell" data-theme={darkMode ? 'dark' : 'light'} style={{ display: "flex", width: "100%", height: "100dvh", overflow: "hidden" }}>
      <Sidebar activePage={activePage} setActivePage={setActivePage} />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, background: "var(--inventory-bg, #F1F5F9)" }}>
        <Header products={products} inventoryReady={status === 'ready'} />

        <main className="inventory-main" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {status === 'ready' || activePage === 'configuracion' ? (
            <Outlet context={{ ...inventory, settings, setSettings, darkMode, toggleDarkMode, themeError, defaultMinStock: settings.minStock, onNavigate: setActivePage, notify }} />
          ) : (
            <div className={s.page}>
              <section className={s.card} aria-busy={status === 'loading'}>
                {status === 'loading' ? <p className={s.muted} role="status">Cargando inventario…</p> : <>
                  <p className={s.formError} role="alert">{error}</p>
                  <button type="button" className={s.button} onClick={retry}>Reintentar</button>
                </>}
              </section>
            </div>
          )}
        </main>
      </div>
      {toast && <div role="status" aria-live="polite" style={{
        position: "fixed",
        right: 24,
        bottom: 24,
        zIndex: 300,
        maxWidth: "min(380px, calc(100vw - 48px))",
        padding: "13px 18px",
        borderRadius: 10,
        background: toast.type === 'error' ? "var(--inventory-danger, #8F1B26)" : "var(--inventory-accent, #E32636)",
        color: "#FFF",
        boxShadow: "0 8px 24px rgb(0 0 0 / 22%)",
        fontFamily: "Inter, sans-serif",
        fontSize: 14,
        fontWeight: 600
      }}>{toast.message}</div>}
    </div>
  );
}

