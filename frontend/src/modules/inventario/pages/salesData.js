import { limaDate, summarizeMovements } from './dashboardData.js';

export function summarizeSales(sales, range) {
  const recent = (sales ?? []).filter(sale => {
    const date = limaDate(sale.date);
    return date && date >= range.from && date <= range.to;
  }).sort((a, b) => new Date(b.date) - new Date(a.date));
  const days = new Map(summarizeMovements([], range).series.map(day => [day.date, { date: day.date, label: day.label, cents: 0, units: 0 }]));
  const products = new Map();
  let totalCents = 0, units = 0;
  recent.forEach(sale => {
    // El total y el nombre provienen de la venta histórica, nunca del producto actual.
    const cents = Math.round(sale.total * 100);
    totalCents += cents;
    units += sale.quantity;
    const day = days.get(limaDate(sale.date));
    day.cents += cents;
    day.units += sale.quantity;
    const product = products.get(String(sale.productId)) || { id: sale.productId, name: sale.product, sku: sale.sku, units: 0, cents: 0 };
    product.units += sale.quantity;
    product.cents += cents;
    products.set(String(sale.productId), product);
  });
  return { recent, units, total: totalCents / 100,
    series: [...days.values()].map(day => ({ ...day, amount: day.cents / 100 })),
    top: [...products.values()].sort((a, b) => b.units - a.units || b.cents - a.cents || String(a.id).localeCompare(String(b.id)))
      .slice(0, 5).map(product => ({ ...product, amount: product.cents / 100 })),
  };
}

export function saleValidation(product, quantity, price) {
  if (!product) return 'Selecciona un producto.';
  const units = Number(quantity), unitPrice = Number(price);
  if (!Number.isSafeInteger(units) || units <= 0 || units > product.stock) return 'Ingresa una cantidad entera que no supere el stock disponible.';
  if (String(price).trim() === '' || !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice >= 1e10
    || Number(unitPrice.toFixed(2)) !== unitPrice || !Number.isSafeInteger(units * Math.round(unitPrice * 100))) {
    return 'Ingresa un precio de venta válido de hasta dos decimales.';
  }
  return '';
}
