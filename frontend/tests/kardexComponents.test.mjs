import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

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
    assert(render('/kardex').includes('Selecciona un producto para comenzar'));
    assert(render('/kardex?producto=999').includes('Producto no disponible'));
  });
  await t.test('totales independientes de página y controles de consulta',()=>{
    const html=render('/kardex?producto=1&pagina=2');
    assert(html.includes('Kardex de inventario')); assert(html.includes('Movimiento #30'));
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
});
