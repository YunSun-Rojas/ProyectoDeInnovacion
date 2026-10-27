import test from 'node:test';
import assert from 'node:assert/strict';
import {visionFileError,visionDimensionsError,MAX_IMAGE_BYTES} from '../src/modules/inventario/pages/visionData.js';
test('visión: tipos reales, tamaño y dimensiones de las imágenes',()=>{
  for(const type of ['image/jpeg','image/png','image/webp'])assert.equal(visionFileError({type,size:100}), '');
  for(const file of [null,{type:'image/svg+xml',size:100},{type:'image/png',size:0},{type:'image/png',size:MAX_IMAGE_BYTES+1}])assert.ok(visionFileError(file));
  assert.equal(visionDimensionsError(960,1280),'');
  for(const [w,h] of [[31,100],[8193,32],[4001,4000]])assert.ok(visionDimensionsError(w,h));
});

test('IA: presentación accesible usa predicción sin simulaciones y conserva reconocimiento visual',async()=>{
  const [{build},{default:react},{createElement:h},{renderToStaticMarkup},{fileURLToPath}]=await Promise.all([
    import('vite'),import('@vitejs/plugin-react'),import('react'),import('react-dom/server'),import('node:url')]);
  await build({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),plugins:[react()],logLevel:'error',
    build:{ssr:fileURLToPath(new URL('./catalog-review/renderEntry.jsx',import.meta.url)),outDir:fileURLToPath(new URL('../dist/vision-ssr',import.meta.url)),emptyOutDir:false,
      rolldownOptions:{external:['react','react/jsx-runtime','react/jsx-dev-runtime','lucide-react'],output:{entryFileNames:'vision.mjs'}}}});
  const {Prediccion,Vision}=await import('../dist/vision-ssr/vision.mjs');
  const products=Array.from({length:5},(_,i)=>({id:i+1,name:`Producto ${i+1}`,sku:`SKU-${i+1}`,stock:[8,1,0,5,100][i],minStock:i+1}));
  const original=structuredClone(products);
  const html=renderToStaticMarkup(h(Prediccion,{products}));
  assert.ok(html.includes('<h1>Predicción de demanda</h1>'));
  assert.equal((html.match(/<article/g)||[]).length,0);
  assert.ok(html.includes('Predicciones no disponibles') && html.includes('El historial de ventas no está habilitado para esta sesión.'));
  assert.ok(!html.includes('Reponer') && !html.includes('Agotamiento estimado'));
  assert.ok(!html.includes('Demostración')&&!html.includes('(IA)'));
  assert.deepEqual(products,original);
  const vision=renderToStaticMarkup(h(Vision));
  assert.ok(vision.includes('<h1>Reconocimiento visual</h1>'));
  assert.ok(!vision.includes('INTELIGENCIA ARTIFICIAL · MODELO ENTRENADO'));
  for(const label of ['Comprobar modelo','Imagen de entrada','Sin resultados todavía','Los resultados del análisis aparecerán aquí','Hasta 8 MiB y 16 MP','Se procesa en memoria'])assert.ok(vision.includes(label));
  assert.equal((vision.match(/type="file"/g)||[]).length,1);
  assert.match(vision,/accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(vision,/<button[^>]*disabled=""[^>]*>[\s\S]*?Analizar imagen/);
  assert.ok(!vision.includes('<table'));
});
