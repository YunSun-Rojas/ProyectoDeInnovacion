import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { catalogFormValues } from '../../shared/catalogProduct.js';
import { countIssue, difference, reviewIssue, summarizeCount, validQuantity } from '../src/modules/inventario/pages/physicalData.js';

test('inventario físico: sesión completa, cero, avances parciales y motivos condicionales', () => {
  const lines = Array.from({ length: 176 }, (_, i) => ({ product_id: i + 1, reference_stock: 8, physical_quantity: i === 175 ? null : 8, reason: '' }));
  const context = { current: { id: 'local', status: 'borrador' }, lines };
  assert.deepEqual(summarizeCount(lines), { counted: 175, pending: 1, differences: 0 });
  assert.equal(countIssue(lines), ''); // Guardar avance permite pendientes.
  assert.match(reviewIssue(context), /Falta 1 producto por contar/);
  lines[175].physical_quantity = 0;
  assert.equal(difference(lines[175]), -8);
  assert.match(reviewIssue(context), /Falta el motivo en 1/);
  lines[175].reason = ' \t\n';
  assert.match(reviewIssue(context), /Falta el motivo en 1/);
  lines[175].reason = 'Faltante verificado';
  assert.equal(reviewIssue(context), '');
  assert.match(reviewIssue({ ...context, dirty: true }), /Guarda el avance/);
  for (const block of [{ busy: true }, { pending: {} }, { readOnly: true }, { conflicts: [{}] }, { current: null }, { current: { status: 'en revisión' } }, { current: { status: 'finalizado' } }, { current: { status: 'cancelado' } }]) assert(reviewIssue({ ...context, ...block }));
  for (const value of [-1, 0.5, NaN, Infinity, '0', 2147483648]) {
    assert.equal(validQuantity(value), false);
    lines[175].physical_quantity = value;
    assert.equal(difference(lines[175]), null);
    assert(countIssue(lines));
    assert(reviewIssue(context));
  }
  for (const value of [null, '']) {
    lines[175].physical_quantity = value;
    assert.equal(difference(lines[175]), null);
    assert.equal(summarizeCount(lines).pending, 1);
    assert.match(reviewIssue(context), /Falta 1/);
  }
  for (const value of [0, 8, 2147483647]) assert(validQuantity(value));
  lines[175].physical_quantity = 10;
  assert.equal(difference(lines[175]), 2);
  lines[175].reason = 'x'.repeat(401);
  assert.match(countIssue(lines), /400/);
  lines[175].physical_quantity = 8;
  lines[175].reason = 'Motivo previo que se conserva';
  assert.equal(reviewIssue(context), '');
  assert.equal(lines[175].reason, 'Motivo previo que se conserva');
  assert(countIssue([]));
});

test('valores iniciales para productos null y undefined', () => {
  const expected = { name: '', sku: '', category: 'Periféricos', brand: '', model: '',
    characteristics: '', barcode: '', price: '', purchaseCost: '', unitOfMeasure: 'Unidad',
    minStock: 0, isActive: true };
  for (const product of [null, undefined]) {
    assert.deepEqual(catalogFormValues(product, 'Periféricos'), expected);
    assert.equal(catalogFormValues(product).category, '');
  }
});

test('componentes aislados: campos, permisos, stock de consulta y guardado bloqueado', async t => {
  await build({ configFile: false, root: fileURLToPath(new URL('../', import.meta.url)), plugins: [react()],
    logLevel: 'error', build: { ssr: fileURLToPath(new URL('./catalog-review/renderEntry.jsx', import.meta.url)),
      outDir: fileURLToPath(new URL('../dist/catalog-ssr', import.meta.url)), emptyOutDir: false,
      rolldownOptions: { external: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'lucide-react'],
        output: { entryFileNames: 'components.mjs' } } } });
  const { ProductForm, ProductDetails, ProductDetailsDialog, InventoryToast, Productos, DeleteProductDialog, Existencias, StockHistoryDialog, StockDialog, Historial, InventarioFisico } = await import('../dist/catalog-ssr/components.mjs');
  await t.test('inventario físico: encabezado y creación explícita sin sesión automática', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Routes, null,
      createElement(Route, { element: createElement(Outlet, { context: { readOnly: false } }) },
        createElement(Route, { path: '/', element: createElement(InventarioFisico) })))));
    for (const label of ['<h1>Inventario físico</h1>', 'Sesión de conteo', 'Observación del nuevo conteo', 'Crear conteo', 'Actualizar historial']) assert(html.includes(label));
    for (const removed of ['INVENTARIO FÍSICO', 'Conteo de inventario', 'Cuenta productos, detecta diferencias y confirma ajustes.']) assert(!html.includes(removed));
    for (const label of ['ALMACÉN · FASE 5', 'Enviar a revisión', 'Confirmar ajustes', 'Página 1 de 1']) assert(!html.includes(label));
  });
  const product = { id: 1, name: 'Mouse', sku: 'M1', category: 'Periféricos', stock: 8, minStock: 2, price: 80, purchaseCost: 45, isActive: false };
  const renderHistory = (movements, url = '/movimientos', extra = {}) => renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [url] }, createElement(Routes, null,
    createElement(Route, { element: createElement(Outlet, { context: { products: [product], movements, ...extra } }) },
      createElement(Route, { path: '/movimientos', element: createElement(Historial) })))));
  const renderStockAction = action => renderToStaticMarkup(createElement(MemoryRouter, {
    initialEntries: [`/existencias?accion=${action}`],
  }, createElement(Routes, null,
    createElement(Route, { element: createElement(Outlet, { context: {
      products: [product], movements: [], status: 'ready', stockEnabled: true, readOnly: false,
    } }) },
    createElement(Route, { path: '/existencias', element: createElement(Existencias) })))));
  await t.test('Movimientos: siete columnas, cuatro filtros, conteos originales e historial retirado intacto', () => {
    const movements = [
      { id: 60, productId: 99, product: 'Mouse retirado', sku: 'M1', date: '2026-10-20T03:30:00Z', type: 'Entrada', quantity: 5, before: 0, after: 5, reason: 'Compra', user: 'autor@historico.test' },
      { id: 61, productId: 99, product: 'Mouse retirado', sku: 'M1', date: '2026-10-20T04:00:00Z', type: 'Venta', quantity: -2, before: 5, after: 3, reason: 'Venta', user: 'otro@historico.test', saleId: 1, total: 160, unitPrice: 80 },
      { id: 62, productId: 99, product: 'Mouse retirado', sku: 'M1', date: '2026-10-20T05:00:00Z', type: 'Baja', quantity: 0, before: 3, after: 3, reason: 'Retiro', user: 'autor@historico.test' },
      { id: 63, productId: 1, product: 'Mouse actual', sku: 'M1', date: '2026-10-20T06:00:00Z', type: 'Edición histórica', quantity: 0, before: 8, after: 8, reason: 'Cambio de nombre', user: 'autor@historico.test' },
    ];
    const original = structuredClone(movements);
    const html = renderHistory(movements, '/movimientos?historial=todos&responsable=nadie');
    for (const removed of ['TRAZABILIDAD DEL INVENTARIO', 'Historial de operaciones', 'Movimientos según los filtros', 'Producto, operación y período', 'Responsable', 'Ver detalle', '<dialog', '>Acciones<']) assert(!html.includes(removed));
    assert.equal((html.match(/<th scope=/g) || []).length, 7);
    assert.equal((html.match(/<label/g) || []).length, 4);
    assert.equal((html.match(/type="search"/g) || []).length, 1);
    assert.equal((html.match(/<select/g) || []).length, 1);
    assert.equal((html.match(/Producto eliminado/g) || []).length, 1);
    assert(html.includes('4 registros') && html.includes('Mouse retirado') && html.includes('Mouse actual'));
    assert.deepEqual([...html.matchAll(/<option[^>]*>([^<]+)<\/option>/g)].map(match => match[1]), ['Todos', 'Entradas', 'Salidas', 'Ventas', 'Ajustes', 'Productos eliminados']);
    assert(html.includes('+5') && html.includes('-2') && html.includes('19/10/2026'));
    assert(html.includes('Venta: S/ 160.00'));
    for (const [kind, count] of [['Entrada', 1], ['Salida', 1], ['Otros', 2]]) assert.match(html, new RegExp(`data-kind="${kind}"><div[^>]*>.*?</div><strong[^>]*>${count}</strong>`));
    assert.deepEqual(movements, original);
    for (const url of ['/movimientos', '/movimientos?historial=sin-variacion', '/movimientos?historial=stock', '/movimientos?tipo=Alta', '/movimientos?tipo=Edición histórica']) {
      const all = renderHistory(movements, url);
      assert(all.includes('4 registros') && all.includes('Tipo original: Baja'));
      assert.match(all, /<option value="Todos" selected="">Todos/);
    }
    assert(html.includes('Limpiar filtros'));
  });
  await t.test('Movimiento filtra por tipo real y Todos incluye altas, ediciones y ajustes sin variación', () => {
    const movements = ['Entrada', 'Salida', 'Venta', 'Ajuste', 'Ajuste', 'Ajuste', 'Alta', 'Baja', 'Edición'].map((type, id) => ({ id, type, productId: 99, product: `Registro ${id}`, sku: 'SKU-retirado', date: '2026-10-20T12:00:00Z', quantity: id === 4 ? -2 : id === 5 || id === 8 ? 0 : 2, before: 10, after: id === 4 ? 8 : id === 5 || id === 8 ? 10 : 12, reason: 'Auditoría conservada' }));
    const original = structuredClone(movements);
    assert(renderHistory(movements).includes('9 registros'));
    for (const [type, count] of [['Entrada', 1], ['Salida', 1], ['Venta', 1], ['Ajuste', 3], ['Baja', 1]]) {
      const html = renderHistory(movements, `/movimientos?tipo=${type}&historial=stock&responsable=nadie`);
      assert(html.includes(`${count} registros`));
      const body = html.match(/<tbody>(.*?)<\/tbody>/s)[1];
      assert.equal((body.match(/<tr/g) || []).length, count);
      if (type === 'Ajuste') { assert(body.includes('Registro 5') && body.includes('-2')); assert(!body.includes('Registro 8')); }
      if (type === 'Baja') { assert(body.includes('Producto eliminado')); assert(!body.includes('Registro 0')); }
    }
    assert.deepEqual(movements, original);
    assert.match(renderHistory(movements), /<button[^>]*disabled=""[^>]*>Limpiar filtros/);
  });
  await t.test('Movimientos: paginación de 25, filtros combinados y límite de página sin perder registros', () => {
    const movements = Array.from({ length: 61 }, (_, id) => ({ id, productId: id % 2 ? 99 : 1, product: `Producto ${id}`, sku: `H-${id}`, date: '2026-10-20T12:00:00Z', type: 'Entrada', quantity: 1, before: 0, after: 1, reason: 'Compra' }));
    const html = renderHistory(movements, '/movimientos?pagina=2');
    assert(html.includes('61 registros') && html.includes('Página 2 de 3'));
    assert.equal((html.match(/<tbody>(.*?)<\/tbody>/s)[1].match(/<tr/g) || []).length, 25);
    assert(html.includes('chevron-left') && html.includes('chevron-right'));
    assert(renderHistory(movements, '/movimientos?pagina=999').includes('Página 3 de 3'));
    const filtered = renderHistory(movements, '/movimientos?q=H-60&tipo=Entrada&desde=2026-10-20&hasta=2026-10-20&pagina=2');
    assert(filtered.includes('1 registros') && filtered.includes('Página 1 de 1'));
    assert(filtered.includes('Producto 60'));
  });
  await t.test('Movimientos conserva estados vacíos y de consulta sin historial', () => {
    assert(renderHistory([]).includes('Aún no hay movimientos'));
    assert(renderHistory([], '/movimientos', { readOnly: true }).includes('Historial no disponible para esta sesión'));
    assert(renderHistory([{id:1, date:'2026-10-20', type:'Entrada', quantity:1}], '/movimientos?q=inexistente').includes('No hay coincidencias'));
  });
  await t.test('Existencias elimina la consulta secundaria incluso con su URL antigua y conserva las tarjetas', () => {
    const products = Array.from({ length: 43 }, (_, index) => ({ ...product, id: index + 1, sku: `M${index}` }));
    const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/existencias?vista=productos&pagina=2'] }, createElement(Routes, null,
      createElement(Route, { element: createElement(Outlet, { context: { products, categories: ['Periféricos'], status: 'ready', stockEnabled: true, readOnly: false } }) },
        createElement(Route, { path: '/existencias', element: createElement(Existencias) })))));
    assert(html.includes('Productos con stock bajo') && html.includes('Productos agotados'));
    for (const removed of ['Productos registrados', 'Unidades disponibles', 'INVENTARIO POR SKU', 'Actualizar existencias', 'Ver todos los productos', '<table', 'Buscar producto', 'Movimiento registrado correctamente']) assert(!html.includes(removed));
    assert(html.includes('Movimientos de hoy'));
    assert.equal((html.match(/Ver productos →/g) || []).length, 2);
    assert(html.includes('Sin movimientos registrados hoy'));
    assert(html.includes('Registra una entrada, salida o ajuste para ver actividad aquí.'));
    assert(!html.includes('Los movimientos anteriores siguen disponibles en Movimientos de inventario'));
    assert.match(html, /<h3>Sin movimientos registrados hoy<\/h3>/);
    assert(!html.includes('/dashboard/productos'));
    assert.equal((html.match(/<input/g) || []).length, 0);
    assert(html.includes('Actualizar') && html.includes('Registrar movimiento'));
  });
  await t.test('Accesos rápidos de entrada y salida abren el movimiento con el tipo correcto', () => {
    for (const [action, type] of [['entrada', 'stock_in'], ['salida', 'stock_out']]) {
      const html = renderStockAction(action);
      assert(html.includes('<dialog'));
      assert.match(html, new RegExp(`<option value="${type}" selected="">`));
      assert(html.includes('Selecciona un producto'));
    }
  });
  await t.test('ficha de movimientos muestra varias operaciones reales por ID y detalle de solo lectura', () => {
    const movements = [{ id: 100, productId: 1, product: 'Mouse histórico', sku: 'OLD', type: 'Salida', quantity: -3, before: 10, after: 7, reason: 'Venta local', date: '2026-10-20T03:30:00Z', user: 'operador@local.test' },
      { id: 101, productId: 1, type: 'Entrada', quantity: 2 }, { id: 102, productId: 2, sku: 'M1', type: 'Entrada', quantity: 50 }];
    const render = extra => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(StockHistoryDialog, { product, movements, ...extra })));
    assert.equal((render({}).match(/aria-label="Ver detalle del movimiento /g) || []).length, 2);
    const detail = render({ initialMovement: movements[0] });
    for (const text of ['Mouse histórico', 'OLD', '−3', '10', '7', 'Venta local', '19 oct', 'operador@local.test', '100']) assert(detail.includes(text));
    assert(!detail.includes('<input'));
    assert(detail.includes('<dt>N.º de movimiento</dt><dd>100</dd>'));
    assert(!detail.includes('<dt>Referencia</dt>'));
    assert.equal((detail.match(/Ver en Kardex →/g) || []).length, 1);
    assert(detail.includes('/dashboard/kardex?producto=1'));
    assert(!render({initialMovement: {...movements[0], productId:null}}).includes('Ver en Kardex'));
    assert(render({ movements: [] }).includes('No hay movimientos disponibles'));
    const pending = renderToStaticMarkup(createElement(StockDialog, { products: [product], saving: true }));
    assert.match(pending, /aria-busy="true"[^>]*disabled=""[^>]*>Registrando…/);
  });
  await t.test('Existencias muestra cinco movimientos mínimos, solo detalle y tarjetas enlazadas a Alertas', () => {
    const movements = [...Array.from({ length: 8 }, (_, id) => ({ id, productId: 1, product: `Histórico ${id}`, sku: 'M1', type: 'Entrada', quantity: 1, date: new Date().toISOString() })),
      { id: 99, productId: 99, product: 'Producto retirado', sku: 'M1', type: 'Entrada', quantity: 1, date: '2026-10-20T12:00:00Z' }];
    const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/existencias'] }, createElement(Routes, null,
      createElement(Route, { element: createElement(Outlet, { context: { products: [product], movements, status: 'ready', stockEnabled: true } }) },
        createElement(Route, { path: '/existencias', element: createElement(Existencias) })))));
    assert(html.includes('Movimientos de hoy'));
    assert.equal((html.match(/>Ver detalle</g) || []).length, 5);
    assert(!html.includes('Ver todos los productos'));
    assert(!html.includes('Ver en Kardex'));
    assert(!html.includes('SKU M1'));
    assert(!html.includes('oct.'));
    assert(!html.includes('<table'));
    assert(html.indexOf('Histórico 7') < html.indexOf('Histórico 6'));
    assert(!html.includes('Producto retirado'));
    assert(html.includes('/dashboard/alertas?estado=bajo'));
    assert(html.includes('/dashboard/alertas?estado=agotado'));
  });
  await t.test('Productos ordena por creación real, desempata por ID y conserva los órdenes anteriores', () => {
    const items=[{...product,id:1,name:'Primero alfabético',createdAt:'2026-10-01T12:00:00Z'},
      {...product,id:2,name:'Reciente A',createdAt:'2026-10-20T12:00:00Z'},
      {...product,id:3,name:'Reciente B',createdAt:'2026-10-20T12:00:00Z'},
      {...product,id:99,name:'Sin fecha',createdAt:'inválida'}];
    const original=structuredClone(items);
    const html=renderToStaticMarkup(createElement(MemoryRouter,null,createElement(Productos,{products:items})));
    const body=html.match(/<tbody>(.*?)<\/tbody>/s)[1];
    assert(body.indexOf('Reciente B')<body.indexOf('Reciente A'));
    assert(body.indexOf('Reciente A')<body.indexOf('Primero alfabético'));
    assert(body.indexOf('Primero alfabético')<body.indexOf('Sin fecha'));
    assert.match(html,/<option value="recent" selected="">Agregados recientemente/);
    for(const value of ['name','stock-asc','stock-desc','value-desc']) assert(html.includes(`value="${value}"`));
    assert.deepEqual(items,original);
  });
  await t.test('ficha del ojo conserva datos, un cierre y ningún enlace a Kardex ni barra superior', () => {
    const rich={...product,brand:'Marca original',model:'Modelo original',characteristics:'USB\nSensor óptico',createdAt:'2026-10-20T03:30:00Z',updatedAt:'2026-10-20T05:30:00Z',createdByName:'Autor original'};
    const html=renderToStaticMarkup(createElement(ProductDetailsDialog,{product:rich,onClose:()=>{}}));
    assert.equal((html.match(/<button/g)||[]).length,1);
    assert(html.includes('aria-label="Cerrar ficha"'));
    assert(!html.includes('<a ')&&!html.includes('Kardex')&&!html.includes('dialogToolbar'));
    for(const label of ['SKU','Categoría','Marca','Modelo','Estado administrativo','Características','Precio de venta','Stock actual','Stock mínimo','Disponibilidad','Fecha de creación','Última actualización','Registrado por','Marca original','Modelo original','Autor original']) assert(html.includes(label));
    for(const removed of ['Código de barras','Costo de compra','ID interno','type="file"']) assert(!html.includes(removed));
    assert(!html.includes('<input'));
  });
  await t.test('entrada por URL preselecciona el ID sin escribir y respeta solo lectura', () => {
    let calls = 0;
    const render = readOnly => renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/existencias?accion=entrada&producto=1'] }, createElement(Routes, null,
      createElement(Route, { element: createElement(Outlet, { context: { products: [product], status: 'ready', stockEnabled: true, readOnly, onStock: () => calls++ } }) },
        createElement(Route, { path: '/existencias', element: createElement(Existencias) })))));
    const html = render(false);
    assert.match(html, /<option value="1" selected="">M1 · Mouse/);
    assert.match(html, /<option value="stock_in" selected="">Entrada/);
    assert(!html.includes('Buscar producto para el movimiento'));
    assert(!html.includes('type="search"'));
    const labels = [...html.matchAll(/<label class="([^"]+)">(?:Producto \/ SKU|Tipo)<select/g)];
    assert.equal(labels.length, 2);
    assert.equal(labels[0][1], labels[1][1], 'ambos selectores reutilizan el mismo estilo premium');
    assert.equal((html.match(/<option value="1"/g) || []).length, 1);
    assert(!html.includes('Vista previa · pendiente de confirmación'));
    assert(!render(true).includes('<dialog'));
    assert.equal(calls, 0);
  });
  await t.test('listado compacto, siete columnas, cuatro tarjetas y paginación legible', () => {
    const products = Array.from({ length: 36 }, (_, i) => ({ ...product, id: i + 1, sku: `M${i}` }));
    const render = (items, url = '/productos') => renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [url] }, createElement(Productos, { products: items })));
    const html = render(products, '/productos?pagina=2');
    assert(!html.includes('Registrado por'));
    assert(!html.includes('Resumen general'));
    assert(!html.includes('>CATÁLOGO<'));
    assert.equal((html.match(/class="inv-stat"/g) || []).length, 4);
    assert(html.includes('Stock bajo') && html.includes('Valorizado'));
    assert.equal((html.match(/<th scope=/g) || []).length, 7);
    assert(html.includes('Página 2 de 3'));
    assert(html.includes('Anterior') && html.includes('Siguiente'));
    assert(render([]).includes('colSpan="7"'));
    assert.equal((html.match(/<input /g) || []).length, 1, 'solo búsqueda global, sin buscadores en filtros');

    const summary = render([
      { ...product, id: 1, isActive: true, stock: 2, minStock: 5, price: 100 },
      { ...product, id: 2, isActive: true, stock: 0, minStock: 5, price: 50 },
    ]);
    assert.match(summary, /<span>Stock bajo<\/span><strong>1<\/strong>/);
    assert(summary.includes('200.00'), 'el valorizado coincide con stock × precio unitario');
  });
  await t.test('confirmación de eliminación identifica producto, espera real y errores', () => {
    const render = props => renderToStaticMarkup(createElement(DeleteProductDialog, { product, ...props }));
    const html = render({});
    assert(html.includes('Eliminar producto'));
    assert(html.includes('<strong>Mouse</strong>'));
    assert(html.includes('Cancelar'));
    assert(html.includes('aria-describedby='));
    assert.match(render({ busy: true }), /aria-busy="true"[^>]*disabled=""[^>]*>Eliminando…/);
    assert(render({ error: 'Conflicto de versión' }).includes('Conflicto de versión'));
    assert(render({ uncertain: true, onRetry: () => {} }).includes('Reintentar eliminación'));
  });
  await t.test('ficha sin atributos ocultos, autor histórico y fechas de Lima', () => {
    const rich = { ...product, barcode: '000456', unitOfMeasure: 'Caja', createdByName: 'Autor original', createdAt: '2026-10-20T03:30:00Z', updatedAt: 'inválido' };
    const html = renderToStaticMarkup(createElement(ProductDetails, { product: rich, canReadPurchaseCost: true }));
    for (const hidden of ['Código de barras', 'Costo de compra', 'Unidad de medida', 'ID interno', 'Fotografía', '000456']) assert(!html.includes(hidden));
    assert(html.includes('Registrado por') && html.includes('Autor original'));
    assert(html.includes('19 oct') && (html.includes('22:30') || html.includes('10:30')));
    assert(html.includes('No registrado'));
  });
  await t.test('guardado accesible, deshabilitado y notificaciones de éxito/error', () => {
    const html = renderToStaticMarkup(createElement(ProductForm, { busy: true, onSave: async () => true }));
    assert.match(html, /<button[^>]*aria-busy="true"[^>]*disabled=""[^>]*>Guardando…/);
    for (const type of ['success', 'error']) {
      const message = type === 'success' ? 'El producto fue creado con éxito' : 'No se pudo guardar.';
      const toast = renderToStaticMarkup(createElement(InventoryToast, { toast: { message, type } }));
      assert(toast.includes(message));
      assert(toast.includes(`role="${type === 'error' ? 'alert' : 'status'}"`));
      assert(toast.includes('popover="manual"'));
    }
    assert.equal(renderToStaticMarkup(createElement(InventoryToast, { toast: null })), '');
  });
  await t.test('Nuevo producto abre con product null y valores iniciales', () => {
    const html = renderToStaticMarkup(createElement(ProductForm, { product: null,
      categories: ['Periféricos'], currentUser: { email: 'operador@example.test' }, onSave: async () => true }));
    assert(html.includes('Nuevo producto'));
    assert(html.includes('Registrar producto'));
    for (const [field, value] of Object.entries({ name: '', sku: '', price: '',
      minStock: '5', stock: '0', createdByName: 'operador@example.test' })) {
      assert.match(html, new RegExp(`<input[^>]*id="[^"]*-${field}"[^>]*value="${value}"`));
    }
    assert.match(html, /<option[^>]*selected=""[^>]*>Periféricos<\/option>/);
    assert.match(html, /<option value="true" selected="">Activo<\/option>/);
  });
  await t.test('edición conserva valores existentes, incluidos cero e inactivo', () => {
    const existing = { ...product, price: 0, purchaseCost: 0, minStock: 0 };
    const values = catalogFormValues(existing, 'Otra categoría');
    for (const field of ['name', 'sku', 'category', 'price', 'purchaseCost', 'minStock', 'isActive']) {
      assert.equal(values[field], existing[field]);
    }
    const html = renderToStaticMarkup(createElement(ProductForm, { product: existing,
      categories: ['Periféricos'], canReadPurchaseCost: true, onSave: async () => true }));
    assert(html.includes('Editar producto'));
    assert(html.includes('Guardar cambios'));
    assert(!html.includes('Stock inicial'));
    for (const field of ['price', 'minStock']) {
      assert.match(html, new RegExp(`<input[^>]*id="[^"]*-${field}"[^>]*value="0"`));
    }
    assert.match(html, /<option value="false" selected="">Inactivo<\/option>/);
  });
  await t.test('formulario nuevo y edición preparados sin endpoint ni stock editable', () => {
    for (const item of [undefined, product]) {
      const html = renderToStaticMarkup(createElement(ProductForm, { product: item, categories: ['Periféricos'], canReadPurchaseCost: true }));
      for (const label of ['Datos del producto', 'Características', 'Precio y existencias', 'Información de registro', 'Precio de venta']) assert(html.includes(label));
      for (const label of ['Código de barras', 'Cargar fotografía', 'Costo de compra', 'Unidad de medida', 'A ·', 'B ·', 'C ·', 'D ·']) assert(!html.includes(label));
      assert.match(html, /<button[^>]*disabled[^>]*>Guardar/);
      assert(html.includes('S/'));
      assert(html.includes('inputMode="decimal"'));
      assert(!/id="[^"]*-stock"/.test(html));
      assert(!html.includes('type="file"'));
    }
  });
  await t.test('costos no se renderizan sin autorización y solo lectura bloquea inputs', () => {
    const html = renderToStaticMarkup(createElement(ProductForm, { product, categories: ['Periféricos'], readOnly: true }));
    assert(!html.includes('Costo de compra'));
    assert.match(html, /<button[^>]*disabled[^>]*>Validar borrador/);
    for (const input of html.match(/<input[^>]*>/g)) assert(input.includes('disabled'));
    const details = renderToStaticMarkup(createElement(ProductDetails, { product }));
    assert(!details.includes('Costo de compra'));
  });
  await t.test('ficha separa inactivo de disponible, no inventa fecha ni agrega Kardex', () => {
    const html = renderToStaticMarkup(createElement(ProductDetails, { product, canReadPurchaseCost: true }));
    assert(html.includes('Inactivo'));
    assert(html.includes('Disponible'));
    assert(html.includes('No registrado'));
    assert(html.includes('Stock actual'));
    assert(!html.includes('<input'));
    assert(!html.includes('Kardex'));
    assert(!html.includes('undefined'));
  });
  await t.test('consulta de producto antiguo no inventa estado administrativo ni expone costos', () => {
    const legacy = { ...product };
    delete legacy.isActive;
    const html = renderToStaticMarkup(createElement(ProductDetails, { product: legacy }));
    assert(html.includes('No disponible'));
    assert(!html.includes('>Activo<'));
    assert(!html.includes('Costo de compra'));
    assert(html.includes('Disponible'));
  });
  await t.test('formulario conectado precarga atributos y permite stock solo al registrar', () => {
    const rich = { ...product, brand: 'Marca', model: 'Modelo', characteristics: 'USB', barcode: '000456', unitOfMeasure: 'Unidad', createdByName: 'Operador' };
    const edit = renderToStaticMarkup(createElement(ProductForm, { product: rich, categories: ['Periféricos'], canReadPurchaseCost: true, onSave: async () => true }));
    for (const value of ['Marca', 'Modelo', 'USB', 'Operador']) assert(edit.includes(value));
    assert(!edit.includes('000456'));
    assert(edit.includes('Guardar cambios'));
    assert(!edit.includes('Stock inicial'));
    const add = renderToStaticMarkup(createElement(ProductForm, { categories: ['Periféricos'], canReadPurchaseCost: true, onSave: async () => true }));
    assert(add.includes('Stock inicial'));
    assert(add.includes('Registrar producto'));
    const uncertain = renderToStaticMarkup(createElement(ProductForm, { product: rich, categories: ['Periféricos'], onSave: async () => true, onRetry: () => {}, uncertain: true }));
    assert(uncertain.includes('Reintentar guardado'));
    assert.match(uncertain, /<button[^>]*disabled[^>]*>Guardar cambios/);
  });
  await t.test('autor de sesión es de solo lectura y edición conserva al autor original', () => {
    const currentUser = { email: 'actual@example.test', user_metadata: { full_name: 'Usuario actual' } };
    const render = product => renderToStaticMarkup(createElement(ProductForm, { product, currentUser, categories: ['Periféricos'] }));
    assert.match(render(null), /<input[^>]*-createdByName"[^>]*readOnly=""[^>]*value="Usuario actual"/);
    assert.match(render({ ...product, createdByName: 'Autor original' }), /readOnly=""[^>]*value="Autor original"/);
    assert(!render(product).includes('Usuario actual'));
    const fallback = renderToStaticMarkup(createElement(ProductForm, { currentUser: { email: 'actual@example.test' } }));
    assert.match(fallback, /readOnly=""[^>]*value="actual@example.test"/);
  });
});
