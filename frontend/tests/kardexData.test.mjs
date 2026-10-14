import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKardex, kardexProducts, kardexPage, kardexCsv, compareMovements } from '../src/modules/inventario/pages/kardexData.js';

const product = { id: 1, name: 'Mouse actual', sku: 'NUEVO', stock: 14 };
const row = (id, type, before, after, day, extra = {}) => ({ id, productId: 1, product: 'Mouse', sku: 'ANTIGUO',
  type, before, after, quantity: 999, date: `2026-10-${day}T15:00:00Z`, reason: 'Motivo', user: 'operador@example.test', ...extra });
const history = [row(1,'Alta',0,10,'01'), row(2,'Entrada',10,15,'02'), row(3,'Venta',15,12,'03',{saleId:'venta-1'}),
  row(4,'Ajuste',12,12,'04'), row(5,'Ajuste',12,16,'05'), row(6,'Ajuste',16,14,'06')];
const choice = (p = product, rows = history) => kardexProducts([p], rows).find(item => item.key === String(p.id));

test('alta, entrada, venta y ajustes usan snapshots sin sumar ediciones ni duplicar ventas', () => {
  const frozen = structuredClone(history), result = buildKardex(choice(), [...history].reverse());
  assert.deepEqual([result.opening,result.entries,result.exits,result.closing],[0,19,5,14]);
  assert.equal(result.warnings.length,0);
  assert.deepEqual(result.rows.map(r=>r.id),[1,2,3,5,6]);
  assert.equal(result.rows.find(r=>r.id===3).exit,3);
  assert.match(result.rows.find(r=>r.id===3).reference,/Venta venta-1/);
  assert.deepEqual(history,frozen);
});

test('saldo inicial usa historia previa; filtros de tipo/auditoría no alteran tarjetas', () => {
  const filters={from:'2026-10-03',to:'2026-10-05',type:'Ajuste',audit:true};
  const result=buildKardex(choice(),history,filters);
  assert.deepEqual([result.opening,result.entries,result.exits,result.closing],[15,4,3,16]);
  assert.deepEqual(result.rows.map(r=>r.id),[4,5]);
  const noAudit=buildKardex(choice(),history,{...filters,audit:false});
  assert.deepEqual(noAudit.rows.map(r=>r.id),[5]);
  assert.equal(noAudit.opening+noAudit.entries-noAudit.exits,noAudit.closing);
});

test('fechas inclusivas de Lima, medianoche UTC y períodos sin movimientos', () => {
  const rows=[row(1,'Alta',0,4,'01',{date:'2026-10-02T04:59:59Z'}),row(2,'Entrada',4,6,'02',{date:'2026-10-02T05:00:00Z'})];
  const p=choice({...product,stock:6},rows);
  const result=buildKardex(p,rows,{from:'2026-10-02',to:'2026-10-02'});
  assert.deepEqual([result.opening,result.entries,result.closing,result.rows.length],[4,2,6,1]);
  const empty=buildKardex(p,rows,{from:'2026-10-03',to:'2026-10-04'});
  assert.deepEqual([empty.opening,empty.closing,empty.entries],[6,6,0]);
  assert.equal(buildKardex(p,rows,{to:'2026-09-30'}).closing,0);
});

test('empates de fecha se ordenan por ID bigint; relecturas no duplican cantidades', () => {
  const rows=[row('9007199254740994','Entrada',1,2,'01'),row('9007199254740993','Alta',0,1,'01')];
  assert(compareMovements(rows[0],rows[1])>0);
  const result=buildKardex(choice({...product,stock:2},rows),[...rows,rows[0]]);
  assert.equal(result.entries,2);
  assert.deepEqual(result.rows.map(r=>r.id),['9007199254740993','9007199254740994']);
});

test('ID conserva cambios de SKU y separa SKU reutilizado y productos eliminados', () => {
  const rows=[...history,row(9,'Alta',0,3,'07',{productId:2,sku:'ANTIGUO',product:'Otro mouse'})];
  const options=kardexProducts([product],rows), current=options.find(p=>p.key==='1');
  assert(current.search.includes('antiguo')); assert(current.search.includes('nuevo'));
  assert.equal(buildKardex(current,rows).entries,19);
  const archived=options.find(p=>p.key==='2');
  assert.equal(archived.archived,true); assert.equal(archived.stock,null);
  assert.equal(buildKardex(archived,rows).closing,null);
  const withDeletion=[...rows,row(10,'Baja',3,0,'08',{productId:2,sku:'ANTIGUO'})];
  assert.equal(buildKardex(archived,withDeletion).closing,0);
});

test('historial antiguo sin alta o sin movimientos no inventa saldos de origen', () => {
  const rows=[row(2,'Entrada',7,14,'05')], p=choice(product,rows), result=buildKardex(p,rows);
  assert.equal(result.opening,null); assert.equal(result.closing,14); assert.equal(result.entries,7);
  assert(result.warnings.some(w=>w.includes('alta inicial')));
  assert.equal(buildKardex(p,rows,{to:'2026-10-04'}).closing,null);
  const none=buildKardex(choice(product,[]),[]);
  assert.equal(none.opening,null); assert.equal(none.closing,null);
  assert(none.warnings.some(w=>w.includes('no tiene movimientos')));
});

test('gaps y stock actual divergente generan advertencias, sin fabricar operaciones', () => {
  const rows=[row(1,'Alta',0,10,'01'),row(2,'Entrada',13,14,'05')];
  const result=buildKardex(choice(product,rows),rows,{from:'2026-10-03',to:'2026-10-05'});
  assert.deepEqual([result.opening,result.closing,result.entries,result.rows.length],[null,null,1,1]);
  assert(result.warnings.some(w=>w.includes('discontinuidad')));
  const p=choice({...product,stock:99});
  assert.equal(buildKardex(p,history).closing,null);
  assert.equal(buildKardex(p,history,{to:'2026-10-03'}).closing,12);
});

test('registros sin ID se consultan aparte, sin certificar saldos por coincidencia de SKU', () => {
  const rows=[row(1,'Entrada',10,14,'01',{productId:null,sku:'NUEVO'})], options=kardexProducts([product],rows);
  const current=buildKardex(options.find(p=>p.key==='1'),rows), legacy=buildKardex(options.find(p=>p.legacy),rows);
  assert.equal(current.rows.length,0); assert.equal(current.opening,null);
  assert.equal(legacy.rows.length,1); assert.equal(legacy.closing,null);
  assert(legacy.warnings.some(w=>w.includes('sin ID')));
  const oldSku=[...history,row(8,'Entrada',0,1,'01',{productId:null})];
  assert.equal(buildKardex(choice(product,oldSku),oldSku).closing,null);
});

test('fechas inválidas, snapshots dañados y duplicados contradictorios no dan saldos falsos', () => {
  for (const filters of [{from:'2026-02-30'},{from:'x'},{from:'2026-10-06',to:'2026-10-01'}]) assert(buildKardex(choice(),history,filters).error);
  for (const patch of [{before:null},{after:-1},{date:'inválida'},{before:1.5}]) {
    const rows=[...history,{...history[0],id:9,...patch}], result=buildKardex(choice(product,rows),rows);
    assert.equal(result.closing,null); assert.equal(result.entries,null);
  }
  const conflict=buildKardex(choice(),[...history,{...history[1],after:99}]);
  assert.equal(conflict.closing,null); assert(conflict.warnings.some(w=>w.includes('versiones diferentes')));
});

test('paginación y CSV usan todas las filas; CSV escapa fórmulas, saltos y comillas', () => {
  const rows=Array.from({length:61},(_,i)=>row(i+1,i===0?'Alta':'Entrada',i,i+1,'01',{
    reason:i===0?' =HYPERLINK("x")':'Texto; con "comillas"\ny salto',user:'@operador',sku:'NUEVO',
  }));
  const p=choice({...product,stock:61,name:'=Nombre'},rows), ledger=buildKardex(p,rows), page=kardexPage(ledger.rows,2);
  assert.deepEqual([page.pages,page.rows.length,page.rows[0].id,ledger.entries,ledger.closing],[3,25,26,61,61]);
  assert.equal(kardexPage(ledger.rows,999).page,3); assert.equal(kardexPage(ledger.rows,'abc').page,1);
  const csv=kardexCsv(p,ledger);
  assert(csv.startsWith('\uFEFF')); assert(csv.includes('Movimiento #61')); assert(csv.includes("'=Nombre"));
  assert(csv.includes("'@operador")); assert(csv.includes("' =HYPERLINK")); assert(csv.includes('""comillas""'));
  const filtered=buildKardex(choice(),history,{type:'Venta'}), salesCsv=kardexCsv(choice(),filtered,{type:'Venta'});
  assert(salesCsv.includes('Venta venta-1')); assert(!salesCsv.includes('Movimiento #1'));
});
