import React from "react";
import { 
  LayoutGrid, 
  Boxes, 
  TrendingUp, 
  Eye, 
  History, 
  Settings, 
  LogOut, 
  PackageCheck 
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
  return (
    <aside style={{
      width: 240,
      background: "#121316",
      color: "#A0A0AB",
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
            width: 36,
            height: 36,
            borderRadius: 8,
            background: "#D62839",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#FFF"
          }}>
            <PackageCheck size={20} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontFamily: "Oswald, sans-serif", fontSize: 18, color: "#FFF", letterSpacing: "0.5px" }}>
              Eagle Gaming
            </h2>
            <span style={{ fontSize: 11, color: "#6E6C68" }}>Inventario Inteligente</span>
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
                  color: isActive ? "#FFF" : "#A0A0AB",
                  fontFamily: "Inter, sans-serif",
                  fontSize: 14,
                  fontWeight: isActive ? 600 : 500,
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  textAlign: "left"
                }}
              >
                <Icon size={18} color={isActive ? "#FFF" : "#A0A0AB"} />
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer / Logout */}
      <div style={{ borderTop: "1px solid #232329", paddingTop: 16 }}>
        <button
          onClick={() => alert("Cerrando sesión...")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            width: "100%",
            padding: "10px 14px",
            borderRadius: 8,
            border: "none",
            background: "transparent",
            color: "#8B8985",
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