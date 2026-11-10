import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCommerce } from '../src/modules/inventory/commerceService.js';

function membershipClient(response) {
  return {
    from(table) {
      assert.equal(table, 'inventory_members');
      return {
        select(column) {
          assert.equal(column, 'user_id');
          return this;
        },
        eq(column, value) {
          assert.equal(column, 'user_id');
          assert.equal(value, 'operator');
          return this;
        },
        async maybeSingle() { return response; },
      };
    },
    rpc() { assert.fail('La consulta comercial debe detenerse en la membresía.'); },
  };
}

test('comercio devuelve 403 si la consulta de membresía devuelve cero filas', async () => {
  await assert.rejects(loadCommerce(membershipClient({ data: null, error: null }), 'operator'),
    { status: 403, message: 'Tu cuenta no tiene acceso a las operaciones comerciales.' });
});

test('comercio devuelve 503 si falla el servicio de membresía', async () => {
  await assert.rejects(loadCommerce(membershipClient({ data: null, error: { code: 'PGRST000' } }), 'operator'),
    { status: 503, message: 'No se pudo verificar el acceso a las operaciones comerciales.' });
});

test('comercio conserva el 403 cuando la base de datos deniega el acceso', async () => {
  await assert.rejects(loadCommerce(membershipClient({ data: null, error: { code: '42501' } }), 'operator'),
    { status: 403 });
});
