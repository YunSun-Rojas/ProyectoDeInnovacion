import { useNavigate } from "react-router-dom";
import { logoutDemo } from "../../auth/services/demoSession";
import { TextGradient } from "../../../components/ui/TextGradient";
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
  const handleLogout = () => {
    logoutDemo();
    navigate('/login', { replace: true });
  };
  return (
    <aside style={{
      width: 240,
      background: "#F3F4F6",
      color: "#454550",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: "24px 16px",
      flexShrink: 0,
      minHeight: "100vh"
    }}>
      <div>
        {/* Brand Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 8px 32px 8px" }}>
          <div style={{
            width: 44,
            height: 44,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#FFF"
          }}>
            <img src="/logo-Eagle.png" alt="Logo de Eagle Gaming" style={{ width: 44, height: 44, objectFit: "contain" }} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontFamily: "Inter, system-ui, sans-serif", fontSize: 18, fontWeight: 800, lineHeight: 1.3, color: "#17171A", letterSpacing: "-0.4px" }}>
              Eagle Gaming
            </h2>
            <TextGradient
              as="span"
              colors={['#000000', '#cc0000', '#000000', '#cc0000']}
              duration={4}
              angle={135}
              className="text-[11px] font-medium"
            >
              Inventario Inteligente
            </TextGradient>
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
                onClick={() => setActivePage(item.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "11px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: isActive ? "#D62839" : "transparent",
                  color: isActive ? "#FFFFFF" : "#454550",
                  fontFamily: "Inter, sans-serif",
                  fontSize: 14,
                  fontWeight: isActive ? 600 : 500,
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  textAlign: "left"
                }}
              >
                <Icon size={18} color={isActive ? "#FFFFFF" : "#454550"} />
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer / Logout */}
      <div style={{ borderTop: "1px solid #E5E7EB", paddingTop: 16 }}>
        <button
          onClick={handleLogout}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            width: "100%",
            padding: "10px 14px",
            borderRadius: 8,
            border: "none",
            background: "transparent",
            color: "#454550",
            fontFamily: "Inter, sans-serif",
            fontSize: 14,
            cursor: "pointer"
          }}
        >
          <LogOut size={18} /> Cerrar Sesión
        </button>
      </div>
    </aside>
  );
}
