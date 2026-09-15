import React, { useState, useEffect, useRef } from "react";
import {
  Calendar,
  Download,
  Bell,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  Search,
  RefreshCw,
} from "lucide-react";

const C = {
  surface:    "#FFFFFF",
  bg:         "#FAF8F5",
  ink:        "#12121A",
  inkSecond:  "#454550",
  muted:      "#8A8880",
  border:     "#E5E1D8",
  borderFaint:"#EFECE6",
  accent:     "#D62839",
  accentTint: "#FBE6E8",
  success:    "#1E8A4C",
  successTint:"#E3F5EB",
  warning:    "#C07D0A",
  warningTint:"#FEF0D3",
  danger:     "#991B2A",
  dangerTint: "#FDEAEC",
};

const FONT = { body: "Inter, system-ui, sans-serif" };

// ── Utilidades ────────────────────────────────────────────────────────────────
const currency = (v) =>
  `S/. ${v.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const DATE_RANGES = ["Hoy", "Últimos 7 días", "Últimos 30 días", "Este mes", "Trimestre actual"];

function useClickOutside(ref, handler) {
  useEffect(() => {
    const listener = (e) => { if (ref.current && !ref.current.contains(e.target)) handler(); };
    document.addEventListener("mousedown", listener);
    return () => document.removeEventListener("mousedown", listener);
  }, [ref, handler]);
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function Header({ products = [] }) {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showDatePicker,    setShowDatePicker]    = useState(false);
  const [selectedRange,     setSelectedRange]     = useState("Últimos 30 días");
  const [exporting,         setExporting]         = useState(false);
  const [justExported,      setJustExported]      = useState(false);
  const [searchQuery,       setSearchQuery]       = useState("");

  const notifRef   = useRef(null);
  const dateRef    = useRef(null);

  useClickOutside(notifRef, () => setShowNotifications(false));
  useClickOutside(dateRef,  () => setShowDatePicker(false));

  // Clasificar alertas por nivel
  const critical = products.filter(p => p.stock === 0);
  const low      = products.filter(p => p.stock > 0 && p.stock <= p.minStock);
  const alerts   = [...critical, ...low];

  // KPI rápido para el header
  const totalValue  = products.reduce((s, p) => s + p.stock * p.price, 0);
  const totalSold   = products.reduce((s, p) => s + (p.unitsSoldThisMonth ?? 0), 0);

  // Exportar CSV enriquecido
  const handleExportCSV = () => {
    if (!products.length) return;
    setExporting(true);

    setTimeout(() => {
      const headers = [
        "ID", "Nombre", "SKU", "Categoría",
        "Stock Actual", "Stock Mínimo", "Precio (S/.)",
        "Valor en Inv. (S/.)", "Vendidos (mes)", "Ingresos (mes, S/.)",
        "Estado",
      ];
      const rows = products.map(p => {
        const estado = p.stock === 0 ? "Sin Stock" : p.stock <= p.minStock ? "Stock Bajo" : "OK";
        return [
          p.id,
          `"${p.name}"`,
          p.sku,
          `"${p.category}"`,
          p.stock,
          p.minStock,
          p.price,
          (p.stock * p.price).toFixed(2),
          p.unitsSoldThisMonth ?? 0,
          ((p.unitsSoldThisMonth ?? 0) * p.price).toFixed(2),
          estado,
        ];
      });

      const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
      const url  = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Reporte_Inventario_EagleGaming_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setExporting(false);
      setJustExported(true);
      setTimeout(() => setJustExported(false), 2500);
    }, 600);
  };

  return (
    <header style={{
      display:        "flex",
      justifyContent: "space-between",
      alignItems:     "center",
      padding:        "0 36px",
      height:         58,
      background:     C.surface,
      borderBottom:   `1px solid ${C.border}`,
      position:       "sticky",
      top:            0,
      zIndex:         50,
      gap:            16,
    }}>

      {/* ── Lado izquierdo: KPIs rápidos + rango de fecha ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>

        {/* Resumen numérico compacto */}
        <div style={{ display: "flex", gap: 20, borderRight: `1px solid ${C.borderFaint}`, paddingRight: 20 }}>
          <QuickStat label="Valor inv." value={currency(totalValue)} />
          <QuickStat label="Vendidos / mes" value={`${totalSold} uds.`} />
        </div>

        {/* Selector de rango de fechas */}
        <div ref={dateRef} style={{ position: "relative" }}>
          <button
            onClick={() => setShowDatePicker(!showDatePicker)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: C.bg, border: `1px solid ${C.border}`,
              padding: "5px 11px", borderRadius: 7,
              fontFamily: FONT.body, fontSize: 12, color: C.inkSecond,
              cursor: "pointer", fontWeight: 500,
            }}
          >
            <Calendar size={13} color={C.muted} />
            {selectedRange}
            <ChevronDown size={13} color={C.muted} />
          </button>

          {showDatePicker && (
            <div style={{
              position: "absolute", top: 36, left: 0,
              background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
              padding: 6, zIndex: 200, minWidth: 180,
            }}>
              {DATE_RANGES.map(r => (
                <button
                  key={r}
                  onClick={() => { setSelectedRange(r); setShowDatePicker(false); }}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "8px 12px", borderRadius: 7, border: "none",
                    background: r === selectedRange ? C.accentTint : "transparent",
                    color: r === selectedRange ? C.accent : C.inkSecond,
                    fontFamily: FONT.body, fontSize: 13, fontWeight: r === selectedRange ? 600 : 400,
                    cursor: "pointer",
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Botón Exportar */}
        <button
          onClick={handleExportCSV}
          disabled={exporting}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: justExported ? C.successTint : C.bg,
            border: `1px solid ${justExported ? C.success + "55" : C.border}`,
            padding: "5px 12px", borderRadius: 7,
            fontFamily: FONT.body, fontSize: 12, fontWeight: 600,
            color: justExported ? C.success : C.inkSecond,
            cursor: exporting ? "wait" : "pointer",
            transition: "all 0.3s",
          }}
        >
          {exporting
            ? <><RefreshCw size={13} color={C.muted} style={{ animation: "spin 0.8s linear infinite" }} /> Exportando…</>
            : justExported
              ? <><CheckCircle2 size={13} color={C.success} /> Exportado</>
              : <><Download size={13} color={C.muted} /> Exportar CSV</>
          }
        </button>
      </div>

      {/* ── Lado derecho: notificaciones + usuario ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>

        {/* Campana de notificaciones */}
        <div ref={notifRef} style={{ position: "relative" }}>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            style={{
              position: "relative", border: "none",
              background: showNotifications ? C.accentTint : "transparent",
              cursor: "pointer", padding: "6px 8px", borderRadius: 8,
              transition: "background 0.2s",
            }}
          >
            <Bell size={18} color={alerts.length > 0 ? C.accent : C.muted} />
            {alerts.length > 0 && (
              <span style={{
                position: "absolute", top: 4, right: 4,
                minWidth: 16, height: 16, borderRadius: 8,
                background: C.accent, color: "#fff",
                fontSize: 9, fontWeight: 700, lineHeight: "16px",
                textAlign: "center", padding: "0 3px",
                fontFamily: FONT.body,
              }}>
                {alerts.length}
              </span>
            )}
          </button>

          {/* Panel de notificaciones */}
          {showNotifications && (
            <div style={{
              position: "absolute", right: 0, top: 42,
              width: 340, background: C.surface,
              border: `1px solid ${C.border}`, borderRadius: 12,
              boxShadow: "0 12px 32px rgba(0,0,0,0.12)",
              overflow: "hidden", zIndex: 200,
            }}>
              {/* Header del panel */}
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "14px 16px 10px",
                borderBottom: `1px solid ${C.borderFaint}`,
              }}>
                <span style={{ fontFamily: FONT.body, fontSize: 13, fontWeight: 700, color: C.ink }}>
                  Notificaciones del Sistema
                </span>
                <span style={{
                  background: alerts.length > 0 ? C.accentTint : C.successTint,
                  color: alerts.length > 0 ? C.accent : C.success,
                  fontSize: 10, fontWeight: 700, borderRadius: 10,
                  padding: "2px 7px",
                }}>
                  {alerts.length > 0 ? `${alerts.length} activas` : "Sin alertas"}
                </span>
              </div>

              {/* Cuerpo */}
              <div style={{ maxHeight: 320, overflowY: "auto" }}>
                {alerts.length === 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 16px", gap: 8 }}>
                    <CheckCircle2 size={28} color={C.success} />
                    <p style={{ color: C.success, fontSize: 13, fontWeight: 600, margin: 0, textAlign: "center" }}>
                      Todo el inventario está en niveles óptimos
                    </p>
                  </div>
                ) : (
                  <div>
                    {/* Sección críticos */}
                    {critical.length > 0 && (
                      <div>
                        <div style={{ padding: "8px 16px 4px", fontSize: 10, fontWeight: 700, color: C.danger, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                          Sin Stock — Reposición Urgente
                        </div>
                        {critical.map(p => (
                          <NotifRow key={p.id} product={p} level="critical" />
                        ))}
                      </div>
                    )}
                    {/* Sección bajo stock */}
                    {low.length > 0 && (
                      <div>
                        <div style={{ padding: "8px 16px 4px", fontSize: 10, fontWeight: 700, color: C.warning, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                          Stock Bajo
                        </div>
                        {low.map(p => (
                          <NotifRow key={p.id} product={p} level="low" />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
              {alerts.length > 0 && (
                <div style={{ borderTop: `1px solid ${C.borderFaint}`, padding: "10px 16px" }}>
                  <p style={{ margin: 0, fontSize: 11, color: C.muted, textAlign: "center" }}>
                    {critical.length > 0 && `${critical.length} producto${critical.length > 1 ? "s" : ""} agotado${critical.length > 1 ? "s" : ""}. `}
                    {low.length > 0 && `${low.length} en stock bajo.`}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 28, background: C.borderFaint }} />

        {/* Avatar + info */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "default" }}>
          <div style={{
            width: 32, height: 32, borderRadius: "50%",
            background: "linear-gradient(135deg, #D62839, #8F1B26)",
            color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: FONT.body, fontWeight: 700, fontSize: 12, letterSpacing: "0.5px",
            boxShadow: "0 2px 6px rgba(214,40,57,0.35)",
          }}>
            AD
          </div>
          <div>
            <div style={{ fontFamily: FONT.body, fontSize: 12, fontWeight: 700, color: C.ink, lineHeight: 1.2 }}>
              Admin Sistema
            </div>
            <div style={{ fontFamily: FONT.body, fontSize: 10, color: C.muted }}>
              Proyecto de Tesis · 2026
            </div>
          </div>
        </div>

      </div>

      {/* Keyframe para el spinner de exportar */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </header>
  );
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function QuickStat({ label, value }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontFamily: FONT.body, fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500 }}>
        {label}
      </span>
      <span style={{ fontFamily: FONT.body, fontSize: 13, fontWeight: 700, color: C.ink }}>
        {value}
      </span>
    </div>
  );
}

function NotifRow({ product, level }) {
  const isCritical = level === "critical";
  const bg     = isCritical ? C.dangerTint  : C.warningTint;
  const color  = isCritical ? C.danger      : C.warning;
  const Icon   = isCritical ? XCircle       : AlertTriangle;
  const ratio  = isCritical ? 0 : Math.round((product.stock / product.minStock) * 100);

  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 10,
      padding: "9px 16px",
      borderBottom: `1px solid ${C.borderFaint}`,
    }}>
      <div style={{ width: 28, height: 28, borderRadius: 7, background: bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
        <Icon size={14} color={color} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {product.name}
        </p>
        <p style={{ margin: "2px 0 0", fontSize: 11, color: C.muted }}>
          {isCritical
            ? "Sin stock disponible"
            : `${product.stock} uds. disponibles (mín: ${product.minStock}) · ${ratio}%`
          }
        </p>
      </div>
      <span style={{
        fontSize: 10, fontWeight: 700, color, background: bg,
        border: `1px solid ${color}40`, borderRadius: 6, padding: "2px 6px",
        flexShrink: 0, alignSelf: "center",
      }}>
        {isCritical ? "AGOTADO" : "BAJO"}
      </span>
    </div>
  );
}
