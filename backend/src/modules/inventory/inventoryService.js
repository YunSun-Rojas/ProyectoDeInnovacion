import { readInventory, mutateInventory } from './inventoryRepository.js';
import { catalogPatch, money } from '../../../../shared/catalogProduct.js';

export async function loadInventory(client, userId, signal) {
  if (!client) {
    throw new Error('No se ha configurado la conexión con Supabase.');
  }

  if (!userId) {
    throw new Error('Inicia sesión para consultar el inventario.');
  }

  signal?.throwIfAborted();

  const {
    categoryRows,
    productRows,
    movementRows,
    salesRows,
    salesEnabled,
    stockEnabled,
    readOnly,
  } = await readInventory(client, userId, signal);

  const categories = categoryRows.map(category => ({
    id: `c${category.id}`,
    name: category.name,
  }));

  const sales = salesRows.map(mapSale);
  const saleByMovement = new Map(
    sales.map(sale => [sale.movementId, sale])
  );

  return {
    products: productRows.map(product => mapProduct(product, categories)),
    categories,
    movements: movementRows
      .map(row => mapMovement(row, saleByMovement.get(String(row.id))))
      .reverse(),
    sales,
    salesEnabled,
    stockEnabled,
    readOnly,
  };
}

export function mapProduct(product, categories) {
  const category = categories.find(
    c => c.id === `c${product.category_id}`
  )?.name;

  const price = Number(product.price);

  if (
    !category ||
    product.price === null ||
    product.price === '' ||
    !Number.isFinite(price) ||
    price < 0 ||
    !Number.isInteger(product.stock) ||
    product.stock < 0 ||
    !Number.isInteger(product.min_stock) ||
    product.min_stock < 0
  ) {
    throw new Error(
      'Hay productos con datos incompletos. Revisa sus categorías, precios y existencias.'
    );
  }

  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    category,
    stock: product.stock,
    price,
    minStock: product.min_stock,
    brand: product.brand ?? '',
    model: product.model ?? '',
    characteristics: product.characteristics ?? '',
    barcode: product.barcode ?? null,
    purchaseCost:
      product.purchase_cost == null
        ? null
        : money(product.purchase_cost, 'Costo de compra'),
    unitOfMeasure: product.unit_of_measure ?? 'Unidad',
    imagePath: product.image_path ?? null,
    isActive: product.is_active ?? true,
    sourceStatus: product.source_status ?? '',
    createdAt: product.created_at ?? null,
    updatedAt: product.updated_at ?? null,
    ...(product.created_by_name != null
      ? { createdByName: product.created_by_name }
      : {}),
    ...(product.version != null
      ? { version: product.version }
      : {}),

    // Valores provisionales: aún no se calculan las ventas por mes.
    unitsSoldThisMonth: 0,
    unitsSoldLastMonth: 0,
  };
}

export function mapMovement(row, sale) {
  return {
    id: row.id,
    productId: row.product_id ?? sale?.productId ?? null,
    date: row.created_at,
    product: row.product_name,
    sku: row.sku,
    type: row.type,
    before: row.stock_before,
    after: row.stock_after,
    quantity: row.quantity,
    user: row.actor_email,
    reason: row.reason,
    ...(sale
      ? {
          type: 'Venta',
          saleId: sale.id,
          unitPrice: sale.unitPrice,
          total: sale.total,
        }
      : {}),
  };
}

export function mapSale(row) {
  const quantity = Number(row.quantity);
  const unitPrice = Number(row.unit_price);
  const total = Number(row.total);

  if (
    !row.id ||
    !row.created_at ||
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    row.unit_price == null ||
    row.total == null ||
    !Number.isFinite(unitPrice) ||
    unitPrice < 0 ||
    !Number.isSafeInteger(Math.round(total * 100)) ||
    total < 0 ||
    Math.round(total * 100) !== quantity * Math.round(unitPrice * 100)
  ) {
    throw new Error(
      'El historial de ventas contiene un registro incompleto. Revisa la base de datos.'
    );
  }

  return {
    id: row.id,
    productId: row.product_id,
    product: row.product_name,
    sku: row.sku,
    quantity,
    unitPrice,
    total,
    movementId: String(row.movement_id),
    date: row.created_at,
    user: row.actor_email,
  };
}

export function salePayload(data) {
  if (
    !Number.isSafeInteger(data.quantity) ||
    data.quantity <= 0 ||
    data.quantity > 2147483647 ||
    typeof data.unitPrice !== 'number' ||
    !Number.isFinite(data.unitPrice) ||
    data.unitPrice < 0 ||
    data.unitPrice >= 1e10 ||
    Number(data.unitPrice.toFixed(2)) !== data.unitPrice ||
    !Number.isSafeInteger(
      data.quantity * Math.round(data.unitPrice * 100)
    )
  ) {
    throw new Error(
      'Ingresa una cantidad entera positiva y un precio de venta válido de hasta dos decimales.'
    );
  }

  return {
    quantity: data.quantity,
    unit_price: data.unitPrice,
  };
}

export function stockPayload(data, action) {
  if (
    !Number.isSafeInteger(data.quantity) ||
    data.quantity === 0 ||
    Math.abs(data.quantity) > 2147483647 ||
    (action !== 'stock_adjust' && data.quantity < 0) ||
    typeof data.reason !== 'string' ||
    !data.reason.trim() ||
    data.reason.trim().length > 500
  ) {
    throw new Error(
      'Usa una cantidad entera válida y un motivo de hasta 500 caracteres. Entradas y salidas requieren cantidades positivas.'
    );
  }

  return {
    quantity: data.quantity,
    reason: data.reason.trim(),
  };
}

export function productPayload(data) {
  if (
    !data ||
    typeof data.name !== 'string' ||
    typeof data.sku !== 'string' ||
    typeof data.category !== 'string' ||
    !['number', 'string'].includes(typeof data.price) ||
    !['number', 'string'].includes(typeof data.stock) ||
    !['number', 'string'].includes(typeof data.minStock)
  ) {
    throw new Error(
      'Completa nombre, SKU y categoría. Usa cantidades enteras no negativas y un precio válido con hasta dos decimales.'
    );
  }

  const price = Number(data.price);
  const stock = Number(data.stock);
  const minStock = Number(data.minStock);

  if (
    !data.name.trim() ||
    !data.sku.trim() ||
    !data.category ||
    data.name.trim().length > 500 ||
    data.sku.trim().length > 100 ||
    data.price === '' ||
    data.stock === '' ||
    data.minStock === '' ||
    !Number.isInteger(stock) ||
    stock < 0 ||
    stock > 2147483647 ||
    !Number.isInteger(minStock) ||
    minStock < 0 ||
    minStock > 2147483647 ||
    !Number.isFinite(price) ||
    price < 0 ||
    price >= 1e10 ||
    Number(price.toFixed(2)) !== price
  ) {
    throw new Error(
      'Completa nombre, SKU y categoría. Usa cantidades enteras no negativas y un precio válido con hasta dos decimales.'
    );
  }

  const payload = {
    name: data.name.trim(),
    sku: data.sku.trim(),
    category: data.category,
    stock,
    price,
    min_stock: minStock,
  };

  const names = {
    brand: 'brand',
    model: 'model',
    characteristics: 'characteristics',
    barcode: 'barcode',
    purchaseCost: 'purchase_cost',
    unitOfMeasure: 'unit_of_measure',
    isActive: 'is_active',
  };

  const patch = catalogPatch(data, {
    canWritePurchaseCost: true,
  });

  for (const [key, value] of Object.entries(patch)) {
    payload[names[key]] = ['brand', 'model', 'characteristics'].includes(key)
      ? (value ?? '')
      : value;
  }

  if (Object.hasOwn(data, 'createdByName')) {
    if (
      typeof data.createdByName !== 'string' ||
      !data.createdByName.trim() ||
      data.createdByName.trim().length > 120
    ) {
      throw new Error(
        'Escribe el nombre de quien registra el producto (máximo 120 caracteres).'
      );
    }

    payload.created_by_name = data.createdByName.trim();
  }

  return payload;
}

export function catalogPayload(data) {
  if (
    !data ||
    ['stock', 'delta', 'catalog_only'].some(key =>
      Object.hasOwn(data, key)
    )
  ) {
    throw new Error(
      'La edición descriptiva no admite cantidades ni ajustes de stock.'
    );
  }

  const payload = productPayload({
    ...data,
    stock: 0,
  });

  delete payload.stock;

  return payload;
}

const writeErrors = {
  INVENTORY_FORBIDDEN:
    'Tu cuenta no tiene permiso para modificar el inventario.',
  INVENTORY_NOT_FOUND:
    'El producto ya no existe. Recarga el inventario.',
  INVENTORY_STALE_VERSION:
    'Otra persona modificó este producto. Recarga la página y revisa los datos antes de volver a editarlo.',
  INVENTORY_NEGATIVE_STOCK:
    'El stock no puede quedar por debajo de cero.',
  INVENTORY_INVALID_INPUT:
    'Los datos del producto no son válidos. Revisa los campos.',
  INVENTORY_INVALID_CATEGORY:
    'La categoría no existe. Recarga el inventario.',
  INVENTORY_REQUEST_CONFLICT:
    'Este intento no coincide con la operación original. Recarga el inventario.',
};

export async function saveInventoryChange(client, request) {
  let response;

  try {
    response = await mutateInventory(client, request);
  } catch {
    throw Object.assign(
      new Error(
        'No se pudo confirmar el guardado. Reintenta la operación para comprobarla sin duplicarla.'
      ),
      { uncertain: true }
    );
  }

  if (response.error) {
    const { code, message } = response.error;

    const known =
      writeErrors[message] ||
      (code === '23505'
        ? 'Ya existe un producto con ese SKU.'
        : ['PGRST202', '42883'].includes(code)
          ? 'Falta habilitar el guardado del inventario en Supabase.'
          : ['23514', '23503', '22003', '22P02', '22023', '23502'].includes(code)
            ? 'Revisa los datos del producto y su categoría.'
            : ['42501', 'PGRST301', 'PGRST303'].includes(code)
              ? 'Tu sesión no permite guardar. Inicia sesión nuevamente.'
              : null);

    throw Object.assign(
      new Error(
        known ||
          'No se pudo confirmar el guardado. Reintenta la operación para comprobarla sin duplicarla.'
      ),
      { uncertain: !known }
    );
  }

  if (
    !response.data?.movement ||
    (request.p_action === 'sale' && !response.data.sale)
  ) {
    throw Object.assign(
      new Error(
        'No se pudo confirmar el resultado. Reintenta la operación.'
      ),
      { uncertain: true }
    );
  }

  return response.data;
}