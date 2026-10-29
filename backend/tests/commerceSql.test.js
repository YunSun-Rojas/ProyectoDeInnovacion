import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('compras y ventas: borradores, recepción, confirmación, reversión e idempotencia', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(await readFile(new URL('./fixtures/catalogDatabase.sql', import.meta.url), 'utf8'));
  // El fixture representa el esquema histórico, incluidas ventas. Elimina esas
  // copias únicamente en este PGlite efímero para probar el SQL que las crea.
  await db.exec(`drop function public.inventory_register_sale(uuid,bigint,bigint,integer,numeric);
    drop function public.inventory_sales_enabled();
    drop table public.inventory_sales cascade;`);
  for (const file of ['./sql/ventas.sql','./sql/20261013_catalog_products.proposed.sql','./sql/20261014_stock_movements.proposed.sql','./sql/20261027_commerce.proposed.sql']) {
    await db.exec(await readFile(new URL(file, import.meta.url), 'utf8'));
  }
  const actor = '00000000-0000-4000-8000-000000000001';
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
  const id = number => `00000000-0000-4000-8000-${String(number).padStart(12,'0')}`;
  const product = (await db.query(`select (inventory_mutate($1,'add',null,null,$2::jsonb)->'product') result`, [id(100), JSON.stringify({ name:'Mouse', sku:'M-01', category:'Periféricos', stock:5, min_stock:2, price:80, purchase_cost:40 })])).rows[0].result;
  const productId = product.id;
  await db.exec('set role authenticated');
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
  await assert.rejects(db.query('select inventory_purchase($1,$2::uuid,$3::jsonb)', ['receive',id(103),'{}']), /INVENTORY_FORBIDDEN/);
  await assert.rejects(db.query('select inventory_sale_order($1,$2::uuid,$3::jsonb)', ['confirm',saleId,'{}']), /INVENTORY_FORBIDDEN/);
  await assert.rejects(db.exec(`insert into inventory_purchases(id,code,supplier_name,purchase_date,status,total,actor_id,actor_email,request_data) values ('${id(119)}','NO','x',current_date,'pendiente',0,'00000000-0000-4000-8000-000000000001','x','{}')`), /permission denied/);
  await db.exec('reset role');
  assert.equal((await db.query('select stock from products where id=$1',[productId])).rows[0].stock, 12, 'venta insuficiente revierte la transacción');
});
