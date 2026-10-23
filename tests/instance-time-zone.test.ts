import { afterEach, describe, expect, it, vi } from 'vitest';

import { instanceTimeZone } from '@/lib/instance-time-zone';

describe('instanceTimeZone', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to Europe/Dublin when unset', () => {
    vi.stubEnv('NEXT_PUBLIC_DEFAULT_TIMEZONE', undefined);
    expect(instanceTimeZone()).toBe('Europe/Dublin');
  });

  it('defaults to Europe/Dublin when blank', () => {
    vi.stubEnv('NEXT_PUBLIC_DEFAULT_TIMEZONE', '   ');
    expect(instanceTimeZone()).toBe('Europe/Dublin');
  });

  it('honours the setting, trimmed', () => {
    vi.stubEnv('NEXT_PUBLIC_DEFAULT_TIMEZONE', ' America/New_York ');
    expect(instanceTimeZone()).toBe('America/New_York');
  });

  it('falls back to Europe/Dublin for a zone Intl does not know', () => {
    vi.stubEnv('NEXT_PUBLIC_DEFAULT_TIMEZONE', 'Not/AZone');
    expect(instanceTimeZone()).toBe('Europe/Dublin');
  });
});
