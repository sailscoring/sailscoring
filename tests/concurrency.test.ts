import { describe, it, expect } from 'vitest';

import { mapWithConcurrency } from '@/lib/concurrency';

describe('mapWithConcurrency', () => {
  it('preserves input order regardless of completion order', async () => {
    const result = await mapWithConcurrency([10, 30, 20, 5], 2, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i * 2;
    });
    expect(result).toEqual([0, 2, 4, 6]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }), 4, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
    });
    expect(peak).toBe(4);
  });

  it('handles an empty input without spawning workers', async () => {
    let calls = 0;
    const result = await mapWithConcurrency([], 8, async () => {
      calls += 1;
      return calls;
    });
    expect(result).toEqual([]);
    expect(calls).toBe(0);
  });

  it('caps workers at the item count when limit exceeds it', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2], 16, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
    });
    expect(peak).toBe(2);
  });

  it('propagates the first rejection', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});
