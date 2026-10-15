import { api } from '../../../api/httpClient';

export function loadReports(signal) {
  return api('/inventory/reports', { signal });
}

export function loadPendingDifferences(signal) {
  return api('/inventory/alerts', { signal });
}

export function loadInventory(signal) {
  return api('/inventory', { signal });
}

export function saveInventoryChange(request) {
  return api('/inventory/changes', { method: 'POST', body: request });
}

export function listPhysicalCounts(signal) {
  return api('/inventory/physical', { signal });
}
export function physicalCount(body) {
  return api('/inventory/physical', { method: 'POST', body });
}
