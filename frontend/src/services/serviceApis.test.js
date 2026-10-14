import { describe, expect, it } from 'vitest';
import { jsonResponse, mockFetchSequence } from '../test/fetch';
import { ApiError, api } from './api';
import { auditApi } from './auditApi';
import { usersApi } from './usersApi';

/** Call `run` against a mocked fetch; return the method, URL and parsed body it sent, and its result. */
async function captured(run, response = jsonResponse(200, { ok: true })) {
  const fetchMock = mockFetchSequence(response);
  const result = await run();
  const [url, options] = fetchMock.mock.calls[0];
  return { url, method: options.method, body: options.body ? JSON.parse(options.body) : undefined, result };
}

describe('usersApi', () => {
  it.each([
    ['list with filters', () => usersApi.list({ q: 'eli', role: 'employee', status: '' }), 'GET', '/api/users?q=eli&role=employee'],
    ['get one user', () => usersApi.get(7), 'GET', '/api/users/7'],
    ['reset a password', () => usersApi.resetPassword(7), 'POST', '/api/users/7/reset-password'],
    ['deactivate', () => usersApi.deactivate(7), 'POST', '/api/users/7/deactivate'],
    ['reactivate', () => usersApi.reactivate(7), 'POST', '/api/users/7/reactivate'],
  ])('%s', async (_name, run, method, url) => {
    const sent = await captured(run);
    expect(sent).toMatchObject({ method, url, body: undefined, result: { ok: true } });
  });

  it('creates a user with a JSON body and returns the created record', async () => {
    const data = { first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com', role: 'employee' };
    const sent = await captured(() => usersApi.create(data), jsonResponse(201, { id: 9, ...data }));
    expect(sent).toMatchObject({ method: 'POST', url: '/api/users', body: data, result: { id: 9 } });
  });

  it('updates another user with PATCH', async () => {
    const sent = await captured(() => usersApi.update(7, { job_title: 'Lead' }));
    expect(sent).toMatchObject({ method: 'PATCH', url: '/api/users/7', body: { job_title: 'Lead' } });
  });

  it('updates the signed-in user via /me', async () => {
    const sent = await captured(() => usersApi.updateMe({ email: 'new@example.com' }));
    expect(sent).toMatchObject({ method: 'PATCH', url: '/api/users/me', body: { email: 'new@example.com' } });
  });

  it('passes an abort signal through to fetch', async () => {
    const controller = new AbortController();
    const fetchMock = mockFetchSequence(jsonResponse(200, { items: [] }));
    await usersApi.list({}, controller.signal);
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('surfaces validation errors with field details', async () => {
    mockFetchSequence(jsonResponse(400, {
      error: { code: 'validation_error', message: 'Validation failed', details: { email: 'This email is already in use' } },
    }));
    const error = await usersApi.create({ email: 'taken@example.com' }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, details: { email: 'This email is already in use' } });
  });
});

describe('auditApi', () => {
  it('lists entries with filters, skipping empty ones', async () => {
    const sent = await captured(() => auditApi.list({ action: 'auth.login', outcome: 'denied', role: '', page: 2 }));
    expect(sent).toMatchObject({ method: 'GET', url: '/api/audit?action=auth.login&outcome=denied&page=2' });
  });

  it('loads the list of recorded action names', async () => {
    const sent = await captured(() => auditApi.actions(), jsonResponse(200, { items: ['auth.login', 'project.create'] }));
    expect(sent).toMatchObject({ method: 'GET', url: '/api/audit/actions', result: { items: ['auth.login', 'project.create'] } });
  });

  it('surfaces a 403 for non-admins as an ApiError', async () => {
    mockFetchSequence(jsonResponse(403, { error: { code: 'forbidden', message: 'Access denied' } }));
    const error = await auditApi.list({}).catch((e) => e);
    expect(error).toMatchObject({ status: 403, code: 'forbidden', message: 'Access denied' });
  });
});

describe('api.put', () => {
  it('sends a PUT with a JSON body (PUT is accepted as an alias of PATCH)', async () => {
    const sent = await captured(() => api.put('projects', '/3', { name: 'Apollo' }));
    expect(sent).toMatchObject({ method: 'PUT', url: '/api/projects/3', body: { name: 'Apollo' } });
  });
});
