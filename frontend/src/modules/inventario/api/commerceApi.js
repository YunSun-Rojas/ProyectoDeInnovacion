import { api } from '../../../api/httpClient';

export const loadCommerce = signal => api('/inventory/commerce', { signal });
export const saveCommerce = body => api('/inventory/commerce', { method: 'POST', body });
