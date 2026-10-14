import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Contrato mínimo de la base existente. No representa un volcado de producción.
const fixture = `
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql as $$ select '{"email":"operador@example.test"}'::jsonb $$;
create table inventory_members(user_id uuid primary key);
insert into inventory_members values ('00000000-0000-4000-8000-000000000001');
grant usage on schema public, auth to authenticated;
grant select on inventory_members to authenticated;
create table categories(id bigint primary key, name text);
insert into categories values (1, 'Periféricos');
create table products(id bigint primary key, name text, sku text, category_id bigint, stock integer, min_stock integer, price numeric(12,2), version integer);
insert into products values (1, 'Mouse', 'M1', 1, 10, 2, 80, 1);
create table inventory_movements(id bigint generated always as identity primary key, type text, stock_before integer, stock_after integer, quantity integer);
create function inventory_write_enabled() returns boolean language sql as $$ select true $$;
create function inventory_mutate(p_request_id uuid, p_action text, p_product_id bigint, p_expected_version integer, p_data jsonb) returns jsonb language plpgsql as $$
declare p products%rowtype; m inventory_movements%rowtype; old_stock integer;
begin
 select stock into old_stock from products where id = p_product_id;
 update products set stock = (p_data->>'stock')::integer, price = (p_data->>'price')::numeric, version = version + 1 where id = p_product_id and version = p_expected_version returning * into p;
 if not found then raise exception 'INVENTORY_STALE_VERSION'; end if;
 insert into inventory_movements(type, stock_before, stock_after, quantity) values ('Ajuste', old_stock, p.stock, p.stock-old_stock) returning * into m;
 return jsonb_build_object('product',to_jsonb(p),'movement',to_jsonb(m));
end; $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
`;

test('SQL de ventas: descuento atómico, precio histórico, permisos y reintento', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(fixture);
  await db.exec(await readFile(new URL('../../supabase/sql/ventas.sql', import.meta.url), 'utf8'));
  const call = (id, version, quantity, price) => db.query('select inventory_register_sale($1::uuid, 1::bigint, $2::bigint, $3::integer, $4::numeric) as result', [id, version, quantity, price]);
  const id = '00000000-0000-4000-8000-000000000010';
  const first = (await call(id, 1, 2, 75)).rows[0].result;
  assert.equal(first.product.stock, 8);
  assert.equal(first.product.price, 80);
  assert.equal(first.sale.unit_price, 75);
  assert.equal(first.sale.total, 150);
  assert.equal(first.sale.actor_email, 'operador@example.test');
  assert.deepEqual((await call(id, 1, 2, 75)).rows[0].result, first);
  assert.equal((await db.query('select count(*)::int as count from inventory_movements')).rows[0].count, 1);
  await assert.rejects(call(id, 1, 3, 75), /INVENTORY_REQUEST_CONFLICT/);
  await assert.rejects(call('00000000-0000-4000-8000-000000000011', 1, 1, 80), /INVENTORY_STALE_VERSION/);
  await assert.rejects(call('00000000-0000-4000-8000-000000000012', 2, 9, 80), /INVENTORY_NEGATIVE_STOCK/);
  await assert.rejects(call('00000000-0000-4000-8000-000000000012', 2, 1, 1.234), /INVENTORY_INVALID_INPUT/);

  await db.exec('update products set price = 90, version = version + 1 where id = 1');
  const second = (await call('00000000-0000-4000-8000-000000000013', 3, 1, 90)).rows[0].result;
  assert.equal(second.sale.total, 90);
  assert.equal((await db.query('select sum(total)::text as total from inventory_sales')).rows[0].total, '240.00');

  // Una falla al persistir la venta debe deshacer el descuento y el movimiento.
  await db.exec(`create function reject_test_sale() returns trigger language plpgsql as $$ begin raise exception 'test rollback'; end; $$;
    create trigger reject_sale before insert on inventory_sales for each row execute function reject_test_sale();`);
  await assert.rejects(call('00000000-0000-4000-8000-000000000014', 4, 1, 90), /test rollback/);
  assert.equal((await db.query('select stock from products where id=1')).rows[0].stock, 7);
  assert.equal((await db.query('select count(*)::int as count from inventory_movements')).rows[0].count, 2);
  await db.exec('drop trigger reject_sale on inventory_sales');

  await db.exec('set role authenticated');
  assert.equal((await db.query('select total from inventory_sales')).rows.length, 2);
  await assert.rejects(db.exec('update inventory_sales set unit_price = 999'), /permission denied/);
  await assert.rejects(db.exec('delete from inventory_sales'), /permission denied/);
  await db.exec(`select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',false)`);
  assert.equal((await db.query('select total from inventory_sales')).rows.length, 0);
  await assert.rejects(call('00000000-0000-4000-8000-000000000015', 4, 1, 90), /INVENTORY_FORBIDDEN/);
  await db.exec('reset role; delete from products where id=1');
  assert.equal((await db.query('select count(*)::int as count from inventory_sales')).rows[0].count, 2);
});
