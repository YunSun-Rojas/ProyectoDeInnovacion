export const STOCK_LABELS = { agotado: 'Agotado', bajo: 'Stock bajo', normal: 'Normal' };

export function classifyStock(product) {
  if (!Number.isSafeInteger(product.stock) || product.stock < 0 ||
    !Number.isSafeInteger(product.minStock) || product.minStock < 0) {
    throw new Error('Hay productos sin stock o mínimo válido. No se pueden calcular sus alertas.');
  }
  return product.stock === 0 ? 'agotado' : product.stock <= product.minStock ? 'bajo' : 'normal';
}

export function buildAlerts(products, pending = { sessions: [], lines: [] }) {
  const unique = [...new Map(products.map(p => [String(p.id), p])).values()];
  const byId = new Map(unique.map(p => [String(p.id), p]));
  const summary = { normal: 0, bajo: 0, agotado: 0, diferencias: 0 };
  const alerts = [];
  for (const product of unique) {
    const state = classifyStock(product);
    summary[state]++;
    if (state === 'normal') continue;
    alerts.push({ id: `stock:${product.id}`, productId: product.id, name: product.name, sku: product.sku,
      category: product.category, state, priority: state === 'agotado' ? 'critica' : 'media',
      stock: product.stock, minimum: product.minStock, suggested: Math.max(0, product.minStock - product.stock) });
  }
  const open = new Map(pending.sessions.filter(s => ['borrador', 'en revisión'].includes(s.status)).map(s => [s.id, s]));
  const groups = new Map();
  const seen = new Set();
  for (const line of pending.lines) {
    const key = `${line.session_id}:${line.product_id}`;
    if (seen.has(key) || !open.has(line.session_id) || line.physical_quantity === null ||
      !Number.isSafeInteger(line.physical_quantity) || !Number.isSafeInteger(line.reference_stock) ||
      line.physical_quantity < 0 || line.reference_stock < 0 || line.physical_quantity === line.reference_stock) continue;
    seen.add(key);
    const product = byId.get(String(line.product_id));
    const groupKey = String(line.product_id);
    if (!groups.has(groupKey)) groups.set(groupKey, { id: `difference:${groupKey}`, productId: line.product_id,
      name: line.product_name, sku: line.sku, category: product?.category || 'Producto fuera del catálogo',
      state: 'diferencia', priority: 'alta', counts: [] });
    groups.get(groupKey).counts.push({ ...line, session: open.get(line.session_id), delta: line.physical_quantity - line.reference_stock });
  }
  summary.diferencias = groups.size;
  return { summary, alerts: [...alerts, ...groups.values()].sort((a, b) =>
    ({ critica: 0, alta: 1, media: 2 }[a.priority] - { critica: 0, alta: 1, media: 2 }[b.priority]) || a.name.localeCompare(b.name, 'es')) };
}

export function filterAlerts(alerts, { query = '', category = '', state = '', priority = '' } = {}) {
  const text = query.trim().toLocaleLowerCase('es');
  return alerts.filter(a => (!text || [a.name, a.sku].some(v => String(v).toLocaleLowerCase('es').includes(text))) &&
    (!category || a.category === category) && (!state || a.state === state) && (!priority || a.priority === priority));
}
