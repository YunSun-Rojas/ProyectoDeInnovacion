const PAGE_SIZE = 500;

function fail(message, status = 503) {
  return Object.assign(new Error(message), { status });
}

async function rows(client, table, columns = '*') {
  const output = [];
  let response;
  const orderBy = table.endsWith('_lines') ? 'product_id' : 'created_at';
  do {
    response = await client.from(table).select(columns, { count: 'exact' })
      .order(orderBy, { ascending: orderBy !== 'created_at' }).order('id').range(output.length, output.length + PAGE_SIZE - 1);
    if (['42P01', 'PGRST205'].includes(response.error?.code)) throw fail('El módulo comercial todavía no está habilitado en Supabase.', 409);
    if (response.error) throw fail('No se pudieron cargar las operaciones comerciales.', response.error.code === '42501' ? 403 : 503);
    if (!Array.isArray(response.data) || !Number.isInteger(response.count) || (!response.data.length && output.length < response.count)) throw fail('La respuesta del historial comercial está incompleta. Reintenta.');
    output.push(...response.data);
  } while (output.length < response.count);
  return output;
}

export async function loadCommerce(client, userId) {
  const membership = await client.from('inventory_members').select('user_id').eq('user_id', userId).maybeSingle();
  if (membership.error || !membership.data) throw fail('Tu cuenta no tiene acceso a las operaciones comerciales.', membership.error?.code === '42501' ? 403 : 503);
  const enabled = await client.rpc('inventory_commerce_enabled', {}, { get: true });
  if (['PGRST202', '42883', '42P01', 'PGRST205'].includes(enabled.error?.code)) throw fail('El módulo de compras y ventas requiere aplicar la migración SQL de Supabase.', 409);
  if (enabled.error) throw fail('No se pudo validar el acceso al módulo comercial.', enabled.error.code === '42501' ? 403 : 503);
  const [suppliers, purchases, purchaseLines, saleOrders, saleLines, oldSales] = await Promise.all([
    rows(client, 'inventory_suppliers'), rows(client, 'inventory_purchases'), rows(client, 'inventory_purchase_lines'),
    rows(client, 'inventory_sale_orders'), rows(client, 'inventory_sale_lines'),
    rows(client, 'inventory_sales', 'id,product_id,product_name,sku,quantity,unit_price,total,actor_email,created_at,sale_order_id'),
  ]);
  const attach = (headers, lines, foreignKey) => headers.map(header => ({
    ...header,
    lines: lines.filter(line => line[foreignKey] === header.id),
  }));
  const legacySales = oldSales.filter(sale => !sale.sale_order_id).map(sale => ({
    id: `legacy-${sale.id}`, code: `VTA-LEG-${String(sale.id).slice(0, 8).toUpperCase()}`,
    customer: '', sale_date: sale.created_at, reference: 'Venta rápida anterior', notes: '', status: 'confirmada',
    total: sale.total, actor_email: sale.actor_email, created_at: sale.created_at, legacy: true,
    lines: [{ id: sale.id, product_id: sale.product_id, product_name: sale.product_name, sku: sale.sku,
      quantity: sale.quantity, unit_price: sale.unit_price, subtotal: sale.total }],
  }));
  return {
    enabled: true,
    suppliers: suppliers.filter(supplier => supplier.active),
    purchases: attach(purchases, purchaseLines, 'purchase_id'),
    sales: [...attach(saleOrders, saleLines, 'sale_id'), ...legacySales],
  };
}

export async function saveCommerce(client, { kind, action, id, data = {} }) {
  if (kind === 'supplier' && action === 'save') {
    const { data: result, error } = await client.rpc('inventory_supplier_save', { p_id: id, p_data: data });
    check(error);
    return { supplier: result };
  }
  if (!['purchase', 'sale'].includes(kind) || !['create', 'receive', 'confirm', 'cancel'].includes(action) ||
      (kind === 'purchase' && !['create', 'receive', 'cancel'].includes(action)) ||
      (kind === 'sale' && !['create', 'confirm', 'cancel'].includes(action))) {
    throw fail('La operación solicitada no es válida.', 400);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id ?? '')) throw fail('El identificador de operación no es válido.', 400);
  const fn = kind === 'purchase' ? 'inventory_purchase' : 'inventory_sale_order';
  const { data: result, error } = await client.rpc(fn, { p_action: action, p_id: id, p_data: data });
  check(error);
  return result;
}

function check(error) {
  if (!error) return;
  const message = error.message || '';
  const known = {
    INVENTORY_FORBIDDEN: ['Tu cuenta no tiene permiso para esta operación.', 403],
    INVENTORY_STALE_VERSION: ['El stock cambió mientras se procesaba la operación. Actualiza los datos y reintenta.', 409],
    INVENTORY_NEGATIVE_STOCK: ['No hay stock suficiente para confirmar esta venta.', 409],
    INVENTORY_NOT_FOUND: ['Uno de los productos o documentos ya no existe.', 404],
    INVENTORY_INVALID_INPUT: ['Revisa los productos, cantidades, costos e importes ingresados.', 400],
    INVENTORY_REQUEST_CONFLICT: ['El reintento no coincide con la solicitud original.', 409],
    INVENTORY_IMMUTABLE: ['Este documento ya fue procesado y no admite esa acción.', 409],
    INVENTORY_STOCK_DISABLED: ['Las operaciones de stock todavía no están habilitadas en Supabase.', 409],
    INVENTORY_SALES_DISABLED: ['Las ventas todavía no están habilitadas en Supabase.', 409],
  };
  const entry = Object.entries(known).find(([key]) => message.includes(key));
  if (entry) throw fail(entry[1][0], entry[1][1]);
  if (['42P01', 'PGRST202', 'PGRST205', '42883'].includes(error.code)) throw fail('El módulo comercial requiere aplicar la migración SQL de Supabase.', 409);
  if (['42501', 'PGRST301', 'PGRST303'].includes(error.code)) throw fail('Tu sesión no permite realizar esta operación.', 403);
  if (['22023', '23514', '23503', '22003', '22P02'].includes(error.code)) throw fail('Revisa los datos y el estado del documento antes de reintentar.', 409);
  throw Object.assign(fail('No se pudo confirmar el resultado. Reintenta la misma operación para comprobarla sin duplicarla.'), { uncertain: true });
}
