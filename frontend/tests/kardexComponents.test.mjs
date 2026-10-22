import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { buildKardex, kardexProducts, kardexCsv } from '../src/modules/inventario/pages/kardexData.js';

test('pantalla Kardex: selección, estados, permisos y paginación sin controles de escritura', async t => {
  await build({ configFile:false, root:fileURLToPath(new URL('../',import.meta.url)), plugins:[react()], logLevel:'error',
    build:{ssr:fileURLToPath(new URL('../src/modules/inventario/pages/Kardex.jsx',import.meta.url)),
      outDir:fileURLToPath(new URL('../dist/kardex-ssr',import.meta.url)), emptyOutDir:false,
      rolldownOptions:{external:['react','react/jsx-runtime','react/jsx-dev-runtime','react-router-dom','lucide-react'],output:{entryFileNames:'kardex.mjs'}}} });
  const {default:Kardex}=await import('../dist/kardex-ssr/kardex.mjs');
  const product={id:1,name:'Mouse de prueba',sku:'M1',stock:30};
  const movements=Array.from({length:30},(_,i)=>({id:i+1,productId:1,product:product.name,sku:'M1',
    date:'2026-10-01T15:00:00Z',type:i===0?'Alta':'Entrada',before:i,after:i+1,user:'operador',reason:'Prueba'}));
  const render=(url,extra={})=>renderToStaticMarkup(h(MemoryRouter,{initialEntries:[url]},h(Routes,null,
    h(Route,{element:h(Outlet,{context:{products:[product],movements,status:'ready',readOnly:false,...extra}})},
      h(Route,{path:'/kardex',element:h(Kardex)})))));
  await t.test('selección inicial y referencia desconocida',()=>{
    assert(render('/kardex',{movements:[]}).includes('Sin movimientos registrados hoy'));
    assert(render('/kardex',{movements:[]}).includes('Selecciona un producto para consultar su historial'));
    assert(render('/kardex?producto=999').includes('Producto no disponible'));
  });
  await t.test('totales independientes de página y controles de consulta',()=>{
    const html=render('/kardex?producto=1&pagina=2');
    assert(html.includes('Kardex de inventario')); assert.equal((html.match(/<tbody>(.*?)<\/tbody>/s)[1].match(/<tr/g)||[]).length,5);
    assert(!html.includes('Movimiento #1<')); assert(html.includes('Página 2 de 2'));
    assert(html.includes('Exportar CSV')); assert(!html.includes('Confirmar movimiento')); assert(!html.includes('Guardar cambios'));
  });
  await t.test('modo no habilitado no presenta historial ni exportación activa',()=>{
    const html=render('/kardex?producto=1',{readOnly:true});
    assert(html.includes('El historial no está disponible'));
    assert(!html.includes('Tabla del Kardex'));
    assert.match(html,/<button[^>]*disabled=""[^>]*>[^<]*<svg[\s\S]*?Exportar CSV/);
  });
  await t.test('carga, error y falta de movimientos son explícitos',()=>{
    assert(render('/kardex',{status:'loading'}).includes('Cargando Kardex'));
    assert(render('/kardex',{status:'error',error:'Consulta fallida'}).includes('Consulta fallida'));
    const html=render('/kardex?producto=1',{movements:[]});
    assert(html.includes('No hay movimientos para esta selección'));
    assert(html.includes('No reconstruible con certeza'));
  });
  await t.test('vista de hoy pagina sin duplicar, consulta por ID y respeta permisos', () => {
    const daily = Array.from({length:31}, (_,i)=>({...movements[0], id:i+100, date:new Date().toISOString(), type: i%2?'Venta':'Entrada', before:10, after:i%2?9:11}));
    const html=render('/kardex?auditoria=1&desde=2000-01-01', {movements:[...daily,daily[0]]});
    assert(html.includes('Movimientos de hoy') && html.includes('31 movimientos'));
    assert.equal((html.match(/>Consultar →</g)||[]).length,25);
    assert(html.includes('Página 1 de 2'));
    assert(!html.includes('Tabla del Kardex'));
    assert(!render('/kardex',{movements:daily,readOnly:true}).includes('Consultar →'));
  });
  await t.test('producto directo conserva historial, cuatro saldos, trazabilidad y normaliza auditoría antigua', () => {
    const rows=[movements[0], {...movements[0],id:50,type:'Ajuste',before:1,after:1}];
    const html=render('/kardex?producto=1&auditoria=1',{movements:rows, products:[{...product,stock:1}]});
    assert(!html.includes('Movimientos de hoy'));
    assert(html.includes('Resumen del producto'));
    assert.equal((html.match(/<dt>/g)||[]).length,4);
    assert.equal((html.match(/<th scope=/g)||[]).length,7);
    assert(html.includes('Prueba') && !html.includes('Movimiento #1') && !html.includes('operador'));
    assert(!html.includes('Movimiento #50'));
    for(const removed of ['Incluir cambios sin variación','Consulta de solo lectura','ALMACÉN · CONSULTA POR SKU','ID 1','Página 1 de 1','Saldo inicial del período']) assert(!html.includes(removed));
    assert.equal((html.match(/← Volver/g)||[]).length,1);
    assert(!html.includes('Paginación del Kardex'));
    assert(render('/kardex?producto=1',{...{movements:rows,products:[]}}).includes('Fuera del catálogo'));
    for(const flag of ['saving','refreshing','uncertain']) {
      const busy=render('/kardex?producto=1',{[flag]:true});
      const buttons=[...busy.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)];
      assert(buttons.find(([, ,body])=>body.includes('Exportar CSV'))[1].includes('disabled'));
    }
  });
  await t.test('cuatro minitarjetas conservan saldos y Motivo respeta el texto histórico sin auditoría visible', () => {
    const rows=[{...movements[0],before:0,after:10}, {...movements[0],id:2,type:'Venta',before:10,after:8,reason:'Edición de producto',user:'autor@historial.test',saleId:'venta-original'}, {...movements[0],id:3,type:'Ajuste',before:8,after:9}];
    const original=structuredClone(rows), current={...product,stock:9};
    const html=render('/kardex?producto=1',{movements:rows,products:[current]});
    const summary=html.match(/<section[^>]*aria-label="Resumen del producto"[\s\S]*?<\/section>/)[0];
    assert.equal((summary.match(/<dt>/g)||[]).length,4);
    assert.equal((summary.match(/<svg/g)||[]).length,4);
    assert.deepEqual([...summary.matchAll(/<dd[^>]*>([^<]+)<\/dd>/g)].map(match=>match[1]),['0','11','2','9']);
    for(const tone of ['initial','entry','exit','final']) assert(summary.includes(`data-tone="${tone}"`));
    const body=html.match(/<tbody>(.*?)<\/tbody>/s)[1];
    assert(body.includes('<td>Edición de producto</td>'));
    assert(!body.includes('autor@historial.test') && !body.includes('Movimiento #') && !body.includes('venta-original'));
    const p=kardexProducts([current],rows)[0], ledger=buildKardex(p,rows), csv=kardexCsv(p,ledger);
    assert(csv.includes('Edición de producto') && csv.includes('autor@historial.test') && csv.includes('Venta venta-original · Movimiento #2'));
    assert.deepEqual(rows,original);
  });
});
