import { useCallback, useEffect, useRef, useState } from 'react';
import { loadInventory, saveInventoryChange } from '../api/inventoryApi';

const initialState = { products: [], categories: [], movements: [], sales: [], salesEnabled: false, stockEnabled: false, readOnly: true, status: 'loading', error: '' };

// El canal existente de notificaciones: una sola tarjeta, sin colas acumuladas.
export function useInventoryNotifications() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const dismissToast = useCallback(() => setToast(null), []);
  const notify = useCallback((message, type = 'success') => {
    setToast(previous => previous?.message === message && previous.type === type && !previous.closing
      ? previous : { message, type, closing: false });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(previous => previous ? { ...previous, closing: true } : null), 3500);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { toast, notify, dismissToast };
}

export function useInventory(userId) {
  const [state, setState] = useState(initialState);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const reading = useRef(true);
  const [writeError, setWriteError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const pendingRequest = useRef(null);
  const confirmedChange = useRef(null);
  const locked = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadInventory(controller.signal).then(data => {
      if (!controller.signal.aborted) setState({
        ...initialState,
        ...data,
        // Las versiones anteriores de la API todavía no envían ventas.
        sales: Array.isArray(data.sales) ? data.sales : [],
        salesEnabled: data.salesEnabled === true && Array.isArray(data.sales),
        stockEnabled: data.stockEnabled === true,
        status: 'ready', error: '',
      });
    }).catch(error => {
      if (!controller.signal.aborted) setState({
        ...initialState,
        status: 'error',
        error: error.message || 'No se pudo cargar el inventario. Vuelve a intentarlo.',
      });
    }).finally(() => {
      if (!controller.signal.aborted) {
        reading.current = false;
        setRefreshing(false);
      }
    });
    return () => controller.abort();
  }, [userId, attempt]);

  const retry = () => {
    if (reading.current || locked.current || pendingRequest.current) return;
    reading.current = true;
    setRefreshing(true);
    // Conservar la última lectura y el Outlet durante la actualización.
    setState(previous => previous.status === 'ready' ? previous : initialState);
    setAttempt(previous => previous + 1);
  };

  const execute = async (request, refreshAfterReplay = false) => {
    if (locked.current || reading.current) return false;
    locked.current = true;
    setSaving(true);
    setWriteError('');
    let confirmed = false;
    try {
      const result = await saveInventoryChange(request);
      confirmed = true;
      if (!active.current) return false;
      // Una RPC idempotente puede devolver la instantánea antigua de su primer
      // resultado. Tras reintentar, consultar el estado vigente sin otra escritura.
      const latest = refreshAfterReplay ? await loadInventory() : null;
      const product = result.product;
      const movement = result.movement;
      setState(previous => ({ ...previous,
        products: (product
          ? [...previous.products.filter(p => p.id !== product.id), product].sort((a, b) => a.id - b.id)
          : previous.products.filter(p => p.id !== request.productId)),
        movements: [movement, ...previous.movements.filter(m => m.id !== movement.id)],
        sales: result.sale ? [result.sale, ...(previous.sales ?? []).filter(sale => sale.id !== result.sale.id)] : (previous.sales ?? []),
        ...(latest ?? {}),
      }));
      // Respuesta de ESTA solicitud, independiente del orden del historial o de otras lecturas.
      confirmedChange.current = { requestId: request.requestId, action: request.action, productId: request.productId,
        product: product ? { ...product } : null, movement: movement ? { ...movement } : null };
      pendingRequest.current = null;
      setUncertain(false);
      return true;
    } catch (error) {
      if (!active.current) return false;
      const needsRetry = confirmed || Boolean(error.uncertain);
      if (!needsRetry) pendingRequest.current = null;
      setUncertain(needsRetry);
      setWriteError(error.message);
      return false;
    } finally {
      locked.current = false;
      if (active.current) setSaving(false);
    }
  };

  const mutate = async (action, product, data = {}) => {
    if (locked.current || reading.current || state.readOnly) return false;
    if (pendingRequest.current) {
      setWriteError('Hay un guardado pendiente de confirmar. Pulsa Reintentar guardado antes de realizar otro cambio.');
      return false;
    }
    try {
      const request = { requestId: crypto.randomUUID(), action,
        productId: product?.id ?? null, version: product?.version ?? null, data };
      pendingRequest.current = request;
      return await execute(request);
    } catch (error) { setWriteError(error.message); return false; }
  };

  return { ...state, retry, refreshing, saving: saving || refreshing, writeError, uncertain,
    getConfirmedChange: () => confirmedChange.current,
    retryWrite: () => pendingRequest.current ? execute(pendingRequest.current, true) : Promise.resolve(false),
    onAdd: data => mutate('add', null, data),
    onEdit: (product, data) => mutate('catalog_edit', product, data),
    onDelete: product => mutate('delete', product),
    onAdjustStock: (product, delta) => mutate('adjust', product, { delta }),
    onStock: (product, action, data) => state.stockEnabled && ['stock_in', 'stock_out', 'stock_adjust'].includes(action)
      ? mutate(action, product, data) : Promise.resolve(false),
    onSale: (product, data) => state.salesEnabled ? mutate('sale', product, data) : Promise.resolve(false),
  };
}
