import { useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import { productosDashboard, categoriasDashboard } from "./data/inventarioReal";

export default function InventarioLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activePage = pathname.split("/")[2] || "dashboard";
  const setActivePage = (page) => navigate(page === "dashboard" ? "/dashboard" : `/dashboard/${page}`);
  const [products, setProducts] = useState(productosDashboard);
  const categories = categoriasDashboard;
  const [movements, setMovements] = useState([]);
  const [settings, setSettings] = useState({ company: 'Eagle Gaming', ruc: '20607787728', address: 'C.C. Garcilazo de la Vega 1348, Tda. 1B, 133', phone: '986638034', minStock: 5 });
  const record = (product, type, before, after, reason) => setMovements(previous => [{
    id: crypto.randomUUID(), date: new Date().toISOString(), product: product.name,
    sku: product.sku, type, before, after, quantity: after - before, user: 'demo', reason,
  }, ...previous]);

  const handleAddProduct = (data) => {
    setProducts(previous => [...previous, { ...data, id: Date.now(), unitsSoldLastMonth: 0, unitsSoldThisMonth: 0 }]);
    record(data, 'Alta', 0, data.stock, 'Registro de producto');
  };
  const handleEditProduct = (id, data) => {
    const product = products.find(p => p.id === id);
    setProducts(previous => previous.map(p => p.id === id ? { ...p, ...data } : p));
    record(data, 'Ajuste', product.stock, data.stock, 'Edición de producto');
  };
  const handleDeleteProduct = (id) => {
    const product = products.find(p => p.id === id);
    setProducts(previous => previous.filter(p => p.id !== id));
    record(product, 'Baja', product.stock, 0, 'Eliminación de producto');
  };
  const handleAdjustStock = (id, delta) => {
    const product = products.find(p => p.id === id);
    const stock = Math.max(0, product.stock + delta);
    if (stock === product.stock) return;
    setProducts(previous => previous.map(p => p.id === id ? { ...p, stock } : p));
    record(product, delta > 0 ? 'Entrada' : 'Salida', product.stock, stock, 'Cambio manual de existencias');
  };

  return (
    <div style={{ display: "flex", width: "100vw", minHeight: "100vh", overflowX: "hidden" }}>
      <Sidebar activePage={activePage} setActivePage={setActivePage} />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "#FAF8F5" }}>
        <Header products={products} />

        <main style={{ flex: 1, overflowY: "auto" }}>
          <Outlet context={{ products, categories, movements, settings, setSettings, defaultMinStock: settings.minStock, onNavigate: setActivePage,
            onAdd: handleAddProduct, onEdit: handleEditProduct,
            onDelete: handleDeleteProduct, onAdjustStock: handleAdjustStock }} />
        </main>
      </div>
    </div>
  );
}

