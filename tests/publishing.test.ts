import { describe, it, expect } from 'vitest';

import {
  contentHash,
  fleetSubPath,
  makePublishSlug,
  randomSlugSuffix,
} from '@/lib/publishing';

// Pure helpers for the in-app publishing path (ADR-008 Phase 9). The publish
// handler and the /p/{slug} route are covered end-to-end by e2e/publishing.spec.ts.

describe('randomSlugSuffix', () => {
  it('is lowercase alphanumeric of the requested length', () => {
    expect(randomSlugSuffix()).toMatch(/^[a-z0-9]{6}$/);
    expect(randomSlugSuffix(10)).toMatch(/^[a-z0-9]{10}$/);
  });

  it('is (practically) unique across calls', () => {
    const seen = new Set(Array.from({ length: 200 }, () => randomSlugSuffix()));
    expect(seen.size).toBe(200);
  });
});

describe('makePublishSlug', () => {
  it('kebab-cases the series name and appends a random suffix', () => {
    expect(makePublishSlug('HYC Autumn League 2026')).toMatch(
      /^hyc-autumn-league-2026-[a-z0-9]{6}$/,
    );
  });

  it('collapses punctuation and trims stray hyphens', () => {
    expect(makePublishSlug('M15 Westerns — Lough Derg!')).toMatch(
      /^m15-westerns-lough-derg-[a-z0-9]{6}$/,
    );
  });

  it('falls back to "series" when the name has no usable characters', () => {
    expect(makePublishSlug('!!!')).toMatch(/^series-[a-z0-9]{6}$/);
  });

  it('keeps two same-named series distinct via the suffix', () => {
    expect(makePublishSlug('Spring Series')).not.toBe(makePublishSlug('Spring Series'));
  });
});

describe('fleetSubPath', () => {
  it('serves the primary fleet at the bare slug', () => {
    expect(fleetSubPath('Default', true)).toBe('');
    expect(fleetSubPath('IRC', true)).toBe('');
  });

  it('mirrors bilge layout for non-primary fleets', () => {
    expect(fleetSubPath('IRC One', false)).toBe('standings-irc-one');
    expect(fleetSubPath('Echo', false)).toBe('standings-echo');
  });
});

describe('contentHash', () => {
  it('is a stable 64-char sha-256 hex digest', async () => {
    const h = await contentHash(['<html>a</html>', '<html>b</html>']);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await contentHash(['<html>a</html>', '<html>b</html>'])).toBe(h);
  });

  it('changes when any page content changes', async () => {
    const base = await contentHash(['<html>a</html>']);
    expect(await contentHash(['<html>A</html>'])).not.toBe(base);
  });

  it('distinguishes page boundaries (not just concatenation)', async () => {
    expect(await contentHash(['ab', 'c'])).not.toBe(await contentHash(['a', 'bc']));
  });
});
