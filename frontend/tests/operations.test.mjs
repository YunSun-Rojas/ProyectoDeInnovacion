import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { isValidElement } from 'react';
import { build, normalizePath } from 'vite';
import react from '@vitejs/plugin-react';

// Exercise the component's JSX and event handlers in Node without a browser or a real API.
let rendering;
export function useState(initial) {
  const { values } = rendering;
  const index = rendering.index++;
  if (index === values.length) values.push(typeof initial === 'function' ? initial() : initial);
  return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
}
export const useRef = initial => useState(() => ({ current: initial }))[0];
export const useEffect = () => {};
export const useMemo = calculate => calculate();
export const useCallback = callback => callback;
export const useOutletContext = () => ({ products: [{ id: 1, name: 'Mouse', stock: 5, price: 19.99, purchaseCost: 0.29 }], readOnly: false });
export const Link = 'a';

let Operations;
before(async () => {
  const component = fileURLToPath(new URL('../src/modules/inventario/pages/Operations.jsx', import.meta.url));
  await build({
    configFile: false,
    root: fileURLToPath(new URL('../', import.meta.url)),
    logLevel: 'error',
    plugins: [react(), {
      name: 'operations-test-hooks',
      enforce: 'pre',
      resolveId(id, importer) {
        if (importer === normalizePath(component) && ['react', 'react-router-dom'].includes(id)) {
          return { id: import.meta.url, external: true };
        }
      },
    }],
    ssr: { noExternal: ['react', 'react-router-dom'] },
    build: {
      ssr: component,
      outDir: fileURLToPath(new URL('../dist/operations-ssr', import.meta.url)),
      emptyOutDir: false,
      rolldownOptions: {
        external: ['react/jsx-runtime', 'lucide-react'],
        output: { entryFileNames: 'operations.mjs' },
      },
    },
  });
  ({ default: Operations } = await import('../dist/operations-ssr/operations.mjs'));
});

function find(tree, predicate) {
  const nodes = Array.isArray(tree) ? tree : [tree];
  for (const node of nodes) {
    if (Array.isArray(node)) {
      const match = find(node, predicate);
      if (match) return match;
    } else if (isValidElement(node)) {
      if (predicate(node)) return node;
      const match = find(node.props.children, predicate);
      if (match) return match;
    }
  }
}

function mount(kind) {
  const page = { values: [] };
  let dialog = { values: [] };
  function render(instance, Component, props) {
    rendering = instance;
    instance.index = 0;
    return Component(props);
  }
  function pageTree() { return render(page, Operations, { kind }); }
  function dialogElement() {
    const element = find(pageTree(), node => typeof node.props.onSubmit === 'function' && node.props.kind === kind);
    if (!element) dialog = { values: [] };
    return element;
  }
  return {
    pageTree,
    dialogElement,
    dialogTree() {
      const element = dialogElement();
      return render(dialog, element.type, element.props);
    },
  };
}

const supplier = { id: '00000000-0000-4000-8000-000000000005', name: 'Proveedor de prueba' };
const emptyCommerce = { suppliers: [supplier], purchases: [], sales: [] };
const event = { preventDefault() {} };
const change = (element, value) => element.props.onChange({ target: { value } });
const input = (tree, step) => find(tree, node => node.type === 'input' && node.props.step === step);
const saveButton = tree => find(tree, node => node.type === 'button' && node.props.type === 'submit');
const submit = tree => find(tree, node => node.type === 'form').props.onSubmit(event);

async function openDraft(view, kind, price, units = '1') {
  const tree = view.pageTree();
  await find(tree, node => node.props['aria-label'] === 'Actualizar').props.onClick();
  find(view.pageTree(), node => node.type === 'button' && node.props.children.includes?.(' Nueva ')).props.onClick();
  const form = view.dialogTree();
  if (kind === 'purchase') {
    change(find(form, node => node.type === 'select' && find(node.props.children, option => option.props.value === supplier.id)), supplier.id);
  }
  change(find(form, node => node.type === 'select' && find(node.props.children, option => option.props.value === '1')), '1');
  change(input(form, '1'), units);
  change(input(form, '0.01'), price);
  change(find(form, node => node.type === 'input' && node.props.maxLength === '120'), 'REF-1');
}

test('el formulario comercial acepta decimales exactos y rechaza precios o cantidades inválidos', async t => {
  const posts = [];
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    assert.equal(url, '/api/inventory/commerce');
    if (request.method === 'POST') posts.push(JSON.parse(request.body));
    return Response.json(emptyCommerce);
  });
  for (const [price, units, expected] of [
    ['19.99', '1', 19.99], ['0.29', '1', 0.29], ['.29', '1', 0.29],
    ['0', '1', 0], ['20', '2', 20], ['-0.01', '1'], ['abc', '1'],
    ['', '1'], ['1.001', '1'], ['1.230', '1'], ['0.29', '0'], ['0.29', '-1'],
    ['0.29', '1.5'], ['0.29', '2147483648'], ['0.29', 'abc'],
  ]) {
    const view = mount('sale');
    await openDraft(view, 'sale', price, units);
    const before = posts.length;
    await submit(view.dialogTree());
    if (expected === undefined) {
      assert.equal(posts.length, before, `${price} × ${units}`);
      assert.ok(find(view.dialogTree(), node => node.props.role === 'alert'));
    } else {
      assert.equal(posts.length, before + 1, `${price} × ${units}`);
      assert.equal(posts.at(-1).data.lines[0].unit_price, expected);
      assert.equal(posts.at(-1).data.lines[0].quantity, Number(units));
      assert.equal(view.dialogElement(), undefined);
    }
  }
});

for (const kind of ['purchase', 'sale']) {
  test(`${kind}: un borrador guardado con respuesta incierta se reintenta sin duplicarlo`, async t => {
    const documents = new Map();
    const posts = [];
    let release;
    const firstResponse = new Promise(resolve => { release = resolve; });
    t.mock.method(globalThis, 'fetch', async (url, request) => {
      assert.equal(url, '/api/inventory/commerce');
      if (request.method === 'GET') return Response.json(emptyCommerce);
      posts.push(request.body);
      const body = JSON.parse(request.body);
      if (documents.has(body.id)) assert.equal(documents.get(body.id), request.body);
      documents.set(body.id, request.body);
      if (posts.length === 1) {
        await firstResponse;
        throw new Error('Respuesta perdida después de guardar.');
      }
      if (posts.length === 2) return Response.json({ error: 'Servicio temporalmente inaccesible.' }, { status: 503 });
      return Response.json({ operation: { status: 'pendiente' } });
    });
    const view = mount(kind);
    await openDraft(view, kind, '19.99', '2');
    const originalForm = view.dialogTree();
    const first = submit(originalForm);
    await submit(originalForm);
    assert.equal(posts.length, 1, 'bloquea el segundo envío mientras espera');
    release();
    await first;

    let form = view.dialogTree();
    assert.equal(saveButton(form).props.disabled, true);
    assert.equal(input(form, '0.01').props.value, '19.99');
    assert.equal(input(form, '0.01').props.disabled, true);
    await submit(form);
    await submit(originalForm);
    find(form, node => node.props['aria-label'] === 'Cerrar').props.onClick();
    assert.ok(view.dialogElement(), 'el formulario sigue abierto');
    assert.equal(posts.length, 1);

    const retry = tree => find(tree, node => node.type === 'button' && node.props.children === 'Reintentar la misma solicitud').props.onClick();
    await retry(form);
    form = view.dialogTree();
    assert.equal(saveButton(form).props.disabled, true);
    await retry(form);
    assert.equal(posts.length, 3);
    assert.deepEqual(posts, [posts[0], posts[0], posts[0]]);
    assert.equal(documents.size, 1);
    const saved = JSON.parse(posts[0]);
    assert.equal(saved.kind, kind);
    assert.equal(saved.data.reference, 'REF-1');
    assert.equal(saved.data.lines[0][kind === 'purchase' ? 'unit_cost' : 'unit_price'], 19.99);
    assert.equal(view.dialogElement(), undefined, 'cierra tras confirmar');

    await openDraft(view, kind, '0.29');
    await submit(view.dialogTree());
    assert.equal(documents.size, 2, 'una nueva operación deliberada sigue disponible');
  });
}
