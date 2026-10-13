import { api } from './api';

/** Thin wrappers around the users service endpoints. */
export const usersApi = {
  list: (query, signal) => api.get('users', '', { query, signal }),
  get: (id, signal) => api.get('users', `/${id}`, { signal }),
  create: (data) => api.post('users', '', data),
  update: (id, data) => api.patch('users', `/${id}`, data),
  updateMe: (data) => api.patch('users', '/me', data),
  resetPassword: (id) => api.post('users', `/${id}/reset-password`),
  deactivate: (id) => api.post('users', `/${id}/deactivate`),
  reactivate: (id) => api.post('users', `/${id}/reactivate`),
};
