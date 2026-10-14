// Contrato preparado para Fase 2B. No conectado a rutas ni RPC de producción.
export const CATALOG_CONTRACT_VERSION = 1;
export const CATALOG_TEXT_LIMITS = Object.freeze({
  brand: 120, model: 160, characteristics: 4000, barcode: 100, unitOfMeasure: 40,
});
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function money(value, label, optional = false) {
  if (optional && (value === null || value === '')) return null;
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === ''
    || !/^\d+(?:\.\d{1,2})?$/.test(String(value).trim())) {
    throw new Error(`${label}: usa un importe no negativo con hasta dos decimales.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number >= 1e10) throw new Error(`${label}: importe fuera de rango.`);
  return number;
}

export function quantity(value, label) {
  if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value).trim())) {
    throw new Error(`${label}: usa una cantidad entera no negativa.`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > 2147483647) throw new Error(`${label}: cantidad fuera de rango.`);
  return number;
}

// Ausente = conservar; null/vacío = limpiar solo un atributo nullable.
export function catalogPatch(data, { canWritePurchaseCost = false } = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Datos de catálogo inválidos.');
  const patch = {};
  for (const [field, limit] of Object.entries(CATALOG_TEXT_LIMITS)) {
    if (!own(data, field)) continue;
    const value = data[field];
    if (value !== null && typeof value !== 'string') throw new Error(`${field}: texto inválido.`);
    const normalized = value?.trim() || null;
    if (normalized && normalized.length > limit) throw new Error(`${field}: máximo ${limit} caracteres.`);
    if (field === 'unitOfMeasure' && !normalized) throw new Error('La unidad de medida es obligatoria.');
    patch[field] = normalized;
  }
  if (own(data, 'purchaseCost')) {
    if (!canWritePurchaseCost) throw new Error('No tienes permiso para modificar el costo de compra.');
    patch.purchaseCost = money(data.purchaseCost, 'Costo de compra', true);
  }
  if (own(data, 'isActive')) {
    if (typeof data.isActive !== 'boolean') throw new Error('El estado administrativo debe ser activo o inactivo.');
    patch.isActive = data.isActive;
  }
  if (own(data, 'imagePath')) throw new Error('La carga de fotografías todavía no está habilitada.');
  return patch;
}

export function catalogFormValues(product = {}, category = '') {
  product = product ?? {};
  return {
    name: product.name ?? '', sku: product.sku ?? '', category: product.category ?? category,
    brand: product.brand ?? '', model: product.model ?? '', characteristics: product.characteristics ?? '',
    barcode: product.barcode ?? '', price: product.price ?? '', purchaseCost: product.purchaseCost ?? '',
    unitOfMeasure: product.unitOfMeasure ?? 'Unidad', minStock: product.minStock ?? 0,
    isActive: product.isActive ?? true,
  };
}

export function validateCatalogForm(data, { products = [], productId, categories = [], canWritePurchaseCost = false } = {}) {
  if (typeof data.name !== 'string' || !data.name.trim() || data.name.trim().length > 500) throw new Error('Ingresa un nombre de hasta 500 caracteres.');
  if (typeof data.sku !== 'string' || !data.sku.trim() || data.sku.trim().length > 100) throw new Error('Ingresa un SKU de hasta 100 caracteres.');
  if (products.some(product => product.id !== productId && product.sku.trim().toLowerCase() === data.sku.trim().toLowerCase())) {
    throw new Error('Ya existe un producto con ese SKU.');
  }
  if (!categories.includes(data.category)) throw new Error('Selecciona una categoría existente.');
  return { name: data.name.trim(), sku: data.sku.trim(), category: data.category,
    price: money(data.price, 'Precio de venta'), minStock: quantity(data.minStock, 'Stock mínimo'),
    ...catalogPatch(data, { canWritePurchaseCost }) };
}

export function catalogAvailability(product) {
  if (product.stock === 0) return 'Agotado';
  if (product.stock <= product.minStock) return 'Stock bajo';
  return 'Disponible';
}
