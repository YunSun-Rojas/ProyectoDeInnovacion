import test from 'node:test';
import assert from 'node:assert/strict';
import { stockValidation, filterMovements } from '../src/modules/inventario/pages/movementData.js';

test('valida cantidades, disponibilidad, desbordamiento y motivo antes de guardar', () => {
  const product = { stock: 10, version: 2 };
  for (const action of ['stock_in', 'stock_out', 'stock_adjust']) assert.equal(stockValidation(product, action, '4', 'Compra'), '');
  assert.equal(stockValidation(product, 'stock_adjust', '-10', 'Conteo'), '');
  for (const [action, quantity, reason] of [['stock_in','0','Compra'],['stock_in','1.5','Compra'],['stock_out','11','Salida'],['stock_out','-1','Salida'],['stock_adjust','-11','Conteo'],['stock_adjust','2',' '],['stock_in','2147483647','Compra']]) assert(stockValidation(product, action, quantity, reason));
  assert(stockValidation(null, 'stock_in', '1', 'Compra'));
});

test('separa variación cero conservando todos los registros y filtra fechas Lima, SKU, tipo, responsable', () => {
  const movements = [
    { id: 1, date: '2026-10-14T02:00:00Z', product: 'Mouse', sku: 'M1', type: 'Ajuste', quantity: 0, user: 'Ana' },
    { id: 2, date: '2026-10-14T06:00:00Z', product: 'Mouse', sku: 'M1', type: 'Entrada', quantity: 4, user: 'Luis' },
    { id: 3, date: '2026-10-14T07:00:00Z', product: 'Mouse', sku: 'M1', type: 'Venta', quantity: -1, user: 'Ana' },
  ];
  assert.deepEqual(filterMovements(movements).map(m => m.id), [3,2]);
  assert.deepEqual(filterMovements(movements, { scope: 'sin-variacion' }).map(m => m.id), [1]);
  assert.equal(filterMovements(movements, { scope: 'todos' }).length, 3);
  assert.equal(filterMovements(movements, { scope: 'todos', to: '2026-10-13' })[0].id, 1);
  assert.equal(filterMovements(movements, { query: ' m1 ', actor: 'lu', type: 'Entrada', from: '2026-10-14' })[0].id, 2);
  assert.equal(movements.length, 3);
});
