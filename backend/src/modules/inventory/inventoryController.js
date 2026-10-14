import { readBody, fail } from '../../utils/http.js';

export function createInventoryController(inventory) {
  return {
    async load({ session: { client, user }, send }) {
      send(200, await inventory.loadInventory(client, user.id));
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
