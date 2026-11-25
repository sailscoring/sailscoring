import { describe, expect, it } from 'vitest';

import { DIRECTORY_CACHE_TAG, publishedCacheTag } from '@/lib/published-cache';
import { parsePurgeArgs } from '@/scripts/purge-public-cache';
import { publicCacheReminder } from '@/scripts/public-cache-reminder';

describe('parsePurgeArgs', () => {
  it('purges each workspace and the directory its publications feed', () => {
    expect(parsePurgeArgs(['org_a', 'org_b'])).toEqual({
      tags: [publishedCacheTag('org_a'), publishedCacheTag('org_b'), DIRECTORY_CACHE_TAG],
      dryRun: false,
    });
  });

  it('can purge the directory alone', () => {
    expect(parsePurgeArgs(['--directory']).tags).toEqual([DIRECTORY_CACHE_TAG]);
  });

  it('refuses to run with nothing to purge', () => {
    expect(() => parsePurgeArgs([])).toThrow(/at least one workspace id/);
    expect(() => parsePurgeArgs(['--dry-run'])).toThrow(/at least one workspace id/);
  });

  it('refuses an id that would split the comma-separated tag list', () => {
    expect(() => parsePurgeArgs(['org_a,org_b'])).toThrow(/not a workspace id/);
    expect(() => parsePurgeArgs(['--all'])).toThrow(/unknown option/);
  });
});

describe('publicCacheReminder', () => {
  it('names each workspace once, as the purge command takes them', () => {
    expect(publicCacheReminder(['org_a', 'org_b', 'org_a'])).toContain(
      'pnpm public-cache:purge:prod org_a org_b',
    );
  });

  it('says nothing when nothing was written', () => {
    expect(publicCacheReminder([])).toBeNull();
  });
});
