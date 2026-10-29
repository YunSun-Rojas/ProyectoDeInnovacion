// Offline thesis demonstration only. Never imported by production entry points.
import { predictionFixture } from './fixtures.mjs';
import { validatePredictionEvidence } from '../../../shared/predictionEvidence.js';

export const DEMO_LABEL = 'DEMOSTRACIÓN — DATOS SIMULADOS';
export const DEMO_AS_OF = '2026-10-01T12:00:00.000Z';
export const DEMO_DAYS = 240;
const DAY = 86400000;

export function createPredictionDemo() {
  const template = predictionFixture({ length: DEMO_DAYS });
  const shift = Date.parse(DEMO_AS_OF) - Date.parse(template.asOf);
  const shiftedDay = day => new Date(Date.parse(`${day}T00:00:00Z`) + shift).toISOString().slice(0, 10);
  const examples = [
    { id: 9_000_000_000_001, sku: 'SIM-AURORA-001', name: 'Mouse ficticio Aurora', stock: 12, minStock: 6, dailyUnits: 3 },
    { id: 9_000_000_000_002, sku: 'SIM-NEBULA-002', name: 'Teclado ficticio Nebula', stock: 28, minStock: 8, dailyUnits: 2 },
  ];
  const products = [], sales = [], classifications = [], coverage = [];
  examples.forEach(({ dailyUnits, ...product }, productIndex) => {
    products.push({ ...product, isActive: true });
    template.sales.forEach((sale, index) => {
      // UUIDs and high numeric product IDs belong solely to this local fixture.
      const id = `dddd000${productIndex + 1}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      const auditId = productIndex * DEMO_DAYS + index + 1;
      sales.push({ ...sale, id, productId: product.id, product: product.name, sku: product.sku,
        movementId: `simulated-movement:${id}`, quantity: dailyUnits,
        date: new Date(Date.parse(sale.date) + shift).toISOString() });
      classifications.push({ saleId: id, kind: 'commercial', evidence: `sale-review:${auditId}`, verifiedAt: DEMO_AS_OF });
    });
    template.predictionEvidence.coverage.forEach((row, index) => coverage.push({
      productId: product.id, from: shiftedDay(row.from), to: shiftedDay(row.to),
      evidence: `day-review:${productIndex * DEMO_DAYS + index + 1}`, verifiedAt: DEMO_AS_OF,
    }));
  });
  return { products, sales, salesEnabled: true, status: 'ready', asOf: DEMO_AS_OF, evidenceState: 'available',
    predictionEvidence: validatePredictionEvidence({ classifications, coverage, stockouts: [] }, DEMO_AS_OF) };
}
