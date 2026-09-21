import { beforeEach, describe, expect, it, vi } from 'vitest';

const { revalidateTag, recordActivity } = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  recordActivity: vi.fn(async () => {}),
}));

vi.mock('next/cache', () => ({ revalidateTag }));
vi.mock('@/lib/activity-log', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/activity-log')>()),
  recordActivity,
}));

import { RateLimitedError } from '@/app/api/v1/_lib/handler';
import { forceSourceRefresh, wantsRefresh } from '@/lib/api-handlers/handicap-source-refresh';
import { ForbiddenError } from '@/lib/auth/require-workspace';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';

/**
 * The server half of "Refresh from source" (#594): who may force a refetch,
 * how often, and what it actually invalidates. The button itself is covered
 * by the IRC e2e; what matters here is that a feed nobody asked about is not
 * discarded, and that a held-down button is refused with a wait rather than
 * passed through to someone else's server.
 */

function ctx(role: WorkspaceContext['role']): WorkspaceContext {
  return {
    userId: 'u1',
    email: 'scorer@example.com',
    workspaceId: 'w1',
    workspaceSlug: 'club',
    role,
    features: ['orc', 'irc-rating', 'echo', 'vprs-rating'],
  } as WorkspaceContext;
}

beforeEach(() => {
  revalidateTag.mockClear();
  recordActivity.mockClear();
  vi.useRealTimers();
});

describe('forceSourceRefresh', () => {
  it('expires the tag outright, so the next read is a blocking miss', async () => {
    await forceSourceRefresh(ctx('owner'), {
      tag: 'irc-rating',
      key: 'irc-rating',
      label: 'the IRC rating list',
    });
    // `{ expire: 0 }` is the load-bearing argument: the default would serve
    // the stale listing once, which reads as the button doing nothing.
    expect(revalidateTag).toHaveBeenCalledWith('irc-rating', { expire: 0 });
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'handicaps.source-refreshed' }),
    );
  });

  it('takes manage-workspace — it reaches someone else’s server', async () => {
    await expect(
      forceSourceRefresh(ctx('member'), {
        tag: 'orc-certs:IRL:ORC',
        key: 'orc-certs:IRL:ORC',
        label: 'ORC certificates',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('refuses a second refresh of the same source with the seconds left', async () => {
    // The throttle map lives for the module's lifetime, so each test that
    // depends on the interval uses a key of its own.
    const input = { tag: 'irc-rating', key: 'throttle-probe', label: 'the IRC rating list' };
    await forceSourceRefresh(ctx('owner'), input);

    const again = forceSourceRefresh(ctx('owner'), input);
    await expect(again).rejects.toBeInstanceOf(RateLimitedError);
    await again.catch((err: RateLimitedError) => {
      expect(err.retryAfterSeconds).toBeGreaterThan(0);
      expect(err.retryAfterSeconds).toBeLessThanOrEqual(60);
    });
    expect(revalidateTag).toHaveBeenCalledTimes(1);
  });

  it('throttles per source, so one country’s certificates do not block another’s', async () => {
    await forceSourceRefresh(ctx('owner'), {
      tag: 'orc-certs:IRL:ORC',
      key: 'orc-certs:IRL:ORC',
      label: 'ORC ORC certificates for IRL',
    });
    await forceSourceRefresh(ctx('owner'), {
      tag: 'orc-certs:GBR:ORC',
      key: 'orc-certs:GBR:ORC',
      label: 'ORC ORC certificates for GBR',
    });
    expect(revalidateTag).toHaveBeenCalledTimes(2);
    // Each country's own tag, never the shared one: a scorer who was handed
    // the British listing keeps it.
    expect(revalidateTag.mock.calls.map((c) => c[0])).toEqual([
      'orc-certs:IRL:ORC',
      'orc-certs:GBR:ORC',
    ]);
  });

  it('lets the same source through again once the interval has passed', async () => {
    const input = { tag: 'vprs-rating:42', key: 'vprs-rating:42', label: 'a club VPRS list' };
    await forceSourceRefresh(ctx('owner'), input);

    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    try {
      await forceSourceRefresh(ctx('owner'), input);
    } finally {
      Date.now = realNow;
    }
    expect(revalidateTag).toHaveBeenCalledTimes(2);
  });
});

describe('wantsRefresh', () => {
  it('reads only an explicit yes', async () => {
    expect(wantsRefresh('1')).toBe(true);
    expect(wantsRefresh('true')).toBe(true);
    expect(wantsRefresh('0')).toBe(false);
    expect(wantsRefresh(null)).toBe(false);
  });
});
