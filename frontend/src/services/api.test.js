import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, apiRequest, setTokenProvider } from './api';

function mockFetch({ status = 200, body, contentType = 'application/json' } = {}) {
  const response = {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    json: async () => body,
  };
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
}

afterEach(() => setTokenProvider(() => null));

describe('apiRequest', () => {
  it('returns parsed JSON on success', async () => {
    const fetchMock = mockFetch({ body: { status: 'ok' } });
    await expect(api.get('health')).resolves.toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.objectContaining({ method: 'GET' }));
  });

  it('builds query strings and skips empty values', async () => {
    const fetchMock = mockFetch({ body: [] });
    await api.get('projects', '', { query: { q: 'apollo', archived: false, role: '', page: undefined } });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/projects?q=apollo&archived=false');
  });

  it('sends JSON bodies and the bearer token', async () => {
    setTokenProvider(() => 'tok123');
    const fetchMock = mockFetch({ status: 201, body: { id: 1 } });
    await api.post('projects', '', { name: 'Apollo' });
    const [, options] = fetchMock.mock.calls[0];
    expect(options.body).toBe('{"name":"Apollo"}');
    expect(options.headers).toMatchObject({ Authorization: 'Bearer tok123', 'Content-Type': 'application/json' });
  });

  it('returns null for 204 responses', async () => {
    mockFetch({ status: 204 });
    await expect(api.delete('projects', '/1')).resolves.toBeNull();
  });

  it('converts error responses into ApiError with details', async () => {
    mockFetch({
      status: 400,
      body: { error: { code: 'validation_error', message: 'Validation failed', details: { name: 'Required' } } },
    });
    const error = await apiRequest('projects', '', { method: 'POST', body: {} }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'validation_error', details: { name: 'Required' } });
  });

  it('treats non-JSON responses (CloudFront index.html fallback) as not found', async () => {
    mockFetch({ status: 200, contentType: 'text/html', body: '<html>' });
    const error = await api.get('missing').catch((e) => e);
    expect(error).toMatchObject({ status: 404, code: 'unexpected_response' });
  });

  it('reports network failures with a friendly message', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const error = await api.get('health').catch((e) => e);
    expect(error).toMatchObject({ status: 0, code: 'network_error' });
  });

  it('rethrows aborts so callers can ignore them', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const error = await api.get('health').catch((e) => e);
    expect(error.name).toBe('AbortError');
  });
});
