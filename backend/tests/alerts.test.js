import test from 'node:test';
import assert from 'node:assert/strict';
import { readPendingDifferences } from '../src/modules/inventory/inventoryRepository.js';
import { createInventoryRoutes } from '../src/modules/inventory/inventoryRoutes.js';
import { createInventoryController } from '../src/modules/inventory/inventoryController.js';

function mock({ member = { data: { user_id: 'actor' } }, response, rows = [] } = {}) {
  const calls = [];
  return { calls, from(table) {
    calls.push(['from', table]);
    const query = {
      select(...args) { calls.push(['select', ...args]); return query; },
      eq(...args) { calls.push(['eq', ...args]); return query; },
      in(...args) { calls.push(['in', ...args]); return query; },
      order() { return query; },
      maybeSingle() { return Promise.resolve(member); },
      range(start,end) { calls.push(['range', start, end]); return Promise.resolve(response || { data: rows.slice(start,Math.min(end+1,start+200)), count: rows.length }); },
    };
    return query;
  } };
}
const row = (id, status = 'borrador', quantity = 0) => ({ session_id: `s${id}`, product_id: id, sku: `SKU${id}`,
  product_name: 'Prueba', physical_quantity: quantity, reference_stock: 2,
  inventory_counts: { id: `s${id}`, status, actor_email: 'responsable@example.test' } });

test('alertas: consulta de solo lectura paginada, miembros y estados abiertos', async () => {
  const client = mock({ rows: [...Array.from({ length: 1005 }, (_,i) => row(i+1)), row(1006,'finalizado'), row(1007,'cancelado'), row(1008,'borrador',null), row(1009,'en revisión',2)] });
  const result = await readPendingDifferences(client,'actor');
  assert.equal(result.enabled,true);
  assert.equal(result.lines.length,1005);
  assert.ok(result.sessions.some(s => s.id === 's1009'));
  assert.ok(client.calls.some(c => c[0] === 'in' && c[1] === 'inventory_counts.status' && c[2].join() === 'borrador,en revisión'));
  assert.ok(client.calls.some(c => c[0] === 'eq' && c[1] === 'user_id' && c[2] === 'actor'));
  assert.ok(client.calls.filter(c => c[0] === 'range').length > 5);
  assert.ok(client.calls.filter(c => c[0] === 'from').every(c => ['inventory_members','inventory_count_lines'].includes(c[1])));
});
test('alertas: migración ausente no se representa como cero diferencias verificadas', async () => {
  for (const code of ['42P01','PGRST205','PGRST200']) {
    const result = await readPendingDifferences(mock({ response: { error: { code } } }),'actor');
    assert.equal(result.enabled,false);
  }
  assert.deepEqual(await readPendingDifferences(mock(),'actor'), { enabled: true, sessions: [], lines: [] });
});
test('alertas: permisos, errores de Supabase y respuesta incompleta', async () => {
  const denied = mock({ member: { data: null } });
  await assert.rejects(readPendingDifferences(denied,'actor'),e => e.status === 403);
  assert.equal(denied.calls.filter(c => c[0] === 'from').length,1);
  for (const [code,status] of [['42501',403],['network',503]]) {
    await assert.rejects(readPendingDifferences(mock({ response: { error: { code } } }),'actor'),e => e.status === status);
    await assert.rejects(readPendingDifferences(mock({ member: { error: { code } } }),'actor'),e => e.status === status);
  }
  for (const response of [{ data: [], count: 3 },{ data: [] },{ data: null, count: 0 }])
    await assert.rejects(readPendingDifferences(mock({ response }),'actor'),e => e.status === 503);
});
test('alertas: ruta GET autenticada usa la identidad de sesión', async () => {
  let received;
  const client = {};
  const controller = createInventoryController({ loadPendingDifferences: async (...args) => { received=args; return { enabled:true, sessions:[], lines:[] }; } });
  const route = createInventoryRoutes(controller).find(r => r.path === '/api/inventory/alerts');
  assert.equal(route.method,'GET');
  assert.notEqual(route.public,true);
  await route.handler({ session: { client, user: { id:'actor' } }, send: (status,result) => { assert.equal(status,200); assert.equal(result.enabled,true); } });
  assert.deepEqual(received,[client,'actor']);
});
