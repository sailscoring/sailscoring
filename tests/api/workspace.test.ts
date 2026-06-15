// @vitest-environment node

/**
 * ADR-009 M4 — GET /api/v1/workspace returns the caller's resolved identity
 * and active workspace (the CLI's `whoami`). The handler is pure (everything
 * is already in the request's WorkspaceContext), so no DB is needed.
 */
import { describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/auth/require-workspace', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/auth/require-workspace')>();
  return { ...original, requireWorkspace: vi.fn() };
});

import { GET } from '@/app/api/v1/workspace/route';
import { requireWorkspace } from '@/lib/auth/require-workspace';

const mockedRequire = requireWorkspace as ReturnType<typeof vi.fn>;

describe('GET /api/v1/workspace (whoami)', () => {
  test('projects the caller-owned identity fields', async () => {
    mockedRequire.mockResolvedValue({
      userId: 'usr_1',
      email: 'skipper@hyc.test',
      workspaceId: 'org_1',
      workspaceSlug: 'hyc',
      role: 'owner',
      features: ['logo-library'],
    });

    const res = await GET(
      new Request('http://localhost/api/v1/workspace') as Parameters<typeof GET>[0],
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: 'usr_1',
      email: 'skipper@hyc.test',
      workspaceId: 'org_1',
      workspaceSlug: 'hyc',
      role: 'owner',
      features: ['logo-library'],
    });
  });
});
