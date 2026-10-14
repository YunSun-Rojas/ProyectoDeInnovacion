import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Únicamente PostgreSQL WASM en memoria: sin URL, credenciales ni Supabase remoto.
test('migración de catálogo con funciones reales exportadas en entorno aislado', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('./fixtures/catalogDatabase.sql', import.meta.url), 'utf8'));
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", ['00000000-0000-4000-8000-000000000001']);
  let counter = 1;
  const uuid = () => `00000000-0000-4000-8000-${String(counter++).padStart(12, '0')}`;
  const mutate = async (action, id, version, data, requestId = uuid()) => (await db.query(
    'select inventory_mutate($1::uuid,$2::text,$3::bigint,$4::bigint,$5::jsonb) as result',
    [requestId, action, id, version, JSON.stringify(data)])).rows[0].result;
  const sale = async (id, version, qty, requestId = uuid()) => (await db.query(
    'select inventory_register_sale($1::uuid,$2::bigint,$3::bigint,$4::integer,75::numeric) as result',
    [requestId, id, version, qty])).rows[0].result;
  const data = { name: 'Mouse', sku: 'M1', category: 'Periféricos', stock: 12, min_stock: 2, price: 80 };
  const original = await mutate('add', null, null, data);
  const id = original.product.id;
  await sale(id, 1, 1);
  const beforeProducts = (await db.query('select * from products')).rows;
  const beforeHistory = (await db.query('select * from inventory_movements order by id')).rows;
  const beforeSales = (await db.query('select * from inventory_sales order by id')).rows;
  const acl = (await db.query("select proacl::text from pg_proc where oid='inventory_mutate(uuid,text,bigint,bigint,jsonb)'::regprocedure")).rows;
  // Se ejecuta el archivo completo, incluidos preflight y COMMIT, solo en memoria.
  await db.exec(await readFile(new URL('../../supabase/sql/20261013_catalog_products.proposed.sql', import.meta.url), 'utf8'));

  await t.test('ampliación conserva datos previos, ACL, ventas e historial', async () => {
    const after = (await db.query('select * from products')).rows;
    for (const [key, value] of Object.entries(beforeProducts[0])) assert.deepEqual(after[0][key], value);
    assert.equal(after[0].purchase_cost, null);
    assert.equal(after[0].updated_at, null);
    assert.equal(after[0].unit_of_measure, 'Unidad');
    assert.deepEqual((await db.query('select * from inventory_movements order by id')).rows, beforeHistory);
    assert.deepEqual((await db.query('select * from inventory_sales order by id')).rows, beforeSales);
    assert.deepEqual((await db.query("select proacl::text from pg_proc where oid='inventory_mutate(uuid,text,bigint,bigint,jsonb)'::regprocedure")).rows, acl);
  });
  const draft = { ...data, sku: 'M2', brand: 'Marca', model: 'Modelo', characteristics: 'USB',
    purchase_cost: 35.25, barcode: '000123', unit_of_measure: 'Unidad', is_active: false };
  let product;
  await t.test('alta, consulta y SKU único, importes y usuarios miembros', async () => {
    await db.exec('set role authenticated');
    product = (await mutate('add', null, null, draft)).product;
    assert.equal(product.brand, 'Marca');
    assert.equal(product.purchase_cost, 35.25);
    assert.equal(product.price, 80);
    assert.equal((await db.query('select purchase_cost from products where id=$1', [product.id])).rows[0].purchase_cost, '35.25');
    await assert.rejects(mutate('add', null, null, draft), /products_sku_key/);
    for (const price of [-1, 0.001]) await assert.rejects(mutate('add', null, null, { ...draft, sku: uuid(), price }), /INVENTORY_INVALID_INPUT/);
    for (const purchase_cost of [-1, 1.001, 1e10, 'NaN']) await assert.rejects(mutate('add', null, null, { ...draft, sku: uuid(), purchase_cost }), /INVENTORY_INVALID_INPUT/);
    await db.exec('reset role');
  });
  await t.test('catalog_edit obtiene stock en servidor y no admite banderas manipuladas', async () => {
    const { stock, ...edit } = draft;
    for (const forced of [{ stock: stock - 1 }, { stock }, { delta: 1 }, { catalog_only: false, stock: 0 }]) {
      await assert.rejects(mutate('catalog_edit', product.id, product.version, { ...edit, ...forced }), /INVENTORY_INVALID_INPUT/);
    }
    const request = uuid();
    const result = await mutate('catalog_edit', product.id, product.version, { ...edit, model: 'Nuevo modelo' }, request);
    assert.equal(result.product.stock, stock);
    assert.equal(result.product.version, product.version + 1);
    assert.equal(result.product.model, 'Nuevo modelo');
    assert.equal(result.movement.quantity, 0);
    assert(result.product.updated_at);
    assert.deepEqual(await mutate('catalog_edit', product.id, product.version, { ...edit, model: 'Nuevo modelo' }, request), result);
    await assert.rejects(mutate('catalog_edit', product.id, product.version, { ...edit, model: 'Otro' }, request), /INVENTORY_REQUEST_CONFLICT/);
    await assert.rejects(mutate('catalog_edit', product.id, product.version, edit), /INVENTORY_STALE_VERSION/);
    product = result.product;
  });
  await t.test('venta real exportada conserva atributos, concurrencia, precio e idempotencia', async () => {
    // Simula una referencia ya existente, NO habilita carga ni Storage.
    await db.query("update products set image_path='products/test.webp',source_status='Datos Correcto' where id=$1", [product.id]);
    const request = uuid();
    const result = await sale(product.id, product.version, 2, request);
    for (const key of ['brand','model','characteristics','purchase_cost','barcode','unit_of_measure','is_active','price']) assert.equal(result.product[key], product[key]);
    assert.equal(result.product.image_path, 'products/test.webp');
    assert.equal(result.product.source_status, 'Datos Correcto');
    assert.equal(result.product.stock, product.stock - 2);
    assert.equal(result.product.version, product.version + 1);
    assert.equal(result.sale.total, 150);
    assert.deepEqual(await sale(product.id, product.version, 2, request), result);
    await assert.rejects(sale(product.id, product.version, 1), /INVENTORY_STALE_VERSION/);
    await assert.rejects(sale(product.id, result.product.version, 99), /INVENTORY_NEGATIVE_STOCK/);
    const { stock, ...edit } = data;
    const updated = await mutate('catalog_edit', product.id, result.product.version, { ...edit, sku: 'M2', price: 99 });
    assert.equal(updated.product.stock, stock - 2);
    assert.equal(updated.product.purchase_cost, 35.25);
    assert.equal((await db.query('select total from inventory_sales where id=$1', [request])).rows[0].total, '150.00');
    await assert.rejects(mutate('catalog_edit', product.id, updated.product.version, { ...edit, image_path: 'arbitraria' }), /INVENTORY_INVALID_INPUT/);
  });
  await t.test('RLS y RPC impiden lectura y escritura ajenas al inventario', async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", ['00000000-0000-4000-8000-999999999999']);
    await db.exec('set role authenticated');
    for (const table of ['products', 'inventory_members', 'inventory_movements']) assert.equal((await db.query(`select * from ${table}`)).rows.length, 0);
    assert.equal((await db.query('select id,total from inventory_sales')).rows.length, 0);
    await assert.rejects(mutate('add', null, null, { ...data, sku: 'NO' }), /INVENTORY_FORBIDDEN/);
    await assert.rejects(sale(id, 2, 1), /INVENTORY_FORBIDDEN/);
    await assert.rejects(db.query("insert into inventory_members values('00000000-0000-4000-8000-999999999999')"), /permission denied/);
    await assert.rejects(db.query('update products set stock=0'), /permission denied/);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select purchase_cost from products'), /permission denied/);
    await assert.rejects(mutate('add', null, null, data), /permission denied/);
    await db.exec('reset role');
  });
});
