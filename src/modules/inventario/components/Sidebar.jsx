import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { logoutDemo } from "../../auth/services/demoSession";
import LogoutDialog from './LogoutDialog';
import { 
  LayoutGrid, 
  Boxes, 
  TrendingUp, 
  Eye, 
  History, 
  Settings, 
  LogOut
} from "lucide-react";

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutGrid },
  { id: "productos", label: "Inventario", icon: Boxes },
  { id: "prediccion", label: "Predicción IA", icon: TrendingUp },
  { id: "vision", label: "Reconocimiento Visión", icon: Eye },
  { id: "historial", label: "Historial", icon: History },
  { id: "configuracion", label: "Configuración", icon: Settings },
];

export default function Sidebar({ activePage, setActivePage }) {
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError('');
    const result = await logoutDemo();
    if (!result.ok) {
      setLogoutError(result.error);
      setLoggingOut(false);
      return;
    }
    navigate('/login', { replace: true });
  };
  return (
    <>
    <aside className="inventory-sidebar" style={{
      width: 240,
      background: "#E71950",
      color: "#F1F5F9",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: "24px 16px",
      flexShrink: 0,
      minHeight: 0
    }}>
      <div>
        {/* Brand Header */}
        <div className="sidebar-brand" style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 0 32px" }}>
          <div style={{
            width: 50,
            height: 50,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#FFF"
          }}>
            <img src="/logo-Eagle.png" alt="Logo de Eagle Gaming" style={{ width: 50, height: 50, objectFit: "contain" }} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontFamily: "Inter, system-ui, sans-serif", fontSize: 20, fontWeight: 800, lineHeight: 1.3, color: "#FFFFFF", letterSpacing: "-0.4px" }}>
              Eagle Gaming
            </h2>
            <span style={{ color: "#FFFFFF", fontSize: 11, fontWeight: 500 }}>
              Inventario Inteligente
            </span>
          </div>
        </div>

        {/* Navigation */}
        <nav style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                aria-label={item.label}
                onClick={() => setActivePage(item.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "11px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: isActive ? "#F1F5F9" : "transparent",
                  color: isActive ? "#E71950" : "#FFFFFF",
                  fontFamily: "Inter, sans-serif",
                  fontSize: 14,
                  fontWeight: isActive ? 600 : 500,
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  textAlign: "left"
                }}
              >
                <Icon size={18} color={isActive ? "#E71950" : "#FFFFFF"} />
                <span className="sidebar-label">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer / Logout */}
      <div className="sidebar-footer" style={{ borderTop: "1px solid rgba(241,245,249,0.3)", paddingTop: 16 }}>
        <button
          type="button"
          disabled={loggingOut}
          aria-busy={loggingOut}
          aria-haspopup="dialog"
          aria-expanded={showLogoutDialog}
          aria-controls={showLogoutDialog ? 'logout-dialog' : undefined}
          aria-label="Cerrar sesión" onClick={() => { setLogoutError(''); setShowLogoutDialog(true); }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            width: "100%",
            padding: "10px 14px",
            borderRadius: 8,
            border: "none",
            background: "transparent",
            color: "#F1F5F9",
            fontFamily: "Inter, sans-serif",
            fontSize: 14,
            cursor: "pointer"
          }}
        >
          <LogOut size={18} /><span className="sidebar-label">{loggingOut ? 'Cerrando sesión…' : 'Cerrar Sesión'}</span>
        </button>
      </div>
    </aside>
    {showLogoutDialog && <LogoutDialog onDismiss={() => setShowLogoutDialog(false)} onConfirm={handleLogout} busy={loggingOut} error={logoutError} />}
    </>
  );
}
