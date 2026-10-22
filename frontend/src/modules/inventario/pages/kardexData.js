export const limaDay = value => new Date(value).toLocaleDateString('sv-SE', { timeZone: 'America/Lima' });
const hasId = value => value !== null && value !== undefined && value !== '';
const movementKey = row => hasId(row.productId) ? String(row.productId) : `sin-id:${row.sku || ''}`;
const validStock = value => Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;

export function kardexToday(movements, now = new Date()) {
  const day = limaDay(now), seen = new Set();
  return movements.filter(row => {
    if (!hasId(row.id) || !Number.isFinite(Date.parse(row.date)) || limaDay(row.date) !== day
      || !validStock(row.before) || !validStock(row.after) || row.before === row.after
      || !['Alta', 'Entrada', 'Salida', 'Ajuste', 'Venta', 'Baja'].includes(row.type)) return false;
    const id = String(row.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).sort((a, b) => compareMovements(b, a)).map(row => ({ ...row, delta: row.after - row.before, productKey: movementKey(row) }));
}

export function compareMovements(a, b) {
  const time = Date.parse(a.date) - Date.parse(b.date);
  if (Number.isFinite(time) && time !== 0) return time;
  const left = String(a.id), right = String(b.id);
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) return BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0;
  return left.localeCompare(right, 'es', { numeric: true });
}

export function kardexProducts(products, movements) {
  const choices = new Map(products.map(product => [String(product.id), {
    ...product, key: String(product.id), archived: false, legacy: false, search: [product.name, product.sku],
  }]));
  for (const row of [...movements].sort(compareMovements)) {
    const key = movementKey(row);
    if (!choices.has(key)) choices.set(key, { key, id: row.productId ?? null, name: row.product,
      sku: row.sku, stock: null, category: '', archived: true, legacy: !hasId(row.productId), search: [] });
    const choice = choices.get(key);
    choice.search.push(row.product, row.sku);
    if (choice.archived) { choice.name = row.product; choice.sku = row.sku; }
  }
  return [...choices.values()].map(choice => ({ ...choice,
    search: choice.search.filter(Boolean).join(' ').toLocaleLowerCase('es'),
  })).sort((a, b) => String(a.name).localeCompare(String(b.name), 'es') || a.key.localeCompare(b.key));
}

function dateError(from, to) {
  for (const value of [from, to]) {
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))
      || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)) return 'Selecciona fechas válidas.';
  }
  return from && to && from > to ? 'La fecha inicial no puede ser posterior a la fecha final.' : '';
}

export function buildKardex(choice, movements, { from = '', to = '', type = 'Todos', audit = false } = {}) {
  const result = { rows: [], periodRows: [], opening: null, closing: null, entries: 0, exits: 0, warnings: [], error: dateError(from, to) };
  if (!choice || result.error) return result;
  const warnings = new Set();
  const unique = new Map();
  let invalid = false;
  for (const movement of movements.filter(row => movementKey(row) === choice.key)) {
    if (!hasId(movement.id) || !Number.isFinite(Date.parse(movement.date)) || !validStock(movement.before) || !validStock(movement.after)) {
      invalid = true;
      warnings.add('Hay registros con fecha o stock incompleto. No se pueden certificar los saldos ni completar sus totales.');
      continue;
    }
    const id = String(movement.id);
    if (unique.has(id)) {
      if (JSON.stringify(unique.get(id)) !== JSON.stringify(movement)) {
        invalid = true;
        warnings.add('Hay versiones diferentes de un mismo movimiento. Actualiza el inventario antes de interpretar los saldos.');
      }
      continue;
    }
    unique.set(id, movement);
  }
  const history = [...unique.values()].sort(compareMovements).map(row => {
    const delta = row.after - row.before;
    return { ...row, day: limaDay(row.date), delta, entry: Math.max(0, delta), exit: Math.max(0, -delta),
      reference: `${row.saleId ? `Venta ${row.saleId} · ` : ''}Movimiento #${row.id}` };
  });
  result.periodRows = history.filter(row => (!from || row.day >= from) && (!to || row.day <= to));
  result.entries = result.periodRows.reduce((sum, row) => sum + row.entry, 0);
  result.exits = result.periodRows.reduce((sum, row) => sum + row.exit, 0);
  if (!Number.isSafeInteger(result.entries) || !Number.isSafeInteger(result.exits)) {
    invalid = true;
    warnings.add('Las cantidades acumuladas superan el límite de cálculo seguro.');
  }
  result.rows = result.periodRows.filter(row => (audit || row.delta !== 0) && (type === 'Todos' || row.type === type));
  const first = history[0], last = history.at(-1);
  const origin = first?.type === 'Alta' && first.before === 0;
  const previous = from ? history.filter(row => row.day < from).at(-1) : null;
  const final = history.filter(row => !to || row.day <= to).at(-1);
  result.opening = previous ? previous.after : origin ? 0 : null;
  result.closing = final ? final.after : origin ? 0 : null;
  if (!history.length) warnings.add('Este producto no tiene movimientos verificables. El stock actual no permite reconstruir sus saldos históricos.');
  else if (!origin) warnings.add('No consta un alta inicial. Los saldos anteriores al primer registro disponible son desconocidos.');
  for (let index = 1; index < history.length; index++) {
    const before = history[index - 1], after = history[index];
    if (before.after !== after.before && (!to || before.day <= to) && (!from || after.day >= from)) {
      warnings.add('Hay una discontinuidad entre movimientos que afecta al período. Las entradas y salidas muestran solo cantidades registradas; el saldo final no es reconstruible con certeza.');
      result.closing = null;
      if (!from || (before.day < from && after.day >= from)) result.opening = null;
    }
  }
  if (!choice.archived && last && choice.stock !== last.after && (!to || to >= last.day)) {
    warnings.add('El último saldo no coincide con el stock actual. Actualiza la consulta; si persiste, el historial disponible está incompleto.');
    result.closing = null;
    if (from && from > last.day) result.opening = null;
  }
  if (choice.archived && !choice.legacy && last && last.type !== 'Baja' && (!to || to >= last.day)) {
    warnings.add('El producto está fuera del catálogo y no consta su baja. No se puede certificar el saldo final después del último registro.');
    result.closing = null;
    if (from && from > last.day) result.opening = null;
  }
  const knownSkus = new Set([choice.sku, ...history.map(row => row.sku)]);
  if (choice.legacy || movements.some(row => !hasId(row.productId) && knownSkus.has(row.sku))) {
    warnings.add(choice.legacy
      ? 'Historial antiguo sin ID de producto: se agrupa por SKU, pero no se puede garantizar su identidad ni certificar saldos.'
      : 'Existen registros del mismo SKU sin ID de producto. Se consultan por separado para evitar mezclar identidades; los saldos no se certifican.');
    result.opening = null;
    result.closing = null;
  }
  if (invalid) { result.opening = null; result.closing = null; result.entries = null; result.exits = null; }
  result.warnings = [...warnings];
  return result;
}

export function kardexPage(rows, requestedPage, size = 25) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const requested = Number(requestedPage);
  const page = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, pages) : 1;
  return { page, pages, rows: rows.slice((page - 1) * size, page * size) };
}

const csvCell = value => {
  let text = String(value ?? '');
  const first = [...text].find(char => char.charCodeAt(0) > 32 && !/\s/.test(char));
  if (typeof value === 'string' && first && '=+@-'.includes(first)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
export const kardexDate = value => new Date(value).toLocaleString('es-PE', { timeZone: 'America/Lima' });

export function kardexCsv(choice, ledger, { from = '', to = '', type = 'Todos' } = {}) {
  const balance = value => value == null ? 'No reconstruible' : value;
  // Texto explícito sin fórmulas: Excel puede mostrar el apóstrofo protector.
  const skuText = value => value == null || value === '' ? '' : `'${String(value)}`;
  const lines = [
    ['Kardex de inventario'], ['Información general'], ['Producto', choice.name], ['SKU actual o último conocido', skuText(choice.sku)],
    ['Identidad de producto', choice.id ?? 'Sin ID'], ['Desde (Lima)', from || 'Todo el historial'], ['Hasta (Lima)', to || 'Último registro disponible'],
    ['Tipo de movimiento seleccionado', type], ['Estado del producto', choice.legacy ? 'Sin identidad histórica verificable' : choice.archived ? 'Fuera del catálogo' : 'En el catálogo'],
    ['Stock actual', choice.archived ? 'Fuera del catálogo actual' : choice.stock],
    [], ['Resumen del producto'],
    ['Saldo inicial del período', balance(ledger.opening)], ['Entradas registradas del período (todos los tipos)', balance(ledger.entries)],
    ['Salidas registradas del período (todos los tipos)', balance(ledger.exits)], ['Saldo final del período', balance(ledger.closing)],
    ...ledger.warnings.map(warning => ['Advertencia de historial', warning]), [],
    ['Movimientos del producto'],
    ['Fecha y hora (Perú, UTC−05:00)', 'Producto histórico', 'SKU histórico', 'Tipo', 'Entrada', 'Salida', 'Stock anterior', 'Saldo posterior', 'Motivo', 'Responsable', 'N.º de movimiento / referencia'],
    ...ledger.rows.map(row => [kardexDate(row.date), row.product, skuText(row.sku), row.type, row.entry, row.exit, row.before, row.after, row.reason, row.user, row.reference]),
  ];
  return '\uFEFF' + lines.map(line => line.map(csvCell).join(';')).join('\r\n');
}
