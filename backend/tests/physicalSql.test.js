import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { difference, summarizeCount } from '../../frontend/src/modules/inventario/pages/physicalData.js';

test('conteo cero, pendiente y diferencias', () => {
  const lines = [{ physical_quantity: null, reference_stock: 5 }, { physical_quantity: 0, reference_stock: 5 }, { physical_quantity: 8, reference_stock: 5 }, { physical_quantity: 5, reference_stock: 5 }];
  assert.deepEqual(lines.map(difference), [null,-5,3,0]);
  assert.deepEqual(summarizeCount(lines), { counted: 3, pending: 1, differences: 2 });
});
test('Fase 5 aislada: persistencia, permisos, conflictos, idempotencia y rollback', async t => {
 const db = new PGlite(); t.after(() => db.close());
 for (const file of ['./fixtures/catalogDatabase.sql','../../supabase/sql/20261013_catalog_products.proposed.sql','../../supabase/sql/20261014_stock_movements.proposed.sql']) await db.exec(await readFile(new URL(file,import.meta.url),'utf8'));
 const proposal=await readFile(new URL('../../supabase/sql/20261014_physical_inventory.proposed.sql',import.meta.url),'utf8');
 // Ejecutar solamente el preflight de la propuesta en transacciones locales.
 const preflight=proposal.slice(0,proposal.indexOf('CREATE TABLE public.inventory_counts'));
 await t.test('preflight detecta dependencias y privilegios alterados',async () => {
  for (const change of [
   'alter table products rename column version to missing_version',
   'grant update(stock) on products to authenticated',
   'grant select(stock) on products to anon',
   'revoke execute on function inventory_register_stock(uuid,bigint,bigint,text,integer,text) from authenticated',
   'drop function inventory_write_enabled()',
   'alter function inventory_register_stock(uuid,bigint,bigint,text,integer,text) security invoker',
  ]) {
   await db.exec('begin'); await db.exec(change);
   await assert.rejects(db.exec(preflight),/PHYSICAL_(SCHEMA|PERMISSION)_DRIFT/);
   await db.exec('rollback');
  }
 });
 await db.exec(proposal);
 const actor='00000000-0000-4000-8000-000000000001';
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
 let n=900; const id=()=>`00000000-0000-4000-8000-${String(n++).padStart(12,'0')}`;
 for (const sku of ['COUNT1','COUNT2']) await db.query("select inventory_mutate($1,'add',null,null,$2::jsonb)",[id(),JSON.stringify({sku,name:sku,category:'Periféricos',stock:5,price:10,min_stock:1})]);
 const call=async(action,sid,revision=null,data={})=>(await db.query('select inventory_physical($1,$2,$3,$4::jsonb) result',[action,sid,revision,JSON.stringify(data)])).rows[0].result;
 await db.exec('set role authenticated');
 let sid=id(); let count=await call('create',sid); const initial=count;
 assert.deepEqual(await call('create',sid),count);
 assert.ok(count.lines.every(l=>l.physical_quantity===null));
 await t.test('validación estricta y rollback de lotes inválidos', async () => {
  const line={productId:count.lines[0].product_id,quantity:0,reason:'Verificado'};
  for (const quantity of [-1,1.5,2147483648,'0',true,{},[]]) {
   await assert.rejects(call('save',sid,1,{lines:[{...line,quantity}]}));
  }
  for (const invalid of [
   {productId:line.productId}, {...line,productId:0}, {...line,productId:-1},
   {...line,productId:1.5}, {...line,productId:'1'}, {...line,productId:9007199254740992},
   {...line,productId:999999}, {...line,reason:'x'.repeat(401)}, {...line,reason:null},
   {...line,reason:123}, null,
  ]) await assert.rejects(call('save',sid,1,{lines:[line,invalid]}));
  await assert.rejects(call('save',sid,1,{lines:[line,line]}),/INVENTORY_INVALID_INPUT/);
  for (const data of [null,[],{lines:null},{lines:[]},{lines:{}},'invalid']) await assert.rejects(call('save',sid,1,data));
  for (const observation of [null,123,{},'x'.repeat(501)]) await assert.rejects(call('create',id(),null,{observation}));
  await assert.rejects(call('create','00000000-0000-0000-0000-000000000000'),/INVENTORY_INVALID_INPUT/);
  assert.deepEqual(await call('get',sid),initial);
  await assert.rejects(call('reopen',sid,1),/PHYSICAL_REVIEW_REQUIRED/);
  // El máximo int32 se conserva sin redondeos; transacción local desechada.
  await db.exec('begin');
  const max=await call('save',sid,1,{lines:[{...line,quantity:2147483647}]});
  assert.equal(max.lines[0].physical_quantity,2147483647);
  await db.exec('rollback');
  await db.exec('begin');
  const blanks=await call('save',sid,1,{lines:count.lines.map(l=>({productId:l.product_id,quantity:0,reason:' \t\n'}))});
  await assert.rejects(call('review',sid,blanks.session.revision),/PHYSICAL_INCOMPLETE/);
  await db.exec('rollback');
 });
 await t.test('historial compartido entre miembros, escritura exclusiva del responsable', async () => {
  const other='00000000-0000-4000-8000-000000000002';
  await db.exec('reset role');
  await db.query('insert into auth.users values($1,$2)',[other,'otro@example.test']);
  await db.query('insert into inventory_members values($1)',[other]);
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
  assert.deepEqual(await call('get',sid),initial);
  assert.equal((await db.query('select * from inventory_counts')).rows.length,1);
  for (const action of ['save','review','reopen','rebase','confirm','cancel'])
   await assert.rejects(call(action,sid,1,{lines:[]}),/INVENTORY_FORBIDDEN/);
  await assert.rejects(call('create',sid),/INVENTORY_REQUEST_CONFLICT/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
 });
 await assert.rejects(call('review',sid,1),/PHYSICAL_INCOMPLETE/);
 const payload={lines:count.lines.map((l,i)=>({productId:l.product_id,quantity:0,reason:i===0?'x'.repeat(400):'Faltante verificado'}))};
 count=await call('save',sid,1,payload);
 assert.ok(count.lines.every(l=>l.physical_quantity===0));
 assert.deepEqual(await call('get',sid),count);
 await assert.rejects(call('save',sid,1,payload),/PHYSICAL_STALE_REVISION/);
 count=await call('review',sid,count.session.revision);
 const product=count.lines[0];
 await db.exec('begin; reset role');
 await db.query('delete from products where id=$1',[product.product_id]);
 await db.exec('set local role authenticated');
 await assert.rejects(call('confirm',sid,count.session.revision),/PHYSICAL_PRODUCT_REMOVED/);
 await db.exec('rollback');
 await db.query("select inventory_register_stock($1,$2,$3,'stock_in',1,'Compra')",[id(),product.product_id,product.reference_version]);
 const conflict=await call('confirm',sid,count.session.revision);
 assert.equal(conflict.conflicts.length,1);
 assert.equal((await call('get',sid)).session.status,'en revisión');
 count=await call('rebase',sid,count.session.revision);
 assert.equal(count.lines.find(l=>l.product_id===product.product_id).physical_quantity,null);
 count=await call('save',sid,count.session.revision,payload);
 count=await call('review',sid,count.session.revision);
 // Fallar en el segundo movimiento comprueba rollback del primer ajuste.
 await db.exec('reset role');
 await db.exec(`create function reject_count_test() returns trigger language plpgsql as $$ begin if new.product_id=${count.lines[1].product_id} then raise exception 'partial failure'; end if; return new; end $$; create trigger reject_count before insert on inventory_movements for each row execute function reject_count_test();`);
 const before=(await db.query('select id,stock,version from products order by id')).rows;
 const history=(await db.query('select count(*) n from inventory_movements')).rows[0].n;
 await db.exec('set role authenticated');
 await assert.rejects(call('confirm',sid,count.session.revision),/partial failure/);
 assert.equal((await call('get',sid)).session.status,'en revisión');
 assert.deepEqual((await db.query('select id,stock,version from products order by id')).rows,before);
 await db.exec('reset role; drop trigger reject_count on inventory_movements; set role authenticated');
 const done=await call('confirm',sid,count.session.revision);
 assert.equal(done.session.status,'finalizado');
 assert.deepEqual(await call('confirm',sid,count.session.revision),done);
 assert.equal(Number((await db.query('select count(*) n from inventory_movements')).rows[0].n),Number(history)+count.lines.length);
 for (const line of count.lines) {
  const movement=(await db.query('select * from inventory_movements where request_id=$1',[line.movement_request])).rows[0];
  assert.equal(movement.actor_id,actor);
  assert.equal(movement.actor_email,'operador@example.test');
  assert.equal(movement.type,'Ajuste');
  assert.equal(movement.stock_before,line.reference_stock);
  assert.equal(movement.stock_after,line.physical_quantity);
  assert.equal(movement.quantity,line.physical_quantity-line.reference_stock);
  assert.ok(movement.reason.includes(sid));
 }
 await assert.rejects(call('save',sid,done.session.revision,payload),/PHYSICAL_IMMUTABLE/);
 await assert.rejects(db.exec('update inventory_count_lines set physical_quantity=99'),/permission denied/);
 // Finalización sin diferencias.
 sid=id(); count=await call('create',sid);
 count=await call('save',sid,1,{lines:count.lines.map(l=>({productId:l.product_id,quantity:l.reference_stock}))});
 count=await call('review',sid,count.session.revision);
 assert.equal((await call('confirm',sid,count.session.revision)).session.status,'finalizado');
 await t.test('sesiones superpuestas, reintento y cancelación',async () => {
  const ready=[];
  for (let i=0;i<2;i++) {
   let c=await call('create',id());
   c=await call('save',c.session.id,c.session.revision,{lines:c.lines.map(l=>({productId:l.product_id,quantity:1,reason:'Sobrante'}))});
   ready.push(await call('review',c.session.id,c.session.revision));
  }
  const first=ready[0]; const second=ready[1];
  const [a,b]=await Promise.all([call('confirm',first.session.id,first.session.revision),call('confirm',first.session.id,first.session.revision)]);
  assert.deepEqual(a,b);
  assert.equal(a.session.status,'finalizado');
  assert.equal((await call('confirm',second.session.id,second.session.revision)).conflicts.length,second.lines.length);
  const canceled=await call('cancel',second.session.id,second.session.revision);
  assert.equal(canceled.session.status,'cancelado');
  for (const action of ['save','review','reopen','rebase','confirm']) await assert.rejects(call(action,second.session.id,canceled.session.revision),/PHYSICAL_IMMUTABLE/);
 });
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",['00000000-0000-4000-8000-999999999999']);
 await assert.rejects(call('get',initial.session.id),/INVENTORY_FORBIDDEN/);
 assert.equal((await db.query('select * from inventory_counts')).rows.length,0);
 await db.exec('reset role; set role anon');
 await assert.rejects(call('create',id()),/permission denied/);
 await assert.rejects(db.exec('select * from inventory_counts'),/permission denied/);
 await db.exec('reset role');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
 await t.test('catálogo vacío no crea sesiones y lectura no exige escritura',async () => {
  await db.exec('begin; delete from products; set local role authenticated');
  await assert.rejects(call('create',id()),/PHYSICAL_EMPTY/);
  await db.exec('rollback');
  await db.exec("begin; create or replace function inventory_write_enabled() returns boolean language sql as 'select false'; set local role authenticated");
  assert.equal((await call('get',initial.session.id)).session.status,'finalizado');
  await assert.rejects(call('create',id()),/INVENTORY_FORBIDDEN/);
  await db.exec('rollback');
 });
});

// Contrato HTTP con cliente simulado; nunca conecta a Supabase.
test('API Fase 5: migracion ausente, permisos y respuestas inciertas no simulan guardado', async () => {
 const { createInventoryController } = await import('../src/modules/inventory/inventoryController.js');
 const { Readable } = await import('node:stream');
 const controller = createInventoryController({});
 const id='00000000-0000-4000-8000-000000000001';
 let response; let sent=false; let args;
 const client={ rpc: async (...values)=>{ args=values; return response; } };
 const invoke=async(body)=>{
  const req=Readable.from([JSON.stringify(body)]); req.headers={'content-type':'application/json'};
  return controller.physical({req,session:{client},send:()=>{sent=true;}});
 };
 response={error:{code:'PGRST202'}};
 await assert.rejects(invoke({action:'create',id}),e=>e.status===409 && /base de datos/.test(e.message));
 assert.equal(sent,false);
 response={error:{code:'42501'}};
 await assert.rejects(invoke({action:'save',id,revision:1}),e=>e.status===403);
 response={error:{message:'network error'}};
 await assert.rejects(invoke({action:'confirm',id,revision:2}),e=>e.status===503 && e.uncertain);
 response={data:{session:{id,status:'finalizado'},lines:[]}};
 await invoke({action:'confirm',id,revision:2,user:'forged',stock:999});
 assert.deepEqual(args,['inventory_physical',{p_action:'confirm',p_id:id,p_revision:2,p_data:{}}]);
 assert.equal(sent,true);
 await assert.rejects(invoke({action:'erase',id}),e=>e.status===400);
 for (const revision of [0,-1,1.5,2147483648,'1']) await assert.rejects(invoke({action:'save',id,revision}),e=>e.status===400);
 for (const data of [[],123,'invalid']) await assert.rejects(invoke({action:'save',id,revision:1,data}),e=>e.status===400);
 response={error:{message:'PHYSICAL_EMPTY',code:'P0001'}};
 await assert.rejects(invoke({action:'create',id}),e=>e.status===409 && !e.uncertain);
 for (const code of ['40001','40P01','55P03','57014']) {
  response={error:{code}};
  await assert.rejects(invoke({action:'confirm',id,revision:2}),e=>e.status===409 && !e.uncertain);
 }
});
