import { api } from './api';

/** Most rows one export returns (matches EXPORT_LIMIT in the audit service). */
export const EXPORT_LIMIT = 5000;

/** Read-only audit log (admins, and managers within their scope). */
export const auditApi = {
  list: (query, signal) => api.get('audit', '', { query, signal }),
  actions: (signal) => api.get('audit', '/actions', { signal }),
  /** The filtered log as a CSV Blob. */
  exportCsv: (query) => api.download('audit', '/export', 'text/csv', { query }),
};
