import { describe, expect, test } from 'vitest';

import {
  canonicalLogoUrl,
  parseCanonicalLogoFile,
  findCanonicalByFile,
  CANONICAL_LOGOS,
} from '@/lib/canonical-logos';

describe('canonical logo helpers', () => {
  test('url build + parse round-trip', () => {
    expect(canonicalLogoUrl('aib.png')).toBe('/canonical-logos/aib.png');
    expect(canonicalLogoUrl('aib.png', 'https://app.sailscoring.ie/')).toBe(
      'https://app.sailscoring.ie/canonical-logos/aib.png',
    );
    expect(parseCanonicalLogoFile(canonicalLogoUrl('aib.png'))).toBe('aib.png');
    expect(
      parseCanonicalLogoFile(canonicalLogoUrl('aib.png', 'https://app.sailscoring.ie')),
    ).toBe('aib.png');
  });

  test('parse ignores non-canonical URLs', () => {
    expect(parseCanonicalLogoFile('/logos/11111111-2222-3333-4444-555555555555')).toBeNull();
    expect(parseCanonicalLogoFile('https://hyc.ie/logo.png')).toBeNull();
    expect(parseCanonicalLogoFile('')).toBeNull();
  });

  test('catalogue is non-empty and well-formed', () => {
    expect(CANONICAL_LOGOS.length).toBeGreaterThan(0);
    for (const logo of CANONICAL_LOGOS) {
      expect(logo.id).toBeTruthy();
      expect(logo.displayName).toBeTruthy();
      expect(logo.file).toMatch(/\.(svg|png)$/);
      expect(['svg', 'png']).toContain(logo.format);
    }
  });

  test('findCanonicalByFile resolves a known entry', () => {
    const aib = CANONICAL_LOGOS.find((l) => l.id === 'aib');
    expect(aib).toBeDefined();
    expect(findCanonicalByFile(aib!.file)?.id).toBe('aib');
    expect(findCanonicalByFile('does-not-exist.png')).toBeUndefined();
  });
});
