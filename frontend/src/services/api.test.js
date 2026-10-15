import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, mockFetchSequence } from '../test/fetch';
import { ApiError, api, apiRequest, configureAuth } from './api';

const expired = jsonResponse(401, { error: { code: 'token_expired', message: 'Expired' } });

afterEach(() => configureAuth({}));

describe('apiRequest', () => {
  it('returns parsed JSON on success', async () => {
    const fetchMock = mockFetchSequence(jsonResponse(200, { status: 'ok' }));
    await expect(api.get('health')).resolves.toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.objectContaining({ method: 'GET' }));
  });

  it('builds query strings and skips empty values', async () => {
    const fetchMock = mockFetchSequence(jsonResponse(200, []));
    await api.get('projects', '', { query: { q: 'apollo', archived: false, role: '', page: undefined } });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/projects?q=apollo&archived=false');
  });

  it('sends JSON bodies and the bearer token', async () => {
    configureAuth({ getAccessToken: () => 'tok123' });
    const fetchMock = mockFetchSequence(jsonResponse(201, { id: 1 }));
    await api.post('projects', '', { name: 'Apollo' });
    const [, options] = fetchMock.mock.calls[0];
    expect(options.body).toBe('{"name":"Apollo"}');
    expect(options.headers).toMatchObject({ Authorization: 'Bearer tok123', 'Content-Type': 'application/json' });
  });

  it('returns null for 204 responses', async () => {
    mockFetchSequence(jsonResponse(204, null));
    await expect(api.delete('projects', '/1')).resolves.toBeNull();
  });

  it('converts error responses into ApiError with details', async () => {
    mockFetchSequence(jsonResponse(400, {
      error: { code: 'validation_error', message: 'Validation failed', details: { name: 'Required' } },
    }));
    const error = await apiRequest('projects', '', { method: 'POST', body: {} }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'validation_error', details: { name: 'Required' } });
  });

  it('treats non-JSON responses (CloudFront index.html fallback) as not found', async () => {
    mockFetchSequence(jsonResponse(200, '<html>', 'text/html'));
    const error = await api.get('missing').catch((e) => e);
    expect(error).toMatchObject({ status: 404, code: 'unexpected_response' });
  });

  it('downloads files as a Blob, asking for the file type', async () => {
    const blob = new Blob(['a,b']);
    const fetchMock = mockFetchSequence({ ...jsonResponse(200, null, 'text/csv; charset=utf-8'), blob: async () => blob });
    await expect(api.download('audit', '/export', 'text/csv', { query: { q: 'x' } })).resolves.toBe(blob);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/audit/export?q=x');
    expect(fetchMock.mock.calls[0][1].headers.Accept).toBe('text/csv, application/json');
  });

  it('still reports JSON errors from a download', async () => {
    mockFetchSequence(jsonResponse(403, { error: { code: 'forbidden', message: 'Nope' } }));
    const error = await api.download('audit', '/export', 'text/csv').catch((e) => e);
    expect(error).toMatchObject({ status: 403, code: 'forbidden' });
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

describe('expired tokens', () => {
  it('refreshes once and retries the request with the new token', async () => {
    let token = 'old';
    const refresh = vi.fn(async () => { token = 'new'; });
    configureAuth({ getAccessToken: () => token, refresh });
    const fetchMock = mockFetchSequence(expired, jsonResponse(200, { ok: true }));

    await expect(api.get('projects')).resolves.toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer new');
  });

  it('ends the session when the refresh fails', async () => {
    const onAuthFailure = vi.fn();
    configureAuth({ getAccessToken: () => 'old', refresh: vi.fn().mockRejectedValue(new Error('x')), onAuthFailure });
    mockFetchSequence(expired);

    const error = await api.get('projects').catch((e) => e);
    expect(error).toMatchObject({ status: 401, code: 'session_expired' });
    expect(onAuthFailure).toHaveBeenCalled();
  });

  it('does not loop if the retried request is still rejected', async () => {
    const refresh = vi.fn().mockResolvedValue();
    const onAuthFailure = vi.fn();
    configureAuth({ getAccessToken: () => 'tok', refresh, onAuthFailure });
    const fetchMock = mockFetchSequence(expired);

    const error = await api.get('projects').catch((e) => e);
    expect(error.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledOnce();
    expect(onAuthFailure).toHaveBeenCalledOnce();
  });

  it('ends the session on other 401s when a token was sent (e.g. deactivated account)', async () => {
    const onAuthFailure = vi.fn();
    configureAuth({ getAccessToken: () => 'tok', refresh: vi.fn(), onAuthFailure });
    mockFetchSequence(jsonResponse(401, { error: { code: 'unauthorized', message: 'Inactive' } }));
    await api.get('projects').catch(() => {});
    expect(onAuthFailure).toHaveBeenCalledOnce();
  });

  it('leaves anonymous 401s (bad login) to the caller', async () => {
    const onAuthFailure = vi.fn();
    configureAuth({ getAccessToken: () => null, onAuthFailure });
    mockFetchSequence(jsonResponse(401, { error: { code: 'unauthorized', message: 'Invalid employee ID or password' } }));
    const error = await api.post('auth', '/login', {}).catch((e) => e);
    expect(error.message).toBe('Invalid employee ID or password');
    expect(onAuthFailure).not.toHaveBeenCalled();
  });
});
