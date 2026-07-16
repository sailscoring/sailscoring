import { describe, expect, it } from 'vitest';

import { decodeNextPath, encodeNextPath, safeInternalPath } from '@/lib/safe-redirect';

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

describe('encodeNextPath / decodeNextPath', () => {
  it('round-trips paths, including query strings', () => {
    for (const path of ['/', '/account', '/series/abc?tab=races', '/?error=INVALID_TOKEN']) {
      expect(decodeNextPath(encodeNextPath(path))).toBe(path);
    }
  });

  it('produces output stable under URL decoding, with no nested-URL breakers', () => {
    const encoded = encodeNextPath('/series/abc?tab=races&q=100%25');
    expect(decodeURIComponent(encoded)).toBe(encoded);
    expect(encoded).not.toMatch(/[?&%#=+/]/);
  });

  it('round-trips non-ASCII paths', () => {
    const path = '/series/abc?q=%C3%A9chelle café';
    expect(decodeNextPath(encodeNextPath(path))).toBe(path);
  });

  it('passes plain /-prefixed values through for links minted before encoding', () => {
    expect(decodeNextPath('/')).toBe('/');
    expect(decodeNextPath('/series/abc')).toBe('/series/abc');
  });

  it('returns undefined for missing or undecodable values', () => {
    expect(decodeNextPath(undefined)).toBeUndefined();
    expect(decodeNextPath(null)).toBeUndefined();
    expect(decodeNextPath('')).toBeUndefined();
    expect(decodeNextPath('not base64url!!')).toBeUndefined();
    // Valid base64 of invalid UTF-8 bytes.
    expect(decodeNextPath('_w')).toBeUndefined();
  });

  it('feeds safeInternalPath a fallback-worthy value on garbage input', () => {
    expect(safeInternalPath(decodeNextPath('not base64url!!'))).toBe('/');
    // base64url of 'https://evil.example' decodes fine but is then rejected.
    expect(safeInternalPath(decodeNextPath(encodeNextPath('https://evil.example')))).toBe('/');
  });
});
