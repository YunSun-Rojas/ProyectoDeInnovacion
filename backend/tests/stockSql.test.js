import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// PostgreSQL WASM local en memoria; no conexión ni SQL en Supabase.
test('Fase 3: transacciones de stock compatibles con RPC reales de Fases 1/2', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  for (const path of ['./fixtures/catalogDatabase.sql', './sql/20261013_catalog_products.proposed.sql']) await db.exec(await readFile(new URL(path, import.meta.url), 'utf8'));
  const actor = '00000000-0000-4000-8000-000000000001';
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
  let counter = 100;
  const uuid = () => `00000000-0000-4000-8000-${String(counter++).padStart(12, '0')}`;
  const mutate = async (action, product, data, request = uuid()) => (await db.query(
    'select inventory_mutate($1::uuid,$2::text,$3::bigint,$4::bigint,$5::jsonb) result',
    [request, action, product?.id ?? null, product?.version ?? null, JSON.stringify(data)])).rows[0].result;
  const stock = async (product, kind, quantity, reason = 'Conteo físico', request = uuid()) => (await db.query(
    'select inventory_register_stock($1::uuid,$2::bigint,$3::bigint,$4::text,$5::integer,$6::text) result',
    [request, product.id, product.version, kind, quantity, reason])).rows[0].result;
  const sale = async (product, request = uuid()) => (await db.query(
    'select inventory_register_sale($1::uuid,$2::bigint,$3::bigint,2,75) result',
    [request, product.id, product.version])).rows[0].result;
  const data = { sku: 'F3', name: 'Mouse', category: 'Periféricos', stock: 10, price: 80, min_stock: 2, brand: 'Marca', purchase_cost: 40, barcode: '001', unit_of_measure: 'Unidad', is_active: false };
  let product = (await mutate('add', null, data)).product;
  const snapshot = async () => (await db.query('select * from inventory_movements order by id')).rows;
  const oldHistory = await snapshot();
  const signatures = ['inventory_mutate(uuid,text,bigint,bigint,jsonb)', 'inventory_register_sale(uuid,bigint,bigint,integer,numeric)'];
  const definitions = async () => (await db.query('select pg_get_functiondef(to_regprocedure(s)) def from unnest($1::text[]) s', [signatures])).rows;
  const oldDefinitions = await definitions();
  await db.exec(await readFile(new URL('./sql/20261014_stock_movements.proposed.sql', import.meta.url), 'utf8'));
  assert.deepEqual(await snapshot(), oldHistory);
  assert.deepEqual(await definitions(), oldDefinitions);
  await db.exec('set role authenticated');
  assert.equal((await db.query('select inventory_stock_enabled() enabled')).rows[0].enabled, true);

  await t.test('RPC de stock respeta el permiso de escritura aunque el usuario sea miembro', async () => {
    await db.exec('reset role');
    await db.exec(`create or replace function public.inventory_write_enabled() returns boolean
      language sql stable set search_path = '' as $$ select false $$`);
    await db.exec('set role authenticated');
    await assert.rejects(stock(product, 'stock_in', 1), /INVENTORY_FORBIDDEN/);
    await db.exec('reset role');
    await db.exec(`create or replace function public.inventory_write_enabled() returns boolean
      language sql stable set search_path = '' as $$ select exists
      (select 1 from public.inventory_members where user_id=auth.uid()) $$`);
    await db.exec('set role authenticated');
  });

  await t.test('entrada múltiple, reintento y conflicto conservan atributos', async () => {
    const request = uuid();
    const result = await stock(product, 'stock_in', 6, 'Compra', request);
    assert.equal(result.product.stock, 16);
    assert.equal(result.movement.quantity, 6);
    assert.equal(result.movement.actor_id, actor);
    assert.equal(result.movement.actor_email, 'operador@example.test');
    assert.equal(result.movement.stock_before, 10);
    assert.equal(result.movement.stock_after, 16);
    for (const key of ['sku','brand','purchase_cost','barcode','unit_of_measure','is_active','price','created_at']) assert.equal(result.product[key], product[key]);
    assert.deepEqual(await stock(product, 'stock_in', 6, 'Compra', request), result);
    await assert.rejects(stock(product, 'stock_in', 7, 'Compra', request), /INVENTORY_REQUEST_CONFLICT/);
    await assert.rejects(mutate('adjust', product, { delta: 1 }, request), /INVENTORY_REQUEST_CONFLICT/);
    await assert.rejects(stock(product, 'stock_out', 1), /INVENTORY_STALE_VERSION/);
    product = result.product;
  });
  await t.test('salida, ajustes firmados y validación no dejan stock negativo', async () => {
    const before = await snapshot();
    for (const [kind, quantity, reason] of [['stock_out',17,'Retiro'],['stock_in',0,'Compra'],['stock_in',-1,'Compra'],['stock_adjust',1,' '],['stock_adjust',-17,'Conteo'],['stock_in',2147483647,'Compra']]) await assert.rejects(stock(product, kind, quantity, reason), /INVENTORY_(INVALID_INPUT|NEGATIVE_STOCK)/);
    await assert.rejects(stock(product, 'stock_adjust', 1, 'x'.repeat(501)), /INVENTORY_INVALID_INPUT/);
    await assert.rejects(stock(product, 'stock_adjust', 1, '\t\n'), /INVENTORY_INVALID_INPUT/);
    assert.deepEqual(await snapshot(), before);
    let result = await stock(product, 'stock_out', 3, 'Retiro de almacén');
    assert.equal(result.product.stock, 13);
    assert.equal(result.movement.quantity, -3);
    product = (await stock(result.product, 'stock_adjust', -2)).product;
    result = await stock(product, 'stock_adjust', 4);
    assert.equal(result.product.stock, 15);
    assert.equal(result.movement.type, 'Ajuste');
    product = result.product;
  });
  await t.test('dos solicitudes con misma versión solo permiten una escritura', async () => {
    // PGlite serializa consultas; verifica el resultado del control de versión.
    // El bloqueo FOR UPDATE de la RPC requiere ensayo multisesión en copia real.
    const results = await Promise.allSettled([stock(product, 'stock_out', 10), stock(product, 'stock_out', 10)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.match(results.find(r => r.status === 'rejected').reason.message, /INVENTORY_STALE_VERSION/);
    product = results.find(r => r.status === 'fulfilled').value.product;
    assert.equal(product.stock, 5);
  });
  await t.test('ventas, adjust ±1 y catalog_edit mantienen contratos e historial', async () => {
    const request = uuid();
    const result = await sale(product, request);
    assert.equal(result.product.stock, 3);
    assert.equal(result.sale.total, 150);
    assert.deepEqual(await sale(product, request), result);
    await assert.rejects(stock(product, 'stock_in', 1, 'Compra', request), /INVENTORY_REQUEST_CONFLICT/);
    await assert.rejects(stock(product, 'stock_in', 1), /INVENTORY_STALE_VERSION/);
    product = result.product;
    await assert.rejects(mutate('adjust', product, { delta: 6 }), /INVENTORY_INVALID_INPUT/);
    product = (await mutate('adjust', product, { delta: -1 })).product;
    product = (await mutate('adjust', product, { delta: 1 })).product;
    const { stock: _stock, ...catalog } = data;
    const edited = await mutate('catalog_edit', product, { ...catalog, model: 'Nuevo' });
    assert.equal(edited.movement.quantity, 0);
    assert.equal(edited.product.stock, 3);
    assert.equal(edited.product.purchase_cost, 40);
    assert.equal((await snapshot()).length > oldHistory.length, true);
    product = edited.product;
  });
  await t.test('falla de historial revierte cambio de stock y versión', async () => {
    await db.exec('reset role');
    await db.exec("create function reject_stock_test() returns trigger language plpgsql as $$ begin raise exception 'rollback test'; end $$; create trigger reject_stock before insert on inventory_movements for each row execute function reject_stock_test();");
    await assert.rejects(stock(product, 'stock_in', 2), /rollback test/);
    const row = (await db.query('select stock,version from products where id=$1', [product.id])).rows[0];
    assert.equal(row.stock, product.stock);
    assert.equal(Number(row.version), product.version);
    await db.exec('drop trigger reject_stock on inventory_movements');
  });
  await t.test('usuarios ajenos y anónimos sin escritura; historial protegido', async () => {
    await db.exec('set role authenticated');
    await assert.rejects(db.exec('update products set stock=999'), /permission denied/);
    await assert.rejects(db.exec('delete from inventory_movements'), /permission denied/);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", ['00000000-0000-4000-8000-999999999999']);
    assert.equal((await db.query('select inventory_stock_enabled() enabled')).rows[0].enabled, false);
    assert.equal((await snapshot()).length, 0);
    await assert.rejects(stock(product, 'stock_in', 2), /INVENTORY_FORBIDDEN/);
    await db.exec('reset role; set role anon');
    await assert.rejects(stock(product, 'stock_in', 2), /permission denied/);
    await db.exec('reset role');
  });
});
