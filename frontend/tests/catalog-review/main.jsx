import React from 'react';
import { createRoot } from 'react-dom/client';
import ProductForm from '../../src/modules/inventario/components/catalog/ProductForm';
import ProductDetails from '../../src/modules/inventario/components/catalog/ProductDetails';
import './preview.css';

const product = { id: 1, sku: 'REV-M01', name: 'Mouse de revisión', category: 'Periféricos', brand: 'Marca de ejemplo', model: 'Modelo de revisión',
  characteristics: 'Producto de ejemplo para revisar la ficha.\nNo proviene de Supabase.', price: 80, purchaseCost: 45,
  stock: 8, minStock: 2, unitOfMeasure: 'Unidad', isActive: true, version: 1 };
const mode = new URLSearchParams(window.location.search).get('mode');
const readOnly = mode === 'readonly';
createRoot(document.getElementById('root')).render(<React.StrictMode>
  <main><header className="review-notice"><h1>Revisión de catálogo · Fase 2B</h1><p>Entorno aislado con datos de ejemplo. Sin API, sin guardado y sin conexión a Supabase.</p></header>
    <div className="review-layout"><ProductForm product={mode === 'new' ? undefined : product} categories={['Periféricos', 'Pantallas']}
      products={[product]} canReadPurchaseCost={!readOnly} readOnly={readOnly} />
      <ProductDetails product={product} canReadPurchaseCost={!readOnly} /></div></main>
</React.StrictMode>);
