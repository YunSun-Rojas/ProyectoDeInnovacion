import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../auth/services/supabase';
import { loadInventory, mapProduct, mapMovement, productPayload, saveInventoryChange } from './inventory';

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
    loadInventory(supabase, userId, controller.signal).then(data => {
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
      const result = await saveInventoryChange(supabase, request);
      confirmed = true;
      if (!active.current) return false;
      const product = result.product ? mapProduct(result.product, state.categories) : null;
      const movement = mapMovement(result.movement);
      setState(previous => ({ ...previous,
        products: (product
          ? [...previous.products.filter(p => p.id !== product.id), product].sort((a, b) => a.id - b.id)
          : previous.products.filter(p => p.id !== request.p_product_id)),
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
      const payload = ['add', 'edit'].includes(action) ? productPayload(data) : data;
      const request = { p_request_id: crypto.randomUUID(), p_action: action,
        p_product_id: product?.id ?? null, p_expected_version: product?.version ?? null, p_data: payload };
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
