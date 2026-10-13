import { api } from './api';

/** Thin wrappers around the projects service endpoints. */
export const projectsApi = {
  list: (query, signal) => api.get('projects', '', { query, signal }),
  get: (id, signal) => api.get('projects', `/${id}`, { signal }),
  create: (data) => api.post('projects', '', data),
  update: (id, data) => api.patch('projects', `/${id}`, data),
  archive: (id) => api.post('projects', `/${id}/archive`),
  reactivate: (id, data = {}) => api.post('projects', `/${id}/reactivate`, data),
};
