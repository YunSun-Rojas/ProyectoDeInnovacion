import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogReadColumns, mapCatalogProduct, prepareCatalogData, catalogAccessForMember, CATALOG_EDIT_ACTION } from '../src/modules/inventory/catalogPreparation.js';
import { catalogPatch, money, quantity, validateCatalogForm, catalogAvailability } from '../../shared/catalogProduct.js';
import { productPayload } from '../src/modules/inventory/inventoryService.js';

const current = { id: 1, sku: 'M-01', name: 'Mouse', category: 'Periféricos', stock: 8, price: 80, minStock: 2, version: 3 };
const access = { schemaVersion: 1, rpcReviewed: true, canWrite: true, canWritePurchaseCost: true };
const row = { id: 1, sku: 'M-01', name: 'Mouse', category_id: 1, stock: 8, price: '80.00', min_stock: 2, version: 3 };

test('política aprobada deriva costo de membresía y no confunde consulta con escritura', () => {
  const member = catalogAccessForMember({ isMember: true, readOnly: false, schemaVersion: 1, rpcReviewed: true });
  assert.equal(member.canReadPurchaseCost, true);
  assert.equal(member.canWritePurchaseCost, true);
  assert(catalogReadColumns(member).includes('purchase_cost'));
  assert.equal(catalogAccessForMember({ isMember: true }).canReadPurchaseCost, true);
  assert.equal(catalogAccessForMember({ isMember: true }).canWrite, false);
  assert.equal(catalogAccessForMember({ isMember: false, readOnly: false }).canWrite, false);
  assert.equal(catalogAccessForMember().canReadPurchaseCost, false);
  assert.equal(CATALOG_EDIT_ACTION, 'catalog_edit');
});

test('preparación bloqueada sin verificación; no permite consultar nuevas columnas con esquema antiguo', () => {
  for (const permissions of [{}, { ...access, schemaVersion: 0 }, { ...access, rpcReviewed: false }]) {
    assert.throws(() => catalogReadColumns(permissions), /verificar/);
    assert.throws(() => prepareCatalogData({ action: 'edit', current, data: {}, access: permissions }), /pendiente/);
  }
});

test('producto antiguo obtiene opcionales sin alterar stock, precio ni valorizado', () => {
  const before = structuredClone(row);
  const mapped = mapCatalogProduct(row, [{ id: 'c1', name: 'Periféricos' }]);
  assert.equal(mapped.stock * mapped.price, 640);
  assert.equal(mapped.unitOfMeasure, 'Unidad');
  assert.equal(mapped.isActive, true);
  assert.equal(mapped.brand, null);
  assert.equal(mapped.updatedAt, null);
  assert(!Object.hasOwn(mapped, 'purchaseCost'));
  assert.deepEqual(row, before);
});

test('campos existentes reutilizados y costo oculto por defecto incluso si la fila lo incluye', () => {
  const rich = { ...row, brand: 'Marca', model: 'Modelo', characteristics: 'USB', created_by_name: 'Nombre declarado', purchase_cost: '30.50', source_status: 'importado', is_active: false };
  const restricted = mapCatalogProduct(rich, [{ id: 'c1', name: 'Periféricos' }]);
  assert.equal(restricted.characteristics, 'USB');
  assert.equal(restricted.createdByName, 'Nombre declarado');
  assert.equal(restricted.isActive, false);
  assert(!Object.hasOwn(restricted, 'purchaseCost'));
  assert(!catalogReadColumns(access).includes('purchase_cost'));
  assert(catalogReadColumns({ ...access, canReadPurchaseCost: true }).includes('purchase_cost'));
  assert.equal(mapCatalogProduct(rich, [{ id: 'c1', name: 'Periféricos' }], { canReadPurchaseCost: true }).purchaseCost, 30.5);
});

test('editar omite atributos no enviados y distingue limpieza explícita de ausencia', () => {
  const data = { brand: '  Marca nueva  ', model: null, barcode: '000123' };
  const result = prepareCatalogData({ action: 'edit', current, data, access });
  assert.equal(result.brand, 'Marca nueva');
  assert.equal(result.model, '');
  assert(!Object.hasOwn(result, 'catalog_only'));
  assert.equal(result.barcode, '000123');
  for (const key of ['characteristics', 'purchase_cost', 'image_path', 'unit_of_measure', 'is_active']) assert(!Object.hasOwn(result, key));
  const stored = { ...current, characteristics: 'USB', purchase_cost: 30, image_path: 'products/1/photo.webp', unit_of_measure: 'Unidad', is_active: false };
  // Modelo de patch propuesto; no sustituye la ejecución de la RPC en un entorno autorizado.
  const next = { ...stored, ...result };
  assert.equal(next.image_path, stored.image_path);
  assert.equal(next.purchase_cost, 30);
  assert.equal(next.is_active, false);
  assert(!Object.hasOwn(result, 'stock'));
  assert.equal(result.price, 80);
});

test('ficha rechaza cambios de cantidad e identidad de sistema no sale en payload', () => {
  assert.throws(() => prepareCatalogData({ action: 'edit', current, data: { stock: 9 }, access }), /existencias/);
  const result = prepareCatalogData({ action: 'edit', current, data: { id: 9, version: 99, updated_at: '2000-01-01', created_by_name: 'Suplantado', source_status: 'otra' }, access });
  assert(!Object.hasOwn(result, 'stock'));
  for (const key of ['id', 'version', 'updated_at', 'created_by_name', 'source_status']) assert(!Object.hasOwn(result, key));
  assert.equal(current.version, 3);
});

test('sin permisos no prepara escrituras ni acepta cambios al costo o imagen', () => {
  assert.throws(() => prepareCatalogData({ action: 'edit', current, data: {}, access: { ...access, canWrite: false } }), /permiso/);
  assert.throws(() => catalogPatch({ purchaseCost: null }), /permiso/);
  assert.throws(() => catalogPatch({ imagePath: 'https://example.test/x.jpg' }), /fotografías/);
  assert.throws(() => catalogPatch({ imagePath: null }), /fotografías/);
});

test('campos NOT NULL del CSV se limpian como texto vacío; costo y barcode conservan null', () => {
  const result = prepareCatalogData({ action: 'edit', current,
    data: { brand: null, model: '', characteristics: '   ', purchaseCost: '', barcode: null }, access });
  assert.equal(result.brand, '');
  assert.equal(result.model, '');
  assert.equal(result.characteristics, '');
  assert.equal(result.purchase_cost, null);
  assert.equal(result.barcode, null);
  assert(!Object.hasOwn(result, 'stock'));
  assert.equal(result.price, current.price);
  assert(!Object.hasOwn(result, 'image_path'));
});

test('validación de importes distingue cero, vacío, decimales y valores no finitos', () => {
  assert.equal(money('', 'Costo', true), null);
  assert.equal(money(null, 'Costo', true), null);
  assert.equal(money(0, 'Costo', true), 0);
  assert.equal(money('42.90', 'Precio'), 42.9);
  for (const value of [-1, NaN, Infinity, '1e2', true, {}, ' ', '1.001', 10000000000]) assert.throws(() => money(value, 'Precio'));
  for (const value of [-1, 1.5, 2147483648, '', true]) assert.throws(() => quantity(value, 'Stock'));
});

test('SKU duplicado se detecta sin modificar los SKU; conserva SKU propio al editar', () => {
  const options = { categories: ['Periféricos'], products: [current] };
  assert.throws(() => validateCatalogForm({ ...current, sku: 'm-01' }, options), /SKU/);
  assert.equal(validateCatalogForm(current, { ...options, productId: 1 }).sku, 'M-01');
  assert.equal(current.sku, 'M-01');
});

test('contrato de clientes antiguos y payload de edición usado por ventas sigue intacto', () => {
  const data = { ...current, stock: 6 };
  assert.deepEqual(productPayload(data), { name: 'Mouse', sku: 'M-01', category: 'Periféricos', stock: 6, price: 80, min_stock: 2 });
  // El adaptador de ficha no acepta ventas; el pipeline actual mantiene su RPC.
  assert.throws(() => prepareCatalogData({ action: 'sale', current, data: {}, access }), /inválida/);
});

test('defaults solo en altas y estado administrativo independiente de stock', () => {
  const result = prepareCatalogData({ action: 'add', data: current, access });
  assert.equal(result.unit_of_measure, 'Unidad');
  assert.equal(result.is_active, true);
  assert.equal(catalogAvailability({ ...current, isActive: false }), 'Disponible');
  assert.equal(catalogAvailability({ ...current, stock: 0 }), 'Agotado');
  assert.throws(() => catalogPatch({ isActive: 'false' }), /administrativo/);
  assert.throws(() => catalogPatch({ unitOfMeasure: '' }), /obligatoria/);
});
