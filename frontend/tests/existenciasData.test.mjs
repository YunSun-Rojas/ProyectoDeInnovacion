import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedStockChange, filterStock, movementQuantity, productMovements, recentStockMovements, stockState } from '../src/modules/inventario/pages/existenciasData.js';
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

test('últimos movimientos: cinco reales, orden descendente, empates por ID y sin duplicados', () => {
  const rows = Array.from({ length: 8 }, (_, id) => ({ id, productId: 1, type: id % 2 ? 'Salida' : 'Ajuste', quantity: id % 2 ? -2 : 3, date: '2026-10-20T12:00:00Z' }));
  const before = structuredClone(rows);
  assert.deepEqual(recentStockMovements([...rows, rows[7], { id: 9, productId: 1, type: 'Registro', quantity: 10 }, { id: 10, productId: 1, type: 'Entrada', quantity: 0 }], products, null, '2026-10-20').map(row => row.id), [7, 6, 5, 4, 3]);
  assert.deepEqual(rows, before);
  assert.deepEqual(recentStockMovements([]), []);
});

test('movimiento confirmado exacto primero incluso con operaciones concurrentes posteriores y sin duplicarlo', () => {
  const confirmed = { id: 10, productId: 1, product: 'Mouse histórico', sku: 'OLD', type: 'Entrada', quantity: 5, before: 10, after: 15, date: '2026-10-20T12:00:00Z' };
  const concurrent = { ...confirmed, id: 11, quantity: -2, before: 15, after: 13, type: 'Salida', date: '2026-10-20T12:01:00Z' };
  const rows = recentStockMovements([concurrent, { ...confirmed, product: 'Nombre actualizado' }], products, confirmed, '2026-10-20');
  assert.equal(rows[0], confirmed);
  assert.deepEqual(rows.map(row => row.id), [10, 11]);
  assert.equal(rows[0].after, 15);
  assert.equal(rows[0].product, 'Mouse histórico');
  assert.deepEqual(recentStockMovements([confirmed, concurrent], products, null, '2026-10-20').map(row => row.id), [11, 10]);
});

test('recientes filtra por pertenencia al catálogo antes de limitar, conserva Inactivos y todo el historial', () => {
  const catalog = [{ ...products[0], isActive: false }];
  const rows = Array.from({ length: 12 }, (_, index) => ({ id: index + 1, productId: index < 6 ? '1' : 99,
    product: 'Mouse', sku: 'M-01', type: 'Entrada', quantity: 1, date: '2026-10-20T12:00:00Z' }));
  const deletion = { ...rows[0], id: 13, type: 'Baja', quantity: -8 };
  const unlinked = { ...rows[0], id: 14, productId: null };
  const history = [...rows, deletion, unlinked];
  const original = structuredClone(history);
  assert.deepEqual(recentStockMovements(history, catalog, null, '2026-10-20').map(row => row.id), [6, 5, 4, 3, 2]);
  assert.deepEqual(recentStockMovements(history, [], rows[11], '2026-10-20'), []);
  assert.deepEqual(recentStockMovements([rows[0]], catalog, null, '2026-10-20'), [rows[0]]);
  assert.deepEqual(productMovements(history, 99), rows.slice(6));
  assert.deepEqual(history, original);
  assert.equal(catalog[0].isActive, false);
});

test('Existencias: solo el día de Perú, ventas incluidas y confirmaciones de ayer no reaparecen', () => {
  const rows=[{id:1,productId:1,type:'Entrada',quantity:3,date:'2026-10-20T04:59:59Z'},
    {id:2,productId:1,type:'Venta',quantity:-1,date:'2026-10-20T05:00:00Z'},
    {id:3,productId:1,type:'Ajuste',quantity:2,date:'2026-10-21T04:59:59Z'},
    {id:4,productId:1,type:'Salida',quantity:-1,date:'2026-10-21T05:00:00Z'}];
  const before=structuredClone(rows);
  assert.deepEqual(recentStockMovements(rows,products,rows[0],'2026-10-20').map(row=>row.id),[3,2]);
  assert.deepEqual(recentStockMovements(rows,products,rows[2],'2026-10-21').map(row=>row.id),[4]);
  assert.deepEqual(recentStockMovements(rows,products,rows[2],'2026-10-22'),[]);
  assert.deepEqual(rows,before);
});

test('Existencias combina búsqueda por nombre/SKU, categoría, estado y orden', () => {
  assert.equal(filterStock(products, { query: '  mOn-01 ' })[0].id, 3);
  assert.equal(filterStock(products, { query: 'TECLADO', category: 'Periféricos', state: 'bajo' })[0].id, 2);
  assert.deepEqual(filterStock(products, { category: 'Periféricos', sort: 'stock-desc' }).map(product => product.id), [1, 2]);
  assert.deepEqual(filterStock(products, { query: 'inexistente' }), []);
  assert.deepEqual(filterStock([], { state: 'normal' }), []);
});

test('movimientos por ID conservan varias operaciones y no mezclan SKU reutilizado ni registros sin ID', () => {
  const movements = [{ id: 10, productId: 1, sku: 'M-01' }, { id: 11, productId: '1', sku: 'SKU-ANTIGUO' },
    { id: 12, productId: 2, sku: 'M-01' }, { id: 13, productId: null, sku: 'M-01' }];
  assert.deepEqual(productMovements(movements, 1).map(row => row.id), [10, 11]);
  assert.deepEqual(productMovements(movements, null), []);
  assert.deepEqual(productMovements(movements, 999), []);
});

test('confirmación se asocia a la solicitud exacta y rechaza respuestas anteriores o de otro producto', () => {
  const intent = { productId: '1', action: 'stock_in' };
  const receipt = { requestId: 'solicitud-actual', action: 'stock_in', productId: 1,
    product: { id: 1, stock: 15 }, movement: { id: 40, productId: 1, before: 10, quantity: 5, after: 15 } };
  assert.equal(confirmedStockChange(receipt, intent, 'anterior'), receipt);
  assert.equal(confirmedStockChange(receipt, intent, receipt.requestId), null);
  assert.equal(confirmedStockChange(receipt, { ...intent, productId: 2 }), null);
  assert.equal(confirmedStockChange(receipt, { ...intent, action: 'stock_out' }), null);
  assert.equal(confirmedStockChange({ ...receipt, movement: { ...receipt.movement, productId: 2 } }, intent), null);
  assert.equal(confirmedStockChange({ ...receipt, movement: null }, intent), null);
  assert.equal(confirmedStockChange(undefined, intent), null);
  // Una lectura posterior concurrente no cambia el saldo confirmado de esta operación.
  const later = { id: 41, productId: 1, before: 15, quantity: -2, after: 13 };
  assert.equal(productMovements([later, receipt.movement], 1).length, 2);
  assert.equal(confirmedStockChange(receipt, intent).movement.id, 40);
  assert.equal(confirmedStockChange(receipt, intent).movement.after, 15);
  assert.deepEqual([5, -3, 0, undefined].map(movementQuantity), ['+5', '−3', '0', 'No registrado']);
});
