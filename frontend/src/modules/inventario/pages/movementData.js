export function stockValidation(product, action, quantity, reason) {
  const value = Number(quantity);
  if (!product || !Number.isSafeInteger(product.version)) return 'Selecciona un SKU con versión disponible.';
  if (!['stock_in', 'stock_out', 'stock_adjust'].includes(action) || !quantity.trim()
    || !Number.isSafeInteger(value) || value === 0 || Math.abs(value) > 2147483647
    || (action !== 'stock_adjust' && value < 0)) return 'Ingresa una cantidad entera válida, distinta de cero; entradas y salidas requieren cantidades positivas.';
  if (!reason.trim() || reason.trim().length > 500) return 'Escribe un motivo de hasta 500 caracteres.';
  const final = product.stock + (action === 'stock_out' ? -value : value);
  if (final < 0) return 'La cantidad supera el stock disponible.';
  if (final > 2147483647) return 'El stock final supera el límite permitido.';
  return '';
}

export function filterMovements(movements, { query = '', type = 'Todos', from = '', to = '', scope = 'stock', actor = '' } = {}) {
  return movements.filter(m => {
    const date = new Date(m.date).toLocaleDateString('sv-SE', { timeZone: 'America/Lima' });
    return `${m.product} ${m.sku}`.toLocaleLowerCase('es').includes(query.trim().toLocaleLowerCase('es'))
      && (type === 'Todos' || m.type === type)
      && (!from || date >= from) && (!to || date <= to)
      && (scope === 'todos' || (scope === 'stock' ? m.quantity !== 0 : m.quantity === 0))
      && String(m.user ?? '').toLocaleLowerCase('es').includes(actor.trim().toLocaleLowerCase('es'));
  }).sort((a, b) => new Date(b.date) - new Date(a.date) || Number(b.id) - Number(a.id));
}
