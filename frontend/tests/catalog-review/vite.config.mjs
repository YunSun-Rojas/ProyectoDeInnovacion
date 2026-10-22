import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { stockValidation } from '../../src/modules/inventario/pages/movementData.js';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: { outDir: fileURLToPath(new URL('../../dist/catalog-review', import.meta.url)), emptyOutDir: false },
  plugins: [react(), tailwindcss(), {
    name: 'deny-api-in-catalog-review',
    configureServer(server) {
      // API EXCLUSIVAMENTE en memoria para probar el hook real. Sin proxy ni Supabase.
      const inventory = { products: Array.from({ length: 43 }, (_, i) => ({ id: i + 1, sku: `ST-${i + 1}`, name: `Producto local ${String(i + 1).padStart(2, '0')}`, category: i % 2 ? 'Pantallas' : 'Periféricos', stock: i === 1 ? 2 : i === 2 ? 0 : 10, minStock: 5, version: 1, price: 50 })),
        movements: [], categories: ['Pantallas', 'Periféricos', 'Audio', 'Cables', 'Accesorios', 'Componentes', 'Consolas'], sales: [], stockEnabled: true, salesEnabled: false, readOnly: false };
      const results = new Map();
      const metrics = { posts: 0, writes: 0, reads: 0 };
      const counts = new Map(Array.from({ length: 4 }, (_, index) => {
        const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
        return [id, { session: { id, status: ['borrador', 'borrador', 'en revisión', 'finalizado'][index], revision: 1,
          created_at: '2026-10-21T04:30:00Z', actor_email: 'responsable@local.test', observation: `Sesión local ${index + 1}` },
          lines: Array.from({ length: 176 }, (_, i) => ({ product_id: i + 1, sku: `FIS-${i + 1}`, product_name: `Producto físico ${i + 1}`, reference_stock: 8,
            physical_quantity: index === 0 && i === 175 ? null : 8, reason: '' })) }];
      }));
      const countMetrics = { creates: 0, saves: 0, reviews: 0, confirms: 0 };
      let scenario = 'success';
      let alertScenario = 'stock', alertReads = 0;
      let reportReads = 0;
      let visionScenario = 'offline';
      const visionMetrics = { checks:0, analyses:0, receivedBytes:0 };
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const send = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
        if (url.pathname === '/_review/vision-scenario') { visionScenario=url.searchParams.get('value')||'offline'; return send(200,{visionScenario}); }
        if (url.pathname === '/_review/vision-metrics') return send(200,{...visionMetrics,stockWrites:metrics.writes,countWrites:countMetrics});
        const visionModel={model:'monitores_v1/best.pt',classes:[{id:0,name:'monitor'}],confidenceThreshold:0.25,imageSize:640};
        if (url.pathname === '/api/vision/model' && req.method === 'GET') {
          visionMetrics.checks++;
          return visionScenario==='offline'?send(503,{error:'No se pudo conectar al modelo. Inicia Python: python backend/yolo/service.py'}):send(200,visionModel);
        }
        if (url.pathname === '/api/vision/detect' && req.method === 'POST') {
          visionMetrics.analyses++;
          for await (const chunk of req) visionMetrics.receivedBytes+=chunk.length;
          if (visionScenario==='slow') await new Promise(resolve=>setTimeout(resolve,1800));
          if (visionScenario==='error') return send(503,{error:'Error simulado del servicio de reconocimiento.'});
          return send(200,{...visionModel,width:64,height:64,elapsedMs:123,detections:visionScenario==='empty'?[]:[{classId:0,className:'monitor',confidence:0.875,box:[8,8,56,56]}]});
        }
        if (url.pathname === '/_review/report-metrics') return send(200, { reads:reportReads, stockWrites:metrics.writes, countWrites:countMetrics });
        if (url.pathname === '/api/inventory/reports' && req.method === 'GET') {
          reportReads++;
          if (scenario === 'error') return send(503, { error:'Error simulado de reportes.' });
          const day = new Date().toLocaleDateString('sv-SE',{timeZone:'America/Lima'});
          const productRows = Array.from({length:43},(_,i)=>({id:i+1,sku:`EG-TEST-FLUJO-${1017+i}`,name:`Producto de reporte ${String(i+1).padStart(2,'0')}`,stock:i%5===0?0:10,purchaseCost:i===2?null:i===1?0:2.5}));
          const sessions = Array.from({length:25},(_,i)=>({id:`00000000-0000-4000-8000-${String(100+i).padStart(12,'0')}`,created_at:`${day}T12:00:00Z`,status:['borrador','en revisión','finalizado','cancelado'][i%4],actor_email:'auditoria@local.test'}));
          return send(200, { products:productRows,readOnly:false,consultedAt:new Date().toISOString(),
            movements:scenario==='empty'?[]:Array.from({length:61},(_,i)=>({id:i+1,productId:i===60?99:i%30+1,sku:i===60?'EG-RETIRADO-99':productRows[i%30].sku,product:i===60?'Producto retirado':productRows[i%30].name,
              date:`${day.slice(0,8)}${String(1+i%Math.min(20,Number(day.slice(8)))).padStart(2,'0')}T12:00:00Z`,type:['Alta','Entrada','Salida','Venta','Ajuste','Baja'][i%6],before:10,after:i%6<2?13:i%6===4?10:8,
              reason:i%6===4?'Inventario físico sesión local: sin variación':'Referencia histórica; texto con "comillas"',...(i%6===3?{saleId:i+1}:{})})),
            physical:{enabled:true,sessions,lines:sessions.flatMap(s=>productRows.slice(0,2).map((p,i)=>({session_id:s.id,product_id:p.id,sku:p.sku,product_name:p.name,reference_stock:8,physical_quantity:i===0?6:8,reason:i===0?'Faltante verificado':'Sin diferencia'})))} });
        }
        if (url.pathname === '/_review/scenario') { scenario = url.searchParams.get('value') || 'success'; return send(200, { scenario }); }
        if (url.pathname === '/_review/metrics') return send(200, metrics);
        if (url.pathname === '/_review/physical-metrics') return send(200, { ...countMetrics, stock: inventory.products.map(p => p.stock) });
        if (url.pathname === '/api/inventory/physical') {
          if (req.method === 'GET') return send(200, { sessions: [...counts.values()].map(c => c.session) });
          let raw = ''; for await (const chunk of req) raw += chunk;
          const request = JSON.parse(raw);
          if (request.action !== 'get') {
            if (scenario === 'slow') await new Promise(resolve => setTimeout(resolve, 1500));
            if (scenario === 'error') return send(400, { error: 'Error simulado: conserva el conteo.', uncertain: false });
            if (scenario === 'retry') { scenario = 'success'; return send(503, { error: 'Respuesta incierta simulada. Reintenta.', uncertain: true }); }
          }
          let count = counts.get(request.id);
          if (request.action === 'create' && !count) {
            count = { session: { id: request.id, status: 'borrador', revision: 1, created_at: new Date().toISOString(), actor_email: 'responsable@local.test', observation: request.data.observation },
              lines: [...counts.values()][0].lines.map(l => ({ ...l, physical_quantity: null, reason: '' })) };
            counts.set(request.id, count); countMetrics.creates++;
          }
          if (!count) return send(404, { error: 'Sesión inexistente', uncertain: false });
          if (!['create', 'get'].includes(request.action)) {
            if (request.revision !== count.session.revision) return send(409, { error: 'Versión anterior. Recarga la sesión.', uncertain: false });
            if (request.action === 'save') {
              count.lines = count.lines.map(l => { const change = request.data.lines.find(x => x.productId === l.product_id); return change ? { ...l, physical_quantity: change.quantity, reason: change.reason } : l; }); countMetrics.saves++;
            }
            if (request.action === 'review') {
              if (count.lines.some(l => l.physical_quantity === null || (l.physical_quantity !== l.reference_stock && !l.reason.trim()))) return send(409, { error: 'Conteo incompleto', uncertain: false });
              count.session.status = 'en revisión'; countMetrics.reviews++;
            }
            if (request.action === 'reopen') count.session.status = 'borrador';
            if (request.action === 'cancel') count.session.status = 'cancelado';
            if (request.action === 'confirm') { count.session.status = 'finalizado'; countMetrics.confirms++; }
            count.session.revision++;
          }
          return send(200, count);
        }
        if (url.pathname === '/_review/alert-scenario') { alertScenario = url.searchParams.get('value') || 'all'; return send(200, { alertScenario }); }
        if (url.pathname === '/_review/alert-metrics') return send(200, { reads:alertReads, stockWrites:metrics.writes, countWrites:countMetrics });
        if (url.pathname === '/api/inventory/alerts' && req.method === 'GET') {
          alertReads++;
          if (alertScenario === 'error') return send(503, { error:'Consulta de diferencias simulada no disponible.' });
          if (alertScenario === 'unavailable') return send(200, { enabled:false, sessions:[], lines:[] });
          if (alertScenario !== 'all') return send(200, { enabled:true, sessions:[], lines:[] });
          const sessions = [...counts.values()].slice(0,2).map(c => ({...c.session,status:'borrador'}));
          return send(200, { enabled:true, sessions, lines:[
            {session_id:sessions[0].id,product_id:1,sku:'ALT-1',product_name:'Producto de alerta 01',reference_stock:8,physical_quantity:6},
            {session_id:sessions[1].id,product_id:1,sku:'ALT-1',product_name:'Producto de alerta 01',reference_stock:8,physical_quantity:9},
            {session_id:sessions[0].id,product_id:2,sku:'ALT-2',product_name:'Producto de alerta 02',reference_stock:8,physical_quantity:10},
            {session_id:sessions[0].id,product_id:99,sku:'RET-99',product_name:'Producto fuera del catálogo',reference_stock:8,physical_quantity:0},
          ] });
        }
        if (url.pathname === '/api/inventory' && req.method === 'GET') { metrics.reads++; return send(200, inventory); }
        if (url.pathname === '/api/inventory/changes' && req.method === 'POST') {
          metrics.posts++;
          try {
            let body = ''; for await (const chunk of req) body += chunk;
            const request = JSON.parse(body);
            if (results.has(request.requestId)) return send(200, results.get(request.requestId));
            if (scenario === 'slow') await new Promise(resolve => setTimeout(resolve, 5000));
            if (scenario === 'error') return send(400, { error: 'Error simulado: conserva el borrador.', uncertain: false });
            const product = inventory.products.find(item => item.id === request.productId);
            const error = stockValidation(product, request.action, String(request.data.quantity), request.data.reason);
            if (error || product.version !== request.version) return send(409, { error: error || 'Conflicto de versión.', uncertain: false });
            const delta = request.action === 'stock_out' ? -request.data.quantity : request.data.quantity;
            const movement = { id: 100 + metrics.writes, productId: product.id, product: product.name, sku: product.sku,
              type: { stock_in: 'Entrada', stock_out: 'Salida', stock_adjust: 'Ajuste' }[request.action], before: product.stock,
              quantity: delta, after: product.stock + delta, reason: request.data.reason, date: new Date().toISOString(), user: 'operador@local.test' };
            product.stock = movement.after; product.version++; metrics.writes++;
            inventory.movements.unshift(movement);
            const result = { product: { ...product }, movement: { ...movement } };
            results.set(request.requestId, result);
            if (scenario === 'retry') return send(503, { error: 'Respuesta simulada incierta. Reintenta la misma solicitud.', uncertain: true });
            return send(200, result);
          } catch { return send(400, { error: 'Solicitud local inválida.', uncertain: false }); }
        }
        if (!req.url.startsWith('/api')) return next();
        res.statusCode = 403;
        res.end('Revisión aislada: API deshabilitada.');
      });
    },
  }],
  server: { host: '127.0.0.1', fs: { allow: [fileURLToPath(new URL('../../../', import.meta.url))] } },
});
