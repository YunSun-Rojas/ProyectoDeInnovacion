const PAGE_SIZE = 500;

function checkResponse({ error }) {
  if (!error) return;
  if (['42P01', 'PGRST205'].includes(error.code)) {
    throw new Error('No se encontraron las tablas del inventario en este proyecto. Revisa la configuración de Supabase.');
  }
  throw new Error('No se pudo consultar el inventario. Revisa tu conexión y los permisos de tu cuenta e inténtalo nuevamente.');
}

async function readRows(client, table, columns, signal) {
  const rows = [];
  let total;
  do {
    signal?.throwIfAborted();
    const response = await client.from(table)
      .select(columns, { count: 'exact' })
      .order('id', { ascending: true })
      .range(rows.length, rows.length + PAGE_SIZE - 1)
      .abortSignal(signal);
    checkResponse(response);
    if (!Array.isArray(response.data) || !Number.isInteger(response.count)) {
      throw new Error('La respuesta del inventario está incompleta. Vuelve a intentarlo.');
    }
    total = response.count;
    if (response.data.length === 0 && rows.length < total) {
      throw new Error('No se pudieron cargar todos los productos. Vuelve a intentarlo.');
    }
    rows.push(...response.data);
  } while (rows.length < total);
  return rows;
}

export async function readInventory(client, userId, signal) {
  const membership = await client.from('inventory_members')
    .select('user_id').eq('user_id', userId).maybeSingle().abortSignal(signal);
  checkResponse(membership);
  if (!membership.data) {
    throw new Error('Tu cuenta no está autorizada para consultar el inventario. Solicita acceso al administrador.');
  }

  const capability = await client.rpc('inventory_write_enabled', {}, { get: true }).abortSignal(signal);
  if (capability.error && !['PGRST202', '42883'].includes(capability.error.code)) checkResponse(capability);
  const readOnly = capability.data !== true;
  const [categoryRows, productRows, movementRows] = await Promise.all([
    readRows(client, 'categories', 'id,name', signal),
    readRows(client, 'products', `id,sku,name,category_id,stock,price,min_stock${readOnly ? '' : ',version'}`, signal),
    readOnly ? [] : readRows(client, 'inventory_movements', 'id,product_name,sku,type,stock_before,stock_after,quantity,actor_email,reason,created_at', signal),
  ]);
  signal?.throwIfAborted();
  return { categoryRows, productRows, movementRows, readOnly };
}

export function mutateInventory(client, request) {
  return client.rpc('inventory_mutate', request);
}
