// Synthetic fixtures exclusively for automated tests and isolated visual review.
// Never imported by the production application.
export const fixtureDay = index => new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
export function predictionFixture({ length = 220, kind = 'commercial', coverage = true, stock = 10,
  unknownDay = -1, products, extra = {} } = {}) {
  const catalog = products ?? [{ id: 1, sku: 'SYN-1', name: 'Producto sintético', stock, minStock: 3, isActive: true }];
  const sales = Array.from({ length }, (_, index) => ({ id: `synthetic-${index}`, productId: 1,
    sku: 'SYN-1', product: 'Nombre histórico sintético', quantity: 2, movementId: `synthetic-m-${index}`,
    date: `${fixtureDay(index)}T12:00:00Z` }));
  return { products: catalog, sales, salesEnabled: true, status: 'ready', asOf: `${fixtureDay(length)}T12:00:00Z`,
    predictionEvidence: { classifications: kind === 'unclassified' ? [] : sales.map(sale => ({
      saleId: sale.id, kind, evidence: 'Synthetic classification fixture' })),
    coverage: coverage ? Array.from({ length }, (_, index) => index === unknownDay ? null : ({
      productId: 1, from: fixtureDay(index), to: fixtureDay(index), evidence: 'Synthetic closed-day fixture' })).filter(Boolean) : [] }, ...extra };
}
