import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { catalogFormValues } from '../../shared/catalogProduct.js';

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
  const { ProductForm, ProductDetails } = await import('../dist/catalog-ssr/components.mjs');
  const product = { id: 1, name: 'Mouse', sku: 'M1', category: 'Periféricos', stock: 8, minStock: 2, price: 80, purchaseCost: 45, isActive: false };
  await t.test('Nuevo producto abre con product null y valores iniciales', () => {
    const html = renderToStaticMarkup(createElement(ProductForm, { product: null,
      categories: ['Periféricos'], canReadPurchaseCost: true, onSave: async () => true }));
    assert(html.includes('Nuevo producto'));
    assert(html.includes('Registrar producto'));
    for (const [field, value] of Object.entries({ name: '', sku: '', price: '', purchaseCost: '',
      unitOfMeasure: 'Unidad', minStock: '5', stock: '0', createdByName: '' })) {
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
    for (const field of ['price', 'purchaseCost', 'minStock']) {
      assert.match(html, new RegExp(`<input[^>]*id="[^"]*-${field}"[^>]*value="0"`));
    }
    assert.match(html, /<option value="false" selected="">Inactivo<\/option>/);
  });
  await t.test('formulario nuevo y edición preparados sin endpoint ni stock editable', () => {
    for (const item of [undefined, product]) {
      const html = renderToStaticMarkup(createElement(ProductForm, { product: item, categories: ['Periféricos'], canReadPurchaseCost: true }));
      for (const label of ['Identificación', 'Características', 'Información comercial', 'Control básico', 'Código de barras', 'Precio de venta', 'Costo de compra']) assert(html.includes(label));
      assert.match(html, /<button[^>]*disabled[^>]*>Guardar/);
      assert.match(html, /<button[^>]*disabled[^>]*>Cargar fotografía/);
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
    for (const value of ['Marca', 'Modelo', 'USB', '000456', 'Operador']) assert(edit.includes(value));
    assert(edit.includes('Guardar cambios'));
    assert(!edit.includes('Stock inicial'));
    const add = renderToStaticMarkup(createElement(ProductForm, { categories: ['Periféricos'], canReadPurchaseCost: true, onSave: async () => true }));
    assert(add.includes('Stock inicial'));
    assert(add.includes('Registrar producto'));
    const uncertain = renderToStaticMarkup(createElement(ProductForm, { product: rich, categories: ['Periféricos'], onSave: async () => true, onRetry: () => {}, uncertain: true }));
    assert(uncertain.includes('Reintentar guardado'));
    assert.match(uncertain, /<button[^>]*disabled[^>]*>Guardar cambios/);
  });
});
