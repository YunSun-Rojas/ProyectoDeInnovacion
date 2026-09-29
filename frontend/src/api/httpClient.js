export async function api(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, { method, credentials: 'same-origin', signal,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw Object.assign(new Error('No se pudo conectar con el backend. Comprueba que esté iniciado e inténtalo nuevamente.'), { uncertain: method !== 'GET' });
  }
  let data;
  try { data = await response.json(); }
  catch { throw Object.assign(new Error('Respuesta incompleta del servidor. Reintenta la operación.'), { uncertain: method !== 'GET' }); }
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') window.dispatchEvent(new CustomEvent('session-changed', { detail: null }));
    throw Object.assign(new Error(data.error || 'No se pudo completar la operación.'), {
      code: data.code, status: response.status,
      uncertain: typeof data.uncertain === 'boolean' ? data.uncertain : method !== 'GET' && response.status >= 500 });
  }
  return data;
}
