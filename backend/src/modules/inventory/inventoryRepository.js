const PAGE_SIZE = 500;

export async function readReportCounts(client, userId) {
  const member = await client.from('inventory_members').select('user_id').eq('user_id', userId).maybeSingle();
  if (member.error || !member.data) throw Object.assign(new Error('No se pudo autorizar la consulta de conteos.'), { status: member.error && member.error.code !== '42501' ? 503 : 403 });
  const read = async (table, columns, order) => {
    const rows = [];
    let response;
    do {
      let query = client.from(table).select(columns, { count: 'exact' });
      for (const column of order) query = query.order(column);
      response = await query.range(rows.length, rows.length + PAGE_SIZE - 1);
      if (['42P01','PGRST205'].includes(response.error?.code)) return null;
      if (response.error || !Array.isArray(response.data) || !Number.isInteger(response.count) || (!response.data.length && rows.length < response.count))
        throw Object.assign(new Error('No se pudo consultar el historial completo de conteos. Revisa la conexión y los permisos.'), { status: response.error?.code === '42501' ? 403 : 503 });
      rows.push(...response.data);
    } while (rows.length < response.count);
    return rows;
  };
  const sessions = await read('inventory_counts','id,status,created_at,finalized_at,actor_email',['id']);
  if (sessions === null) return { enabled: false, sessions: [], lines: [] };
  const lines = await read('inventory_count_lines','session_id,product_id,sku,product_name,reference_stock,physical_quantity,reason',['session_id','product_id']);
  return lines === null ? { enabled: false, sessions: [], lines: [] } : { enabled: true, sessions, lines };
}

// Solo lectura; no usa la RPC transaccional de conteos ni altera sus estados.
export async function readPendingDifferences(client, userId) {
  const membership = await client.from('inventory_members').select('user_id').eq('user_id', userId).maybeSingle();
  if (membership.error) throw Object.assign(new Error('No se pudieron verificar los permisos de alertas. Reintenta.'),
    { status: membership.error.code === '42501' ? 403 : 503 });
  if (!membership.data) {
    throw Object.assign(new Error('Tu cuenta no pudo autorizar la consulta de alertas.'), { status: 403 });
  }
  const check = response => {
    if (response.error) throw Object.assign(new Error('No se pudieron consultar las diferencias pendientes. Revisa tu conexión y permisos.'),
      { status: response.error.code === '42501' ? 403 : 503 });
    if (!Array.isArray(response.data) || !Number.isInteger(response.count)) throw Object.assign(new Error('Respuesta incompleta de diferencias pendientes.'), { status: 503 });
  };
  const sessions = new Map();
  const rows = [];
  let response;
  do {
    // FK de Fase 5: estado y cantidades se leen juntos, sin una consulta por sesión.
    response = await client.from('inventory_count_lines')
      .select('session_id,product_id,sku,product_name,reference_stock,physical_quantity,inventory_counts!inner(id,status,created_at,actor_email)', { count: 'exact' })
      .in('inventory_counts.status', ['borrador', 'en revisión'])
      .order('session_id').order('product_id').range(rows.length, rows.length + PAGE_SIZE - 1);
    if (['42P01', 'PGRST205', 'PGRST200'].includes(response.error?.code)) return { enabled: false, sessions: [], lines: [] };
    check(response);
    if (!response.data.length && rows.length < response.count) throw Object.assign(new Error('Detalle de conteos incompleto. Reintenta.'), { status: 503 });
    rows.push(...response.data);
  } while (rows.length < response.count);
  const lines = rows.flatMap(({ inventory_counts: session, ...line }) => {
    if (!session || !['borrador', 'en revisión'].includes(session.status)) return [];
    sessions.set(session.id, session);
    return line.physical_quantity !== null && line.physical_quantity !== line.reference_stock ? [line] : [];
  });
  return { enabled: true, sessions: [...sessions.values()], lines };
}

function checkResponse({ error }) {
  if (!error) return;

  if (['42P01', 'PGRST205'].includes(error.code)) {
    throw new Error(
      'No se encontraron las tablas del inventario en este proyecto. Revisa la configuración de Supabase.'
    );
  }

  throw new Error(
    'No se pudo consultar el inventario. Revisa tu conexión y los permisos de tu cuenta e inténtalo nuevamente.'
  );
}

async function readRows(client, table, columns, signal) {
  const rows = [];
  let total;

  do {
    signal?.throwIfAborted();

    const response = await client
      .from(table)
      .select(columns, { count: 'exact' })
      .order('id', { ascending: true })
      .range(rows.length, rows.length + PAGE_SIZE - 1)
      .abortSignal(signal);

    try { checkResponse(response); } catch (error) { error.code = response.error?.code; throw error; }

    if (
      !Array.isArray(response.data) ||
      !Number.isInteger(response.count)
    ) {
      throw new Error(
        'La respuesta del inventario está incompleta. Vuelve a intentarlo.'
      );
    }

    total = response.count;

    if (response.data.length === 0 && rows.length < total) {
      throw new Error(
        'No se pudieron cargar todos los productos. Vuelve a intentarlo.'
      );
    }

    rows.push(...response.data);
  } while (rows.length < total);

  return rows;
}

async function readSales(client, signal) {
  try {
    return await readRows(client, 'inventory_sales', 'id,product_id,product_name,sku,quantity,unit_price,total,movement_id,actor_email,created_at,cancelled_at', signal);
  } catch (error) {
    if (!['42703', 'PGRST204'].includes(error.code)) throw error;
    return readRows(client, 'inventory_sales', 'id,product_id,product_name,sku,quantity,unit_price,total,movement_id,actor_email,created_at', signal);
  }
}

export async function readInventory(client, userId, signal) {
  const membership = await client
    .from('inventory_members')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()
    .abortSignal(signal);

  checkResponse(membership);

  if (!membership.data) {
    throw new Error(
      'Tu cuenta no está autorizada para consultar el inventario. Solicita acceso al administrador.'
    );
  }

  const [capability, salesCapability, stockCapability] = await Promise.all([
    client
      .rpc('inventory_write_enabled', {}, { get: true })
      .abortSignal(signal),
    client
      .rpc('inventory_sales_enabled', {}, { get: true })
      .abortSignal(signal),
    client
      .rpc('inventory_stock_enabled', {}, { get: true })
      .abortSignal(signal),
  ]);

  if (
    capability.error &&
    !['PGRST202', '42883'].includes(capability.error.code)
  ) {
    checkResponse(capability);
  }

  const readOnly = capability.data !== true;

  if (
    salesCapability.error &&
    !['PGRST202', '42883'].includes(salesCapability.error.code)
  ) {
    checkResponse(salesCapability);
  }

  const salesEnabled = salesCapability.data === true;

  if (
    stockCapability.error &&
    !['PGRST202', '42883'].includes(stockCapability.error.code)
  ) {
    checkResponse(stockCapability);
  }

  const stockEnabled = stockCapability.data === true;

  const [categoryRows, productRows, movementRows, salesRows] =
    await Promise.all([
      readRows(client, 'categories', 'id,name', signal),

      readRows(
        client,
        'products',
        `id,sku,name,category_id,stock,price,min_stock,brand,model,characteristics,barcode,purchase_cost,unit_of_measure,image_path,is_active,created_at,updated_at,created_by_name,source_status${readOnly ? '' : ',version'}`,
        signal
      ),

      readOnly
        ? []
        : readRows(
            client,
            'inventory_movements',
            'id,product_id,product_name,sku,type,stock_before,stock_after,quantity,actor_email,reason,created_at',
            signal
          ),

      salesEnabled
        ? readSales(client, signal)
        : [],
    ]);

  signal?.throwIfAborted();

  return {
    categoryRows,
    productRows,
    movementRows,
    salesRows,
    salesEnabled,
    stockEnabled,
    readOnly,
  };
}

export function mutateInventory(client, request) {
  if (
    ['stock_in', 'stock_out', 'stock_adjust'].includes(request.p_action)
  ) {
    return client.rpc('inventory_register_stock', {
      p_request_id: request.p_request_id,
      p_product_id: request.p_product_id,
      p_expected_version: request.p_expected_version,
      p_kind: request.p_action,
      p_quantity: request.p_data.quantity,
      p_reason: request.p_data.reason,
    });
  }

  if (request.p_action === 'sale') {
    return client.rpc('inventory_register_sale', {
      p_request_id: request.p_request_id,
      p_product_id: request.p_product_id,
      p_expected_version: request.p_expected_version,
      p_quantity: request.p_data.quantity,
      p_unit_price: request.p_data.unit_price,
    });
  }

  return client.rpc('inventory_mutate', request);
}
