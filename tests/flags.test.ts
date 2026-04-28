import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('USE_SERVER_DATA', () => {
  const originalValue = process.env.USE_SERVER_DATA;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.USE_SERVER_DATA;
  });

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.USE_SERVER_DATA;
    } else {
      process.env.USE_SERVER_DATA = originalValue;
    }
  });

  it('defaults to false when the env var is unset', async () => {
    const { USE_SERVER_DATA } = await import('@/lib/flags');
    expect(USE_SERVER_DATA).toBe(false);
  });

  it('is false for any value other than the literal string "true"', async () => {
    process.env.USE_SERVER_DATA = '1';
    const { USE_SERVER_DATA } = await import('@/lib/flags');
    expect(USE_SERVER_DATA).toBe(false);
  });

  it('is true only for the literal string "true"', async () => {
    process.env.USE_SERVER_DATA = 'true';
    const { USE_SERVER_DATA } = await import('@/lib/flags');
    expect(USE_SERVER_DATA).toBe(true);
  });
});
