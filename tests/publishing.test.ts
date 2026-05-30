import { describe, it, expect } from 'vitest';

import {
  contentHash,
  deriveSeriesSlug,
  fleetSubPath,
  kebab,
  publishedBlobKey,
} from '@/lib/publishing';

// Pure helpers for the in-app publishing path (ADR-008 Phase 9/10, #153). The
// publish handler and the /p/{ws}/{series}/{fleet} route are covered end-to-end
// by e2e/publishing.spec.ts.

describe('kebab / deriveSeriesSlug', () => {
  it('lowercases and hyphenates', () => {
    expect(deriveSeriesSlug('HYC Autumn League 2026')).toBe('hyc-autumn-league-2026');
  });

  it('collapses punctuation and trims stray hyphens', () => {
    expect(deriveSeriesSlug('M15 Westerns — Lough Derg!')).toBe('m15-westerns-lough-derg');
  });

  it('falls back to "series" when nothing usable remains', () => {
    expect(deriveSeriesSlug('!!!')).toBe('series');
  });

  it('is deterministic — no random suffix (workspace namespaces it)', () => {
    expect(deriveSeriesSlug('Spring Series')).toBe(deriveSeriesSlug('Spring Series'));
  });
});

describe('fleetSubPath', () => {
  it('serves a single (default) fleet at "standings"', () => {
    expect(fleetSubPath('Default', true)).toBe('standings');
    expect(fleetSubPath('IRC', true)).toBe('standings');
  });

  it('uses the kebab fleet name for named fleets', () => {
    expect(fleetSubPath('IRC One', false)).toBe('irc-one');
    expect(fleetSubPath('Echo', false)).toBe('echo');
  });
});

describe('publishedBlobKey', () => {
  it('mirrors the public URL path with the content hash appended', () => {
    expect(publishedBlobKey('hyc', 'autumn-league-2026', 'standings', 'abc123')).toBe(
      'p/hyc/autumn-league-2026/standings-abc123',
    );
    expect(publishedBlobKey('u-abc123', 'westerns', 'irc-1', 'deadbeef')).toBe(
      'p/u-abc123/westerns/irc-1-deadbeef',
    );
  });

  it('gives a fresh key when the content hash changes, stable otherwise', () => {
    const a = publishedBlobKey('hyc', 'autumn-league-2026', 'standings', 'hash-a');
    const b = publishedBlobKey('hyc', 'autumn-league-2026', 'standings', 'hash-b');
    expect(a).not.toBe(b);
    expect(publishedBlobKey('hyc', 'autumn-league-2026', 'standings', 'hash-a')).toBe(a);
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

  it('distinguishes page boundaries', async () => {
    expect(await contentHash(['ab', 'c'])).not.toBe(await contentHash(['a', 'bc']));
  });
});

describe('kebab (direct)', () => {
  it('is exported for reuse and handles empties', () => {
    expect(kebab('A B')).toBe('a-b');
    expect(kebab('')).toBe('series');
  });
});
