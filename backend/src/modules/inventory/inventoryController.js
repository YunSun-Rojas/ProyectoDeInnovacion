import { readBody, fail } from '../../utils/http.js';

export function createInventoryController(inventory) {
  return {
    async load({ session: { client, user }, send }) {
      send(200, await inventory.loadInventory(client, user.id));
    },
    async change({ req, session: { client, user }, send }) {
      const body = await readBody(req);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)
        || !['add', 'edit', 'delete', 'adjust'].includes(body.action)) throw fail(400, 'Operación inválida.');
      if (body.action !== 'add' && (!Number.isSafeInteger(body.productId) || body.productId <= 0)) throw fail(400, 'Producto inválido.');
      if (['edit', 'delete'].includes(body.action) && (!Number.isSafeInteger(body.version) || body.version <= 0)) throw fail(400, 'Versión inválida.');
      if (!body.data || Array.isArray(body.data) || typeof body.data !== 'object') throw fail(400, 'Datos inválidos.');
      if (body.action === 'adjust' && ![-1, 1].includes(body.data.delta)) throw fail(400, 'Ajuste inválido.');
      const payload = ['add', 'edit'].includes(body.action) ? inventory.productPayload(body.data)
        : body.action === 'adjust' ? { delta: body.data.delta } : {};
      // Leer permisos y categorías ANTES de escribir, para no perder una confirmación.
      const current = await inventory.loadInventory(client, user.id);
      if (current.readOnly) throw fail(403, 'Tu cuenta no tiene habilitado el guardado.');
      const result = await inventory.saveInventoryChange(client, { p_request_id: body.requestId, p_action: body.action,
        p_product_id: body.action === 'add' ? null : body.productId,
        p_expected_version: body.version ?? null, p_data: payload });
      try {
        return send(200, { product: result.product ? inventory.mapProduct(result.product, current.categories) : null,
          movement: inventory.mapMovement(result.movement) });
      } catch { throw Object.assign(fail(503, 'Cambio enviado. Reintenta para confirmar sin duplicarlo.'), { uncertain: true }); }
    },
  };
}
