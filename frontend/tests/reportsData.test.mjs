import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReports, periodBucket, validatePeriod, reportsCsv, searchReport, reportPage } from '../src/modules/inventario/pages/reportsData.js';

const product=(id,stock=5,purchaseCost=2)=>({id,sku:`S${id}`,name:`Producto ${id}`,stock,purchaseCost,price:999});
const movement=(id,date,before,after,type='Entrada',productId=1)=>({id,date,before,after,type,productId,sku:`S${productId}`,product:`Producto ${productId}`});
const empty={products:[],movements:[],physical:{enabled:true,sessions:[],lines:[]}};
const range={from:'2026-10-01',to:'2026-10-31'};

test('reportes: fechas inclusivas Lima, calendario, semana y mes',()=>{
  const data={...empty,movements:[movement(1,'2026-10-01T04:59:59Z',0,2),movement(2,'2026-10-01T05:00:00Z',2,5),movement(3,'2026-11-01T04:59:59Z',5,6),movement(4,'2026-11-01T05:00:00Z',6,10)]};
  const report=buildReports(data,range);
  assert.equal(report.entries,4);assert.equal(report.movements.length,2);
  assert.ok(validatePeriod('2026-02-30','2026-03-01'));
  assert.ok(validatePeriod('2026-11-01','2026-10-01'));
  assert.throws(()=>buildReports(data,{from:'bad'}));
  assert.equal(periodBucket('2026-10-04','week'),'2026-09-28');
  assert.equal(periodBucket('2026-10-05','week'),'2026-10-05');
  assert.equal(periodBucket('2026-10-14','month'),'2026-10-01');
  assert.equal(buildReports(data,{...range,group:'month'}).series.length,1);
});
test('reportes: unidades, neto, operaciones y ajustes excluidos del ranking',()=>{
  const date='2026-10-02T12:00:00Z';
  const movements=[movement(1,date,0,20,'Alta'),movement(2,date,20,17,'Venta'),movement(3,date,17,13,'Salida'),movement(4,date,13,0,'Ajuste'),movement(5,date,4,0,'Baja'),movement(6,date,0,0,'Ajuste')];
  const r=buildReports({...empty,movements:[...movements,movements[1]]},range);
  assert.equal(r.entries,20);assert.equal(r.exits,24);assert.equal(r.net,-4);assert.equal(r.series[0].operations,6);
  assert.equal(r.ranking[0].units,7);assert.equal(r.ranking[0].operations,2);
  assert.equal(r.zeroTransitions,1);
  assert.throws(()=>buildReports({...empty,movements:[movements[0],{...movements[0],after:21}]}),/contradictorios/);
  assert.throws(()=>buildReports({...empty,movements:[{...movements[0],saleId:'sale'},{...movements[1],saleId:'sale'}]}),/varios movimientos/);
});
test('reportes: catálogo sin movimiento, último registro global e identidad antigua',()=>{
  const r=buildReports({...empty,products:[product(1),product(2),product(3),product(4)],movements:[movement(1,'2026-09-01T12:00:00Z',0,5,'Alta'),movement(2,'2026-10-02T12:00:00Z',5,5,'Ajuste',2),{...movement(3,'2026-09-01T12:00:00Z',1,0,'Salida',null),sku:'S4'}]},range);
  assert.deepEqual(r.inactive.map(p=>p.id),[1,3,4]);
  assert.equal(r.inactive[0].inactivity,'Sin movimiento en el periodo');assert.ok(r.inactive[0].last);
  assert.equal(r.inactive[1].inactivity,'Sin movimientos registrados');
  assert.match(r.inactive[2].inactivity,/no verificable/);
});
test('reportes: valor a costo, cobertura parcial, cero y costos inválidos',()=>{
  const products=[product(1,3,1.25),product(2,1,null),product(3,5,-1),product(4,1,NaN),product(5,1,'2'),product(6,2,0),product(7,1,1.234)];
  const r=buildReports({...empty,products});
  assert.equal(r.value,3.75);assert.equal(r.covered,2);assert.equal(r.total,7);
  assert.equal(buildReports({...empty,products:[product(1,0,null)]}).value,null);
  assert.equal(buildReports({...empty,products:[product(1,0,0)]}).value,0);
  assert.equal(buildReports({...empty,products:[product(1)],movements:[]}).empty,0);
  assert.equal(buildReports({...empty,products:[product(1,0)]}).empty,1);
});
test('reportes: precisión, estados de sesiones, diferencias y líneas pendientes',()=>{
  const sessions=['borrador','en revisión','finalizado','cancelado'].map((status,i)=>({id:`c${i}`,status,created_at:'2026-10-02T12:00:00Z'}));
  const line=(session_id,product_id,physical_quantity,reference_stock=5)=>({session_id,product_id,physical_quantity,reference_stock});
  const lines=[line('c0',1,5),line('c0',2,null),line('c1',1,2),line('c2',1,8),line('c3',1,5)];
  const r=buildReports({...empty,physical:{enabled:true,sessions,lines:[...lines,lines[0]]}},range);
  assert.equal(r.counted,3);assert.equal(r.matched,1);assert.ok(Math.abs(r.accuracy-100/3)<0.00001);
  assert.equal(r.differences.length,2);assert.equal(r.countSessions[0].pending,1);
  assert.equal(r.countSessions[1].shortage,3);assert.equal(r.countSessions[2].surplus,3);
  assert.equal(buildReports(empty).accuracy,null);
  assert.equal(searchReport(r.differences,'c2').length,1);
  assert.equal(buildReports({...empty,physical:{sessions:[sessions[0]],lines:[line('c0',1,5)]}}).accuracy,100);
  assert.equal(buildReports({...empty,physical:{sessions,lines}},{from:'2026-11-01'}).countSessions.length,0);
});
test('reportes: gran volumen, Top 5/10/20, filtros y paginación sin truncar CSV',()=>{
  const data={...empty,products:Array.from({length:1205},(_,i)=>product(i+1)),movements:Array.from({length:30},(_,i)=>movement(i+1,'2026-10-02T12:00:00Z',30,0,'Salida',i+1))};
  for(const top of [5,10,20])assert.equal(buildReports(data,{...range,top}).ranking.length,top);
  const r=buildReports(data,range);
  assert.equal(r.inactive.length,1175);
  const filtered=searchReport(r.inactive,'s1205');assert.equal(filtered.length,1);
  assert.equal(reportPage(r.inactive,48,25).rows.length,25); // Página solicitada limitada al final disponible.
  const csv=reportsCsv('Sin movimiento',['SKU'],r.inactive.map(p=>[p.sku]));
  assert.ok(csv.includes('S1205'));
});
test('reportes: CSV seguro con comillas, separadores, saltos, fórmulas y negativos numéricos',()=>{
  const csv=reportsCsv('Reporte',['Producto','Cantidad'],[['=SUM(1,2)',-3],[' \t@evil',2],['A;"B"\nC',null]]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=SUM(1,2)";"-3"'));
  assert.ok(csv.includes('"\' \t@evil"'));
  assert.ok(csv.includes('"A;""B""\nC"'));
  assert.ok(csv.includes('No disponible'));
  assert.ok(reportsCsv('Reporte',['Nombre'],[['\u0000=1+1']]).includes("'\u0000=1+1"));
});

test('reportes: pantalla independiente y exportación bloqueada mientras carga',async()=>{
  const [{build},{default:react},{createElement:h},{renderToStaticMarkup},{fileURLToPath}]=await Promise.all([
    import('vite'),import('@vitejs/plugin-react'),import('react'),import('react-dom/server'),import('node:url')]);
  await build({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),plugins:[react()],logLevel:'error',
    build:{ssr:fileURLToPath(new URL('../src/modules/inventario/pages/Reportes.jsx',import.meta.url)),outDir:fileURLToPath(new URL('../dist/reports-ssr',import.meta.url)),emptyOutDir:false,
      rolldownOptions:{external:['react','react/jsx-runtime','react/jsx-dev-runtime','lucide-react','recharts'],output:{entryFileNames:'reports.mjs'}}}});
  const {default:Reportes}=await import('../dist/reports-ssr/reports.mjs');
  const html=renderToStaticMarkup(h(Reportes));
  assert.ok(html.includes('Reportes e indicadores'));
  assert.ok(html.includes('Consultando el historial completo autorizado'));
  assert.match(html,/<button[^>]*disabled=""[^>]*>[\s\S]*?Exportar CSV/);
  assert.ok(!html.includes('Registrar movimiento'));
});
