/**
 * The operator re-publish pass's guard: which publications it may rebuild.
 * Pure — the DB facts come in as a row, the verdict comes out.
 */
import { describe, expect, test } from 'vitest';

import { classify, publicationBackend, type PublicationRow } from '@/scripts/republish';

function row(overrides: Partial<PublicationRow> = {}): PublicationRow {
  return {
    id: 'pub-1',
    slug: '2026',
    pages: [
      { fleetName: 'Default', isDefault: true, subPath: 'standings', blobUrl: 'db:p/ws/2026/standings-abc' },
    ],
    dataBlobUrl: 'db:p/ws/2026/spring.sailscoring.json-abc',
    contentHash: 'abc',
    publishedVersion: 4,
    workspaceId: 'org_1',
    workspaceSlug: 'ws',
    seriesId: 'series-1',
    seriesName: 'Spring Series',
    seriesVersion: 4,
    asPublished: false,
    ...overrides,
  };
}

describe('republish — classify', () => {
  test('a publication of an unchanged series in the configured backend is rebuilt', () => {
    expect(classify(row(), 'db')).toEqual({ kind: 'rebuild' });
  });

  test('pending edits are left to the scorer', () => {
    const verdict = classify(row({ seriesVersion: 6 }), 'db');
    expect(verdict.kind).toBe('skip');
    expect(verdict.kind === 'skip' && verdict.reason).toMatch(/pending edits \(series v6, published v4\)/);
  });

  test('an orphaned publication has nothing to render from', () => {
    const verdict = classify(row({ seriesId: null, seriesName: null, seriesVersion: null, asPublished: null }), 'db');
    expect(verdict.kind).toBe('skip');
    expect(verdict.kind === 'skip' && verdict.reason).toMatch(/orphaned/);
  });

  test('an as-published archive is never re-rendered', () => {
    const verdict = classify(row({ asPublished: true }), 'db');
    expect(verdict.kind).toBe('skip');
    expect(verdict.kind === 'skip' && verdict.reason).toMatch(/as-published/);
  });

  test('blobs in the other backend are a skip, never a migration', () => {
    const inBlob = row({
      pages: [{ fleetName: 'Default', isDefault: true, subPath: 'standings', blobUrl: 'https://blob.example/p/ws/2026/standings-abc' }],
      dataBlobUrl: 'https://blob.example/p/ws/2026/spring.sailscoring.json-abc',
    });
    expect(classify(inBlob, 'blob')).toEqual({ kind: 'rebuild' });
    const verdict = classify(inBlob, 'db');
    expect(verdict.kind).toBe('skip');
    expect(verdict.kind === 'skip' && verdict.reason).toMatch(/Vercel Blob.*published_blobs/);
    const other = classify(row(), 'blob');
    expect(other.kind === 'skip' && other.reason).toMatch(/published_blobs.*Vercel Blob/);
  });

  test('the version guard runs before the backend guard', () => {
    const verdict = classify(row({ seriesVersion: 5 }), 'blob');
    expect(verdict.kind === 'skip' && verdict.reason).toMatch(/pending edits/);
  });
});

describe('republish — publicationBackend', () => {
  test('reads the backend off the locators, data file included', () => {
    expect(publicationBackend(row())).toBe('db');
    expect(publicationBackend(row({ dataBlobUrl: null }))).toBe('db');
    expect(publicationBackend(row({ dataBlobUrl: 'https://blob.example/x' }))).toBe('mixed');
  });
});
