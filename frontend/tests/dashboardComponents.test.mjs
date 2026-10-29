import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

test('el Dashboard muestra datos reales del almacén y accesos operativos funcionales', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = fileURLToPath(new URL('../dist/dashboard-ssr', import.meta.url));
  await build({
    configFile: false,
    root,
    plugins: [react()],
    logLevel: 'error',
    build: {
      ssr: fileURLToPath(new URL('../src/modules/inventario/pages/Dashboard.jsx', import.meta.url)),
      outDir: output,
      emptyOutDir: true,
      rolldownOptions: {
        external: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'],
        output: { entryFileNames: 'dashboard.mjs' },
      },
    },
  });

  const { default: Dashboard } = await import('../dist/dashboard-ssr/dashboard.mjs');
  const html = renderToStaticMarkup(createElement(
    MemoryRouter,
    null,
    createElement(Dashboard, {
      products: [
        { id: 1, name: 'Teclado Eagle', sku: 'KEY-1', stock: 0, minStock: 2, purchaseCost: 25, isActive: true },
        { id: 2, name: 'Mouse Eagle', sku: 'MOU-2', stock: 4, minStock: 5, purchaseCost: null, price: 99, isActive: true },
        { id: 3, name: 'Producto archivado', sku: 'OLD-3', stock: 40, minStock: 5, purchaseCost: 20, isActive: false },
      ],
      movements: [
        { id: 5, product: 'Mouse Eagle', sku: 'MOU-2', date: '2026-10-28T12:00:00Z', type: 'Venta', before: 5, after: 4, quantity: -1, user: 'user@example.test', reason: 'Venta registrada' },
        { id: 4, product: 'Teclado Eagle', sku: 'KEY-1', date: '2026-10-27T12:00:00Z', type: 'Entrada', before: 0, after: 3, quantity: 3, user: 'admin@example.test', reason: 'Reposición' },
      ],
      activity: {
        series: [{ date: '2026-10-28', label: '28/10', entradas: 3, salidas: 1 }],
        entries: 3,
        exits: 1,
        hasFlow: true,
      },
      rangeLabel: 'Últimos 30 días',
      defaultMinStock: 5,
      readOnly: false,
      stockEnabled: true,
    })
  ));

  for (const text of [
    'Panel de control',
    'Resumen general del almacén',
    'Productos registrados',
    'Unidades en almacén',
    'Valor del inventario',
    'Productos con stock bajo',
    'No disponible',
    'Alertas de inventario',
    'Movimientos del almacén',
    'Movimientos recientes',
    'user@example.test',
    'Venta · salida de stock',
    'Registrar producto',
    'Registrar entrada',
    'Registrar salida',
    'Consultar inventario',
    'Consultar Kardex',
  ]) assert(html.includes(text), `Falta el contenido ${text}`);

  assert(html.includes('2 registros disponibles'));
  assert(html.includes('/dashboard/productos?accion=nuevo'));
  assert(html.includes('/dashboard/existencias?accion=entrada'));
  assert(html.includes('/dashboard/existencias?accion=salida'));
  assert(html.includes('/dashboard/movimientos'));
  assert(html.includes('/dashboard/existencias'));
  assert(html.includes('/dashboard/alertas'));
  assert(html.includes('/dashboard/kardex'));
  assert(!html.includes('Producto archivado'));
  assert(!html.includes('Ventas por día'));
  assert(!html.includes('Top 5 por unidades'));
  assert(!html.includes('Stock por categoría'));

  const empty = renderToStaticMarkup(createElement(
    MemoryRouter,
    null,
    createElement(Dashboard, {
      products: [],
      movements: [],
      activity: { series: [], entries: 0, exits: 0, hasFlow: false },
      readOnly: false,
      retry: () => {},
    })
  ));
  assert(empty.includes('Sin productos activos'));
  assert(empty.includes('Sin movimientos en este período'));
  assert(empty.includes('Aún no hay movimientos'));
  assert(!empty.includes('Registrar entrada'));
  assert(!empty.includes('Registrar salida'));

  const invalidRange = renderToStaticMarkup(createElement(
    MemoryRouter,
    null,
    createElement(Dashboard, {
      products: [],
      movements: [],
      activity: { series: [], entries: 0, exits: 0, hasFlow: false },
      rangeError: 'Selecciona un rango de fechas válido.',
      readOnly: true,
    })
  ));
  assert(invalidRange.includes('Rango de fechas no válido'));
  assert(invalidRange.includes('Selecciona un rango de fechas válido.'));
  assert(!invalidRange.includes('Registrar producto'));
});
