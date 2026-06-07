import { describe, expect, test } from 'vitest';

import {
  isAllowedLogoContentType,
  isLogoClass,
  logoBlobKey,
  logoExtension,
  LOGO_CLASSES,
} from '@/lib/flag-locker';
import { logoCreateSchema, logoUpdateSchema } from '@/lib/validation/logo';

describe('flag-locker helpers', () => {
  test('content-type allow-list', () => {
    expect(isAllowedLogoContentType('image/png')).toBe(true);
    expect(isAllowedLogoContentType('image/svg+xml')).toBe(true);
    expect(isAllowedLogoContentType('image/bmp')).toBe(false);
    expect(isAllowedLogoContentType('application/pdf')).toBe(false);
  });

  test('extension mapping', () => {
    expect(logoExtension('image/jpeg')).toBe('jpg');
    expect(logoExtension('image/svg+xml')).toBe('svg');
    expect(logoExtension('image/bmp')).toBe('bin');
  });

  test('logo classes are recognised', () => {
    for (const c of LOGO_CLASSES) expect(isLogoClass(c)).toBe(true);
    expect(isLogoClass('mascot')).toBe(false);
  });

  test('blob key is content-addressed and namespaced', () => {
    const key = logoBlobKey('org_123', 'abc123', 'image/png');
    expect(key).toBe('logos/org_123/abc123.png');
  });
});

describe('logo validation', () => {
  test('create rejects an unknown class', () => {
    const r = logoCreateSchema.safeParse({
      id: crypto.randomUUID(),
      displayName: 'HYC',
      logoClass: 'mascot',
      contentType: 'image/png',
      data: 'AAAA',
    });
    expect(r.success).toBe(false);
  });

  test('create defaults sourceUrl to empty string', () => {
    const r = logoCreateSchema.parse({
      id: crypto.randomUUID(),
      displayName: 'HYC',
      logoClass: 'sailing-club',
      contentType: 'image/png',
      data: 'AAAA',
    });
    expect(r.sourceUrl).toBe('');
  });

  test('update requires a non-empty name', () => {
    expect(
      logoUpdateSchema.safeParse({ displayName: '', logoClass: 'sponsor' }).success,
    ).toBe(false);
    expect(
      logoUpdateSchema.safeParse({ displayName: 'AIB', logoClass: 'sponsor' }).success,
    ).toBe(true);
  });
});
