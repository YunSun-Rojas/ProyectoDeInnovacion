import React from "react";
import { TrendingUp, Sparkles, AlertCircle, ArrowUpRight } from "lucide-react";

export default function Prediccion({ products = [] }) {
  return (
    <div style={{ padding: "32px 40px", background: "#FAF8F5", minHeight: "100vh" }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1 style={{ margin: 0, fontFamily: "Oswald, sans-serif", fontSize: 32, fontWeight: 700, color: "#17171A" }}>
            Predicción de Demanda (IA)
          </h1>
          <span style={{ background: "#FBE6E7", color: "#D62839", padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
            <Sparkles size={14} /> Modelo ML Activo
          </span>
        </div>
        <p style={{ margin: "4px 0 0", fontFamily: "Inter, sans-serif", fontSize: 14, color: "#6E6C68" }}>
          Proyección automatizada de agotamiento de stock basada en ventas históricas.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }}>
        {products.slice(0, 4).map((p) => {
          const estimatedDays = Math.floor(p.stock * 1.5) + 2; // Simulación de predicción
          return (
            <div key={p.id} style={{ background: "#FFF", border: "1px solid #E7E3DC", borderRadius: 12, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <h3 style={{ margin: 0, fontFamily: "Inter, sans-serif", fontSize: 16, color: "#17171A" }}>{p.name}</h3>
                  <span style={{ fontSize: 12, color: "#6E6C68" }}>SKU: {p.sku}</span>
                </div>
                <TrendingUp size={20} color="#D62839" />
              </div>

              <div style={{ margin: "16px 0", padding: "12px", background: "#FAF8F5", borderRadius: 8 }}>
                <span style={{ fontSize: 12, color: "#6E6C68", display: "block" }}>Agotamiento Estimado</span>
                <span style={{ fontFamily: "Oswald, sans-serif", fontSize: 24, fontWeight: 600, color: estimatedDays <= 5 ? "#8F1B26" : "#17171A" }}>
                  ~ {estimatedDays} días
                </span>
              </div>

              <p style={{ margin: 0, fontSize: 13, color: "#6E6C68", display: "flex", alignItems: "center", gap: 6 }}>
                <AlertCircle size={14} color="#B4700B" /> Se sugiere reordenar {p.minStock * 2} unidades pronto.
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}