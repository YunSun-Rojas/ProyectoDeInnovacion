import { readBody, fail } from '../../utils/http.js';
import { loadCommerce, saveCommerce } from './commerceService.js';

export function createInventoryController(inventory) {
  return {
    async predictionEvidence({ session: { client, user }, send }) {
      send(200, await inventory.loadPredictionEvidence(client, user.id));
    },
    async reports({ session: { client, user }, send }) {
      send(200, await inventory.loadReports(client, user.id));
    },
    async alerts({ session: { client, user }, send }) {
      send(200, await inventory.loadPendingDifferences(client, user.id));
    },
    async physicalList({ session: { client }, send }) {
      const sessions = [];
      let response;
      do {
        response = await client.from('inventory_counts').select('*', { count: 'exact' })
          .order('created_at', { ascending: false }).order('id').range(sessions.length, sessions.length + 499);
        physicalError(response.error);
        if (!Array.isArray(response.data) || !Number.isInteger(response.count) || (!response.data.length && sessions.length < response.count))
          throw fail(503, 'No se pudo cargar el historial completo. Reintenta.');
        sessions.push(...response.data);
      } while (sessions.length < response.count);
      send(200, { sessions });
    },
    async physical({ req, session: { client }, send }) {
      const body = await readBody(req);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id)
        || !['get','create','save','review','reopen','rebase','confirm','cancel'].includes(body.action)
        || (body.revision != null && (!Number.isInteger(body.revision) || body.revision < 1 || body.revision > 2147483647))
        || (body.data != null && (typeof body.data !== 'object' || Array.isArray(body.data)))) throw fail(400, 'Solicitud inválida.');
      const response = await client.rpc('inventory_physical', { p_action: body.action, p_id: body.id,
        p_revision: body.revision ?? null, p_data: body.data ?? {} });
      physicalError(response.error);
      send(200, response.data);
    },
    async load({ session: { client, user }, send }) {
      send(200, await inventory.loadInventory(client, user.id));
    },
    async commerceLoad({ session: { client, user }, send }) {
      send(200, await loadCommerce(client, user.id));
    },
    async commerceSave({ req, session: { client }, send }) {
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
        typeof body.kind !== 'string' || typeof body.action !== 'string' || typeof body.id !== 'string' ||
        (body.data != null && (typeof body.data !== 'object' || Array.isArray(body.data)))) throw fail(400, 'Solicitud comercial inválida.');
      send(200, await saveCommerce(client, body));
    },
    async change({ req, session: { client, user }, send }) {
      const body = await readBody(req);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)
        || !['add', 'edit', 'catalog_edit', 'delete', 'adjust', 'sale', 'stock_in', 'stock_out', 'stock_adjust'].includes(body.action)) throw fail(400, 'Operación inválida.');
      const stockAction = ['stock_in', 'stock_out', 'stock_adjust'].includes(body.action);
      if (body.action !== 'add' && (!Number.isSafeInteger(body.productId) || body.productId <= 0)) throw fail(400, 'Producto inválido.');
      if ((stockAction || ['edit', 'catalog_edit', 'delete', 'sale'].includes(body.action)) && (!Number.isSafeInteger(body.version) || body.version <= 0)) throw fail(400, 'Versión inválida.');
      if (!body.data || Array.isArray(body.data) || typeof body.data !== 'object') throw fail(400, 'Datos inválidos.');
      if (body.action === 'adjust' && (!Number.isSafeInteger(body.data.delta)
        || ![-1, 1].includes(body.data.delta))) {
        throw fail(400, 'El ajuste compatible solo admite +1 o -1.');
      }
      let payload;
      try {
        payload = body.action === 'catalog_edit' ? inventory.catalogPayload(body.data)
          : ['add', 'edit'].includes(body.action) ? inventory.productPayload(body.data)
          : stockAction ? inventory.stockPayload(body.data, body.action)
          : body.action === 'sale' ? inventory.salePayload(body.data)
          : body.action === 'adjust' ? { delta: body.data.delta } : {};
      } catch (error) { throw fail(400, error.message); }
      // Leer permisos y categorías ANTES de escribir, para no perder una confirmación.
      const current = await inventory.loadInventory(client, user.id);
      if (current.readOnly) throw fail(403, 'Tu cuenta no tiene habilitado el guardado.');
      if (stockAction && !current.stockEnabled) throw fail(409, 'Falta aplicar la migración de stock de Fase 3.');
      if (body.action === 'sale' && !current.salesEnabled) throw fail(409, 'El registro de ventas todavía no está habilitado.');
      const result = await inventory.saveInventoryChange(client, { p_request_id: body.requestId, p_action: body.action,
        p_product_id: body.action === 'add' ? null : body.productId,
        p_expected_version: body.version ?? null, p_data: payload });
      try {
        const sale = result.sale ? inventory.mapSale(result.sale) : undefined;
        return send(200, { product: result.product ? inventory.mapProduct(result.product, current.categories) : null,
          movement: inventory.mapMovement(result.movement, sale), ...(sale ? { sale } : {}) });
      } catch { throw Object.assign(fail(503, 'Cambio enviado. Reintenta para confirmar sin duplicarlo.'), { uncertain: true }); }
    },
  };
}

function physicalError(error) {
  if (!error) return;
  if (['42P01','PGRST205','PGRST202','42883'].includes(error.code))
    throw fail(409, 'Inventario físico requiere habilitación de base de datos: aplicar el SQL propuesto de Fase 5 con autorización.');
  if (error.code === '42501' || error.message?.includes('FORBIDDEN')) throw fail(403, 'Tu cuenta no tiene permiso para esta sesión.');
  const messages = { PHYSICAL_STALE_REVISION: 'La sesión cambió. Vuelve a abrirla antes de guardar.',
    PHYSICAL_EMPTY: 'No hay productos para crear o confirmar este conteo.',
    PHYSICAL_INCOMPLETE: 'Cuenta todos los productos y explica cada diferencia.',
    PHYSICAL_PRODUCT_REMOVED: 'Un producto fue eliminado. Cancela este conteo y crea otro.',
    PHYSICAL_IMMUTABLE: 'Esta sesión está cerrada y no admite cambios.',
    PHYSICAL_REVIEW_REQUIRED: 'Primero envía la sesión a revisión.' };
  const known = Object.entries(messages).find(([key]) => error.message?.includes(key))?.[1];
  if (known || error.message?.includes('INVENTORY_') || ['22003','22023','23514','22P02'].includes(error.code))
    throw fail(409, known || 'No se pudo completar el conteo. Recarga la sesión y revisa los datos.');
  if (['40001','40P01','55P03','57014'].includes(error.code))
    throw fail(409, 'La transacción se revirtió por concurrencia o tiempo de espera. Recarga la sesión y reintenta.');
  throw Object.assign(fail(503, 'No se pudo confirmar el resultado. Reintenta la misma operación.'), { uncertain: true });
}
