import test from 'node:test';
import assert from 'node:assert/strict';
import { limaDate, periodRange, summarizeInventory, summarizeInventoryCost, summarizeMovements, movementFlow, movementError } from '../src/modules/inventario/pages/dashboardData.js';

test('Las altas y ediciones de stock aparecen en todos los períodos correspondientes, sin duplicar cantidades', () => {
  const movements = [
    { id: 1, date: '2026-10-13T14:00:00Z', type: 'Alta', before: 0, after: 10, quantity: 10 },
    { id: 2, date: '2026-10-13T15:00:00Z', type: 'Ajuste', before: 10, after: 16, quantity: 6 },
    { id: 3, date: '2026-10-13T16:00:00Z', type: 'Ajuste', before: 16, after: 12, quantity: -4 },
    { id: 4, date: '2026-10-13T17:00:00Z', type: 'Ajuste', before: 12, after: 12, quantity: 0 },
  ];
  for (const period of ['today', '7', 'month', 'quarter']) {
    const summary = summarizeMovements(movements, periodRange(period, '2026-10-13'));
    assert.equal(summary.hasFlow, true, period);
    assert.equal(summary.entries, 16, period);
    assert.equal(summary.exits, 4, period);
    assert.equal(summary.series.find(day => day.date === '2026-10-13').entradas, 16);
    assert.equal(summary.recent.length, 4);
  }
  assert.deepEqual(movementFlow({ type: 'Baja', before: 12, after: 0, quantity: -12 }), { entries: 0, exits: 12 });
  assert.deepEqual(movementFlow({ type: 'Ajuste', before: 12, after: 12, quantity: 12 }), { entries: 0, exits: 0 });
  assert.deepEqual(movementFlow({ type: 'Ajuste', before: null, after: null, quantity: -3 }), { entries: 0, exits: 3 });
  assert.deepEqual(movementFlow({ type: 'Desconocido', quantity: 999 }), { entries: 0, exits: 0 });
});

test('Stock bajo y agotados no se superponen y el valor legado usa las existencias actuales', () => {
  const result = summarizeInventory([
    { name: 'A', stock: 0, minStock: 5, price: 10, category: 'Audio' },
    { name: 'B', stock: 5, minStock: 5, price: 10, category: 'Audio' },
    { name: 'C', stock: 10, minStock: 5, price: 20, category: 'Video' },
    { name: 'D', stock: 2, price: 5, category: 'Audio' },
  ]);
  assert.equal(result.low, 2);
  assert.equal(result.empty, 1);
  assert.equal(result.units, 17);
  assert.equal(result.value, 260);
  assert.deepEqual(result.attention.map(p => p.name), ['A', 'D', 'B']);
});

test('Períodos inclusivos y fechas de Lima, incluso alrededor de medianoche UTC', () => {
  assert.equal(limaDate('2026-10-13T02:00:00Z'), '2026-10-12');
  assert.deepEqual(periodRange('7', '2026-10-13'), { from: '2026-10-07', to: '2026-10-13' });
  assert.deepEqual(periodRange('30', '2026-10-13'), { from: '2026-09-14', to: '2026-10-13' });
  assert.deepEqual(periodRange('custom', '2026-10-13', { from: '2026-09-20', to: '2026-10-05' }), { from: '2026-09-20', to: '2026-10-05' });
  assert.ok(periodRange('custom', '2026-10-13', { from: '2026-10-06', to: '2026-10-05' }).error);
  assert.ok(periodRange('custom', '2026-10-13', { from: '2026-02-30', to: '2026-10-05' }).error);
});

test('La valorización del panel usa solo costos de compra completos y no sustituye precios de venta', () => {
  assert.deepEqual(summarizeInventoryCost([
    { stock: 3, purchaseCost: 10 },
    { stock: 2, purchaseCost: 4.5, price: 99 },
  ]), { value: 39, missingCosts: 0 });
  assert.deepEqual(summarizeInventoryCost([
    { stock: 3, purchaseCost: 10 },
    { stock: 2, purchaseCost: null, price: 99 },
  ]), { value: null, missingCosts: 1 });
  assert.deepEqual(summarizeInventoryCost([
    { stock: 3, purchaseCost: 10 },
    { stock: 0, purchaseCost: null, price: 99 },
  ]), { value: 30, missingCosts: 0 });
  assert.deepEqual(summarizeInventoryCost([]), { value: 0, missingCosts: 0 });
});

test('Entradas y salidas reales incluyen el stock inicial y dejan días sin actividad en cero', () => {
  const movements = [
    { id: 1, date: '2026-10-13T02:00:00Z', type: 'Entrada', quantity: 3 },
    { id: 2, date: '2026-10-13T12:00:00Z', type: 'Salida', quantity: -2 },
    { id: 3, date: '2026-10-13T14:00:00Z', type: 'Alta', quantity: 100 },
    { id: 4, date: '2026-10-14T06:00:00Z', type: 'Entrada', quantity: 9 },
    { id: 5, date: 'invalid', type: 'Entrada', quantity: 8 },
  ];
  const result = summarizeMovements(movements, { from: '2026-10-11', to: '2026-10-13' });
  assert.equal(result.entries, 103);
  assert.equal(result.exits, 2);
  assert.equal(result.hasFlow, true);
  assert.deepEqual(result.recent.map(m => m.id), [3, 2, 1]);
  assert.deepEqual(result.series.map(d => [d.entradas, d.salidas]), [[0, 0], [3, 0], [100, 2]]);
  assert.equal(summarizeMovements([], { from: '2026-10-13', to: '2026-10-13' }).hasFlow, false);
  assert.equal(summarizeMovements(movements, { error: 'Fechas inválidas' }).recent.length, 0);
});

test('No se permiten salidas mayores al stock ni cantidades inválidas', () => {
  const product = { stock: 5 };
  assert.ok(movementError(undefined, '1', 'Entrada'));
  for (const value of ['', '0', '-1', '1.5', 'abc']) assert.ok(movementError(product, value, 'Entrada'));
  assert.ok(movementError(product, '6', 'Salida'));
  assert.ok(movementError({ stock: 2147483647 }, '1', 'Entrada'));
  assert.equal(movementError(product, '5', 'Salida'), '');
  assert.equal(movementError(product, '20', 'Entrada'), '');
});

test('Los cuatro períodos filtran cambios reales sin modificar productos ni su valorización', () => {
  const products = [{ name: 'Teclado', stock: 8, minStock: 5, price: 120, category: 'Periféricos' }];
  const original = structuredClone(products);
  const movements = [
    { id: 1, date: '2026-11-13T12:00:00Z', type: 'Entrada', quantity: 2 },
    { id: 2, date: '2026-11-08T12:00:00Z', type: 'Salida', quantity: -3 },
    { id: 3, date: '2026-11-01T12:00:00Z', type: 'Ajuste', quantity: 0 },
    { id: 4, date: '2026-10-20T12:00:00Z', type: 'Entrada', quantity: 5 },
    { id: 5, date: '2026-10-01T05:00:00Z', type: 'Baja', quantity: -1 },
    { id: 6, date: '2026-10-01T04:59:59Z', type: 'Entrada', quantity: 100 },
  ];
  const cases = [
    ['today', '2026-11-13', [1], 2, 0],
    ['7', '2026-11-07', [1, 2], 2, 3],
    ['month', '2026-11-01', [1, 2, 3], 2, 3],
    ['quarter', '2026-10-01', [1, 2, 3, 4, 5], 7, 4],
  ];
  for (const [period, from, ids, entries, exits] of cases) {
    const range = periodRange(period, '2026-11-13');
    assert.deepEqual(range, { from, to: '2026-11-13' });
    const result = summarizeMovements(movements, range);
    assert.deepEqual(result.recent.map(m => m.id), ids, period);
    assert.equal(result.entries, entries, period);
    assert.equal(result.exits, exits, period);
    assert.equal(summarizeInventory(products).value, 960);
    assert.deepEqual(products, original);
  }
  assert.equal(periodRange('quarter', '2026-01-02').from, '2026-01-01');
  assert.equal(periodRange('quarter', '2026-07-31').from, '2026-07-01');
  assert.equal(periodRange('7', '2026-01-02').from, '2025-12-27');
});

test('Hoy incluye solo la fecha actual de Perú, desde medianoche hasta antes del día siguiente', () => {
  const result = summarizeMovements([
    { id: 1, date: '2026-10-13T04:59:59Z', type: 'Entrada', quantity: 100 },
    { id: 2, date: '2026-10-13T05:00:00Z', type: 'Entrada', quantity: 4 },
    { id: 3, date: '2026-10-14T04:59:59Z', type: 'Salida', quantity: -2 },
    { id: 4, date: '2026-10-14T05:00:00Z', type: 'Entrada', quantity: 100 },
  ], periodRange('today', '2026-10-13'));
  assert.deepEqual(result.recent.map(m => m.id), [3, 2]);
  assert.equal(result.entries, 4);
  assert.equal(result.exits, 2);
});

test('Los períodos se superponen según el calendario peruano, incluso al cambiar de mes', () => {
  const movements = [
    { id: 1, date: '2026-10-01T04:59:59Z', type: 'Entrada', quantity: 4 }, // 30 de septiembre en Perú
    { id: 2, date: '2026-10-01T05:00:00Z', type: 'Salida', quantity: -2 }, // 1 de octubre en Perú
    { id: 3, date: '2026-10-02T18:00:00Z', type: 'Entrada', quantity: 6 },
    { id: 4, date: '2026-10-04T05:00:00Z', type: 'Entrada', quantity: 50 }, // fuera del corte
  ];
  const week = summarizeMovements(movements, periodRange('7', '2026-10-03'));
  const month = summarizeMovements(movements, periodRange('month', '2026-10-03'));
  const quarter = summarizeMovements(movements, periodRange('quarter', '2026-10-03'));
  assert.deepEqual(week.recent.map(m => m.id), [3, 2, 1]);
  assert.deepEqual(month.recent.map(m => m.id), [3, 2]);
  assert.deepEqual(quarter.recent.map(m => m.id), [3, 2]);
  assert.equal(week.entries, 10);
  assert.equal(month.entries, 6);
  assert.equal(quarter.exits, 2);
  const inMonthWeek = summarizeMovements(movements, periodRange('7', '2026-10-07'));
  const inMonth = summarizeMovements(movements, periodRange('month', '2026-10-07'));
  for (const movement of inMonthWeek.recent) assert.ok(inMonth.recent.some(m => m.id === movement.id));
});
