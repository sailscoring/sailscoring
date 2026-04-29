import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  ApiError,
  AuthError,
  ConflictApiError,
  ForbiddenApiError,
  NotFoundApiError,
  ValidationApiError,
  apiFetch,
} from '@/lib/api-client';

const fetchMock = vi.fn();

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockReset();
});

afterEach(() => {
  fetchMock.mockReset();
});

function makeResponse(status: number, body?: unknown): Response {
  if (body === undefined) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('apiFetch', () => {
  test('parses JSON on 200', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(200, { ok: true }));
    const result = await apiFetch('/x');
    expect(result).toEqual({ ok: true });
  });

  test('returns undefined on 204', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(204));
    const result = await apiFetch('/x', { method: 'DELETE' });
    expect(result).toBeUndefined();
  });

  test('returns undefined on 404 when allow404 is set', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(404, { error: 'not-found' }));
    const result = await apiFetch('/x', { allow404: true });
    expect(result).toBeUndefined();
  });

  test('throws AuthError on 401', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(401, { error: 'unauthenticated' }));
    await expect(apiFetch('/x')).rejects.toBeInstanceOf(AuthError);
  });

  test('throws ForbiddenApiError on 403 with reason', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(403, { error: 'forbidden', reason: 'no-workspace' }));
    const err = await apiFetch('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenApiError);
    expect((err as ForbiddenApiError).reason).toBe('no-workspace');
  });

  test('throws NotFoundApiError on 404 by default', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(404, { error: 'not-found', resource: 'series' }));
    const err = await apiFetch('/x').catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundApiError);
    expect((err as NotFoundApiError).resource).toBe('series');
  });

  test('throws ConflictApiError on 409 with detail', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(409, { error: 'conflict', detail: { v: 7 } }));
    const err = await apiFetch('/x', { method: 'PUT' }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictApiError);
    expect((err as ConflictApiError).detail).toEqual({ v: 7 });
  });

  test('throws ValidationApiError on 400 with issues', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(400, { error: 'invalid', issues: [{ path: 'x', message: 'bad' }] }),
    );
    const err = await apiFetch('/x', { method: 'PUT' }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationApiError);
    expect((err as ValidationApiError).issues).toEqual([{ path: 'x', message: 'bad' }]);
  });

  test('falls back to ApiError for other non-OK statuses', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(500, { error: 'internal' }));
    const err = await apiFetch('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
  });

  test('sends Idempotency-Key on PUT writes by default', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(200, { id: 'x' }));
    await apiFetch('/api/v1/series/x', { method: 'PUT', body: { id: 'x' } });
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['idempotency-key']).toBeTruthy();
    expect(headers['content-type']).toBe('application/json');
  });

  test('Idempotency-Key can be disabled with idempotencyKey: null', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(204));
    await apiFetch('/x', { method: 'DELETE', idempotencyKey: null });
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['idempotency-key']).toBeUndefined();
  });

  test('Idempotency-Key is suppressed on GET', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(200, []));
    await apiFetch('/x');
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['idempotency-key']).toBeUndefined();
  });
});
