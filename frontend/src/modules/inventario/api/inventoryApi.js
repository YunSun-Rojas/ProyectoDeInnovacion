import { api } from '../../../api/httpClient';

export function loadInventory(signal) {
  return api('/inventory', { signal });
}

export function saveInventoryChange(request) {
  return api('/inventory/changes', { method: 'POST', body: request });
}
