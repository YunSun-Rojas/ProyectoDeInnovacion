import { useEffect, useRef, useState } from 'react';
import { loadInventory, saveInventoryChange } from '../api/inventoryApi';

const initialState = { products: [], categories: [], movements: [], readOnly: true, status: 'loading', error: '' };

export function useInventory(userId) {
  const [state, setState] = useState(initialState);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [writeError, setWriteError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const pendingRequest = useRef(null);
  const locked = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadInventory(controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ ...data, status: 'ready', error: '' });
    }).catch(error => {
      if (!controller.signal.aborted) setState({
        ...initialState,
        status: 'error',
        error: error.message || 'No se pudo cargar el inventario. Vuelve a intentarlo.',
      });
    });
    return () => controller.abort();
  }, [userId, attempt]);

  const retry = () => {
    setState(initialState);
    setAttempt(previous => previous + 1);
  };

  const execute = async request => {
    if (locked.current) return false;
    locked.current = true;
    setSaving(true);
    setWriteError('');
    let confirmed = false;
    try {
      const result = await saveInventoryChange(request);
      confirmed = true;
      if (!active.current) return false;
      const product = result.product;
      const movement = result.movement;
      setState(previous => ({ ...previous,
        products: (product
          ? [...previous.products.filter(p => p.id !== product.id), product].sort((a, b) => a.id - b.id)
          : previous.products.filter(p => p.id !== request.productId)),
        movements: [movement, ...previous.movements.filter(m => m.id !== movement.id)],
      }));
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
    if (locked.current || state.readOnly) return false;
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

  return { ...state, retry, saving, writeError, uncertain,
    retryWrite: () => pendingRequest.current ? execute(pendingRequest.current) : Promise.resolve(false),
    onAdd: data => mutate('add', null, data),
    onEdit: (product, data) => mutate('edit', product, data),
    onDelete: product => mutate('delete', product),
    onAdjustStock: (product, delta) => mutate('adjust', product, { delta }),
  };
}
