import test from 'node:test';
import assert from 'node:assert/strict';
import { readReportCounts } from '../src/modules/inventory/inventoryRepository.js';
import { createInventoryController } from '../src/modules/inventory/inventoryController.js';
import { createInventoryRoutes } from '../src/modules/inventory/inventoryRoutes.js';

function client({member={data:{user_id:'actor'}},failure,rows=1203}={}) {
  const calls=[];
  return {calls,from(table){
    calls.push(['from',table]);
    const query={select(){return query;},eq(key,value){calls.push(['eq',key,value]);return query;},order(){return query;},
      maybeSingle(){return Promise.resolve(member);},
      range(start,end){
        calls.push(['range',table,start,end]);
        if(failure)return Promise.resolve(failure);
        const all=Array.from({length:rows},(_,i)=>table==='inventory_counts'?{id:`s${i}`,status:i%2?'finalizado':'borrador'}:{session_id:`s${i}`,product_id:i,physical_quantity:i===0?null:0,reference_stock:2});
        return Promise.resolve({data:all.slice(start,Math.min(end+1,start+200)),count:all.length});
      }};
    return query;
  }};
}
test('reportes: historial completo paginado, sesiones abiertas/finalizadas y solo lectura',async()=>{
  const db=client();const result=await readReportCounts(db,'actor');
  assert.equal(result.enabled,true);assert.equal(result.sessions.length,1203);assert.equal(result.lines.length,1203);
  assert.equal(result.lines[0].physical_quantity,null);
  assert.ok(result.sessions.some(s=>s.status==='finalizado'));
  assert.ok(db.calls.some(c=>c[0]==='eq'&&c[2]==='actor'));
  assert.ok(db.calls.filter(c=>c[0]==='from').every(c=>['inventory_members','inventory_counts','inventory_count_lines'].includes(c[1])));
  assert.ok(db.calls.filter(c=>c[0]==='range').length>10);
});
test('reportes: vacíos, migración ausente, red, permisos y respuesta incompleta',async()=>{
  assert.deepEqual(await readReportCounts(client({rows:0}),'actor'),{enabled:true,sessions:[],lines:[]});
  for(const code of ['42P01','PGRST205'])assert.equal((await readReportCounts(client({failure:{error:{code}}}),'actor')).enabled,false);
  for(const [code,status] of [['42501',403],['network',503]]){
    await assert.rejects(readReportCounts(client({failure:{error:{code}}}),'actor'),e=>e.status===status);
    await assert.rejects(readReportCounts(client({member:{error:{code}}}),'actor'),e=>e.status===status);
  }
  const denied=client({member:{data:null}});
  await assert.rejects(readReportCounts(denied,'actor'),e=>e.status===403);
  assert.equal(denied.calls.filter(c=>c[0]==='from').length,1);
  for(const failure of [{data:[],count:5},{data:null,count:0},{data:[]}])await assert.rejects(readReportCounts(client({failure}),'actor'),e=>e.status===503);
});
test('reportes: endpoint GET autenticado reutiliza la identidad de sesión',async()=>{
  const db={};let args;
  const controller=createInventoryController({loadReports:async(...values)=>{args=values;return {products:[],movements:[]};}});
  const route=createInventoryRoutes(controller).find(r=>r.path==='/api/inventory/reports');
  assert.equal(route.method,'GET');assert.notEqual(route.public,true);
  await route.handler({session:{client:db,user:{id:'actor'}},send:(status,body)=>{assert.equal(status,200);assert.deepEqual(body.products,[]);}});
  assert.deepEqual(args,[db,'actor']);
});
