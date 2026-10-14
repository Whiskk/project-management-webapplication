import { api } from './api';

/** Thin wrappers around the projects service endpoints. */
export const projectsApi = {
  list: (query, signal) => api.get('projects', '', { query, signal }),
  get: (id, signal) => api.get('projects', `/${id}`, { signal }),
  create: (data) => api.post('projects', '', data),
  update: (id, data) => api.patch('projects', `/${id}`, data),
  archive: (id) => api.post('projects', `/${id}/archive`),
  reactivate: (id, data = {}) => api.post('projects', `/${id}/reactivate`, data),
  team: (id, signal) => api.get('projects', `/${id}/assignments`, { signal }),
  staffingOptions: (id, signal) => api.get('projects', `/${id}/staffing-options`, { signal }),
  assign: (id, data) => api.post('projects', `/${id}/assignments`, data),
  updateAssignment: (id, assignmentId, data) => api.patch('projects', `/${id}/assignments/${assignmentId}`, data),
  removeAssignment: (id, assignmentId) => api.delete('projects', `/${id}/assignments/${assignmentId}`),
  milestones: (id, signal) => api.get('projects', `/${id}/milestones`, { signal }),
  createMilestone: (id, data) => api.post('projects', `/${id}/milestones`, data),
  updateMilestone: (id, milestoneId, data) => api.patch('projects', `/${id}/milestones/${milestoneId}`, data),
  deleteMilestone: (id, milestoneId) => api.delete('projects', `/${id}/milestones/${milestoneId}`),
  approvals: (signal) => api.get('projects', '/approvals', { signal }),
  approve: (id, assignmentId) => api.post('projects', `/${id}/assignments/${assignmentId}/approve`),
  reject: (id, assignmentId, note) => api.post('projects', `/${id}/assignments/${assignmentId}/reject`, note ? { note } : {}),
};
