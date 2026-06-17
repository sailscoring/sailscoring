import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  canonicalLogoUrl,
  canonicalHomepageForUrl,
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

  test('canonicalHomepageForUrl resolves a canonical logo to its homepage', () => {
    const iodai = CANONICAL_LOGOS.find((l) => l.id === 'iodai');
    expect(iodai?.homepageUrl).toBe('https://iodai.com');
    expect(canonicalHomepageForUrl(canonicalLogoUrl(iodai!.file))).toBe('https://iodai.com');
  });

  test('canonicalHomepageForUrl is undefined for non-canonical or homepage-less URLs', () => {
    // Not a canonical reference at all.
    expect(canonicalHomepageForUrl('https://hyc.ie/logo.png')).toBeUndefined();
    expect(canonicalHomepageForUrl('/logos/11111111-2222-3333-4444-555555555555')).toBeUndefined();
    expect(canonicalHomepageForUrl('')).toBeUndefined();
    // A canonical file that isn't in the catalogue.
    expect(canonicalHomepageForUrl(canonicalLogoUrl('does-not-exist.png'))).toBeUndefined();
  });
});

describe('canonical helpers with a dedicated origin', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test('url + parse use the configured origin at its root', async () => {
    vi.stubEnv('NEXT_PUBLIC_CANONICAL_LOGOS_URL', 'https://logos.sailscoring.ie');
    vi.resetModules();
    const mod = await import('@/lib/canonical-logos');

    expect(mod.canonicalLogoUrl('aib.png')).toBe('https://logos.sailscoring.ie/aib.png');
    expect(mod.parseCanonicalLogoFile('https://logos.sailscoring.ie/aib.png')).toBe('aib.png');
    // The app-hosted fallback path is still recognised (older stored refs).
    expect(mod.parseCanonicalLogoFile('/canonical-logos/aib.png')).toBe('aib.png');
    // A different origin is not mistaken for a canonical reference.
    expect(mod.parseCanonicalLogoFile('https://evil.example/aib.png')).toBeNull();
  });
});
