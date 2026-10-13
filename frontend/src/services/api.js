/**
 * API client for the backend Lambda services.
 *
 * Every request goes to `${VITE_API_URL}/api/<service><path>`: the local CORS
 * proxy (port 3001) in development, CloudFront in AWS. All failures are
 * normalised into `ApiError` so UI code handles one error shape.
 */

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let tokenProvider = () => null;

/** Register a function that returns the current access token (set by auth). */
export function setTokenProvider(provider) {
  tokenProvider = provider;
}

function buildUrl(service, path, query) {
  const url = `${API_URL}/api/${service}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.append(key, value);
  });
  const search = params.toString();
  return search ? `${url}?${search}` : url;
}

/**
 * Send a request to a backend service.
 *
 * @param {string} service - Service name, e.g. 'projects'.
 * @param {string} [path] - Path within the service, e.g. '/12/archive'.
 * @param {object} [options] - { method, body, query, signal }.
 * @returns {Promise<any>} Parsed JSON body, or null for 204 responses.
 * @throws {ApiError}
 */
export async function apiRequest(service, path = '', { method = 'GET', body, query, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = tokenProvider();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(buildUrl(service, path, query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError(0, 'network_error', 'Unable to reach the server. Check your connection and try again.');
  }

  if (response.status === 204) return null;

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    // CloudFront rewrites unknown paths to index.html with a 200, so a non-JSON
    // response means the API route was not found.
    throw new ApiError(
      response.ok ? 404 : response.status,
      'unexpected_response',
      'The server returned an unexpected response.',
    );
  }

  const data = await response.json();
  if (!response.ok) {
    const error = data?.error || {};
    throw new ApiError(
      response.status,
      error.code || 'error',
      error.message || 'Request failed.',
      error.details,
    );
  }
  return data;
}

export const api = {
  get: (service, path, options) => apiRequest(service, path, { ...options, method: 'GET' }),
  post: (service, path, body, options) => apiRequest(service, path, { ...options, method: 'POST', body }),
  put: (service, path, body, options) => apiRequest(service, path, { ...options, method: 'PUT', body }),
  patch: (service, path, body, options) => apiRequest(service, path, { ...options, method: 'PATCH', body }),
  delete: (service, path, options) => apiRequest(service, path, { ...options, method: 'DELETE' }),
};
