import { vi } from 'vitest';

/** Build a minimal fetch Response stand-in. */
export function jsonResponse(status, body, contentType = 'application/json') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    json: async () => body,
  };
}

/** Mock global fetch to resolve with the given responses in order (last one repeats). */
export function mockFetchSequence(...responses) {
  const mock = vi.spyOn(globalThis, 'fetch');
  responses.forEach((response, index) => {
    if (index === responses.length - 1) mock.mockResolvedValue(response);
    else mock.mockResolvedValueOnce(response);
  });
  return mock;
}
