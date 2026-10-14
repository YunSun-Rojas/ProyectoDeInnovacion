export const numeric = value => Number.isFinite(Number(value)) ? Number(value) : 0;
export const minimumStock = (product, fallback = 5) => Math.max(0, numeric(product.minStock ?? fallback));

export function limaDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('sv-SE', { timeZone: 'America/Lima' });
}

export const DATE_RANGES = [
  { id: 'today', label: 'Hoy', shortLabel: 'hoy' },
  { id: '7', label: 'Últimos 7 días', shortLabel: '7d' },
  { id: 'month', label: 'Este mes', shortLabel: 'mes' },
  { id: 'quarter', label: 'Trimestre actual', shortLabel: 'trim' },
];

export function periodRange(period, today) {
  if (period === 'today') return { from: today, to: today };
  const start = new Date(`${today}T12:00:00Z`);
  if (period === '7') start.setUTCDate(start.getUTCDate() - 6);
  else if (period === 'quarter') {
    start.setUTCDate(1);
    start.setUTCMonth(Math.floor(start.getUTCMonth() / 3) * 3);
  } else start.setUTCDate(1);
  return { from: start.toISOString().slice(0, 10), to: today };
}

export function summarizeInventory(products, fallback = 5) {
  const attention = products.filter(p => numeric(p.stock) <= minimumStock(p, fallback))
    .sort((a, b) => numeric(a.stock) - numeric(b.stock) || String(a.name).localeCompare(String(b.name), 'es'));
  const values = new Map();
  products.forEach(p => values.set(p.category || 'Sin categoría', (values.get(p.category || 'Sin categoría') || 0) + numeric(p.stock) * numeric(p.price)));
  return {
    units: products.reduce((sum, p) => sum + numeric(p.stock), 0),
    value: products.reduce((sum, p) => sum + numeric(p.stock) * numeric(p.price), 0),
    low: products.filter(p => numeric(p.stock) > 0 && numeric(p.stock) <= minimumStock(p, fallback)).length,
    empty: products.filter(p => numeric(p.stock) === 0).length,
    attention,
    categories: [...values].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
  };
}

// Usar el stock auditado evita depender de la etiqueta del movimiento y
// contar dos veces la cantidad cuando un ajuste también trae before/after.
export function movementFlow(movement) {
  const validStock = value => value !== null && value !== undefined && value !== ''
    && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
  let delta = 0;
  if (validStock(movement.before) && validStock(movement.after)) {
    delta = Number(movement.after) - Number(movement.before);
  } else {
    const quantity = numeric(movement.quantity);
    if (['Entrada', 'Alta'].includes(movement.type)) delta = Math.abs(quantity);
    else if (['Salida', 'Baja'].includes(movement.type)) delta = -Math.abs(quantity);
    else if (movement.type === 'Ajuste') delta = quantity;
  }
  return { entries: Math.max(0, delta), exits: Math.max(0, -delta) };
}

export function summarizeMovements(movements, range) {
  if (range.error) return { recent: [], series: [], entries: 0, exits: 0, hasFlow: false };
  const recent = movements.filter(m => {
    const date = limaDate(m.date);
    return date && date >= range.from && date <= range.to;
  }).sort((a, b) => new Date(b.date) - new Date(a.date));
  const days = new Map();
  const cursor = new Date(`${range.from}T12:00:00Z`);
  while (cursor.toISOString().slice(0, 10) <= range.to) {
    const date = cursor.toISOString().slice(0, 10);
    days.set(date, { date, label: `${date.slice(8, 10)}/${date.slice(5, 7)}`, entradas: 0, salidas: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  let entries = 0, exits = 0, hasFlow = false;
  recent.forEach(m => {
    const flow = movementFlow(m);
    if (!flow.entries && !flow.exits) return;
    hasFlow = true;
    const day = days.get(limaDate(m.date));
    day.entradas += flow.entries;
    day.salidas += flow.exits;
    entries += flow.entries;
    exits += flow.exits;
  });
  return { recent, series: [...days.values()], entries, exits, hasFlow };
}

export function movementError(product, quantity, type) {
  if (!product) return 'Selecciona un producto.';
  const amount = Number(quantity);
  if (!Number.isSafeInteger(amount) || amount <= 0) return 'Ingresa una cantidad entera mayor que cero.';
  if (type === 'Salida' && amount > numeric(product.stock)) return 'La cantidad supera el stock disponible.';
  if (type === 'Entrada' && numeric(product.stock) + amount > 2147483647) return 'La cantidad supera el límite de stock permitido.';
  return '';
}
