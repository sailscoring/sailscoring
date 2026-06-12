// @vitest-environment node

import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/lib/auth/require-workspace', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/require-workspace')>();
  return {
    ...original,
    requireWorkspace: vi.fn(),
  };
});

import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  workspaceRoute,
} from '@/app/api/v1/_lib/handler';
import {
  ForbiddenError,
  UnauthenticatedError,
  requireWorkspace,
} from '@/lib/auth/require-workspace';

const mockedRequire = requireWorkspace as ReturnType<typeof vi.fn>;

function makeRequest(method: string, body?: unknown): Request {
  return new Request('http://localhost/api/v1/x', {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
  });
}

const okWorkspace = {
  userId: 'u',
  email: 'e@x',
  workspaceId: 'w',
  role: 'owner' as const,
};

describe('workspaceRoute', () => {
  test('200 with JSON body when handler returns a value', async () => {
    mockedRequire.mockResolvedValueOnce(okWorkspace);
    const handler = workspaceRoute(async () => ({ ok: true }));
    const res = await handler(
      makeRequest('GET') as Parameters<typeof handler>[0],
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test('204 when handler returns undefined', async () => {
    mockedRequire.mockResolvedValueOnce(okWorkspace);
    const handler = workspaceRoute(async () => undefined);
    const res = await handler(
      makeRequest('DELETE') as Parameters<typeof handler>[0],
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(204);
  });

  test('401 when requireWorkspace throws UnauthenticatedError', async () => {
    mockedRequire.mockRejectedValueOnce(new UnauthenticatedError());
    const handler = workspaceRoute(async () => ({}));
    const res = await handler(
      makeRequest('GET') as Parameters<typeof handler>[0],
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthenticated' });
  });

  test('403 when requireWorkspace throws ForbiddenError', async () => {
    mockedRequire.mockRejectedValueOnce(new ForbiddenError('no-workspace'));
    const handler = workspaceRoute(async () => ({}));
    const res = await handler(
      makeRequest('GET') as Parameters<typeof handler>[0],
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', reason: 'no-workspace' });
  });

  test('404 when handler throws NotFoundError', async () => {
    mockedRequire.mockResolvedValueOnce(okWorkspace);
    const handler = workspaceRoute(async () => {
      throw new NotFoundError('series');
    });
    const res = await handler(
      makeRequest('GET') as Parameters<typeof handler>[0],
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not-found', resource: 'series' });
  });

  test('409 when handler throws ConflictError', async () => {
    mockedRequire.mockResolvedValueOnce(okWorkspace);
    const handler = workspaceRoute(async () => {
      throw new ConflictError({ currentVersion: 7 });
    });
    const res = await handler(
      makeRequest('PUT') as Parameters<typeof handler>[0],
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(409);
  });

  test('400 when handler throws ZodError', async () => {
    mockedRequire.mockResolvedValueOnce(okWorkspace);
    const handler = workspaceRoute(async () => {
      z.object({ x: z.number() }).parse({ x: 'no' });
    });
    const res = await handler(
      makeRequest('PUT', { x: 'no' }) as Parameters<typeof handler>[0],
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid');
  });

  test('400 when handler throws BadRequestError', async () => {
    mockedRequire.mockResolvedValueOnce(okWorkspace);
    const handler = workspaceRoute(async () => {
      throw new BadRequestError('bad', [{ path: 'x' }]);
    });
    const res = await handler(
      makeRequest('PUT') as Parameters<typeof handler>[0],
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(400);
  });

  test('500 when handler throws an unrecognised error', async () => {
    mockedRequire.mockResolvedValueOnce(okWorkspace);
    const handler = workspaceRoute(async () => {
      throw new Error('something');
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handler(
      makeRequest('GET') as Parameters<typeof handler>[0],
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(500);
    consoleSpy.mockRestore();
  });

  describe('role enforcement', () => {
    const asRole = (role: string) =>
      mockedRequire.mockResolvedValueOnce({ ...okWorkspace, role });

    const call = (
      method: string,
      opts?: Parameters<typeof workspaceRoute>[1],
    ) => {
      const handler = workspaceRoute(async () => ({ ok: true }), opts);
      return handler(makeRequest(method) as Parameters<typeof handler>[0], {
        params: Promise.resolve({}),
      });
    };

    test('member can GET but not write', async () => {
      asRole('member');
      expect((await call('GET')).status).toBe(200);
      asRole('member');
      const res = await call('PUT');
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: 'forbidden',
        reason: 'permission-denied:manage-series',
      });
    });

    test('scorer passes score routes but not the manage-series default', async () => {
      asRole('scorer');
      expect((await call('POST', { requires: 'score' })).status).toBe(200);
      asRole('scorer');
      expect((await call('POST')).status).toBe(403);
      asRole('scorer');
      expect((await call('PUT', { requires: 'manage-workspace' })).status).toBe(403);
    });

    test('member is denied score routes; explicit read writes pass', async () => {
      asRole('member');
      const res = await call('POST', { requires: 'score' });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: 'forbidden',
        reason: 'permission-denied:score',
      });
      asRole('member');
      expect((await call('POST', { requires: 'read' })).status).toBe(200);
    });

    test('admin passes everything, including manage-workspace and a GET demanding it', async () => {
      asRole('admin');
      expect((await call('DELETE', { requires: 'manage-workspace' })).status).toBe(200);
      asRole('admin');
      expect((await call('GET', { requires: 'manage-workspace' })).status).toBe(200);
    });

    test('an unrecognised role fails closed to read-only', async () => {
      asRole('superuser');
      expect((await call('GET')).status).toBe(200);
      asRole('superuser');
      expect((await call('POST', { requires: 'score' })).status).toBe(403);
    });
  });

  test('params are awaited and passed to the handler', async () => {
    mockedRequire.mockResolvedValueOnce(okWorkspace);
    const handler = workspaceRoute<{ id: string }, { seenId: string }>(
      async (_req, { params }) => ({ seenId: params.id }),
    );
    const res = await handler(
      makeRequest('GET') as Parameters<typeof handler>[0],
      { params: Promise.resolve({ id: 'series-42' }) },
    );
    expect(await res.json()).toEqual({ seenId: 'series-42' });
  });
});
