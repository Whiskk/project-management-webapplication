/**
 * API client for the backend Lambda services.
 *
 * Every request goes to `${VITE_API_URL}/api/<service><path>`: the local CORS
 * proxy (port 3001) in development, CloudFront in AWS. All failures are
 * normalised into `ApiError` so UI code handles one error shape. When an
 * access token has expired the request is transparently retried once after
 * refreshing the session.
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

const noAuth = {
  getAccessToken: () => null,
  refresh: null,
  onAuthFailure: () => {},
};
let authHandlers = noAuth;

/**
 * Connect the client to the session layer.
 *
 * @param {object} handlers
 * @param {() => string|null} handlers.getAccessToken - Current access token.
 * @param {() => Promise<void>} handlers.refresh - Refresh the session (throws on failure).
 * @param {() => void} handlers.onAuthFailure - Called when the session can no longer be used.
 */
export function configureAuth(handlers) {
  authHandlers = { ...noAuth, ...handlers };
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
 * @param {object} [options] - { method, body, query, signal, accept }. `accept` (e.g. 'text/csv')
 *   asks for a file instead of JSON; the response is then returned as a Blob.
 * @returns {Promise<any>} Parsed JSON body, a Blob when `accept` is given, or null for 204 responses.
 * @throws {ApiError}
 */
export async function apiRequest(service, path = '', options = {}) {
  const { method = 'GET', body, query, signal, accept, retried = false } = options;
  const headers = { Accept: accept ? `${accept}, application/json` : 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = authHandlers.getAccessToken();
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
  if (accept && response.ok && contentType.includes(accept)) return response.blob();
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
  if (response.ok) return data;

  const error = data?.error || {};
  if (response.status === 401 && token) {
    if (error.code === 'token_expired' && !retried && authHandlers.refresh) {
      try {
        await authHandlers.refresh();
      } catch {
        authHandlers.onAuthFailure();
        throw new ApiError(401, 'session_expired', 'Your session has expired. Please sign in again.');
      }
      return apiRequest(service, path, { ...options, retried: true });
    }
    authHandlers.onAuthFailure();
  }
  throw new ApiError(response.status, error.code || 'error', error.message || 'Request failed.', error.details);
}

export const api = {
  get: (service, path, options) => apiRequest(service, path, { ...options, method: 'GET' }),
  post: (service, path, body, options) => apiRequest(service, path, { ...options, method: 'POST', body }),
  put: (service, path, body, options) => apiRequest(service, path, { ...options, method: 'PUT', body }),
  patch: (service, path, body, options) => apiRequest(service, path, { ...options, method: 'PATCH', body }),
  delete: (service, path, options) => apiRequest(service, path, { ...options, method: 'DELETE' }),
  /** GET a file (e.g. accept = 'text/csv') as a Blob; errors still arrive as ApiError. */
  download: (service, path, accept, options) => apiRequest(service, path, { ...options, method: 'GET', accept }),
};

/** Save a Blob through the browser's download prompt. */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
