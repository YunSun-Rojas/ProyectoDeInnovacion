import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { classifyStock, buildAlerts, filterAlerts } from '../src/modules/inventario/pages/alertsData.js';

const product = (id,stock,minStock=3) => ({ id,stock,minStock,name:`Mouse ${id}`,sku:`SKU${id}`,category:'Periféricos' });
test('alertas: cero prioritario, mínimos reales y límites de clasificación', () => {
  for (const [stock,minimum,expected] of [[0,5,'agotado'],[3,3,'bajo'],[1,3,'bajo'],[4,3,'normal'],[0,0,'agotado'],[1,0,'normal']])
    assert.equal(classifyStock(product(1,stock,minimum)),expected);
  for (const invalid of [{stock:0},{stock:null,minStock:0},{stock:-1,minStock:0},{stock:1,minStock:null},{stock:1,minStock:-1}])
    assert.throws(() => classifyStock(invalid));
});
test('alertas: reposición estimada, prioridad y actualización del stock sin duplicados', () => {
  const products=[product(1,0),product(2,2),product(3,3),product(4,4),product(5,0,0)];
  const result=buildAlerts([...products,products[0]]);
  assert.deepEqual(result.summary,{normal:1,bajo:2,agotado:2,diferencias:0});
  assert.deepEqual(result.alerts.map(a=>a.priority),['critica','critica','media','media']);
  assert.deepEqual(result.alerts.map(a=>a.suggested),[3,0,1,0]);
  assert.equal(buildAlerts([product(1,10)]).alerts.length,0);
});
test('alertas: diferencias comprobadas, sesiones cerradas y agrupación por producto', () => {
  const line=(session_id,product_id,physical_quantity,reference_stock=3) => ({session_id,product_id,physical_quantity,reference_stock,sku:`SKU${product_id}`,product_name:'Mouse'});
  const pending={sessions:[{id:'a',status:'borrador'},{id:'b',status:'en revisión'},{id:'c',status:'finalizado'},{id:'d',status:'cancelado'}],
    lines:[line('a',1,0),line('a',1,0),line('b',1,5),line('c',2,0),line('d',3,0),line('a',4,null),line('a',5,3)]};
  const result=buildAlerts([product(1,0)],pending);
  assert.equal(result.summary.diferencias,1);
  assert.equal(result.alerts.length,2); // Distintas condiciones, un solo producto.
  assert.deepEqual(result.alerts.find(a=>a.state==='diferencia').counts.map(c=>c.delta),[-3,2]);
  assert.equal(buildAlerts([],pending).alerts[0].category,'Producto fuera del catálogo');
});
test('alertas: búsqueda, categoría, estado, prioridad y vacío', () => {
  const {alerts}=buildAlerts([product(1,0),product(2,1),{...product(3,0),category:'Monitores'}]);
  assert.equal(filterAlerts(alerts,{query:'  sku1 '}).length,1);
  assert.equal(filterAlerts(alerts,{query:'MOUSE',category:'Monitores',state:'agotado',priority:'critica'}).length,1);
  assert.equal(filterAlerts(alerts,{state:'bajo',priority:'critica'}).length,0);
  assert.deepEqual(filterAlerts([],{}),[]);
});
test('alertas: interfaz accesible, consulta sin escrituras y diferencias sin confirmar durante carga', async () => {
  await build({ configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),plugins:[react()],logLevel:'error',
    build:{ssr:fileURLToPath(new URL('../src/modules/inventario/pages/Alertas.jsx',import.meta.url)),outDir:fileURLToPath(new URL('../dist/alerts-ssr',import.meta.url)),emptyOutDir:false,
      rolldownOptions:{external:['react','react/jsx-runtime','react/jsx-dev-runtime','react-router-dom','lucide-react'],output:{entryFileNames:'alerts.mjs'}}} });
  const {default:Alertas}=await import('../dist/alerts-ssr/alerts.mjs');
  const render=products=>renderToStaticMarkup(h(MemoryRouter,null,h(Routes,null,h(Route,{element:h(Outlet,{context:{products,status:'ready'}})},h(Route,{path:'/',element:h(Alertas)})))));
  const html=render([product(1,0,0)]);
  assert.ok(html.includes('Alertas y notificaciones'));
  assert.ok(html.includes('Crítica'));
  assert.ok(html.includes('Revisar reposición; mínimo configurado en cero'));
  assert.ok(html.includes('Diferencias sin confirmar'));
  assert.ok(html.includes('role="status"'));
  assert.ok(!html.includes('Registrar movimiento'));
  assert.ok(render([]).includes('Cargando alertas'));
  assert.ok(render([{stock:0}]).includes('role="alert"'));
});
