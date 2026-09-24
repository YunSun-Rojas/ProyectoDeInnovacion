import React, { useState, useMemo } from "react";
import { Search, Plus, Pencil, Trash2, ArrowUp, ArrowDown, PackageSearch, X } from "lucide-react";

const COLORS = {
  bg: "#FAF8F5",
  cardBg: "#FFFFFF",
  ink: "#17171A",
  muted: "#6E6C68",
  border: "#E7E3DC",
  accent: "#D62839",
  accentHover: "#8F1B26",
  accentTint: "#FBE6E7",
  success: "#2F7D4F",
  successTint: "#E4F2E9",
  warning: "#B4700B",
  warningTint: "#FBEBD4",
  danger: "#8F1B26",
  dangerTint: "#FBE6E7"
};

export default function Productos({ products, categories, onAdd, onEdit, onDelete, onAdjustStock, defaultMinStock = 5 }) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("Todas");
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesQuery = p.name.toLowerCase().includes(query.toLowerCase()) || p.sku.toLowerCase().includes(query.toLowerCase());
      const matchesCategory = categoryFilter === "Todas" || p.category === categoryFilter;
      return matchesQuery && matchesCategory;
    });
  }, [products, query, categoryFilter]);

  return (
    <div style={{ padding: "32px 40px", background: COLORS.bg, minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: "Oswald, sans-serif", fontSize: 32, fontWeight: 700, color: COLORS.ink }}>
            Inventario de Productos
          </h1>
          <p style={{ margin: "4px 0 0", fontFamily: "Inter, sans-serif", fontSize: 14, color: COLORS.muted }}>
            {products.length} ítems registrados en el sistema.
          </p>
        </div>
        <button
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
          minWidth: 280
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
      <div style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Inter, sans-serif" }}>
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
            {filteredProducts.map((p) => {
              const isOut = p.stock === 0;
              const isLow = p.stock <= p.minStock && !isOut;
              return (
                <tr key={p.id} style={{ borderBottom: `1px solid ${COLORS.border}`, fontSize: 14 }}>
                  <td style={{ padding: "14px 20px", fontWeight: 600, color: COLORS.ink }}>{p.name}</td>
                  <td style={{ padding: "14px 20px", color: COLORS.muted, fontSize: 13 }}>{p.sku}</td>
                  <td style={{ padding: "14px 20px", color: COLORS.ink }}>{p.category}</td>
                  <td style={{ padding: "14px 20px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button onClick={() => onAdjustStock(p.id, -1)} style={{ border: `1px solid ${COLORS.border}`, background: "#FFF", borderRadius: 4, width: 26, height: 26, cursor: "pointer" }}>-</button>
                      <span style={{ fontWeight: 600, minWidth: 24, textAlign: "center" }}>{p.stock}</span>
                      <button onClick={() => onAdjustStock(p.id, 1)} style={{ border: `1px solid ${COLORS.border}`, background: "#FFF", borderRadius: 4, width: 26, height: 26, cursor: "pointer" }}>+</button>
                    </div>
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
                    <button onClick={() => { setEditingProduct(p); setShowModal(true); }} style={{ border: "none", background: "none", cursor: "pointer", color: COLORS.muted, marginRight: 10 }}>
                      <Pencil size={16} />
                    </button>
                    <button onClick={() => onDelete(p.id)} style={{ border: "none", background: "none", cursor: "pointer", color: COLORS.danger }}>
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
      {showModal && (
        <ProductModal
          initialData={editingProduct}
          defaultMinStock={defaultMinStock}
          categories={categories}
          onClose={() => setShowModal(false)}
          onSave={(data) => {
            if (editingProduct) onEdit(editingProduct.id, data);
            else onAdd(data);
            setShowModal(false);
          }}
        />
      )}
    </div>
  );
}

function ProductModal({ initialData, categories, onClose, onSave, defaultMinStock }) {
  const [form, setForm] = useState(initialData || { name: "", sku: "", category: categories[0]?.name || "", stock: 0, minStock: defaultMinStock, price: 0 });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#FFF", borderRadius: 12, padding: 28, width: 420, maxWidth: "90%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontFamily: "Oswald, sans-serif", fontSize: 22 }}>{initialData ? "Editar Producto" : "Nuevo Producto"}</h2>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={20} /></button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: "Inter, sans-serif", fontSize: 13 }}>
          <div>
            <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Nombre</label>
            <input style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #E7E3DC", boxSizing: "border-box" }} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>SKU</label>
            <input style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #E7E3DC", boxSizing: "border-box" }} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          </div>
          <div>
            <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Categoría</label>
            <select style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #E7E3DC" }} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Stock</label>
              <input type="number" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #E7E3DC", boxSizing: "border-box" }} value={form.stock} onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Mínimo</label>
              <input type="number" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #E7E3DC", boxSizing: "border-box" }} value={form.minStock} onChange={(e) => setForm({ ...form, minStock: Number(e.target.value) })} />
            </div>
          </div>
          <div>
            <label style={{ fontWeight: 600, display: "block", marginBottom: 4 }}>Precio (S/.)</label>
            <input type="number" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #E7E3DC", boxSizing: "border-box" }} value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} />
          </div>

          <button onClick={() => onSave(form)} style={{ marginTop: 10, background: "#D62839", color: "#FFF", border: "none", padding: "12px", borderRadius: 8, fontWeight: 600, cursor: "pointer" }}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
