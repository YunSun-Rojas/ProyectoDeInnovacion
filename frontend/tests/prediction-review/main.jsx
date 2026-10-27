// Isolated visual review only: no API, authentication or production data.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Prediccion from '../../src/modules/inventario/pages/Prediccion';
import { predictionFixture } from './fixtures.mjs';
import '../../src/index.css';

export default function Review() {
  const [dark, setDark] = useState(false);
  const params = new URLSearchParams(window.location.search);
  const scenario = params.get('scenario');
  const props = predictionFixture({ kind: scenario === 'valid' ? 'commercial' : scenario === 'test' ? 'test' : 'unclassified',
    length: scenario === 'short' ? 100 : 220,
    products: scenario === 'valid' || scenario === 'short' ? undefined : Array.from({ length: 173 }, (_, index) => ({
      id: index + 1, name: `Producto sintético ${index + 1}`, sku: `SYN-${index + 1}`, stock: 10, minStock: 3 })),
    extra: scenario === 'disabled' ? { salesEnabled: false } : {} });
  return <div className="inventory-shell" data-theme={dark ? 'dark' : 'light'} style={{ minHeight: '100vh', background: 'var(--inventory-bg, #f1f5f9)' }}>
    <aside style={{ padding: 12, color: 'var(--inventory-ink, #202735)', fontSize: 12 }}>Solo pruebas · datos sintéticos <button type="button" onClick={() => setDark(value => !value)}>Cambiar tema</button></aside>
    <Prediccion {...props} />
  </div>;
}

createRoot(document.getElementById('root')).render(<Review />);
