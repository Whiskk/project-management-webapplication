import { api } from './api';

/** Read-only audit log (admins only). */
export const auditApi = {
  list: (query, signal) => api.get('audit', '', { query, signal }),
  actions: (signal) => api.get('audit', '/actions', { signal }),
};
