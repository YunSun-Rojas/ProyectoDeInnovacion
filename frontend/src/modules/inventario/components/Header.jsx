import { useState, useEffect, useRef } from "react";
import { DATE_RANGES, limaDate, movementFlow } from '../pages/dashboardData';
import { useAuthSession } from '../../auth/hooks/useAuthSession';
import { useNavigate } from "react-router-dom";
import {
  Calendar,
  Download,
  Bell,
  Moon,
  Sun,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  RefreshCw,
  X,
} from "lucide-react";

const C = {
  surface:    "var(--inventory-surface, #FFFFFF)",
  bg:         "var(--inventory-bg, #F1F5F9)",
  ink:        "var(--inventory-ink, #1F2937)",
  inkSecond:  "var(--inventory-ink-second, #475569)",
  muted:      "var(--inventory-muted, #64748B)",
  border:     "var(--inventory-border, #E5E7EB)",
  borderFaint:"var(--inventory-border, #E5E7EB)",
  accent:     "#E32636",
  accentTint: "var(--inventory-accent-tint, #FBE6E8)",
  success:    "var(--inventory-success, #1E8A4C)",
  successTint:"var(--inventory-success-tint, #E3F5EB)",
  warning:    "var(--inventory-warning, #C07D0A)",
  warningTint:"var(--inventory-warning-tint, #FEF0D3)",
  danger:     "var(--inventory-danger, #991B2A)",
  dangerTint: "var(--inventory-danger-tint, #FDEAEC)",
};

const FONT = { body: "Inter, system-ui, sans-serif" };

// ── Utilidades ────────────────────────────────────────────────────────────────
const currency = (v) =>
  `S/. ${v.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function useClickOutside(ref, handler) {
  useEffect(() => {
    const listener = (e) => { if (ref.current && !ref.current.contains(e.target)) handler(); };
    document.addEventListener("mousedown", listener);
    return () => document.removeEventListener("mousedown", listener);
  }, [ref, handler]);
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function Header({ products = [], inventoryReady = true, selectedRange = '30', onRangeChange, customRange, onCustomRangeChange, activity = { recent: [] }, historyAvailable = false, salesSummary = { total: 0, units: 0 }, salesEnabled = false, darkMode = false, toggleDarkMode }) {
  const navigate = useNavigate();
  const { session } = useAuthSession();
  const profileName = session?.user?.user_metadata?.full_name;
  const displayName = (typeof profileName === 'string' && profileName.trim()) || session?.user?.email || 'Mi cuenta';
  const initials = displayName.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showDatePicker,    setShowDatePicker]    = useState(false);
  const [exporting,         setExporting]         = useState(false);
  const [justExported,      setJustExported]      = useState(false);

  const notifDialogRef = useRef(null);
  const dateRef    = useRef(null);
  const selectedRangeConfig = DATE_RANGES.find(({ id }) => id === selectedRange) ?? DATE_RANGES.find(range => range.id === '30');

  useClickOutside(dateRef,  () => setShowDatePicker(false));
  useEffect(() => {
    const dialog = notifDialogRef.current;
    if (showNotifications && dialog && !dialog.open) dialog.showModal();
  }, [showNotifications]);

  // Clasificar alertas por nivel
  const critical = products.filter(p => p.stock === 0);
  const low      = products.filter(p => p.stock > 0 && p.stock <= p.minStock);
  const alerts   = [...critical, ...low];

  // KPI rápido para el header
  const totalValue  = products.reduce((s, p) => s + p.stock * p.price, 0);

  // Exportar CSV enriquecido
  const handleExportCSV = () => {
    if (!products.length) return;
    setExporting(true);

    setTimeout(() => {
      const headers = [
        "ID", "Nombre", "SKU", "Categoría",
        "Stock Actual", "Stock Mínimo", "Precio (S/.)",
        "Valor en Inv. (S/.)", `Entradas (${selectedRangeConfig.label})`, `Salidas (${selectedRangeConfig.label})`, `Cambios registrados (${selectedRangeConfig.label})`,
        "Estado",
      ];
      const bySku = new Map();
      activity.recent.forEach(m => {
        const totals = bySku.get(m.sku) || { entries: 0, exits: 0, changes: 0 };
        totals.changes++;
        const flow = movementFlow(m);
        totals.entries += flow.entries;
        totals.exits += flow.exits;
        bySku.set(m.sku, totals);
      });
      const rows = products.map(p => {
        const totals = bySku.get(p.sku) || { entries: 0, exits: 0, changes: 0 };
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
          historyAvailable ? totals.entries : 'No disponible',
          historyAvailable ? totals.exits : 'No disponible',
          historyAvailable ? totals.changes : 'No disponible',
          estado,
        ];
      });

      const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
      const url  = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Reporte_Inventario_EagleGaming_${selectedRangeConfig.shortLabel}_${limaDate(new Date())}.csv`;
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
    <header className="inventory-header" style={{
      display:        "flex",
      justifyContent: "space-between",
      alignItems:     "center",
      padding:        "0 36px",
      minHeight:      58,
      flexWrap:       "wrap",
      background:     C.surface,
      borderBottom:   `1px solid ${C.border}`,
      position:       "sticky",
      top:            0,
      zIndex:         50,
      gap:            16,
    }}>

      {/* ── Lado izquierdo: KPIs rápidos + rango de fecha ── */}
      <div className="header-tools" style={{ display: "flex", alignItems: "center", gap: 20 }}>

        {/* Resumen numérico compacto */}
        <div className="header-stats" style={{ display: "flex", gap: 20, borderRight: `1px solid ${C.borderFaint}`, paddingRight: 20 }}>
          <QuickStat label="Valor inv." value={inventoryReady ? currency(totalValue) : '—'} />
          <QuickStat label={`Ventas / ${selectedRangeConfig.shortLabel}`} value={inventoryReady && salesEnabled ? currency(salesSummary.total) : '—'} />
          <QuickStat label={`Unidades vendidas / ${selectedRangeConfig.shortLabel}`} value={inventoryReady && salesEnabled ? `${salesSummary.units}` : '—'} />
        </div>

        {/* Selector de rango de fechas */}
        <div ref={dateRef} style={{ position: "relative" }}>
          <button
            aria-expanded={showDatePicker}
            aria-label={`Período: ${selectedRangeConfig.label}`}
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
            {selectedRangeConfig.label}
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
                  key={r.label}
                  type="button"
                  onClick={() => { onRangeChange?.(r.id); if (r.id !== 'custom') setShowDatePicker(false); }}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "8px 12px", borderRadius: 7, border: "none",
                    background: r.id === selectedRange ? C.accentTint : "transparent",
                    color: r.id === selectedRange ? C.accent : C.inkSecond,
                    fontFamily: FONT.body, fontSize: 13, fontWeight: r.id === selectedRange ? 600 : 400,
                    cursor: "pointer",
                  }}
                >
                  {r.label}
                </button>
              ))}
              {selectedRange === 'custom' && (
                <div style={{ display: "grid", gap: 8, padding: "8px 12px 10px" }}>
                  <label style={{ display: "grid", gap: 4, color: C.muted, fontFamily: FONT.body, fontSize: 11 }}>
                    Desde
                    <input
                      type="date"
                      aria-label="Fecha inicial del rango"
                      max={customRange?.to || limaDate(new Date())}
                      value={customRange?.from || ''}
                      onChange={event => onCustomRangeChange?.({ ...customRange, from: event.target.value })}
                      style={{ width: "100%", boxSizing: "border-box", padding: "7px 8px", border: `1px solid ${C.border}`, borderRadius: 6, background: C.surface, color: C.ink, font: `12px ${FONT.body}` }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 4, color: C.muted, fontFamily: FONT.body, fontSize: 11 }}>
                    Hasta
                    <input
                      type="date"
                      aria-label="Fecha final del rango"
                      min={customRange?.from}
                      max={limaDate(new Date())}
                      value={customRange?.to || ''}
                      onChange={event => onCustomRangeChange?.({ ...customRange, to: event.target.value })}
                      style={{ width: "100%", boxSizing: "border-box", padding: "7px 8px", border: `1px solid ${C.border}`, borderRadius: 6, background: C.surface, color: C.ink, font: `12px ${FONT.body}` }}
                    />
                  </label>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Botón Exportar */}
        <button
          onClick={handleExportCSV}
          disabled={exporting || !inventoryReady || products.length === 0}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: justExported ? C.successTint : C.bg,
            border: `1px solid ${justExported ? `color-mix(in srgb, ${C.success} 33%, transparent)` : C.border}`,
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
      <div className="header-user" style={{ display: "flex", alignItems: "center", gap: 14 }}>

        <button
          type="button"
          onClick={toggleDarkMode}
          aria-label={darkMode ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
          aria-pressed={darkMode}
          title={darkMode ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
          style={{
            display: "grid", placeItems: "center", border: "none",
            background: darkMode ? C.accentTint : "transparent",
            cursor: "pointer", padding: 8, borderRadius: 8,
            color: C.inkSecond, transition: "background 0.2s",
          }}
        >
          {darkMode ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
        </button>

        {/* Campana de notificaciones */}
        <div>
          <button
            type="button"
            onClick={() => setShowNotifications(true)}
            aria-label={`Notificaciones${alerts.length > 0 ? `, ${alerts.length} activas` : ''}`}
            aria-haspopup="dialog"
            aria-expanded={showNotifications}
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
                width: 7, height: 7, borderRadius: "50%",
                background: C.accent,
              }} aria-hidden="true" />
            )}
          </button>

          <dialog
            ref={notifDialogRef}
            className="notification-dialog"
            aria-labelledby="notification-dialog-title"
            onClose={() => setShowNotifications(false)}
            onClick={event => {
              if (event.target === event.currentTarget) event.currentTarget.close();
            }}
          >
            <div style={{ background: C.surface, color: C.ink }}>
              {/* Header del panel */}
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "14px 16px 10px",
                borderBottom: `1px solid ${C.borderFaint}`,
              }}>
                <div>
                  <h2 id="notification-dialog-title" style={{ fontFamily: FONT.body, fontSize: 16, fontWeight: 700, color: C.ink, margin: 0 }}>
                    Notificaciones
                  </h2>
                  <span style={{
                    display: "inline-block", marginTop: 6,
                    background: alerts.length > 0 ? C.accentTint : C.successTint,
                    color: alerts.length > 0 ? C.accent : C.success,
                    fontSize: 10, fontWeight: 700, borderRadius: 10,
                    padding: "2px 7px",
                  }}>
                    {!inventoryReady ? 'Sin datos' : alerts.length > 0 ? `${alerts.length} activas` : "Sin alertas"}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label="Cerrar notificaciones"
                  onClick={() => notifDialogRef.current?.close()}
                  style={{ display: "grid", placeItems: "center", border: "none", background: "transparent", color: C.muted, cursor: "pointer", padding: 6, borderRadius: 6 }}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>

              {/* Cuerpo */}
              <div style={{ maxHeight: 320, overflowY: "auto" }}>
                {!inventoryReady ? <p style={{ padding: 16, color: C.muted, fontSize: 13 }}>El inventario aún no está disponible.</p> : alerts.length === 0 ? (
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

              <div style={{ borderTop: `1px solid ${C.borderFaint}`, padding: 12 }}>
                <button
                  type="button"
                  onClick={() => {
                    notifDialogRef.current?.close();
                    navigate("/dashboard/alertas");
                  }}
                  style={{
                    display: "flex", justifyContent: "center", alignItems: "center",
                    width: "100%", padding: "10px 14px", border: "none",
                    borderRadius: 8, background: C.accent, color: "#fff",
                    fontFamily: FONT.body, fontSize: 13, fontWeight: 650, cursor: "pointer",
                  }}
                >
                  Ver todas las notificaciones
                </button>
              </div>
            </div>
          </dialog>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 28, background: C.borderFaint }} />

        {/* Avatar + info */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "default" }}>
          <div style={{
            width: 32, height: 32, borderRadius: "50%",
            background: "linear-gradient(135deg, #E32636, #E32636)",
            color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: FONT.body, fontWeight: 700, fontSize: 12, letterSpacing: "0.5px",
            boxShadow: "0 2px 6px rgba(59,130,246,0.35)",
          }}>
            {initials}
          </div>
          <div>
            <div title={displayName} style={{ fontFamily: FONT.body, fontSize: 12, fontWeight: 700, color: C.ink, lineHeight: 1.2, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {displayName}
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
        border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`, borderRadius: 6, padding: "2px 6px",
        flexShrink: 0, alignSelf: "center",
      }}>
        {isCritical ? "AGOTADO" : "BAJO"}
      </span>
    </div>
  );
}
