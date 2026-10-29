import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CalendarDays, CircleAlert, Eye, Plus, RefreshCw, Search, ShoppingBag, ShoppingCart, Truck, X } from 'lucide-react';
import { loadCommerce, saveCommerce } from '../api/commerceApi';
import s from './Operations.module.css';

const today = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return parts;
};
const makeId = () => crypto.randomUUID();
const quantity = value => new Intl.NumberFormat('es-PE').format(Number(value) || 0);
const currency = value => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(Number(value) || 0);
const displayDate = value => value ? new Date(`${String(value).slice(0, 10)}T12:00:00-05:00`).toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function Operations({ kind }) {
  const isPurchase = kind === 'purchase';
  const { products = [], readOnly = true, retry, notify } = useOutletContext();
  const [data, setData] = useState({ suppliers: [], purchases: [], sales: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('todos');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('date');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(null);
  const [pending, setPending] = useState(null);
  const lock = useRef(false);
  const abortRef = useRef(null);
  const docs = isPurchase ? data.purchases : data.sales;
  const load = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController(); abortRef.current = controller;
    return loadCommerce(controller.signal).then(result => {
      if (!controller.signal.aborted) { setData(result); setError(''); }
    }).catch(reason => {
      if (!controller.signal.aborted && reason.name !== 'AbortError') setError(reason.message || 'No se pudieron cargar los documentos.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
  }, []);
  useEffect(() => { load(); return () => abortRef.current?.abort(); }, [load]);
  const refresh = () => { setLoading(true); return load(); };
  const filtered = useMemo(() => docs.filter(doc => {
    const searchText = `${doc.code} ${isPurchase ? doc.supplier_name : doc.customer} ${doc.reference}`.toLocaleLowerCase('es');
    const date = String(isPurchase ? doc.purchase_date : doc.sale_date).slice(0, 10);
    return (!query || searchText.includes(query.toLocaleLowerCase('es'))) && (status === 'todos' || doc.status === status) && (!from || date >= from) && (!to || date <= to);
  }).sort((a, b) => sort === 'amount' ? Number(b.total) - Number(a.total) : new Date(b.created_at) - new Date(a.created_at)), [docs, isPurchase, query, status, from, to, sort]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const visible = filtered.slice((page - 1) * 10, page * 10);

  const run = async body => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await saveCommerce(body); setPending(null); await refresh();
      if (body.action !== 'create' && body.kind !== 'supplier') retry?.();
      if (body.kind === 'supplier') notify?.('Proveedor guardado.');
      else notify?.(body.action === 'create' ? 'Documento creado como pendiente.' : body.action === 'receive' ? 'Compra recibida y stock actualizado.' : body.action === 'confirm' ? 'Venta confirmada y stock actualizado.' : 'Documento cancelado.');
      if (body.action === 'create' && body.kind !== 'supplier') setCreating(false);
      return true;
    } catch (reason) {
      setError(reason.message || 'No se pudo guardar el documento.');
      if (reason.uncertain) setPending(body);
      return false;
    } finally { lock.current = false; setBusy(false); }
  };
  const submitCreate = async (form, lines, supplier) => {
    const id = makeId();
    const body = { kind, action: 'create', id, data: {
      ...(isPurchase ? { supplierId: supplier.id || null, supplierName: supplier.name || '' } : { customer: supplier.name || '' }),
      date: form.date, reference: form.reference, notes: form.notes,
      lines: lines.map(line => ({
        id: makeId(), reversal_id: makeId(), product_id: Number(line.productId), quantity: Number(line.quantity),
        ...(isPurchase ? { unit_cost: Number(line.price) } : { unit_price: Number(line.price) }),
      })),
    } };
    const ok = await run(body);
    if (ok) setCreating(false);
  };
  const act = async (doc, action) => {
    const labels = { receive: '¿Confirmas la recepción? Esto sumará las unidades al stock.', confirm: '¿Confirmas esta venta? Se descontarán las unidades del stock.', cancel: '¿Cancelar este documento? Si ya afectó el stock, se registrará una reversión auditada.' };
    if (!window.confirm(labels[action])) return;
    const ok = await run({ kind, action, id: doc.id });
    if (ok) setSelected(current => current ? { ...current, status: action === 'cancel' ? 'cancelada' : isPurchase ? 'recibida' : 'confirmada' } : current);
  };

  const Icon = isPurchase ? Truck : ShoppingCart;
  const title = isPurchase ? 'Compras' : 'Ventas';
  const totalUnits = doc => (doc.lines || []).reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  return <div className={s.page}>
    <header className={s.header}>
      <div><span className={s.eyebrow}>EAGLE GAMING · OPERACIONES</span><h1>{title}</h1><p>{isPurchase ? 'Gestiona proveedores, recepciones y costos de compra.' : 'Registra ventas y controla cada salida del inventario.'}</p></div>
      <div className={s.actions}><Link to="/dashboard" className={s.secondary}><ArrowLeft size={16} /> Panel</Link><button type="button" className={s.primary} onClick={() => setCreating(true)} disabled={readOnly}><Plus size={17} /> Nueva {isPurchase ? 'compra' : 'venta'}</button></div>
    </header>
    {readOnly && <p className={s.notice}><CircleAlert size={17} /> Tu cuenta tiene acceso de solo lectura. Puedes consultar operaciones, pero no crear ni procesar documentos.</p>}
    {error && <div className={s.error} role="alert"><span>{error}</span>{pending && <button type="button" className={s.secondary} disabled={busy} onClick={() => run(pending)}><RefreshCw size={15} /> Reintentar la misma solicitud</button>}</div>}
    <section className={s.filters} aria-label="Filtros de documentos">
      <label className={s.search}><Search size={17} /><input aria-label="Buscar por código o proveedor" placeholder={`Buscar ${isPurchase ? 'código o proveedor' : 'código o cliente'}…`} value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} /></label>
      <label>Estado<select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="todos">Todos</option><option value="pendiente">Pendiente</option><option value={isPurchase ? 'recibida' : 'confirmada'}>{isPurchase ? 'Recibida' : 'Confirmada'}</option><option value="cancelada">Cancelada</option></select></label>
      <label><CalendarDays size={15} /> Desde<input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label>
      <label><CalendarDays size={15} /> Hasta<input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></label>
      <label>Ordenar<select value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}><option value="date">Más recientes</option><option value="amount">Mayor importe</option></select></label>
    </section>
    <section className={s.panel}>
      <div className={s.panelHeading}><div><Icon size={19} /><div><h2>Registro de {title.toLocaleLowerCase('es')}</h2><p>{loading ? 'Actualizando…' : `${quantity(filtered.length)} documentos`}</p></div></div><button type="button" className={s.iconButton} onClick={refresh} disabled={loading} aria-label="Actualizar"><RefreshCw size={17} /></button></div>
      {loading ? <div className={s.loading} role="status">Cargando operaciones…</div> : filtered.length ? <>
        <div className={s.tableWrap}><table><thead><tr><th>Código</th><th>Fecha</th><th>{isPurchase ? 'Proveedor' : 'Cliente'}</th><th>Unidades</th><th>Total</th><th>Estado</th><th>Responsable</th><th /></tr></thead><tbody>
          {visible.map(doc => <tr key={doc.id}><td className={s.code}>{doc.code}</td><td>{displayDate(isPurchase ? doc.purchase_date : doc.sale_date)}</td><td>{isPurchase ? doc.supplier_name : doc.customer || 'Público general'}</td><td>{quantity(totalUnits(doc))}</td><td className={s.amount}>{currency(doc.total)}</td><td><span className={`${s.badge} ${s[doc.status]}`}>{doc.status}</span></td><td>{doc.actor_email || '—'}</td><td><button type="button" className={s.viewButton} onClick={() => setSelected(doc)}><Eye size={15} /> Detalle</button></td></tr>)}
        </tbody></table></div>
        <div className={s.pagination}><span>{quantity(filtered.length)} documentos · Página {page} de {pageCount}</span><div><button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}><ArrowLeft size={15} /> Anterior</button><button type="button" onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={page >= pageCount}>Siguiente <ArrowRight size={15} /></button></div></div>
      </> : <div className={s.empty}><ShoppingBag size={32} /><strong>{error ? 'No se pudo cargar la lista' : 'Aún no hay documentos'}</strong><p>{error ? 'Verifica que la migración esté aplicada y que el backend pueda acceder a Supabase.' : 'Crea el primer documento para comenzar a registrar operaciones reales.'}</p>{!error && <button type="button" className={s.secondary} onClick={() => setCreating(true)} disabled={readOnly}><Plus size={15} /> Nueva {isPurchase ? 'compra' : 'venta'}</button>}</div>}
    </section>
    {creating && <OperationForm kind={kind} products={products} suppliers={data.suppliers} busy={busy} serverError={error} pending={pending} onRetry={async () => { const body = pending; if (!body) return null; return await run(body) ? body : null; }} onClose={() => !busy && setCreating(false)} onSubmit={submitCreate} onSupplier={async name => {
      const id = makeId(); const ok = await run({ kind: 'supplier', action: 'save', id, data: { name } }); return ok ? { id, name } : null;
    }} />}
    {selected && <DetailDialog doc={selected} kind={kind} busy={busy} readOnly={readOnly} error={error} pending={pending} onRetry={async () => pending && await run(pending)} onClose={() => setSelected(null)} onAction={act} />}
  </div>;
}

function OperationForm({ kind, products, suppliers, busy, serverError, pending, onRetry, onClose, onSubmit, onSupplier }) {
  const isPurchase = kind === 'purchase';
  const [date, setDate] = useState(today()); const [reference, setReference] = useState(''); const [notes, setNotes] = useState('');
  const [supplierId, setSupplierId] = useState(''); const [supplierName, setSupplierName] = useState(''); const [newSupplier, setNewSupplier] = useState(false);
  const [customer, setCustomer] = useState(''); const [lines, setLines] = useState([{ productId: '', quantity: '1', price: '' }]); const [error, setError] = useState('');
  const total = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.price) || 0), 0);
  const updateLine = (index, patch) => setLines(previous => previous.map((line, i) => i === index ? { ...line, ...patch } : line));
  const selectProduct = (index, id) => {
    const product = products.find(item => String(item.id) === id);
    updateLine(index, { productId: id, price: isPurchase ? (product?.purchaseCost == null ? '' : String(product.purchaseCost)) : String(product?.price ?? '') });
  };
  const submit = async event => {
    event.preventDefault(); setError('');
    if (lines.some(line => !line.productId || !Number.isSafeInteger(Number(line.quantity)) || Number(line.quantity) <= 0 || !Number.isFinite(Number(line.price)) || Number(line.price) < 0 || Math.round(Number(line.price) * 100) !== Number(line.price) * 100)) { setError('Selecciona productos y verifica cantidades y precios con hasta dos decimales.'); return; }
    if (new Set(lines.map(line => line.productId)).size !== lines.length) { setError('Cada producto debe aparecer una sola vez; actualiza su cantidad en la misma línea.'); return; }
    let supplier = { id: supplierId || null, name: customer };
    if (isPurchase) {
      if (newSupplier) {
        if (!supplierName.trim()) { setError('Escribe el nombre del proveedor.'); return; }
        supplier = await onSupplier(supplierName.trim()); if (!supplier) return;
      } else {
        const saved = suppliers.find(item => item.id === supplierId);
        if (!saved) { setError('Selecciona un proveedor o agrega uno nuevo.'); return; }
        supplier = { id: saved.id, name: saved.name };
      }
    }
    await onSubmit({ date, reference, notes }, lines, supplier);
  };
  const selectable = products.filter(product => !lines.some(line => line.productId === String(product.id)));
  return <div className={s.backdrop} role="presentation"><section className={s.dialog} role="dialog" aria-modal="true" aria-labelledby="operation-title">
    <header className={s.dialogHeader}><div><span className={s.eyebrow}>{isPurchase ? 'ENTRADA DE MERCADERÍA' : 'SALIDA POR VENTA'}</span><h2 id="operation-title">Nueva {isPurchase ? 'compra' : 'venta'}</h2><p>Al guardar quedará pendiente. El stock cambia al {isPurchase ? 'recibir la compra' : 'confirmar la venta'}.</p></div><button type="button" className={s.iconButton} onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={19} /></button></header>
    <form onSubmit={submit}>
      <div className={s.formGrid}><label>Fecha<input type="date" value={date} required onChange={e => setDate(e.target.value)} /></label><label>Documento de referencia<input maxLength="120" value={reference} onChange={e => setReference(e.target.value)} placeholder="Factura, boleta…" /></label>
      {isPurchase ? <label className={s.wide}>Proveedor<select value={newSupplier ? '__new__' : supplierId} onChange={e => { setNewSupplier(e.target.value === '__new__'); setSupplierId(e.target.value === '__new__' ? '' : e.target.value); }} required><option value="">Selecciona proveedor</option>{suppliers.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}<option value="__new__">+ Agregar proveedor nuevo</option></select>{newSupplier && <input className={s.extraField} value={supplierName} maxLength="180" onChange={e => setSupplierName(e.target.value)} placeholder="Nombre del proveedor" required />}</label>
        : <label className={s.wide}>Cliente (opcional)<input maxLength="180" value={customer} onChange={e => setCustomer(e.target.value)} placeholder="Público general" /></label>}
      </div>
      <div className={s.linesHeading}><h3>Productos</h3><button type="button" className={s.secondary} onClick={() => setLines(previous => [...previous, { productId: '', quantity: '1', price: '' }])} disabled={busy || !selectable.length}><Plus size={15} /> Agregar línea</button></div>
      <div className={s.lineList}>{lines.map((line, index) => { const product = products.find(item => String(item.id) === line.productId); return <div className={s.line} key={index}>
        <label className={s.productField}>Producto<select required value={line.productId} onChange={e => selectProduct(index, e.target.value)}><option value="">Selecciona producto</option>{product && <option value={line.productId}>{product.name} · {product.sku}</option>}{selectable.map(item => <option key={item.id} value={String(item.id)}>{item.name} · {item.sku}</option>)}</select>{product && <small>{isPurchase ? `Stock actual: ${quantity(product.stock)}` : `Disponible: ${quantity(product.stock)}`}</small>}{!isPurchase && product && Number(line.quantity) > product.stock && <small className={s.stockWarning}>Stock insuficiente para confirmar; la venta quedará pendiente.</small>}</label>
        <label>Cantidad<input type="number" min="1" step="1" required value={line.quantity} onChange={e => updateLine(index, { quantity: e.target.value })} /></label>
        <label>{isPurchase ? 'Costo unitario' : 'Precio unitario'}<input type="number" min="0" step="0.01" required value={line.price} onChange={e => updateLine(index, { price: e.target.value })} /></label>
        <div className={s.lineSubtotal}><small>Subtotal</small><strong>{currency((Number(line.quantity) || 0) * (Number(line.price) || 0))}</strong><button type="button" className={s.removeLine} aria-label="Quitar producto" disabled={lines.length === 1} onClick={() => setLines(previous => previous.filter((_, i) => i !== index))}><X size={16} /></button></div>
      </div>; })}</div>
      <label className={s.notes}>Observaciones<textarea maxLength="1000" rows="2" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notas opcionales" /></label>
      <div className={s.totalRow}><span>Total del documento</span><strong>{currency(total)}</strong></div>
      {error && <p className={s.errorText} role="alert">{error}</p>}
      {(serverError || pending) && <p className={s.errorText} role="alert">{serverError || 'El servidor pudo haber recibido la solicitud.'}{pending && <> Reintenta el mismo envío para confirmar sin duplicar. <button type="button" className={s.secondary} disabled={busy} onClick={async () => { const sent = await onRetry(); if (sent?.kind === 'supplier') { setSupplierId(sent.id); setSupplierName(''); setNewSupplier(false); } }}>Reintentar la misma solicitud</button></>}</p>}
    <footer className={s.dialogActions}><button type="button" className={s.secondary} onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" className={s.primary} disabled={busy || !lines.length}>{busy ? 'Guardando…' : 'Guardar como pendiente'}</button></footer>
    </form>
  </section></div>;
}

function DetailDialog({ doc, kind, busy, readOnly, error, pending, onRetry, onClose, onAction }) {
  const isPurchase = kind === 'purchase';
  const label = isPurchase ? 'Compra' : 'Venta';
  const date = isPurchase ? doc.purchase_date : doc.sale_date;
  const canWrite = !busy && !readOnly;
  return <div className={s.backdrop} role="presentation"><section className={`${s.dialog} ${s.detailDialog}`} role="dialog" aria-modal="true" aria-labelledby="detail-title">
    <header className={s.dialogHeader}><div><span className={s.eyebrow}>{label.toLocaleUpperCase('es')} · {doc.status}</span><h2 id="detail-title">{doc.code}</h2><p>{displayDate(date)} · Responsable: {doc.actor_email || '—'}</p></div><button type="button" className={s.iconButton} onClick={onClose} disabled={busy} aria-label="Cerrar detalle"><X size={19} /></button></header>
    <div className={s.detailMeta}><div><small>{isPurchase ? 'Proveedor' : 'Cliente'}</small><strong>{isPurchase ? doc.supplier_name : doc.customer || 'Público general'}</strong></div><div><small>Documento</small><strong>{doc.reference || 'Sin referencia'}</strong></div><div><small>Unidades</small><strong>{quantity((doc.lines || []).reduce((sum, line) => sum + Number(line.quantity), 0))}</strong></div></div>
    <div className={s.tableWrap}><table><thead><tr><th>Producto</th><th>Cantidad</th><th>{isPurchase ? 'Costo' : 'Precio'} unitario</th><th>Subtotal</th></tr></thead><tbody>{(doc.lines || []).map(line => <tr key={line.id}><td><strong>{line.product_name}</strong><small className={s.sku}>{line.sku}</small></td><td>{quantity(line.quantity)}</td><td>{currency(isPurchase ? line.unit_cost : line.unit_price)}</td><td className={s.amount}>{currency(line.subtotal)}</td></tr>)}</tbody></table></div>
    {doc.notes && <p className={s.detailNotes}>{doc.notes}</p>}
    <div className={s.totalRow}><span>Total {label.toLocaleLowerCase('es')}</span><strong>{currency(doc.total)}</strong></div>
    {(error || pending) && <p className={s.errorText} role="alert">{error || 'El servidor pudo haber recibido el cambio.'}{pending && <> Puedes reintentar la misma operación. <button type="button" className={s.secondary} disabled={busy} onClick={onRetry}>Reintentar</button></>}</p>}
    <footer className={s.dialogActions}><button type="button" className={s.secondary} onClick={onClose} disabled={busy}>Cerrar</button>
      {doc.status === 'pendiente' && <><button type="button" className={s.dangerButton} onClick={() => onAction(doc, 'cancel')} disabled={!canWrite}>Cancelar documento</button><button type="button" className={s.primary} onClick={() => onAction(doc, isPurchase ? 'receive' : 'confirm')} disabled={!canWrite}>{isPurchase ? 'Recibir y aumentar stock' : 'Confirmar y descontar stock'}</button></>}
      {doc.status === 'confirmada' && !doc.legacy && <button type="button" className={s.dangerButton} onClick={() => onAction(doc, 'cancel')} disabled={!canWrite}>Revertir venta</button>}
    </footer>
  </section></div>;
}
