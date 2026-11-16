import { describe, expect, test } from 'vitest';

import { ApiError } from '@/cli/client';
import { withRetry } from '@/cli/retry';

/** A request failing with each status in turn, then succeeding. */
function failingWith(...statuses: number[]) {
  let calls = 0;
  const fn = async () => {
    const status = statuses[calls++];
    if (status !== undefined) {
      throw new ApiError(status, { retryAfter: 3 }, `request failed (${status})`);
    }
    return 'ok';
  };
  return { fn, calls: () => calls };
}

function harness() {
  const waits: number[] = [];
  const logs: string[] = [];
  return {
    waits,
    logs,
    opts: {
      sleep: async (ms: number) => {
        waits.push(ms);
      },
      log: (m: string) => logs.push(m),
    },
  };
}

describe('withRetry', () => {
  test('a timed-out request is tried again after a short wait', async () => {
    const h = harness();
    const req = failingWith(504);
    await expect(withRetry(req.fn, h.opts)).resolves.toBe('ok');
    expect(req.calls()).toBe(2);
    expect(h.waits).toEqual([5000]);
    expect(h.logs).toEqual(['  … request failed (504), retrying in 5s']);
  });

  test('gateway failures are retried twice, then reported', async () => {
    const h = harness();
    const req = failingWith(502, 503, 504);
    await expect(withRetry(req.fn, h.opts)).rejects.toMatchObject({ status: 504 });
    expect(req.calls()).toBe(3);
    expect(h.waits).toEqual([5000, 15000]);
  });

  test('a 429 waits the server retry-after, counted apart from gateway failures', async () => {
    const h = harness();
    const req = failingWith(429, 504, 429);
    await expect(withRetry(req.fn, h.opts)).resolves.toBe('ok');
    expect(h.waits).toEqual([3000, 5000, 3000]);
  });

  test('the app refusing a request is not retried', async () => {
    const h = harness();
    for (const status of [400, 403, 409, 500]) {
      const req = failingWith(status);
      await expect(withRetry(req.fn, h.opts)).rejects.toMatchObject({ status });
      expect(req.calls()).toBe(1);
    }
    expect(h.waits).toEqual([]);
  });
});
