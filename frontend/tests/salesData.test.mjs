import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSales, saleValidation } from '../src/modules/inventario/pages/salesData.js';
import { periodRange, summarizeInventory } from '../src/modules/inventario/pages/dashboardData.js';

const sale = (id, date, quantity, unitPrice, extra = {}) => ({ id, date, quantity, unitPrice, total: Math.round(unitPrice * 100) * quantity / 100, productId: 1, product: 'Mouse vendido', sku: 'M-1', ...extra });
test('El dashboard tolera una API anterior sin ventas, en todos los períodos', () => {
  for (const period of ['today', '7', 'month', 'quarter']) {
    const range = periodRange(period, '2026-10-13');
    const expected = summarizeSales([], range);
    assert.deepEqual(summarizeSales(undefined, range), expected);
    assert.deepEqual(summarizeSales(null, range), expected);
  }
});

test('Ventas conservan importes históricos al editar precio, nombre o eliminar el producto', () => {
  const sales = [sale('a', '2026-10-13T14:00:00Z', 2, 80), sale('b', '2026-10-13T15:00:00Z', 1, 90)];
  const product = { name: 'Mouse', stock: 5, price: 80, category: 'Periféricos' };
  const range = periodRange('today', '2026-10-13');
  const before = summarizeSales(sales, range);
  product.price = 500;
  product.name = 'Nombre nuevo';
  assert.equal(summarizeInventory([product]).value, 2500);
  assert.deepEqual(summarizeSales(sales, range), before);
  assert.equal(before.total, 250);
  assert.equal(before.units, 3);
  assert.equal(before.top[0].name, 'Mouse vendido');
});

test('Ventas por período respetan Perú, ceros diarios y ranking por unidades', () => {
  const sales = [
    sale('a', '2026-11-13T04:59:59Z', 2, 80), // ayer en Perú
    sale('b', '2026-11-13T05:00:00Z', 3, 20, { productId: 2, product: 'Teclado', sku: 'T-2' }),
    sale('c', '2026-11-01T12:00:00Z', 1, 0.10),
    sale('d', '2026-10-01T05:00:00Z', 1, 0.20),
  ];
  for (const [period, units, total] of [['today', 3, 60], ['7', 5, 220], ['month', 6, 220.10], ['quarter', 7, 220.30]]) {
    const summary = summarizeSales(sales, periodRange(period, '2026-11-13'));
    assert.equal(summary.units, units);
    assert.equal(summary.total, total);
    assert.equal(summary.series.at(-1).amount, 60);
  }
  assert.equal(summarizeSales(sales, periodRange('7', '2026-11-13')).top[0].id, 2);
  assert.equal(summarizeSales([], periodRange('today', '2026-11-13')).total, 0);
  assert.deepEqual(summarizeSales([], periodRange('today', '2026-11-13')).top, []);
});

test('Venta rechaza cantidades inválidas, precio vacío y exceso de stock', () => {
  const product = { stock: 3, price: 80 };
  for (const [quantity, price] of [['4', '80'], ['0', '80'], ['1.5', '80'], ['1', ''], ['1', '-1'], ['1', '1.234']]) {
    assert.ok(saleValidation(product, quantity, price));
  }
  assert.ok(saleValidation(null, '1', '80'));
  assert.equal(saleValidation(product, '3', '79.90'), '');
});
