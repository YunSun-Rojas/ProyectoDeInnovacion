import test from 'node:test';
import assert from 'node:assert/strict';
import { filterStock, stockState } from '../src/modules/inventario/pages/existenciasData.js';
import { summarizeInventory } from '../src/modules/inventario/pages/dashboardData.js';

const products = [
  { id: 1, name: 'Mouse', sku: 'M-01', category: 'Periféricos', stock: 8, minStock: 3, price: 80 },
  { id: 2, name: 'Teclado', sku: 'T-01', category: 'Periféricos', stock: 3, minStock: 3, price: 120 },
  { id: 3, name: 'Monitor', sku: 'MON-01', category: 'Pantallas', stock: 0, minStock: 0, price: 500 },
  { id: 4, name: 'Cable', sku: 'C-01', category: 'Accesorios', stock: 2, minStock: null, price: 10 },
];

test('Existencias distingue mínimos, cero y stock normal sin alterar productos', () => {
  const before = structuredClone(products);
  assert.deepEqual(products.map(product => stockState(product)), ['normal', 'bajo', 'sin-stock', 'bajo']);
  const summary = summarizeInventory(products);
  assert.equal(summary.units, 13);
  assert.equal(summary.low, 2);
  assert.equal(summary.empty, 1);
  assert.deepEqual(filterStock(products).map(product => product.id), [3, 4, 2, 1]);
  assert.deepEqual(products, before);
});

test('Existencias combina búsqueda por nombre/SKU, categoría, estado y orden', () => {
  assert.equal(filterStock(products, { query: '  mOn-01 ' })[0].id, 3);
  assert.equal(filterStock(products, { query: 'TECLADO', category: 'Periféricos', state: 'bajo' })[0].id, 2);
  assert.deepEqual(filterStock(products, { category: 'Periféricos', sort: 'stock-desc' }).map(product => product.id), [1, 2]);
  assert.deepEqual(filterStock(products, { query: 'inexistente' }), []);
  assert.deepEqual(filterStock([], { state: 'normal' }), []);
});
