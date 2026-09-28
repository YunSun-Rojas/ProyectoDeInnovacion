import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, Plus, Pencil, Trash2, X } from "lucide-react";

const COLORS = {
  bg: "var(--inventory-bg, #F1F5F9)",
  cardBg: "var(--inventory-surface, #FFFFFF)",
  ink: "var(--inventory-ink, #1F2937)",
  muted: "var(--inventory-muted, #64748B)",
  border: "var(--inventory-border, #E5E7EB)",
  accent: "#E32636",
  accentTint: "var(--inventory-accent-tint, #FBE6E7)",
  success: "var(--inventory-success, #2F7D4F)",
  successTint: "var(--inventory-success-tint, #E4F2E9)",
  warning: "var(--inventory-warning, #B4700B)",
  warningTint: "var(--inventory-warning-tint, #FBEBD4)",
  danger: "var(--inventory-danger, #8F1B26)",
  dangerTint: "var(--inventory-accent-tint, #FBE6E7)"
};

export default function Productos({ products, categories, onAdd, onEdit, onDelete, readOnly = true, saving = false, writeError = '', uncertain = false, retryWrite, defaultMinStock = 5, notify = () => {} }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const categoryFilter = searchParams.get('categoria') || 'Todas';
  const statusFilter = searchParams.get('estado') || '';
  const setFilter = (key, value) => setSearchParams(previous => {
    const next = new URLSearchParams(previous);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true });
  const setQuery = value => setFilter('q', value);
  const setCategoryFilter = value => setFilter('categoria', value === 'Todas' ? '' : value);
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);

  useEffect(() => {
    if (writeError) notify(writeError, 'error');
  }, [writeError, notify]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesQuery = p.name.toLowerCase().includes(query.toLowerCase()) || p.sku.toLowerCase().includes(query.toLowerCase());
      const matchesCategory = categoryFilter === "Todas" || p.category === categoryFilter;
      const matchesStatus = statusFilter === 'alertas' ? p.stock <= p.minStock
        : statusFilter === 'disponible' ? p.stock > 0
        : statusFilter === 'vendidos' ? p.unitsSoldThisMonth > 0 : true;
      return matchesQuery && matchesCategory && matchesStatus;
    });
  }, [products, query, categoryFilter, statusFilter]);

  return (
    <div style={{ padding: "32px 40px", background: COLORS.bg, minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28, flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: "Oswald, sans-serif", fontSize: 32, fontWeight: 700, color: COLORS.ink }}>
            Inventario de Productos
          </h1>
          <p style={{ margin: "4px 0 0", fontFamily: "Inter, sans-serif", fontSize: 14, color: COLORS.muted }}>
            {products.length} ítems registrados en el sistema.{readOnly && ' Acceso de solo lectura.'}
          </p>
        </div>
        <button
          disabled={readOnly || saving || uncertain}
          title={readOnly ? 'Acceso de solo lectura' : 'Nuevo producto'}
          onClick={() => { setEditingProduct(null); setShowModal(true); }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: COLORS.accent,
            color: "#FFF",
            border: "none",
            borderRadius: 8,
            padding: "10px 18px",
            fontFamily: "Inter, sans-serif",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          <Plus size={18} /> Nuevo Producto
        </button>
      </div>

      {writeError && !showModal && <div role="alert" style={{ color: COLORS.danger, marginBottom: 16 }}>
        {writeError}
        {uncertain && <button type="button" disabled={saving} onClick={retryWrite} style={{ marginLeft: 12 }}>Reintentar guardado</button>}
      </div>}

      {/* Controles de búsqueda y filtros */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: COLORS.cardBg,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 8,
          padding: "8px 14px",
          minWidth: "min(280px, 100%)"
        }}>
          <Search size={18} color={COLORS.muted} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o SKU..."
            style={{ border: "none", outline: "none", width: "100%", fontFamily: "Inter, sans-serif", fontSize: 14 }}
          />
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["Todas", ...categories.map(c => c.name)].map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              style={{
                padding: "8px 16px",
                borderRadius: 20,
                border: `1px solid ${categoryFilter === cat ? COLORS.accent : COLORS.border}`,
                background: categoryFilter === cat ? COLORS.accentTint : COLORS.cardBg,
                color: categoryFilter === cat ? COLORS.accent : COLORS.ink,
                fontFamily: "Inter, sans-serif",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla de Productos */}
      {(query || categoryFilter !== 'Todas' || statusFilter) && <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, fontSize: 13, color: COLORS.muted }}>
        <span>{filteredProducts.length} productos · {statusFilter === 'alertas' ? 'Stock bajo o agotado' : statusFilter === 'disponible' ? 'Con stock disponible' : statusFilter === 'vendidos' ? 'Con ventas este mes' : 'Inventario filtrado'}</span>
        <button type="button" onClick={() => setSearchParams({})} style={{ border: `1px solid ${COLORS.border}`, borderRadius: 6, background: COLORS.cardBg, padding: '6px 10px', cursor: 'pointer', color: COLORS.ink }}>Limpiar filtros</button>
      </div>}
      <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse", fontFamily: "Inter, sans-serif" }}>
          <thead>
            <tr style={{ background: COLORS.bg, borderBottom: `1px solid ${COLORS.border}`, textAlign: "left", fontSize: 12, color: COLORS.muted }}>
              <th style={{ padding: "14px 20px" }}>PRODUCTO</th>
              <th style={{ padding: "14px 20px" }}>SKU</th>
              <th style={{ padding: "14px 20px" }}>CATEGORÍA</th>
              <th style={{ padding: "14px 20px" }}>STOCK</th>
              <th style={{ padding: "14px 20px" }}>PRECIO</th>
              <th style={{ padding: "14px 20px" }}>ESTADO</th>
              <th style={{ padding: "14px 20px", textAlign: "right" }}>ACCIONES</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.length === 0 && <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: COLORS.muted }}>No hay productos que coincidan con los filtros.</td></tr>}
            {filteredProducts.map((p) => {
              const isOut = p.stock === 0;
              const isLow = p.stock <= p.minStock && !isOut;
              return (
                <tr key={p.id} style={{ borderBottom: `1px solid ${COLORS.border}`, fontSize: 14 }}>
                  <td style={{ padding: "14px 20px", fontWeight: 600, color: COLORS.ink }}>{p.name}</td>
                  <td style={{ padding: "14px 20px", color: COLORS.muted, fontSize: 13 }}>{p.sku}</td>
                  <td style={{ padding: "14px 20px", color: COLORS.ink }}>{p.category}</td>
                  <td style={{ padding: "14px 20px" }}>
                    <span style={{ display: "inline-block", fontWeight: 600, minWidth: 24, textAlign: "center" }}>{p.stock}</span>
                  </td>
                  <td style={{ padding: "14px 20px", fontWeight: 500 }}>S/. {p.price.toFixed(2)}</td>
                  <td style={{ padding: "14px 20px" }}>
                    <span style={{
                      padding: "4px 10px",
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 600,
                      background: isOut ? COLORS.dangerTint : isLow ? COLORS.warningTint : COLORS.successTint,
                      color: isOut ? COLORS.danger : isLow ? COLORS.warning : COLORS.success
                    }}>
                      {isOut ? "Sin Stock" : isLow ? "Stock Bajo" : "Disponible"}
                    </span>
                  </td>
                  <td style={{ padding: "14px 20px", textAlign: "right" }}>
                    <button disabled={readOnly || saving || uncertain} title={readOnly ? 'Acceso de solo lectura' : 'Editar producto'} onClick={() => { setEditingProduct(p); setShowModal(true); }} style={{ border: "none", background: "none", cursor: "pointer", color: COLORS.muted, marginRight: 10 }}>
                      <Pencil size={16} />
                    </button>
                    <button disabled={readOnly || saving || uncertain} title={readOnly ? 'Acceso de solo lectura' : 'Eliminar producto'} onClick={async () => { if (window.confirm(`¿Eliminar el producto ${p.name}? El historial se conservará.`) && await onDelete(p)) notify(`Producto eliminado: ${p.name}.`); }} style={{ border: "none", background: "none", cursor: "pointer", color: COLORS.danger }}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal Crear/Editar */}
      {!readOnly && showModal && (
        <ProductModal
          initialData={editingProduct}
          defaultMinStock={defaultMinStock}
          categories={categories}
          saving={saving}
          error={writeError}
          uncertain={uncertain}
          onRetry={async () => { if (await retryWrite()) setShowModal(false); }}
          onClose={() => setShowModal(false)}
          onSave={async (data) => {
            const saved = editingProduct ? await onEdit(editingProduct, data) : await onAdd(data);
            if (saved) {
              notify(editingProduct ? 'Producto actualizado correctamente.' : 'Producto agregado correctamente.');
              setShowModal(false);
            }
          }}
        />
      )}
    </div>
  );
}

function ProductModal({ initialData, categories, onClose, onSave, defaultMinStock, saving, error, uncertain, onRetry }) {
  const [form, setForm] = useState(initialData || { name: "", sku: "", category: categories[0]?.name || "", stock: 0, minStock: defaultMinStock, price: 0 });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "var(--inventory-surface, #FFF)", borderRadius: 12, padding: 28, width: 420, maxWidth: "90%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontFamily: "Oswald, sans-serif", fontSize: 22 }}>{initialData ? "Editar Producto" : "Nuevo Producto"}</h2>
          <button type="button" disabled={saving} onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
        </div>

        <form onSubmit={event => { event.preventDefault(); if (!saving && !uncertain) onSave(form); }} style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: "Inter, sans-serif", fontSize: 13 }}>
          <div>
            <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Nombre</label>
            <input required disabled={saving || uncertain} style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--inventory-border, #E5E7EB)", boxSizing: "border-box" }} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>SKU</label>
            <input required disabled={saving || uncertain} style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--inventory-border, #E5E7EB)", boxSizing: "border-box" }} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          </div>
          <div>
            <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Categoría</label>
            <select required disabled={saving || uncertain} style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--inventory-border, #E5E7EB)" }} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Stock</label>
              <input required disabled={saving || uncertain} min="0" step="1" max="2147483647" type="number" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--inventory-border, #E5E7EB)", boxSizing: "border-box" }} value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Mínimo</label>
              <input required disabled={saving || uncertain} min="0" step="1" max="2147483647" type="number" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--inventory-border, #E5E7EB)", boxSizing: "border-box" }} value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} />
            </div>
          </div>
          <div>
            <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Precio (S/.)</label>
            <input required disabled={saving || uncertain} min="0" step="0.01" max="9999999999.99" type="number" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--inventory-border, #E5E7EB)", boxSizing: "border-box" }} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          </div>

          {error && <p role="alert" style={{ color: COLORS.danger, margin: 0 }}>{error}</p>}
          {uncertain && <button type="button" disabled={saving} onClick={onRetry}>Reintentar guardado</button>}
          <button type="submit" disabled={saving || uncertain} style={{ marginTop: 10, background: "#E32636", color: "#FFF", border: "none", padding: "12px", borderRadius: 8, fontWeight: 600, cursor: "pointer" }}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </form>
      </div>
    </div>
  );
}
