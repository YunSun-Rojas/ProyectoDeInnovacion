import { compareMovements, kardexPage } from './kardexData.js';
export { kardexPage as reportPage };
export const reportDay = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('sv-SE', { timeZone: 'America/Lima' }) : '';
const stock = n => Number.isSafeInteger(n) && n >= 0 && n <= 2147483647;
const sum = (rows, key) => {
  const value = rows.reduce((s,r) => s + r[key],0);
  if (!Number.isSafeInteger(value)) throw new Error('Las cantidades superan el límite de cálculo seguro.');
  return value;
};
export function validatePeriod(from, to) {
  for (const value of [from,to]) if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0,10) !== value)) return 'Selecciona fechas válidas.';
  return from && to && from > to ? 'La fecha inicial debe ser anterior o igual a la final.' : '';
}
function unique(rows, key) {
  const found = new Map();
  for (const row of rows) {
    for (const field of ['id','productId','product_id']) if (typeof row[field]==='number' && !Number.isSafeInteger(row[field])) throw new Error('Hay identificadores fuera del límite seguro.');
    const id = key(row);
    if (!id || id.includes('undefined') || id.includes('null')) throw new Error('Hay registros sin identificador verificable.');
    if (found.has(id) && JSON.stringify(found.get(id)) !== JSON.stringify(row)) throw new Error('Hay registros duplicados contradictorios. Actualiza la consulta.');
    found.set(id,row);
  }
  return [...found.values()];
}
export function periodBucket(day, group) {
  if (group === 'month') return day.slice(0,7) + '-01';
  if (group !== 'week') return day;
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay()+6)%7);
  return date.toISOString().slice(0,10);
}
export function buildReports(data, { from = '', to = '', group = 'day', top = 10 } = {}) {
  const error = validatePeriod(from,to);
  if (error) throw new Error(error);
  const inPeriod = date => (!from || date >= from) && (!to || date <= to);
  const products = unique(data.products || [], p => String(p.id));
  const history = unique(data.movements || [], m => String(m.id)).sort(compareMovements).map(m => {
    if (!reportDay(m.date) || !stock(m.before) || !stock(m.after)) throw new Error('Hay movimientos con fechas o saldos incompletos. No se pueden certificar sus totales.');
    const delta = m.after - m.before;
    return { ...m, day: reportDay(m.date), entries: Math.max(0,delta), exits: Math.max(0,-delta),
      origin: m.type === 'Ajuste' && String(m.reason).startsWith('Inventario físico ') ? 'Inventario físico' : m.type };
  });
  const sales = new Set();
  for (const m of history) if (m.saleId) {
    if (sales.has(m.saleId)) throw new Error('Una venta está vinculada a varios movimientos. Revisa el historial.');
    sales.add(m.saleId);
  }
  const movements = history.filter(m => inPeriod(m.day));
  const buckets = new Map();
  const rank = new Map();
  for (const m of movements) {
    const bucket = periodBucket(m.day,group);
    if (!buckets.has(bucket)) buckets.set(bucket,{ date:bucket, entries:0, exits:0, operations:0 });
    const b = buckets.get(bucket); b.entries += m.entries; b.exits += m.exits; b.operations++;
    if (m.exits > 0 && ['Salida','Venta'].includes(m.type)) {
      const key = m.productId == null ? `sin-id:${m.sku}` : String(m.productId);
      if (!rank.has(key)) rank.set(key,{ id:key, sku:m.sku, name:m.product, units:0, operations:0 });
      const r = rank.get(key); r.units += m.exits; r.operations++; r.name=m.product; r.sku=m.sku;
    }
  }
  const entries = sum(movements,'entries'), exits = sum(movements,'exits');
  const active = new Set(movements.filter(m=>m.productId != null).map(m=>String(m.productId)));
  const last = new Map();
  for (const m of history) if (m.productId != null) last.set(String(m.productId),m.date);
  const uncertainSkus = new Set(history.filter(m=>m.productId == null).map(m=>m.sku));
  const inactive = products.filter(p=>!active.has(String(p.id))).map(p=>({ ...p, last:last.get(String(p.id)) || null,
    inactivity: uncertainSkus.has(p.sku) ? 'Identidad no verificable: existen movimientos sin ID' : last.has(String(p.id)) ? 'Sin movimiento en el periodo' : 'Sin movimientos registrados' }));
  let cents = 0, covered = 0;
  const valuation = products.map(p=>{
    if (!stock(p.stock)) throw new Error('Hay existencias inválidas para valorizar.');
    const cost = p.purchaseCost;
    const unitCents = typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? Math.round(cost*100) : null;
    const valid = unitCents !== null && Number.isSafeInteger(unitCents) && Math.abs(cost*100-unitCents)<0.0001 && Number.isSafeInteger(unitCents*p.stock);
    if (valid) { cents += unitCents*p.stock; covered++; }
    return { ...p, cost:valid?cost:null, value:valid?unitCents*p.stock/100:null };
  });
  if (!Number.isSafeInteger(cents)) throw new Error('La valorización supera el límite de cálculo seguro.');
  const sessions = unique(data.physical?.sessions || [],s=>s.id).filter(s=>{
    const day=reportDay(s.created_at);
    if (!day) throw new Error('Hay sesiones con fechas inválidas.');
    return inPeriod(day);
  });
  for (const s of sessions) if (!['borrador','en revisión','finalizado','cancelado'].includes(s.status)) throw new Error('Estado de conteo desconocido.');
  const sessionById = new Map(sessions.map(s=>[s.id,s]));
  let counted=0, matched=0;
  const countLines = unique(data.physical?.lines || [],l=>`${l.session_id}:${l.product_id}`).filter(l=>sessionById.has(l.session_id)).map(l=>{
    if (!stock(l.reference_stock) || (l.physical_quantity !== null && !stock(l.physical_quantity))) throw new Error('Hay cantidades de conteo inválidas.');
    const session=sessionById.get(l.session_id);
    const delta=l.physical_quantity === null?null:l.physical_quantity-l.reference_stock;
    if (delta !== null && session.status !== 'cancelado') { counted++; if(delta===0) matched++; }
    return { ...l, session, delta, surplus:delta===null?0:Math.max(0,delta), shortage:delta===null?0:Math.max(0,-delta) };
  });
  const differences=countLines.filter(l=>l.delta!==null && l.delta!==0);
  const linesBySession=new Map();
  for (const line of countLines) {
    if (!linesBySession.has(line.session_id)) linesBySession.set(line.session_id,[]);
    linesBySession.get(line.session_id).push(line);
  }
  const countSessions=sessions.map(s=>{
    const lines=linesBySession.get(s.id)||[];
    return {...s, counted:lines.filter(l=>l.delta!==null).length, pending:lines.filter(l=>l.delta===null).length,
      differences:lines.filter(l=>l.delta!==null && l.delta!==0).length, surplus:sum(lines,'surplus'), shortage:sum(lines,'shortage')};
  });
  return { movements, series:[...buckets.values()].sort((a,b)=>a.date.localeCompare(b.date)), entries, exits, net:entries-exits,
    ranking:[...rank.values()].sort((a,b)=>b.units-a.units || a.sku.localeCompare(b.sku)).slice(0,[5,10,20].includes(Number(top))?Number(top):10),
    inactive, valuation, value:covered?cents/100:null, covered, total:products.length,
    countSessions, differences, counted, matched, accuracy:counted?matched/counted*100:null,
    empty:products.filter(p=>p.stock===0).length,
    zeroTransitions:movements.filter(m=>m.before>0 && m.after===0 && m.type!=='Baja').length,
  };
}
export function searchReport(rows, query='', sort='name') {
  const text=query.trim().toLocaleLowerCase('es');
  return rows.filter(r=>[r.name,r.sku,r.product,r.product_name,r.id,r.session_id].some(v=>String(v??'').toLocaleLowerCase('es').includes(text)))
    .sort((a,b)=>sort==='date'?Date.parse(b.date??b.created_at??b.session?.created_at??0)-Date.parse(a.date??a.created_at??a.session?.created_at??0):sort==='stock'?(a.stock??0)-(b.stock??0):sort==='units'?(b.units??0)-(a.units??0):String(a.name??a.product_name??a.product??a.id).localeCompare(String(b.name??b.product_name??b.product??b.id),'es'));
}
export function reportsCsv(title, headers, rows, {from='',to='',note=''}={}) {
  const cell=value=>{
    let text=String(value??'No disponible');
    let probe=text;
    while(probe.length && (probe.charCodeAt(0)<=32 || /\s/.test(probe[0]))) probe=probe.slice(1);
    if(typeof value==='string' && /^[=+@-]/.test(probe)) text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  };
  return '\uFEFF'+[[title],['Desde (Lima)',from||'Todo el historial'],['Hasta (Lima)',to||'Último registro'],['Metodología',note],headers,...rows].map(row=>row.map(cell).join(';')).join('\r\n');
}
