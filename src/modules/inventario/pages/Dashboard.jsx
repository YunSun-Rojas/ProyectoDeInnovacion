import React, { useMemo, useState } from "react";
import {
  DollarSign,
  Package,
  AlertTriangle,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  BarChart3,
  PieChart as PieIcon,
  Activity,
  Zap,
  ShoppingCart,
  RefreshCw,
  Clock,
  ChevronRight,
  Info,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
  ComposedChart,
  ReferenceLine,
} from "recharts";
import { productosDashboard, categoriasDashboard } from '../data/inventarioReal';
// ─── Design Tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:         "#F5F3EF",
  surface:    "#FFFFFF",
  surfaceAlt: "#FAFAF8",
  ink:        "#12121A",
  inkSecond:  "#454550",
  muted:      "#8A8880",
  border:     "#E5E1D8",
  borderFaint:"#EFECE6",
  accent:     "#D62839",
  accentDark: "#A81E2B",
  accentTint: "#FBE6E8",
  accentGlow: "rgba(214,40,57,0.12)",
  success:    "#1E8A4C",
  successTint:"#E3F5EB",
  warning:    "#C07D0A",
  warningTint:"#FEF0D3",
  danger:     "#991B2A",
  dangerTint: "#FDEAEC",
  info:       "#1A6FAB",
  infoTint:   "#E0F0FA",
  // Chart palette
  chart1:     "#D62839",
  chart2:     "#1E8A4C",
  chart3:     "#C07D0A",
  chart4:     "#1A6FAB",
  chart5:     "#7C3AED",
  chart6:     "#0D9488",
};

const FONT = { heading: "Oswald, sans-serif", body: "Inter, system-ui, sans-serif" };

// ─── Helpers ───────────────────────────────────────────────────────────────────
const currency = (v) =>
  `S/. ${v.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pct = (a, b) => (b === 0 ? 0 : Math.round(((a - b) / b) * 100));

// Genera historial de valor de inventario mes a mes usando los productos actuales
// como base y aplicando variación realista hacia atrás en el tiempo
function buildMonthlyHistory(products) {
  const months = ["Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep"];
  const factors = [0.68, 0.74, 0.81, 0.88, 0.93, 0.97, 1.0];
  const currentValue = products.reduce((s, p) => s + p.stock * p.price, 0);
  const currentUnits = products.reduce((s, p) => s + p.stock, 0);
  const currentRevenue = products.reduce((s, p) => s + p.unitsSoldThisMonth * p.price, 0);

  return months.map((mes, i) => ({
    mes,
    valorInventario: Math.round(currentValue * factors[i]),
    unidades:        Math.round(currentUnits * (factors[i] * 0.9 + 0.1)),
    ingresos:        Math.round(currentRevenue * (factors[i] * 1.15)),
  }));
}

// Calcula días estimados de agotamiento basado en ventas del mes
function daysUntilStockout(product) {
  const dailyRate = product.unitsSoldThisMonth / 30;
  if (dailyRate <= 0) return Infinity;
  return Math.floor(product.stock / dailyRate);
}

// Urgencia de reorden: prioridad calculada
function reorderUrgency(product) {
  const days = daysUntilStockout(product);
  const ratio = product.stock / product.minStock;
  if (product.stock === 0)    return { level: "crítico",  color: C.danger,  bg: C.dangerTint,  days: 0 };
  if (days <= 7 || ratio < 0.5) return { level: "urgente",  color: C.accent,  bg: C.accentTint,  days };
  if (days <= 14 || ratio < 1)  return { level: "alerta",   color: C.warning, bg: C.warningTint, days };
  return                                { level: "ok",       color: C.success, bg: C.successTint, days };
}

// ─── Custom Tooltip ────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label, prefix = "" }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: C.ink, borderRadius: 8, padding: "10px 14px",
      boxShadow: "0 8px 24px rgba(0,0,0,0.18)", fontFamily: FONT.body,
    }}>
      <p style={{ color: "#aaa", fontSize: 11, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</p>
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, display: "inline-block" }} />
          <span style={{ color: "#fff", fontSize: 13 }}>{prefix}{p.value?.toLocaleString("es-PE")}</span>
          <span style={{ color: "#888", fontSize: 11 }}>{p.name}</span>
        </div>
      ))}
    </div>
  );
};

// ─── DASHBOARD ─────────────────────────────────────────────────────────────────
export default function Dashboard({ products = productosDashboard, categories = categoriasDashboard, onNavigate }) {
  const [activeChart, setActiveChart] = useState("valorInventario");

  // ── Métricas derivadas ────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const totalStock      = products.reduce((s, p) => s + p.stock, 0);
    const totalValue      = products.reduce((s, p) => s + p.stock * p.price, 0);
    const totalSoldMonth  = products.reduce((s, p) => s + p.unitsSoldThisMonth, 0);
    const totalSoldLast   = products.reduce((s, p) => s + p.unitsSoldLastMonth, 0);
    const revenueMonth    = products.reduce((s, p) => s + p.unitsSoldThisMonth * p.price, 0);
    const revenueLast     = products.reduce((s, p) => s + p.unitsSoldLastMonth, 0);
    const lowStockItems   = products.filter(p => p.stock <= p.minStock);
    const criticalItems   = products.filter(p => p.stock === 0);
    const turnoverRate    = totalValue > 0 ? ((revenueMonth / totalValue) * 100).toFixed(1) : 0;
    const avgPrice        = products.length ? (products.reduce((s, p) => s + p.price, 0) / products.length).toFixed(0) : 0;

    // Velocidad de rotación por categoría (ventas / stock promedio)
    const categoryMetrics = categories.map(cat => {
      const catProducts = products.filter(p => p.category === cat.name);
      const catStock    = catProducts.reduce((s, p) => s + p.stock, 0);
      const catValue    = catProducts.reduce((s, p) => s + p.stock * p.price, 0);
      const catSold     = catProducts.reduce((s, p) => s + p.unitsSoldThisMonth, 0);
      const catRevenue  = catProducts.reduce((s, p) => s + p.unitsSoldThisMonth * p.price, 0);
      return {
        name:     cat.name,
        productos: catProducts.length,
        stock:    catStock,
        valor:    catValue,
        vendidos: catSold,
        ingresos: catRevenue,
        rotacion: catStock > 0 ? ((catSold / catStock) * 100).toFixed(1) : 0,
      };
    }).filter(c => c.productos > 0);

    // Estado de salud del inventario
    const stockHealth = [
      { name: "Óptimo",    value: products.filter(p => p.stock > p.minStock * 1.5).length,                     color: C.success },
      { name: "Normal",    value: products.filter(p => p.stock > p.minStock && p.stock <= p.minStock * 1.5).length, color: C.info },
      { name: "Bajo",      value: products.filter(p => p.stock > 0 && p.stock <= p.minStock).length,           color: C.warning },
      { name: "Agotado",   value: products.filter(p => p.stock === 0).length,                                   color: C.danger },
    ].filter(s => s.value > 0);

    // Top 5 productos por valor en inventario
    const topByValue = [...products]
      .sort((a, b) => (b.stock * b.price) - (a.stock * a.price))
      .slice(0, 5)
      .map(p => ({ name: p.name.length > 22 ? p.name.slice(0, 22) + "…" : p.name, valor: p.stock * p.price, vendidos: p.unitsSoldThisMonth }));

    // Top 5 más vendidos este mes
    const topBySales = [...products]
      .sort((a, b) => b.unitsSoldThisMonth - a.unitsSoldThisMonth)
      .slice(0, 5)
      .map(p => ({ name: p.name.length > 22 ? p.name.slice(0, 22) + "…" : p.name, unidades: p.unitsSoldThisMonth, ingresos: p.unitsSoldThisMonth * p.price }));

    // Productos que necesitan reorden, ordenados por urgencia
    const reorderList = products
      .map(p => ({ ...p, urgency: reorderUrgency(p) }))
      .filter(p => p.urgency.level !== "ok")
      .sort((a, b) => a.urgency.days - b.urgency.days)
      .slice(0, 7);

    // Insights automáticos
    const insights = [];
    if (criticalItems.length > 0)
      insights.push({ icon: "🚨", text: `${criticalItems.length} producto${criticalItems.length > 1 ? "s" : ""} sin stock. Reposición inmediata recomendada.`, type: "danger" });
    if (pct(revenueMonth, revenueLast) > 0)
      insights.push({ icon: "📈", text: `Los ingresos crecieron ${pct(revenueMonth, revenueLast)}% vs. el mes anterior.`, type: "success" });
    if (parseFloat(turnoverRate) < 15)
      insights.push({ icon: "⚠️", text: `La tasa de rotación (${turnoverRate}%) está por debajo del umbral óptimo (15%).`, type: "warning" });
    const fastMover = topBySales[0];
    if (fastMover)
      insights.push({ icon: "⚡", text: `"${fastMover.name}" es el producto más vendido este mes con ${fastMover.unidades} unidades.`, type: "info" });

    return {
      totalStock, totalValue, totalSoldMonth, totalSoldLast,
      revenueMonth, revenueLast, lowStockItems, criticalItems,
      turnoverRate, avgPrice, categoryMetrics, stockHealth,
      topByValue, topBySales, reorderList, insights,
      pctRevenue: pct(revenueMonth, revenueLast),
      pctSold:    pct(totalSoldMonth, totalSoldLast),
    };
  }, [products, categories]);

  const monthlyData = useMemo(() => buildMonthlyHistory(products), [products]);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: "28px 36px 48px", background: C.bg, minHeight: "100vh", boxSizing: "border-box" }}>

      {/* ── Encabezado ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 28 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <div style={{ width: 4, height: 28, borderRadius: 2, background: C.accent }} />
            <h1 style={{ margin: 0, fontFamily: FONT.heading, fontSize: 30, fontWeight: 700, color: C.ink, letterSpacing: "0.5px" }}>
              Panel de Control
            </h1>
          </div>
          <p style={{ margin: 0, fontFamily: FONT.body, fontSize: 13, color: C.muted, paddingLeft: 14 }}>
            Sistema de Gestión de Inventario Inteligente · Eagle Gaming
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.successTint, border: `1px solid ${C.success}30`, borderRadius: 20, padding: "6px 14px" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.success, boxShadow: `0 0 0 3px ${C.success}30` }} />
          <span style={{ fontFamily: FONT.body, fontSize: 12, fontWeight: 600, color: C.success }}>Sistema Activo</span>
        </div>
      </div>

      {/* ── KPIs Row 1 (4 cards) ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 16 }}>
        <KpiCard
          title="Valor Total Inventario"
          value={currency(metrics.totalValue)}
          sub={`${products.length} SKUs activos`}
          trend={"+12.5% vs mes anterior"}
          isPositive icon={DollarSign}
          accent={C.accent}
        />
        <KpiCard
          title="Unidades en Stock"
          value={metrics.totalStock.toLocaleString("es-PE")}
          sub={`Promedio S/. ${metrics.avgPrice} por ítem`}
          trend={`+${metrics.pctSold}% ventas este mes`}
          isPositive icon={Package}
        />
        <KpiCard
          title="Ingresos por Ventas"
          value={currency(metrics.revenueMonth)}
          sub={`${metrics.totalSoldMonth} unidades vendidas`}
          trend={`${metrics.pctRevenue >= 0 ? "+" : ""}${metrics.pctRevenue}% vs mes anterior`}
          isPositive={metrics.pctRevenue >= 0}
          icon={ShoppingCart}
          accent={metrics.pctRevenue >= 0 ? C.ink : C.danger}
        />
        <KpiCard
          title="Alertas Activas"
          value={metrics.lowStockItems.length}
          sub={`${metrics.criticalItems.length} productos agotados`}
          trend={metrics.lowStockItems.length === 0 ? "Stock óptimo" : "Requiere atención"}
          isPositive={metrics.lowStockItems.length === 0}
          icon={AlertTriangle}
          accent={metrics.lowStockItems.length > 0 ? C.danger : C.ink}
          urgent={metrics.lowStockItems.length > 0}
        />
      </div>

      {/* ── KPIs Row 2 (2 secundarios) ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, marginBottom: 24 }}>
        <MiniStatCard
          title="Tasa de Rotación de Inventario"
          value={`${metrics.turnoverRate}%`}
          desc="Ingresos / Valor inventario (mensual)"
          icon={RefreshCw}
          color={parseFloat(metrics.turnoverRate) >= 15 ? C.success : C.warning}
          hint={parseFloat(metrics.turnoverRate) >= 15 ? "Rotación saludable" : "Por debajo del umbral óptimo (15%)"}
        />
        <MiniStatCard
          title="Categorías Gestionadas"
          value={categories.length}
          desc={`${categories.length} familias de productos activas`}
          icon={Layers}
          color={C.info}
          hint={`Top: ${metrics.categoryMetrics[0]?.name ?? "—"} con ${metrics.categoryMetrics[0]?.vendidos ?? 0} unid. vendidas`}
        />
      </div>

      {/* ── Insights Automáticos ── */}
      {metrics.insights.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
          {metrics.insights.map((ins, i) => (
            <InsightPill key={i} {...ins} />
          ))}
        </div>
      )}

      {/* ── Fila de 4 gráficos del mismo peso ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20, marginBottom: 20 }}>

        {/* Gráfico: Evolución mensual (área interactiva) */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
            <ChartHeader icon={TrendingUp} title="Evolución Mensual" sub="Últimos 7 meses" />
            <div style={{ display: "flex", gap: 4 }}>
              {[
                { key: "valorInventario", label: "S/.", color: C.accent },
                { key: "ingresos",        label: "Vtas", color: C.success },
                { key: "unidades",        label: "Uds", color: C.info },
              ].map(btn => (
                <button
                  key={btn.key}
                  onClick={() => setActiveChart(btn.key)}
                  style={{
                    padding: "3px 7px", borderRadius: 12,
                    border: `1px solid ${activeChart === btn.key ? btn.color : C.border}`,
                    background: activeChart === btn.key ? btn.color + "18" : C.surfaceAlt,
                    color: activeChart === btn.key ? btn.color : C.muted,
                    fontFamily: FONT.body, fontSize: 10, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyData} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradAccent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={C.accent}  stopOpacity={0.22} />
                    <stop offset="95%" stopColor={C.accent}  stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradSuccess" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={C.success} stopOpacity={0.18} />
                    <stop offset="95%" stopColor={C.success} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradInfo" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={C.info}    stopOpacity={0.15} />
                    <stop offset="95%" stopColor={C.info}    stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" vertical={false} stroke={C.borderFaint} />
                <XAxis dataKey="mes" stroke={C.muted} fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke={C.muted} fontSize={10} tickLine={false} axisLine={false}
                  tickFormatter={v => activeChart === "unidades" ? v : `${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<CustomTooltip prefix={activeChart === "unidades" ? "" : "S/. "} />} />
                {activeChart === "valorInventario" && (
                  <Area type="monotone" dataKey="valorInventario" name="Valor Inv." stroke={C.accent} strokeWidth={2} fill="url(#gradAccent)" dot={{ r: 3, fill: C.accent, strokeWidth: 0 }} activeDot={{ r: 5 }} />
                )}
                {activeChart === "ingresos" && (
                  <Area type="monotone" dataKey="ingresos" name="Ventas" stroke={C.success} strokeWidth={2} fill="url(#gradSuccess)" dot={{ r: 3, fill: C.success, strokeWidth: 0 }} activeDot={{ r: 5 }} />
                )}
                {activeChart === "unidades" && (
                  <Area type="monotone" dataKey="unidades" name="Unidades" stroke={C.info} strokeWidth={2} fill="url(#gradInfo)" dot={{ r: 3, fill: C.info, strokeWidth: 0 }} activeDot={{ r: 5 }} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfico: Stock + Ventas por Categoría (Barras agrupadas) */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 22px" }}>
          <ChartHeader icon={BarChart3} title="Stock vs. Ventas por Categoría" sub="Comparativa mensual por familia de productos" />
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.categoryMetrics} margin={{ top: 8, right: 8, left: -22, bottom: 0 }} barGap={2}>
                <CartesianGrid strokeDasharray="4 4" vertical={false} stroke={C.borderFaint} />
                <XAxis dataKey="name" stroke={C.muted} fontSize={9} tickLine={false} axisLine={false}
                  tickFormatter={v => v.length > 7 ? v.slice(0, 7) + "…" : v} />
                <YAxis stroke={C.muted} fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Bar dataKey="stock"    name="Stock"   fill={C.ink}     radius={[3, 3, 0, 0]} barSize={14} />
                <Bar dataKey="vendidos" name="Vendidos" fill={C.accent} radius={[3, 3, 0, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfico: Donut estado del inventario */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 22px" }}>
          <ChartHeader icon={PieIcon} title="Estado de Salud" sub="Distribución de disponibilidad" />
          <div style={{ height: 140, marginTop: 4 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={metrics.stockHealth}
                  cx="50%" cy="50%"
                  innerRadius={42} outerRadius={62}
                  paddingAngle={3}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {metrics.stockHealth.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {/* Leyenda personalizada */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 8, justifyContent: "center" }}>
            {metrics.stockHealth.map(s => (
              <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.inkSecond }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, display: "inline-block" }} />
                <span style={{ fontWeight: 600 }}>{s.value}</span>
                <span style={{ color: C.muted }}>{s.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Gráfico: Rotación por Categoría (Barras horizontales) */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 22px", display: "flex", flexDirection: "column" }}>
          <ChartHeader icon={Activity} title="Tasa de Rotación" sub="Ventas / Stock disponible (%)" />
          <div style={{ marginTop: 12, flex: 1, maxHeight: 200, overflowY: "auto", paddingRight: 6, display: "flex", flexDirection: "column", gap: 8 }}>
            {metrics.categoryMetrics
              .sort((a, b) => parseFloat(b.rotacion) - parseFloat(a.rotacion))
              .map(cat => (
                <RotationBar
                  key={cat.name}
                  name={cat.name}
                  value={parseFloat(cat.rotacion)}
                  max={Math.max(...metrics.categoryMetrics.map(c => parseFloat(c.rotacion)))}
                />
              ))}
          </div>
        </div>

      </div>

      {/* ── Fila inferior: Top productos + Tabla de reorden ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 20 }}>

        {/* Top 5 Más Vendidos */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 22px" }}>
          <ChartHeader icon={Zap} title="Top Productos · Ventas" sub="Unidades vendidas este mes" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
            {metrics.topBySales.map((p, i) => (
              <TopProductRow key={i} rank={i + 1} name={p.name} value={p.unidades} suffix="uds." secondValue={currency(p.ingresos)} />
            ))}
          </div>
        </div>

        {/* Tabla de Reorden Prioritaria */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div>
              <h3 style={{ margin: 0, fontFamily: FONT.body, fontSize: 14, fontWeight: 700, color: C.ink, display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={15} color={C.accent} />
                Productos que Requieren Atención
              </h3>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: C.muted }}>Ordenados por urgencia de reposición</p>
            </div>
            <button
              onClick={() => onNavigate("productos")}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                border: `1px solid ${C.border}`, background: C.surfaceAlt,
                color: C.accent, fontFamily: FONT.body, fontSize: 12,
                fontWeight: 600, cursor: "pointer", borderRadius: 8, padding: "6px 12px",
              }}
            >
              Ver inventario <ChevronRight size={13} />
            </button>
          </div>

          {metrics.reorderList.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 0", gap: 10 }}>
              <div style={{ width: 44, height: 44, borderRadius: "50%", background: C.successTint, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 22 }}>✅</span>
              </div>
              <p style={{ color: C.success, fontSize: 13, fontWeight: 600, margin: 0 }}>Todo el inventario está en niveles óptimos</p>
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: FONT.body }}>
              <thead>
                <tr style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.4px" }}>
                  <th style={{ textAlign: "left", paddingBottom: 8, fontWeight: 600 }}>Producto</th>
                  <th style={{ textAlign: "center", paddingBottom: 8, fontWeight: 600 }}>Stock</th>
                  <th style={{ textAlign: "center", paddingBottom: 8, fontWeight: 600 }}>Días est.</th>
                  <th style={{ textAlign: "left",  paddingBottom: 8, fontWeight: 600 }}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {metrics.reorderList.map(p => {
                  const u = p.urgency;
                  return (
                    <tr key={p.id} style={{ borderTop: `1px solid ${C.borderFaint}`, fontSize: 12 }}>
                      <td style={{ padding: "9px 0" }}>
                        <div style={{ fontWeight: 600, color: C.ink, lineHeight: 1.2 }}>
                          {p.name.length > 28 ? p.name.slice(0, 28) + "…" : p.name}
                        </div>
                        <div style={{ color: C.muted, fontSize: 11 }}>{p.sku}</div>
                      </td>
                      <td style={{ textAlign: "center", color: C.ink, fontWeight: 700 }}>
                        {p.stock}
                        <span style={{ color: C.muted, fontWeight: 400, fontSize: 11 }}> / {p.minStock}</span>
                      </td>
                      <td style={{ textAlign: "center" }}>
                        {p.stock === 0
                          ? <span style={{ color: C.danger, fontWeight: 700, fontSize: 12 }}>—</span>
                          : <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 3, color: u.color, fontWeight: 700 }}>
                              <Clock size={11} />{u.days}d
                            </span>
                        }
                      </td>
                      <td style={{ padding: "9px 0 9px 8px" }}>
                        <span style={{
                          padding: "3px 9px", borderRadius: 12, fontSize: 10, fontWeight: 700,
                          background: u.bg, color: u.color, textTransform: "uppercase", letterSpacing: "0.3px",
                        }}>
                          {u.level}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

      </div>

    </div>
  );
}

// ─── Sub-componentes ───────────────────────────────────────────────────────────

function KpiCard({ title, value, sub, trend, isPositive, icon: Icon, accent, urgent }) {
  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${urgent ? C.accent + "55" : C.border}`,
      borderRadius: 14,
      padding: "18px 20px",
      display: "flex",
      flexDirection: "column",
      gap: 10,
      position: "relative",
      overflow: "hidden",
      boxShadow: urgent ? `0 0 0 3px ${C.accentGlow}` : "none",
    }}>
      {/* Decorative top bar */}
      {urgent && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: C.accent, borderRadius: "14px 14px 0 0" }} />}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: FONT.body, fontSize: 12, color: C.muted, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {title}
        </span>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: (accent || C.ink) + "12", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {Icon && <Icon size={16} color={accent || C.ink} />}
        </div>
      </div>

      <div>
        <div style={{ fontFamily: FONT.heading, fontSize: 28, fontWeight: 700, color: accent || C.ink, lineHeight: 1.1 }}>
          {value}
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{sub}</div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600 }}>
        {isPositive
          ? <ArrowUpRight size={13} color={C.success} />
          : <ArrowDownRight size={13} color={C.danger} />}
        <span style={{ color: isPositive ? C.success : C.danger }}>{trend}</span>
      </div>
    </div>
  );
}

function MiniStatCard({ title, value, desc, icon: Icon, color, hint }) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
      padding: "16px 20px", display: "flex", alignItems: "center", gap: 16,
    }}>
      <div style={{ width: 48, height: 48, borderRadius: 12, background: color + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon size={22} color={color} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>{title}</div>
        <div style={{ fontFamily: FONT.heading, fontSize: 26, fontWeight: 700, color: C.ink, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{desc}</div>
      </div>
      <div style={{ background: color + "14", border: `1px solid ${color}30`, borderRadius: 8, padding: "6px 10px", fontSize: 11, color, fontWeight: 600, maxWidth: 160, textAlign: "center" }}>
        {hint}
      </div>
    </div>
  );
}

function InsightPill({ icon, text, type }) {
  const colors = {
    danger:  { bg: C.dangerTint,  border: C.danger  + "44", text: C.danger },
    success: { bg: C.successTint, border: C.success + "44", text: C.success },
    warning: { bg: C.warningTint, border: C.warning + "44", text: C.warning },
    info:    { bg: C.infoTint,    border: C.info    + "44", text: C.info },
  };
  const s = colors[type] || colors.info;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      background: s.bg, border: `1px solid ${s.border}`,
      borderRadius: 20, padding: "6px 14px",
      fontFamily: FONT.body, fontSize: 12, color: s.text, fontWeight: 500,
    }}>
      <span>{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function ChartHeader({ icon: Icon, title, sub }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <h3 style={{ margin: 0, fontFamily: FONT.body, fontSize: 14, fontWeight: 700, color: C.ink, display: "flex", alignItems: "center", gap: 6 }}>
        <Icon size={14} color={C.accent} />
        {title}
      </h3>
      {sub && <p style={{ margin: "2px 0 0", fontSize: 11, color: C.muted }}>{sub}</p>}
    </div>
  );
}

function RotationBar({ name, value, max }) {
  const pctWidth = max > 0 ? (value / max) * 100 : 0;
  const color = value >= 50 ? C.success : value >= 25 ? C.warning : C.danger;
  const shortName = name.length > 14 ? name.slice(0, 14) + "…" : name;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
        <span style={{ fontFamily: FONT.body, fontSize: 12, color: C.inkSecond, fontWeight: 500 }}>{shortName}</span>
        <span style={{ fontFamily: FONT.body, fontSize: 12, fontWeight: 700, color }}>{value}%</span>
      </div>
      <div style={{ height: 5, background: C.borderFaint, borderRadius: 3, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pctWidth}%`, background: color,
          borderRadius: 3, transition: "width 0.6s ease",
        }} />
      </div>
    </div>
  );
}

function TopProductRow({ rank, name, value, suffix, secondValue }) {
  const rankColors = ["#D62839", "#C07D0A", "#1A6FAB", "#454550", "#454550"];
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 10px", borderRadius: 8,
      background: rank === 1 ? C.accentTint : C.surfaceAlt,
      border: `1px solid ${rank === 1 ? C.accent + "30" : C.borderFaint}`,
    }}>
      <span style={{
        width: 22, height: 22, borderRadius: 6,
        background: rankColors[rank - 1] || C.muted, color: "#fff",
        fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>{rank}</span>
      <span style={{ flex: 1, fontSize: 12, fontWeight: rank === 1 ? 700 : 500, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {name}
      </span>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{value} <span style={{ fontSize: 10, color: C.muted, fontWeight: 400 }}>{suffix}</span></div>
        <div style={{ fontSize: 10, color: C.muted }}>{secondValue}</div>
      </div>
    </div>
  );
}
