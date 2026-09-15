import React, { useState } from "react";
import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import Dashboard from "./pages/Dashboard";
import Productos from "./pages/Productos";
import Prediccion from "./pages/Prediccion";
import Vision from "./pages/Vision";

export const CATEGORY_SEED = [
  { id: "c1", name: "Laptops" },
  { id: "c2", name: "Tarjetas de video" },
  { id: "c3", name: "Procesadores" },
  { id: "c4", name: "Memoria RAM" },
  { id: "c5", name: "Almacenamiento" },
  { id: "c6", name: "Periféricos" },
];

export const PRODUCT_SEED = [
  // Laptops
  { id: 1,  name: "Laptop Ultra Workstation X",   sku: "LAP-PRO-001",   category: "Laptops",           stock: 8,  minStock: 4,  price: 2499, unitsSoldLastMonth: 6,  unitsSoldThisMonth: 4 },
  { id: 2,  name: "Laptop Gamer ROG Strix G16",   sku: "LAP-ROG-016",   category: "Laptops",           stock: 5,  minStock: 3,  price: 1799, unitsSoldLastMonth: 8,  unitsSoldThisMonth: 5 },
  { id: 3,  name: "MacBook Pro M3 14\"",           sku: "LAP-MAC-M3",    category: "Laptops",           stock: 2,  minStock: 3,  price: 2999, unitsSoldLastMonth: 4,  unitsSoldThisMonth: 3 },
  // Tarjetas de Video
  { id: 4,  name: "Nvidia RTX 4090 OC 24GB",      sku: "GPU-RTX-4090",  category: "Tarjetas de video", stock: 3,  minStock: 5,  price: 1899, unitsSoldLastMonth: 7,  unitsSoldThisMonth: 4 },
  { id: 5,  name: "Nvidia RTX 4070 Ti Super",     sku: "GPU-RTX-4070TI",category: "Tarjetas de video", stock: 11, minStock: 5,  price: 899,  unitsSoldLastMonth: 14, unitsSoldThisMonth: 9 },
  { id: 6,  name: "AMD Radeon RX 7900 XTX",       sku: "GPU-AMD-7900",  category: "Tarjetas de video", stock: 6,  minStock: 4,  price: 999,  unitsSoldLastMonth: 5,  unitsSoldThisMonth: 3 },
  // Procesadores
  { id: 7,  name: "Intel Core i9-14900K",         sku: "CPU-I9-14900K", category: "Procesadores",      stock: 9,  minStock: 5,  price: 589,  unitsSoldLastMonth: 10, unitsSoldThisMonth: 7 },
  { id: 8,  name: "AMD Ryzen 9 7950X",            sku: "CPU-R9-7950X",  category: "Procesadores",      stock: 7,  minStock: 4,  price: 699,  unitsSoldLastMonth: 6,  unitsSoldThisMonth: 4 },
  { id: 9,  name: "Intel Core i5-14600K",         sku: "CPU-I5-14600K", category: "Procesadores",      stock: 14, minStock: 6,  price: 319,  unitsSoldLastMonth: 18, unitsSoldThisMonth: 11 },
  // Memoria RAM
  { id: 10, name: "DDR5 RAM 32GB Kit 6000MHz",    sku: "RAM-DDR5-32",   category: "Memoria RAM",       stock: 0,  minStock: 10, price: 159,  unitsSoldLastMonth: 20, unitsSoldThisMonth: 0 },
  { id: 11, name: "DDR5 RAM 64GB Kit 5600MHz",    sku: "RAM-DDR5-64",   category: "Memoria RAM",       stock: 4,  minStock: 8,  price: 299,  unitsSoldLastMonth: 8,  unitsSoldThisMonth: 3 },
  { id: 12, name: "DDR4 RAM 16GB 3200MHz",        sku: "RAM-DDR4-16",   category: "Memoria RAM",       stock: 22, minStock: 10, price: 49,   unitsSoldLastMonth: 30, unitsSoldThisMonth: 18 },
  // Almacenamiento
  { id: 13, name: "Samsung 990 Pro NVMe 2TB",     sku: "SSD-SAM-2TB",   category: "Almacenamiento",    stock: 17, minStock: 8,  price: 189,  unitsSoldLastMonth: 22, unitsSoldThisMonth: 15 },
  { id: 14, name: "WD Black SN850X 1TB",          sku: "SSD-WDB-1TB",   category: "Almacenamiento",    stock: 3,  minStock: 6,  price: 129,  unitsSoldLastMonth: 12, unitsSoldThisMonth: 7 },
  { id: 15, name: "Seagate Barracuda 4TB HDD",    sku: "HDD-SEA-4TB",   category: "Almacenamiento",    stock: 11, minStock: 5,  price: 89,   unitsSoldLastMonth: 9,  unitsSoldThisMonth: 5 },
  // Periféricos
  { id: 16, name: "Logitech G Pro X Superlight 2",sku: "PER-LOG-GPXS2", category: "Periféricos",       stock: 8,  minStock: 5,  price: 159,  unitsSoldLastMonth: 11, unitsSoldThisMonth: 7 },
  { id: 17, name: "Razer BlackWidow V4 Pro",      sku: "PER-RZR-BWV4",  category: "Periféricos",       stock: 6,  minStock: 4,  price: 229,  unitsSoldLastMonth: 7,  unitsSoldThisMonth: 4 },
  { id: 18, name: "Monitor LG 27\" 4K OLED",      sku: "PER-LG-27OLED", category: "Periféricos",       stock: 1,  minStock: 3,  price: 799,  unitsSoldLastMonth: 4,  unitsSoldThisMonth: 2 },
];

// Historial de movimientos simulado con estructura realista
export const MOVEMENT_HISTORY = [
  { id: "m01", date: "2026-09-14", productId: 4,  productName: "Nvidia RTX 4090 OC 24GB",    type: "salida",  qty: 2, reason: "Venta" },
  { id: "m02", date: "2026-09-13", productId: 10, productName: "DDR5 RAM 32GB Kit 6000MHz",  type: "entrada", qty: 0, reason: "Pendiente reposición" },
  { id: "m03", date: "2026-09-13", productId: 14, productName: "WD Black SN850X 1TB",        type: "salida",  qty: 3, reason: "Venta" },
  { id: "m04", date: "2026-09-12", productId: 3,  productName: "MacBook Pro M3 14\"",         type: "salida",  qty: 1, reason: "Venta" },
  { id: "m05", date: "2026-09-11", productId: 18, productName: "Monitor LG 27\" 4K OLED",    type: "salida",  qty: 1, reason: "Venta" },
  { id: "m06", date: "2026-09-10", productId: 12, productName: "DDR4 RAM 16GB 3200MHz",      type: "entrada", qty: 30, reason: "Reposición" },
  { id: "m07", date: "2026-09-09", productId: 5,  productName: "Nvidia RTX 4070 Ti Super",   type: "salida",  qty: 3, reason: "Venta" },
  { id: "m08", date: "2026-09-08", productId: 13, productName: "Samsung 990 Pro NVMe 2TB",   type: "entrada", qty: 20, reason: "Reposición" },
];

export default function App() {
  const [activePage, setActivePage] = useState("dashboard");
  const [products, setProducts] = useState(PRODUCT_SEED);
  const [categories, setCategories] = useState(CATEGORY_SEED);

  const handleAddProduct    = (data) => setProducts([...products, { ...data, id: Date.now(), unitsSoldLastMonth: 0, unitsSoldThisMonth: 0 }]);
  const handleEditProduct   = (id, data) => setProducts(products.map(p => p.id === id ? { ...p, ...data } : p));
  const handleDeleteProduct = (id) => setProducts(products.filter(p => p.id !== id));
  const handleAdjustStock   = (id, delta) => setProducts(products.map(p => p.id === id ? { ...p, stock: Math.max(0, p.stock + delta) } : p));

  return (
    <div style={{ display: "flex", width: "100vw", minHeight: "100vh", overflowX: "hidden" }}>
      <Sidebar activePage={activePage} setActivePage={setActivePage} />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "#FAF8F5" }}>
        <Header products={products} />

        <main style={{ flex: 1, overflowY: "auto" }}>
          {activePage === "dashboard" && (
            <Dashboard products={products} categories={categories} onNavigate={setActivePage} />
          )}
          {activePage === "productos" && (
            <Productos
              products={products}
              categories={categories}
              onAdd={handleAddProduct}
              onEdit={handleEditProduct}
              onDelete={handleDeleteProduct}
              onAdjustStock={handleAdjustStock}
            />
          )}
          {activePage === "prediccion" && <Prediccion products={products} />}
          {activePage === "vision"     && <Vision />}
          {activePage === "historial"  && (
            <div style={{ padding: 40, fontFamily: "Inter, sans-serif" }}>
              <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 28 }}>Historial de Movimientos</h2>
              <p style={{ color: "#6E6C68" }}>Registro general de auditoría de entradas y salidas.</p>
            </div>
          )}
          {activePage === "configuracion" && (
            <div style={{ padding: 40, fontFamily: "Inter, sans-serif" }}>
              <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 28 }}>Ajustes del Sistema</h2>
              <p style={{ color: "#6E6C68" }}>Parámetros de conexión de IA y roles de usuario.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
