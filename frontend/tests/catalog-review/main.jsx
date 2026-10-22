import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Outlet, Route, Routes, Link } from 'react-router-dom';
import Productos from '../../src/modules/inventario/pages/Productos';
import ProductForm from '../../src/modules/inventario/components/catalog/ProductForm';
import ProductDetails from '../../src/modules/inventario/components/catalog/ProductDetails';
import { InventoryToast } from '../../src/modules/inventario/InventarioLayout';
import { useInventory, useInventoryNotifications } from '../../src/modules/inventario/hooks/useInventory';
import Existencias from '../../src/modules/inventario/pages/Existencias';
import Kardex from '../../src/modules/inventario/pages/Kardex';
import Alertas from '../../src/modules/inventario/pages/Alertas';
import Historial from '../../src/modules/inventario/pages/Historial';
import InventarioFisico from '../../src/modules/inventario/pages/InventarioFisico';
import Reportes from '../../src/modules/inventario/pages/Reportes';
import Prediccion from '../../src/modules/inventario/pages/Prediccion';
import Vision from '../../src/modules/inventario/pages/Vision';
import { kardexReview } from '../kardex-review/fixtures.mjs';
import './preview.css';
import '../../src/index.css';

const product = { id: 1, sku: 'REV-M01', name: 'Mouse de revisión', category: 'Periféricos', brand: 'Marca de ejemplo', model: 'Modelo de revisión',
  characteristics: 'Producto de ejemplo para revisar la ficha.\nNo proviene de Supabase.', price: 80, purchaseCost: 45,
  stock: 8, minStock: 2, barcode: '000456', unitOfMeasure: 'Caja', createdByName: 'Autor original', isActive: true, version: 1 };
const mode = new URLSearchParams(window.location.search).get('mode');
const readOnly = mode === 'readonly';
// Callbacks locales: permiten probar el flujo real sin API ni datos reales.
export function ModalReview() {
  const [items, setItems] = useState(() => Array.from({ length: Math.min(100, Math.max(1, Number(new URLSearchParams(window.location.search).get('count')) || 1)) }, (_, index) => ({ ...product, id: index + 1, sku: `REV-${index + 1}`, name: index ? `Producto de revisión ${String(index + 1).padStart(2, '0')}` : product.name })));
  const { toast, notify, dismissToast } = useInventoryNotifications();
  const calls = useRef(0);
  const [timing, setTiming] = useState(null);
  const [payload, setPayload] = useState(null);
  const [scenario, setScenario] = useState(new URLSearchParams(window.location.search).get('scenario') || 'success');
  const [uncertain, setUncertain] = useState(false);
  const [pending, setPending] = useState(null);
  const [dark, setDark] = useState(false);
  function confirm(data, original) {
    setPayload(data);
    setItems(previous => original ? previous.map(item => item.id === original.id ? { ...item, ...data } : item)
      : [...previous, { ...data, id: previous.length + 1, createdAt: new Date().toISOString() }]);
    setUncertain(false);
    return true;
  }
  async function save(data, original) {
    const started = performance.now();
    calls.current += 1;
    setTiming({ calls: calls.current, state: 'pending' });
    // Espera EXCLUSIVA de esta vista de pruebas: simula una API pendiente.
    if (['slow', 'retry'].includes(scenario)) await new Promise(resolve => window.setTimeout(resolve, 5000));
    setTiming({ calls: calls.current, simulatedApiMs: Math.round(performance.now() - started), state: 'settled' });
    if (scenario === 'error') throw new Error('No se pudo guardar. Intenta nuevamente.');
    if (scenario === 'retry') { setPending({ data, original }); setUncertain(true); return false; }
    return confirm(data, original);
  }
  function confirmDelete(original) { setItems(previous => previous.filter(item => item.id !== original.id)); setUncertain(false); return true; }
  async function remove(original) {
    calls.current += 1; setTiming({ calls: calls.current, state: 'pending-delete' });
    if (['slow', 'retry'].includes(scenario)) await new Promise(resolve => window.setTimeout(resolve, 5000));
    setTiming({ calls: calls.current, state: 'settled-delete' });
    if (scenario === 'error') throw new Error('No se pudo eliminar. Intenta nuevamente.');
    if (scenario === 'retry') { setPending({ original, action: 'delete' }); setUncertain(true); return false; }
    return confirmDelete(original);
  }
  return <div style={dark ? { '--inventory-surface': '#171c26', '--inventory-surface-alt': '#222936',
    '--inventory-ink': '#edf0f7', '--inventory-muted': '#b6bfce', '--inventory-border': '#394252',
    '--inventory-input-border': '#465166' } : {}}>
    <label>Escenario local <select value={scenario} onChange={e => setScenario(e.target.value)}>
      <option value="success">Éxito</option><option value="slow">API simulada (5 s)</option><option value="error">Error</option><option value="retry">Reintento</option>
    </select></label><button onClick={() => setDark(value => !value)}>Alternar tema de revisión</button>
    <InventoryToast toast={toast} onDismiss={dismissToast} />
    <output aria-label="Medición local">{JSON.stringify(timing)}</output>
    <output aria-label="Payload guardado" style={{display:'block',overflowWrap:'anywhere'}}>{JSON.stringify(payload)}</output>
    <MemoryRouter initialEntries={[mode === 'products' ? '/productos' : '/productos?accion=nuevo']}>
      <Productos products={items} categories={['Periféricos', 'Pantallas', 'Accesorios', 'Audio', 'Cables', 'Componentes', 'Consolas', 'Portátiles']} readOnly={false}
        currentUser={{ email: 'operador@example.test', user_metadata: { full_name: 'Operador de revisión' } }}
        onAdd={data => save(data)} onEdit={(original, data) => save(data, original)} onDelete={remove} uncertain={uncertain}
        retryWrite={() => pending.action === 'delete' ? confirmDelete(pending.original) : confirm(pending.data, pending.original)} notify={notify} />
    </MemoryRouter>
  </div>;
}
export function StockReview() {
  const inventory = useInventory('usuario-local-de-prueba');
  const { toast, notify, dismissToast } = useInventoryNotifications();
  const [metrics, setMetrics] = useState(null);
  const [dark, setDark] = useState(false);
  useEffect(() => { fetch('/_review/metrics').then(response => response.json()).then(setMetrics); }, [inventory.saving, inventory.movements.length]);
  return <div style={dark ? { background: '#10151e', color: '#edf0f7', minHeight: '100dvh', '--inventory-bg': '#10151e', '--inventory-surface': '#171c26', '--inventory-surface-alt': '#222936', '--inventory-ink': '#edf0f7', '--inventory-muted': '#b6bfce', '--inventory-border': '#394252', '--inventory-input-border': '#465166', '--inventory-accent-tint': '#452435', '--inventory-danger': '#fda4af', '--inventory-success': '#86efac' } : {}}>
    <p>API simulada en memoria · Sin conexión a Supabase</p>
    <label>Escenario local<select defaultValue="success" onChange={event => fetch(`/_review/scenario?value=${event.target.value}`)}><option value="success">Éxito</option><option value="slow">Lento (5 s)</option><option value="error">Error</option><option value="retry">Resultado incierto</option></select></label>
    <button onClick={() => setDark(value => !value)}>Alternar tema de revisión</button><output aria-label="Peticiones locales">{JSON.stringify(metrics)}</output>
    <InventoryToast toast={toast} onDismiss={dismissToast} />
    <MemoryRouter initialEntries={['/dashboard/existencias']}><Link to="/dashboard/existencias">Abrir Existencias</Link><Routes>
      <Route element={<Outlet context={{ ...inventory, notify }} />}><Route path="/dashboard/existencias" element={<Existencias />} /><Route path="/dashboard/alertas" element={<Alertas />} /><Route path="/dashboard/kardex" element={<Kardex />} /></Route>
    </Routes></MemoryRouter>
  </div>;
}
function HistoryReview() {
  const [dark, setDark] = useState(false);
  const movements = Array.from({ length: 61 }, (_, index) => ({ id: index + 1, productId: index % 2 ? 99 : 1, product: index % 2 ? 'Mouse retirado' : 'Monitor actual', sku: 'SKU-COMPARTIDO',
    date: `2026-10-${String(1 + index % 20).padStart(2, '0')}T03:30:00Z`, type: ['Entrada', 'Salida', 'Venta', 'Ajuste', 'Alta', 'Baja', 'Edición'][index % 7],
    quantity: index % 7 >= 5 ? 0 : index % 7 === 1 || index % 7 === 2 ? -2 : 3, before: 10, after: index % 7 >= 5 ? 10 : index % 7 === 1 || index % 7 === 2 ? 8 : 13,
    reason: index % 7 === 5 ? 'Retiro del catálogo' : 'Operación histórica de ejemplo para revisar su presentación.', user: 'autor@local.test' }));
  return <div style={dark ? { '--inventory-bg': '#10151e', '--inventory-surface': '#171c26', '--inventory-surface-alt': '#222936', '--inventory-ink': '#edf0f7', '--inventory-muted': '#b6bfce', '--inventory-border': '#394252', '--inventory-input-border': '#465166', '--inventory-accent-tint': '#452435', '--inventory-danger': '#fda4af', '--inventory-success': '#86efac', '--inventory-success-tint': '#193c31', '--inventory-danger-tint': '#452435', colorScheme: 'dark', background: '#10151e', minHeight: '100dvh' } : {}}>
    <p>Historial simulado · Sin API ni conexión a Supabase</p><button onClick={() => setDark(value => !value)}>Alternar tema de revisión</button>
    <MemoryRouter initialEntries={[`/movimientos${window.location.search}`]}><Routes><Route element={<Outlet context={{ movements, products: [{ id: 1 }], readOnly: false }} />}><Route path="/movimientos" element={<Historial />} /></Route></Routes></MemoryRouter>
  </div>;
}
function KardexReview() {
  const [dark, setDark] = useState(false), [reads, setReads] = useState(0);
  const data = useMemo(() => {
    const now = new Date().toISOString();
    const todayRows = Array.from({length:26},(_,index)=>({id:500+index,productId:2,product:'Producto paginado de revisión',sku:'000234',type:'Entrada',before:30+index,after:31+index,quantity:1,date:now,user:'operador@local.test',reason:'Texto; con "comillas"\ny salto de línea'}));
    const other = ['Entrada','Salida','Ajuste','Venta'].map((type,index)=>({id:600+index,productId:1,product:'Mouse de revisión Kardex',sku:'REV-M01',type,before:index===0?14:index===1?15:index===2?14:13,after:index===0?15:index===1?14:index===2?13:12,quantity:index===0?1:-1,date:now,user:'operador@local.test',reason:'Consulta sintética'}));
    const empty = new URLSearchParams(window.location.search).get('scenario') === 'empty';
    return {...kardexReview, products:kardexReview.products.map(p=>({...p,stock:empty?p.stock:p.id===2?56:p.id===1?12:p.stock})),movements:empty?kardexReview.movements:[...kardexReview.movements,...todayRows,...other]};
  }, []);
  return <div style={dark ? { '--inventory-surface': '#171c26', '--inventory-surface-alt': '#222936', '--inventory-ink': '#edf0f7', '--inventory-muted': '#b6bfce', '--inventory-border': '#394252', '--inventory-input-border': '#465166', '--inventory-accent-tint': '#452435', '--inventory-danger': '#fda4af', '--inventory-success': '#86efac', '--inventory-warning': '#fcd34d', '--inventory-warning-tint': '#49361d', colorScheme:'dark',background:'#10151e',minHeight:'100dvh' } : {}}>
    <p>Kardex simulado · Sin API ni conexión a Supabase</p><button onClick={()=>setDark(value=>!value)}>Alternar tema de revisión</button><output aria-label="Lecturas locales">{reads}</output>
    <MemoryRouter initialEntries={[`/kardex${window.location.search}`]}><Routes><Route element={<Outlet context={{...data,status:'ready',retry:()=>setReads(value=>value+1)}} />}><Route path="/kardex" element={<Kardex />} /></Route></Routes></MemoryRouter>
  </div>;
}
function PhysicalReview() {
  const [dark, setDark] = useState(false);
  const [metrics, setMetrics] = useState({});
  useEffect(() => { const timer = setInterval(() => fetch('/_review/physical-metrics').then(r => r.json()).then(setMetrics), 500); return () => clearInterval(timer); }, []);
  return <div style={dark ? { '--inventory-surface': '#171c26', '--inventory-surface-alt': '#222936', '--inventory-ink': '#edf0f7', '--inventory-muted': '#b6bfce', '--inventory-border': '#394252', '--inventory-input-border': '#465166', '--inventory-accent-tint': '#452435', '--inventory-danger': '#fda4af', '--inventory-success': '#86efac', background:'#10151e', colorScheme:'dark', minHeight:'100dvh' } : {}}>
    <p>Conteo simulado · Sin conexión a Supabase</p><button onClick={() => setDark(value => !value)}>Alternar tema de revisión</button>
    <label>Escenario local<select defaultValue="success" onChange={e => fetch(`/_review/scenario?value=${e.target.value}`)}><option value="success">Éxito</option><option value="slow">Lento</option><option value="error">Error</option><option value="retry">Resultado incierto</option></select></label>
    <output aria-label="Operaciones locales" style={{ display:'block', overflowWrap:'anywhere' }}>{JSON.stringify(metrics)}</output>
    <MemoryRouter><Routes><Route element={<Outlet context={{ readOnly:false, retry:()=>{} }} />}><Route path="/" element={<InventarioFisico />} /></Route></Routes></MemoryRouter>
  </div>;
}
function AlertsReview() {
  const [dark,setDark] = useState(false), [fixture,setFixture] = useState(null), [reads,setReads] = useState(0), [metrics,setMetrics] = useState({});
  const initial = new URLSearchParams(window.location.search).get('scenario') || 'all';
  useEffect(() => { fetch(`/_review/alert-scenario?value=${initial}`).then(()=>setFixture(initial)); }, [initial]);
  useEffect(() => { const timer=setInterval(()=>fetch('/_review/alert-metrics').then(r=>r.json()).then(setMetrics),500); return ()=>clearInterval(timer); },[]);
  const products = useMemo(()=>Array.from({length:62},(_,i)=>({id:i+1,name:`Producto de alerta ${String(i+1).padStart(2,'0')}`,sku:`ALT-${i+1}`,category:i===61?'Categoría sin alertas':i%2?'Audio':'Periféricos',stock:fixture==='empty'||i===61?10:[0,2,9][i%3],minStock:5})),[fixture]);
  return <div style={dark ? { '--inventory-surface':'#171c26','--inventory-surface-alt':'#222936','--inventory-ink':'#edf0f7','--inventory-muted':'#b6bfce','--inventory-border':'#394252','--inventory-input-border':'#465166','--inventory-accent-tint':'#452435','--inventory-danger':'#fda4af','--inventory-warning':'#fcd34d','--inventory-warning-tint':'#49361d','--inventory-danger-tint':'#452435',background:'#10151e',colorScheme:'dark',minHeight:'100dvh' } : {}}>
    <p>Alertas simuladas · Sin conexión a Supabase</p><button onClick={()=>setDark(v=>!v)}>Alternar tema de revisión</button>
    <output aria-label="Consultas locales" style={{display:'block',overflowWrap:'anywhere'}}>{JSON.stringify({inventoryReads:reads,...metrics})}</output>
    {fixture && <MemoryRouter initialEntries={[`/dashboard/alertas${window.location.search}`]}><Routes><Route element={<Outlet context={{products,retry:()=>setReads(v=>v+1),stockEnabled:true,readOnly:false,status:'ready'}} />}><Route path="/dashboard/alertas" element={<Alertas />} /><Route path="/dashboard/existencias" element={<p>Destino simulado: Existencias</p>} /><Route path="/dashboard/inventario-fisico" element={<p>Destino simulado: Inventario físico</p>} /></Route></Routes></MemoryRouter>}
  </div>;
}
function ReportsReview() {
  const [dark,setDark] = useState(false), [metrics,setMetrics] = useState({});
  useEffect(()=>{const timer=setInterval(()=>fetch('/_review/report-metrics').then(r=>r.json()).then(setMetrics),500);return()=>clearInterval(timer);},[]);
  return <div style={dark?{'--inventory-surface':'#171c26','--inventory-surface-alt':'#222936','--inventory-ink':'#edf0f7','--inventory-muted':'#b6bfce','--inventory-border':'#394252','--inventory-input-border':'#465166','--inventory-accent-tint':'#452435','--inventory-danger':'#fda4af','--inventory-success':'#86efac','--inventory-warning':'#fcd34d',background:'#10151e',colorScheme:'dark',minHeight:'100dvh'}:{}}>
    <p>Reportes simulados · Sin conexión a Supabase</p><button onClick={()=>setDark(v=>!v)}>Alternar tema de revisión</button><output aria-label="Consultas locales" style={{display:'block',overflowWrap:'anywhere'}}>{JSON.stringify(metrics)}</output>
    <Reportes />
  </div>;
}
function AiReview() {
  const [dark,setDark]=useState(false),[metrics,setMetrics]=useState({});
  useEffect(()=>{const timer=setInterval(()=>fetch('/_review/vision-metrics').then(r=>r.json()).then(setMetrics),500);return()=>clearInterval(timer);},[]);
  const products=[8,1,0,5,100].map((stock,i)=>({...product,id:i+1,name:`Producto de estimación ${i+1}`,sku:`DEMO-${i+1}`,stock,minStock:i+1}));
  return <div style={dark?{'--inventory-surface':'#171c26','--inventory-surface-alt':'#222936','--inventory-ink':'#edf0f7','--inventory-muted':'#b6bfce','--inventory-border':'#394252','--inventory-input-border':'#465166','--inventory-accent-tint':'#452435','--inventory-danger':'#fda4af','--inventory-success':'#86efac','--inventory-warning':'#fcd34d',background:'#10151e',colorScheme:'dark',minHeight:'100dvh'}:{}}>
    <p>IA simulada · Sin modelo ni conexión a Supabase</p><button onClick={()=>setDark(v=>!v)}>Alternar tema de revisión</button>
    {mode==='vision'&&<label>Escenario simulado<select defaultValue="offline" onChange={e=>fetch(`/_review/vision-scenario?value=${e.target.value}`)}>{[['offline','Sin conexión'],['connected','Conectado'],['slow','Lento'],['empty','Sin detecciones'],['error','Error de análisis']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}
    <output aria-label="Peticiones simuladas" style={{display:'block',overflowWrap:'anywhere'}}>{JSON.stringify(metrics)}</output>
    {mode==='vision'?<Vision />:<Prediccion products={products} />}
  </div>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode>
  {['vision','prediction'].includes(mode)?<AiReview />:mode === 'reports' ? <ReportsReview /> : mode === 'alerts' ? <AlertsReview /> : mode === 'physical' ? <PhysicalReview /> : mode === 'kardex' ? <KardexReview /> : mode === 'history' ? <HistoryReview /> : mode === 'stock' ? <StockReview /> :
  ['modal', 'products'].includes(mode) ? <ModalReview /> : <main><header className="review-notice"><h1>Revisión de catálogo · Fase 2B</h1><p>Entorno aislado con datos de ejemplo. Sin API, sin guardado y sin conexión a Supabase.</p></header>
    <div className="review-layout"><ProductForm product={mode === 'new' ? undefined : product} categories={['Periféricos', 'Pantallas']}
      products={[product]} canReadPurchaseCost={!readOnly} readOnly={readOnly} />
      <ProductDetails product={product} canReadPurchaseCost={!readOnly} /></div></main>}
</React.StrictMode>);
