// Adaptador AISLADO: no importar desde controller/repository hasta revisar SQL y permisos.
import { catalogPatch, money, CATALOG_CONTRACT_VERSION } from '../../../../shared/catalogProduct.js';
import { mapProduct, productPayload } from './inventoryService.js';

export const CATALOG_EDIT_ACTION = 'catalog_edit';

// Política aprobada: todos los miembros pueden leer costo; escritura conserva
// la capacidad del inventario. Derivar solo de comprobaciones del servidor.
export function catalogAccessForMember({ isMember = false, readOnly = true, schemaVersion = 0, rpcReviewed = false } = {}) {
  const canWrite = isMember === true && readOnly === false;
  return { schemaVersion, rpcReviewed, canWrite,
    canReadPurchaseCost: isMember === true, canWritePurchaseCost: canWrite };
}

const columns = Object.freeze({ brand: 'brand', model: 'model', characteristics: 'characteristics',
  barcode: 'barcode', purchaseCost: 'purchase_cost', unitOfMeasure: 'unit_of_measure', isActive: 'is_active' });

// Proyección futura. No contiene costos salvo autorización explícita del servidor.
export function catalogReadColumns({ canReadPurchaseCost = false, schemaVersion, rpcReviewed } = {}) {
  if (schemaVersion !== CATALOG_CONTRACT_VERSION || rpcReviewed !== true) {
    throw new Error('No se puede ampliar la consulta antes de verificar el esquema y las RPC.');
  }
  return ['brand', 'model', 'characteristics', 'barcode', 'unit_of_measure', 'image_path', 'is_active',
    'created_at', 'updated_at', 'created_by_name', ...(canReadPurchaseCost ? ['purchase_cost'] : [])];
}

export function mapCatalogProduct(row, categories, { canReadPurchaseCost = false } = {}) {
  const base = mapProduct(row, categories);
  delete base.purchaseCost;
  return { ...base, brand: row.brand ?? null, model: row.model ?? null,
    characteristics: row.characteristics ?? null, barcode: row.barcode ?? null,
    unitOfMeasure: row.unit_of_measure ?? 'Unidad', imagePath: row.image_path ?? null,
    isActive: row.is_active ?? true, createdAt: row.created_at ?? null, updatedAt: row.updated_at ?? null,
    // Nombre histórico declarado; no es prueba de identidad autenticada.
    createdByName: row.created_by_name ?? null,
    ...(canReadPurchaseCost ? { purchaseCost: row.purchase_cost == null ? null : money(row.purchase_cost, 'Costo de compra') } : {}) };
}

// Solo prepara datos; deliberadamente no recibe cliente Supabase ni realiza escrituras.
// Las capacidades deben venir de verificación confiable en servidor, nunca del body HTTP.
export function prepareCatalogData({ action, data, current, access = {} }) {
  if (access.schemaVersion !== CATALOG_CONTRACT_VERSION || access.rpcReviewed !== true) {
    throw new Error('El catálogo ampliado está pendiente de migración y revisión de RPC.');
  }
  if (access.canWrite !== true) throw new Error('Tu cuenta no tiene permiso para modificar el catálogo.');
  if (!['add', 'edit'].includes(action)) throw new Error('Operación de catálogo inválida.');
  if (action === 'edit' && (!current || !Number.isSafeInteger(current.version) || current.version <= 0)) {
    throw new Error('Se requiere el producto actual y su versión.');
  }
  if (action === 'edit' && Object.hasOwn(data, 'stock') && Number(data.stock) !== current.stock) {
    throw new Error('La ficha no puede modificar existencias. Usa la operación de stock existente.');
  }
  const base = action === 'edit' ? { ...current, ...data, stock: current.stock } : data;
  const result = productPayload(base);
  const patch = catalogPatch(data, { canWritePurchaseCost: access.canWritePurchaseCost === true });
  for (const [key, value] of Object.entries(patch)) {
    // Exportación real: estos tres campos son NOT NULL DEFAULT ''.
    result[columns[key]] = ['brand', 'model', 'characteristics'].includes(key) ? (value ?? '') : value;
  }
  // Este payload debe enviarse exclusivamente con CATALOG_EDIT_ACTION.
  // La RPC obtiene stock bajo bloqueo y rechaza cantidades aunque el cliente las fuerce.
  if (action === 'edit') delete result.stock;
  // Ningún default en edit: una venta/cliente antiguo debe conservar lo omitido en SQL.
  if (action === 'add') {
    result.unit_of_measure ??= 'Unidad';
    result.is_active ??= true;
  }
  return result;
}
