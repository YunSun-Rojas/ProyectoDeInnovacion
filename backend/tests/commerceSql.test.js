import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('SQL comercial: instalación, permisos y transacciones de compras y ventas', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(await readFile(new URL('./fixtures/catalogDatabase.sql', import.meta.url), 'utf8'));
  // El fixture representa el esquema histórico, incluidas ventas. Elimina esas
  // copias únicamente en este PGlite efímero para probar el SQL que las crea.
  await db.exec(`drop function public.inventory_register_sale(uuid,bigint,bigint,integer,numeric);
    drop function public.inventory_sales_enabled();
    drop table public.inventory_sales cascade;`);
  for (const file of ['./sql/ventas.sql','./sql/20261013_catalog_products.proposed.sql','./sql/20261014_stock_movements.proposed.sql']) {
    await db.exec(await readFile(new URL(file, import.meta.url), 'utf8'));
  }
  const migration = await readFile(new URL('./sql/20261027_commerce.proposed.sql', import.meta.url), 'utf8');
  const incompatibleSchemas = [
    ['drop function public.inventory_stock_enabled()', /COMMERCE_SCHEMA_DRIFT:.*inventory_stock_enabled/],
    ['drop function public.inventory_sales_enabled()', /COMMERCE_SCHEMA_DRIFT:.*inventory_sales_enabled/],
    ['drop function public.inventory_write_enabled()', /COMMERCE_SCHEMA_DRIFT:.*inventory_write_enabled/],
    ['alter table public.products rename column stock to old_stock', /COMMERCE_SCHEMA_DRIFT:.*products.*stock/],
    ['alter table auth.users alter column email type integer using null::integer', /COMMERCE_SCHEMA_DRIFT:.*auth.users.*email/],
    ['create role installer; set local role installer', /COMMERCE_PERMISSION_DRIFT: installer/],
    ['grant create on schema public to anon', /COMMERCE_PERMISSION_DRIFT: anon.*CREATE/],
    ['grant update on public.inventory_sales to authenticated', /COMMERCE_PERMISSION_DRIFT: authenticated.*escritura directa/],
    ['grant insert(actor_email) on public.inventory_sales to anon', /COMMERCE_PERMISSION_DRIFT: anon.*escritura directa/],
    ['create role writer; grant writer to authenticated; alter default privileges in schema public grant update on tables to writer', /COMMERCE_PERMISSION_DRIFT: authenticated heredaría escritura directa/],
    ['drop policy inventory_sales_read_members on public.inventory_sales', /COMMERCE_PERMISSION_DRIFT:.*RLS/],
    ['alter table public.inventory_sales add column cancelled_at timestamptz', /COMMERCE_SCHEMA_DRIFT: ya existen objetos comerciales/],
  ];
  for (const [change, error] of incompatibleSchemas) {
    await t.test(change, async () => {
      await db.exec('begin; ' + change);
      try {
        await assert.rejects(db.exec(migration), error);
      } finally {
        await db.exec('rollback');
      }
      const { rows: [objects] } = await db.query(`select to_regclass('public.inventory_purchases') as purchases,
        to_regprocedure('public.inventory_commerce_enabled()') as commerce`);
      assert.deepEqual(objects, { purchases: null, commerce: null });
    });
  }

  const actor = '00000000-0000-4000-8000-000000000001';
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
  const id = number => `00000000-0000-4000-8000-${String(number).padStart(12,'0')}`;
  const product = (await db.query(`select (inventory_mutate($1,'add',null,null,$2::jsonb)->'product') result`, [id(100), JSON.stringify({ name:'Mouse', sku:'M-01', category:'Periféricos', stock:6, min_stock:2, price:80, purchase_cost:40 })])).rows[0].result;
  const productId = product.id;
  const legacyId = id(99);
  await db.query('select inventory_register_sale($1,$2,$3,1,80)', [legacyId, productId, product.version]);
  const legacy = (await db.query('select to_jsonb(s) sale from inventory_sales s where id=$1', [legacyId])).rows[0].sale;
  await db.exec(migration);
  const installed = (await db.query('select to_jsonb(s) sale from inventory_sales s where id=$1', [legacyId])).rows[0].sale;
  assert.deepEqual(installed, { ...legacy, sale_order_id: null, cancelled_at: null });

  const call = async (rpc, action, requestId, data) =>
    (await db.query(`select ${rpc}($1,$2,$3::jsonb) result`, [action, requestId, JSON.stringify(data)])).rows[0].result;

  await db.exec('set role authenticated');
  assert.equal((await db.query('select inventory_commerce_enabled() enabled')).rows[0].enabled, true);
  assert.deepEqual((await db.query('select sale_order_id, cancelled_at from inventory_sales where id=$1', [legacyId])).rows,
    [{ sale_order_id: null, cancelled_at: null }]);
  await t.test('rechaza documentos sin líneas o con datos inválidos', async () => {
    for (const [rpc, price] of [['inventory_purchase', 'unit_cost'], ['inventory_sale_order', 'unit_price']]) {
      const line = { id: id(201), reversal_id: id(202), product_id: productId, quantity: 1, [price]: 10 };
      const invalid = [
        null, {}, { lines: null }, { lines: [] }, { lines: {} }, { lines: 'mal' },
        { lines: Array(101).fill(line) }, { lines: [null] }, { lines: [{}] },
        { lines: [{ ...line, quantity: 0 }] }, { lines: [{ ...line, reversal_id: null }] },
        { lines: [{ ...line, [price]: null }] }, { lines: [{ ...line, [price]: 'NaN' }] },
        { lines: [{ ...line, [price]: 10.001 }] },
        { lines: [line, { ...line, id: id(203), reversal_id: id(204) }] },
      ];
      for (const data of invalid) {
        await assert.rejects(call(rpc, 'create', id(200), data), { code: '22023' }, JSON.stringify(data));
      }
      await assert.rejects(call(rpc, 'create', id(200), { lines: [{ ...line, id: 'mal' }] }), { code: '22P02' });
      await assert.rejects(call(rpc, 'create', id(200), { lines: [{ ...line, product_id: 999 }] }), /INVENTORY_NOT_FOUND/);
    }
    assert.deepEqual((await db.query(`select (select count(*)::int from inventory_purchases) purchases,
      (select count(*)::int from inventory_sale_orders) sales`)).rows[0], { purchases: 0, sales: 0 });
  });

  await t.test('rechaza la recepción y confirmación de borradores sin líneas', async () => {
    const line = { id: id(205), reversal_id: id(206), product_id: productId, quantity: 1 };
    await call('inventory_purchase', 'create', id(207), { lines: [{ ...line, unit_cost: 10 }] });
    await call('inventory_sale_order', 'create', id(208), { lines: [{ ...line, unit_price: 10 }] });
    await assert.rejects(call('inventory_purchase', null, id(207), {}), /INVENTORY_INVALID_INPUT/);
    await db.exec(`reset role;
      delete from inventory_purchase_lines where purchase_id='${id(207)}';
      delete from inventory_sale_lines where sale_id='${id(208)}';
      set role authenticated;`);
    await assert.rejects(call('inventory_purchase', 'receive', id(207), {}), /INVENTORY_INVALID_INPUT/);
    await assert.rejects(call('inventory_sale_order', 'confirm', id(208), {}), /INVENTORY_INVALID_INPUT/);
    assert.equal((await db.query('select stock from products where id=$1', [productId])).rows[0].stock, 5);
  });

  const purchaseData = { supplierName:'Proveedor Norte', date:'2026-10-27', reference:'FAC-1', lines:[{id:id(101),reversal_id:id(102),product_id:productId,quantity:7,unit_cost:35}] };
  const purchase = async action => (await db.query('select inventory_purchase($1,$2::uuid,$3::jsonb) result', [action,id(103),JSON.stringify(purchaseData)])).rows[0].result;
  const draft = await purchase('create');
  assert.equal(draft.operation.status, 'pendiente');
  assert.equal((await db.query('select stock from products where id=$1',[productId])).rows[0].stock, 5, 'el borrador no modifica stock');
  const received = (await db.query('select inventory_purchase($1,$2::uuid,$3::jsonb) result', ['receive',id(103),'{}'])).rows[0].result;
  assert.equal(received.operation.status, 'recibida');
  assert.equal((await db.query('select stock from products where id=$1',[productId])).rows[0].stock, 12);
  assert.deepEqual((await db.query('select inventory_purchase($1,$2::uuid,$3::jsonb) result', ['receive',id(103),'{}'])).rows[0].result, received);
  assert.equal((await db.query("select count(*)::int count from inventory_movements where reason like 'Recepción CMP-%'")).rows[0].count, 1);

  const canceledPurchaseId = id(110);
  const canceledPurchaseData = { ...purchaseData, lines:[{id:id(111),reversal_id:id(112),product_id:productId,quantity:2,unit_cost:30}] };
  await db.query('select inventory_purchase($1,$2::uuid,$3::jsonb)', ['create',canceledPurchaseId,JSON.stringify(canceledPurchaseData)]);
  await db.query('select inventory_purchase($1,$2::uuid,$3::jsonb)', ['cancel',canceledPurchaseId,'{}']);
  assert.equal((await db.query('select stock from products where id=$1',[productId])).rows[0].stock, 12, 'cancelar una compra pendiente no toca el stock');

  const saleId = id(104), lineId = id(105), reversalId = id(106);
  const saleData = { customer:'Cliente de prueba', date:'2026-10-27', reference:'BOL-1', lines:[{id:lineId,reversal_id:reversalId,product_id:productId,quantity:3,unit_price:75}] };
  await db.query('select inventory_sale_order($1,$2::uuid,$3::jsonb)', ['create',saleId,JSON.stringify(saleData)]);
  assert.equal((await db.query('select stock from products where id=$1',[productId])).rows[0].stock, 12, 'el borrador de venta no modifica stock');
  const confirmed = (await db.query('select inventory_sale_order($1,$2::uuid,$3::jsonb) result', ['confirm',saleId,'{}'])).rows[0].result;
  assert.equal(confirmed.operation.status, 'confirmada');
  assert.equal((await db.query('select stock from products where id=$1',[productId])).rows[0].stock, 9);
  assert.deepEqual((await db.query('select inventory_sale_order($1,$2::uuid,$3::jsonb) result', ['confirm',saleId,'{}'])).rows[0].result, confirmed);
  assert.equal((await db.query('select sale_order_id from inventory_sales where id=$1',[lineId])).rows[0].sale_order_id, saleId);
  const canceled = (await db.query('select inventory_sale_order($1,$2::uuid,$3::jsonb) result', ['cancel',saleId,'{}'])).rows[0].result;
  assert.equal(canceled.operation.status, 'cancelada');
  assert.equal((await db.query('select stock from products where id=$1',[productId])).rows[0].stock, 12);
  assert.ok((await db.query('select cancelled_at from inventory_sales where id=$1',[lineId])).rows[0].cancelled_at);
  await db.query('select inventory_sale_order($1,$2::uuid,$3::jsonb)', ['cancel',saleId,'{}']);
  assert.equal((await db.query("select count(*)::int count from inventory_movements where reason like 'Reversión venta %'")).rows[0].count, 1);

  const secondProduct = (await db.query(`select (inventory_mutate($1,'add',null,null,$2::jsonb)->'product') result`, [id(113), JSON.stringify({ name:'Teclado', sku:'K-02', category:'Periféricos', stock:2, min_stock:1, price:100 })])).rows[0].result;
  const atomicSaleId = id(114);
  const atomicSaleData = { lines:[
    {id:id(115),reversal_id:id(116),product_id:productId,quantity:1,unit_price:50},
    {id:id(117),reversal_id:id(118),product_id:secondProduct.id,quantity:3,unit_price:60},
  ] };
  await db.query('select inventory_sale_order($1,$2::uuid,$3::jsonb)', ['create',atomicSaleId,JSON.stringify(atomicSaleData)]);
  await assert.rejects(db.query('select inventory_sale_order($1,$2::uuid,$3::jsonb)', ['confirm',atomicSaleId,'{}']), /INVENTORY_NEGATIVE_STOCK/);
  assert.equal((await db.query('select stock from products where id=$1',[productId])).rows[0].stock, 12, 'la falla de una línea revierte las líneas previas');
  assert.equal((await db.query('select stock from products where id=$1',[secondProduct.id])).rows[0].stock, 2);
  const lowSaleId = id(107), lowLineId = id(108);
  const overData = { lines:[{id:lowLineId,reversal_id:id(109),product_id:productId,quantity:99,unit_price:1}] };
  await db.query('select inventory_sale_order($1,$2::uuid,$3::jsonb)', ['create',lowSaleId,JSON.stringify(overData)]);
  await assert.rejects(db.query('select inventory_sale_order($1,$2::uuid,$3::jsonb)', ['confirm',lowSaleId,'{}']), /INVENTORY_NEGATIVE_STOCK/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", ['00000000-0000-4000-8000-000000009999']);
  assert.equal((await db.query('select inventory_commerce_enabled() enabled')).rows[0].enabled, false);
  assert.equal((await db.query('select count(*)::int count from inventory_purchases')).rows[0].count, 0);
  assert.equal((await db.query('select count(*)::int count from inventory_sale_orders')).rows[0].count, 0);
  assert.equal((await db.query('select count(id)::int count from inventory_sales')).rows[0].count, 0);
  await assert.rejects(db.query('select inventory_purchase($1,$2::uuid,$3::jsonb)', ['receive',id(103),'{}']), /INVENTORY_FORBIDDEN/);
  await assert.rejects(db.query('select inventory_sale_order($1,$2::uuid,$3::jsonb)', ['confirm',saleId,'{}']), /INVENTORY_FORBIDDEN/);
  await assert.rejects(db.exec(`insert into inventory_purchases(id,code,supplier_name,purchase_date,status,total,actor_id,actor_email,request_data) values ('${id(119)}','NO','x',current_date,'pendiente',0,'00000000-0000-4000-8000-000000000001','x','{}')`), /permission denied/);
  await db.exec('reset role');
  const { rows: unsafeGrants } = await db.query(`select role_name, table_name
    from unnest(array['anon','authenticated']) as role_name
    cross join unnest(array['inventory_sales','inventory_suppliers','inventory_purchases',
      'inventory_purchase_lines','inventory_sale_orders','inventory_sale_lines']) as table_name
    where has_table_privilege(role_name,'public.'||table_name,'DELETE,TRUNCATE,TRIGGER')
      or has_any_column_privilege(role_name,'public.'||table_name,'INSERT,UPDATE')`);
  assert.deepEqual(unsafeGrants, []);
  await db.exec('set role anon');
  await assert.rejects(db.query('select id from inventory_purchases'), { code: '42501' });
  await assert.rejects(db.query('select inventory_commerce_enabled()'), { code: '42501' });
  await db.exec('reset role');
  assert.equal((await db.query('select stock from products where id=$1',[productId])).rows[0].stock, 12, 'venta insuficiente revierte la transacción');
});
