import { useNavigate } from "react-router-dom";
import { useRef, useState } from "react";
import { logout } from "../../auth/api/authApi";
import LogoutDialog from "./LogoutDialog";
import s from './Sidebar.module.css';

import {
  LayoutGrid,
  Boxes,
  TrendingUp,
  Eye,
  History,
  Settings,
  LogOut,
  Package,
} from "lucide-react";

const NAV_GROUPS = [
  { label: 'INICIO', items: [{ id: 'dashboard', label: 'Panel de control', icon: LayoutGrid }] },
  { label: 'CATÁLOGO', items: [{ id: 'productos', label: 'Productos', icon: Boxes }] },
  { label: 'ALMACÉN', items: [
    { id: 'existencias', label: 'Existencias', icon: Package },
    { id: 'movimientos', label: 'Movimientos', icon: History },
  ] },
  { label: 'INTELIGENCIA ARTIFICIAL', items: [
    { id: 'prediccion', label: 'Predicción de demanda', icon: TrendingUp },
    { id: 'vision', label: 'Reconocimiento visual', icon: Eye },
  ] },
  { label: 'SISTEMA', items: [{ id: 'configuracion', label: 'Configuración', icon: Settings }] },
];

export default function Sidebar({ activePage, setActivePage }) {
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const logoutLock = useRef(false);
  const handleLogout = async () => {
    if (logoutLock.current) return;

    logoutLock.current = true;
    setLoggingOut(true);
    setLogoutError("");

    try {
      const result = await logout();

      if (!result.ok) {
        setLogoutError(
          result.error || "No se pudo cerrar la sesión."
        );
        return;
      }

      navigate("/login", { replace: true });
    } catch {
      setLogoutError(
        "No se pudo cerrar la sesión. Inténtalo nuevamente."
      );
    } finally {
      logoutLock.current = false;
      setLoggingOut(false);
    }
  };

  const navigationStyle = (isActive) => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "11px 12px",
    borderRadius: 8,
    border: "none",
    background: isActive ? "#FFFFFF" : "transparent",
    color: isActive ? "#E71950" : "#FFFFFF",
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: 13,
    fontWeight: isActive ? 650 : 500,
    cursor: "pointer",
    transition: "background 0.2s ease",
    textAlign: "left",
  });

  return (
    <>
      <aside
        className="inventory-sidebar"
        style={{
          width: 220,
          background: "#E71950",
          color: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          padding: "22px 12px 16px",
          flexShrink: 0,
          minHeight: 0,
          boxSizing: "border-box",
        }}
      >
        {/* Logo y nombre */}
        <div
          className="sidebar-brand"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "0 5px 26px",
            flexShrink: 0,
          }}
        >
          <img
            src="/logo-Eagle.png"
            alt="Logo de Eagle Gaming"
            style={{
              width: 42,
              height: 42,
              objectFit: "contain",
              flexShrink: 0,
            }}
          />

          <div>
            <h2
              style={{
                margin: 0,
                fontFamily: "Inter, system-ui, sans-serif",
                fontSize: 18,
                fontWeight: 800,
                lineHeight: 1.3,
                color: "#FFFFFF",
                letterSpacing: "-0.4px",
              }}
            >
              Eagle Gaming
            </h2>

            <span
              style={{
                display: "block",
                marginTop: 3,
                fontSize: 10,
                color: "rgba(255, 255, 255, 0.85)",
              }}
            >
              Inventario inteligente
            </span>
          </div>
        </div>

        {/* Navegación */}
        <nav
          aria-label="Navegación principal"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 5,
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            paddingBottom: 16,
            scrollbarWidth: "thin",
          }}
        >
          {NAV_GROUPS.map(group => <section className={s.group} key={group.label} aria-label={group.label}>
            <h2 className={s.heading}>{group.label}</h2>
            {group.items.map(({ id, label, icon: Icon }) => <button key={id} type="button"
              aria-label={label} title={label} aria-current={activePage === id ? 'page' : undefined}
              onClick={() => setActivePage(id)} style={navigationStyle(activePage === id)}>
              <Icon size={17} aria-hidden="true" /><span className="sidebar-label">{label}</span>
            </button>)}
          </section>)}        </nav>

        {/* Cerrar sesión */}
        <div
          className="sidebar-footer"
          style={{
            borderTop: "1px solid rgba(255, 255, 255, 0.25)",
            paddingTop: 12,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            disabled={loggingOut}
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
            aria-busy={loggingOut}
            aria-haspopup="dialog"
            aria-expanded={showLogoutDialog}
            aria-controls={
              showLogoutDialog ? "logout-dialog" : undefined
            }
            onClick={() => {
              setLogoutError("");
              setShowLogoutDialog(true);
            }}
            style={{
              ...navigationStyle(false),
              opacity: loggingOut ? 0.6 : 1,
              cursor: loggingOut ? "wait" : "pointer",
            }}
          >
            <LogOut size={17} />
            <span className="sidebar-label">
              {loggingOut ? "Cerrando sesión…" : "Cerrar sesión"}
            </span>
          </button>
        </div>
      </aside>

      {showLogoutDialog && (
        <LogoutDialog
          onDismiss={() => {
            if (!logoutLock.current) {
              setShowLogoutDialog(false);
            }
          }}
          onConfirm={handleLogout}
          busy={loggingOut}
          error={logoutError}
        />
      )}
    </>
  );
}