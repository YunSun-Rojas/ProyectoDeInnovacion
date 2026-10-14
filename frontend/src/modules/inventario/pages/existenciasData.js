import { minimumStock, numeric } from './dashboardData.js';

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
