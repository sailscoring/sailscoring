import { describe, expect, it } from 'vitest';

import { safeInternalPath } from '@/lib/safe-redirect';

describe('safeInternalPath', () => {
  it('keeps same-site absolute paths', () => {
    expect(safeInternalPath('/account')).toBe('/account');
    expect(safeInternalPath('/series/abc?tab=races')).toBe('/series/abc?tab=races');
    expect(safeInternalPath('/')).toBe('/');
  });

  it('falls back for absolute and protocol-relative URLs', () => {
    expect(safeInternalPath('https://evil.example')).toBe('/');
    expect(safeInternalPath('//evil.example')).toBe('/');
    expect(safeInternalPath('/\\evil.example')).toBe('/');
    expect(safeInternalPath('javascript:alert(1)')).toBe('/');
  });

  it('falls back for missing or relative values', () => {
    expect(safeInternalPath(undefined)).toBe('/');
    expect(safeInternalPath(null)).toBe('/');
    expect(safeInternalPath('')).toBe('/');
    expect(safeInternalPath('account')).toBe('/');
  });

  it('honours a custom fallback', () => {
    expect(safeInternalPath(undefined, '/sign-in')).toBe('/sign-in');
    expect(safeInternalPath('//evil', '/sign-in')).toBe('/sign-in');
  });
});
