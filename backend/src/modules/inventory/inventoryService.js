import { readInventory, mutateInventory } from './inventoryRepository.js';

export async function loadInventory(client, userId, signal) {
  if (!client) throw new Error('No se ha configurado la conexión con Supabase.');
  if (!userId) throw new Error('Inicia sesión para consultar el inventario.');
  signal?.throwIfAborted();
  const { categoryRows, productRows, movementRows, readOnly } = await readInventory(client, userId, signal);
  const categories = categoryRows.map(category => ({ id: `c${category.id}`, name: category.name }));
  return {
    products: productRows.map(product => mapProduct(product, categories)),
    categories,
    movements: movementRows.map(mapMovement).reverse(),
    readOnly,
  };
}

export function mapProduct(product, categories) {
  const category = categories.find(c => c.id === `c${product.category_id}`)?.name;
  const price = Number(product.price);
  if (!category || product.price === null || product.price === '' || !Number.isFinite(price) || price < 0
    || !Number.isInteger(product.stock) || product.stock < 0
    || !Number.isInteger(product.min_stock) || product.min_stock < 0) {
    throw new Error('Hay productos con datos incompletos. Revisa sus categorías, precios y existencias.');
  }
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    category,
    stock: product.stock,
    price,
    minStock: product.min_stock,
    ...(product.version != null ? { version: product.version } : {}),
    // Compatibilidad con las métricas actuales; aún no hay historial de ventas.
    unitsSoldThisMonth: 0,
    unitsSoldLastMonth: 0,
  };
}

export function mapMovement(row) {
  return { id: row.id, date: row.created_at, product: row.product_name, sku: row.sku,
    type: row.type, before: row.stock_before, after: row.stock_after, quantity: row.quantity,
    user: row.actor_email, reason: row.reason };
}

export function productPayload(data) {
  if (!data || typeof data.name !== 'string' || typeof data.sku !== 'string' || typeof data.category !== 'string'
    || !['number', 'string'].includes(typeof data.price) || !['number', 'string'].includes(typeof data.stock)
    || !['number', 'string'].includes(typeof data.minStock)) {
    throw new Error('Completa nombre, SKU y categoría. Usa cantidades enteras no negativas y un precio válido con hasta dos decimales.');
  }
  const price = Number(data.price);
  const stock = Number(data.stock);
  const minStock = Number(data.minStock);
  if (!data.name?.trim() || !data.sku?.trim() || !data.category
    || data.name.trim().length > 500 || data.sku.trim().length > 100
    || data.price === '' || data.stock === '' || data.minStock === ''
    || !Number.isInteger(stock) || stock < 0 || stock > 2147483647
    || !Number.isInteger(minStock) || minStock < 0 || minStock > 2147483647
    || !Number.isFinite(price) || price < 0 || price >= 1e10 || Number(price.toFixed(2)) !== price) {
    throw new Error('Completa nombre, SKU y categoría. Usa cantidades enteras no negativas y un precio válido con hasta dos decimales.');
  }
  return { name: data.name.trim(), sku: data.sku.trim(), category: data.category,
    stock, price, min_stock: minStock };
}

const writeErrors = {
  INVENTORY_FORBIDDEN: 'Tu cuenta no tiene permiso para modificar el inventario.',
  INVENTORY_NOT_FOUND: 'El producto ya no existe. Recarga el inventario.',
  INVENTORY_STALE_VERSION: 'Otra persona modificó este producto. Recarga la página y revisa los datos antes de volver a editarlo.',
  INVENTORY_NEGATIVE_STOCK: 'El stock no puede quedar por debajo de cero.',
  INVENTORY_INVALID_INPUT: 'Los datos del producto no son válidos. Revisa los campos.',
  INVENTORY_INVALID_CATEGORY: 'La categoría no existe. Recarga el inventario.',
  INVENTORY_REQUEST_CONFLICT: 'Este intento no coincide con la operación original. Recarga el inventario.',
};

export async function saveInventoryChange(client, request) {
  let response;
  try { response = await mutateInventory(client, request); }
  catch { throw Object.assign(new Error('No se pudo confirmar el guardado. Reintenta la operación para comprobarla sin duplicarla.'), { uncertain: true }); }
  if (response.error) {
    const { code, message } = response.error;
    const known = writeErrors[message] || (code === '23505' ? 'Ya existe un producto con ese SKU.'
      : ['PGRST202', '42883'].includes(code) ? 'Falta habilitar el guardado del inventario en Supabase.'
      : ['23514', '23503', '22003', '22P02', '22023', '23502'].includes(code) ? 'Revisa los datos del producto y su categoría.'
      : ['42501', 'PGRST301', 'PGRST303'].includes(code) ? 'Tu sesión no permite guardar. Inicia sesión nuevamente.' : null);
    throw Object.assign(new Error(known || 'No se pudo confirmar el guardado. Reintenta la operación para comprobarla sin duplicarla.'), { uncertain: !known });
  }
  if (!response.data?.movement) {
    throw Object.assign(new Error('No se pudo confirmar el resultado. Reintenta la operación.'), { uncertain: true });
  }
  return response.data;
}
