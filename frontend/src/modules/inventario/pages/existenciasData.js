import { minimumStock, numeric } from './dashboardData.js';
import { compareMovements, limaDay } from './kardexData.js';

export function recentStockMovements(movements, products = [], confirmedMovement = null, day = limaDay(new Date())) {
  const catalogIds = new Set(products.filter(product => product.id != null && product.id !== '').map(product => String(product.id)));
  const seen = new Set();
  const rows = (confirmedMovement ? [confirmedMovement, ...movements] : movements).filter(movement => {
    if (movement.productId == null || !catalogIds.has(String(movement.productId))) return false;
    if (!Number.isFinite(Date.parse(movement.date)) || limaDay(movement.date) !== day) return false;
    if (!['Entrada', 'Salida', 'Ajuste', 'Venta', 'Alta'].includes(movement.type) || !Number.isSafeInteger(movement.quantity) || movement.quantity === 0) return false;
    if (movement.id != null) {
      const key = String(movement.id);
      if (seen.has(key)) return false;
      seen.add(key);
    }
    return true;
  });
  return rows.sort((a, b) => {
    if (a === confirmedMovement) return -1;
    if (b === confirmedMovement) return 1;
    return compareMovements(b, a);
  }).slice(0, 5);
}

export function productMovements(movements, productId) {
  if (productId == null || productId === '') return [];
  return movements.filter(movement => movement.productId != null && String(movement.productId) === String(productId));
}

export function confirmedStockChange(receipt, intent, previousRequestId) {
  if (!receipt?.requestId || receipt.requestId === previousRequestId || !intent
    || !['stock_in', 'stock_out', 'stock_adjust'].includes(receipt.action) || receipt.action !== intent.action
    || String(receipt.productId) !== String(intent.productId)
    || receipt.product?.id == null || String(receipt.product.id) !== String(intent.productId)
    || receipt.movement?.productId == null || String(receipt.movement.productId) !== String(intent.productId)
    || receipt.movement.id == null) return null;
  return receipt;
}

export const movementQuantity = value => Number.isSafeInteger(value)
  ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${new Intl.NumberFormat('es-PE').format(Math.abs(value))}` : 'No registrado';

export function stockState(product, fallback = 5) {
  if (numeric(product.stock) === 0) return 'sin-stock';
  return numeric(product.stock) <= minimumStock(product, fallback) ? 'bajo' : 'normal';
}

export function filterStock(products, { query = '', category = '', state = '', sort = 'stock-asc', fallback = 5 } = {}) {
  const text = query.trim().toLocaleLowerCase('es');
  return products.filter(product =>
    [product.name, product.sku].some(value => String(value ?? '').toLocaleLowerCase('es').includes(text))
    && (!category || product.category === category)
    && (!state || stockState(product, fallback) === state)
  ).sort((a, b) => (sort === 'stock-desc' ? numeric(b.stock) - numeric(a.stock) : numeric(a.stock) - numeric(b.stock))
    || String(a.name).localeCompare(String(b.name), 'es'));
}
