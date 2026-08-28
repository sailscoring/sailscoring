import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const deleteByTag = vi.hoisted(() => vi.fn());
vi.mock('@vercel/functions', () => ({ dangerouslyDeleteByTag: deleteByTag }));

import { publishedCacheTag, purgePublishedCache } from '@/lib/published-cache';

describe('publishedCacheTag', () => {
  it('namespaces the workspace id', () => {
    expect(publishedCacheTag('ws-abc123')).toBe('p:ws-abc123');
  });

  it('produces a tag Vercel will accept', () => {
    // Commas delimit tags in the Vercel-Cache-Tag header, so one inside a tag
    // would silently split it in two; 256 bytes is the documented ceiling.
    const tag = publishedCacheTag('a'.repeat(64));
    expect(tag).not.toContain(',');
    expect(Buffer.byteLength(tag, 'utf8')).toBeLessThanOrEqual(256);
  });
});

describe('purgePublishedCache', () => {
  const vercel = process.env.VERCEL;
  beforeEach(() => deleteByTag.mockReset());
  afterEach(() => {
    if (vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = vercel;
  });

  it('does nothing off Vercel, where there is no CDN to purge', async () => {
    delete process.env.VERCEL;
    await expect(purgePublishedCache('ws-1')).resolves.toBeUndefined();
    expect(deleteByTag).not.toHaveBeenCalled();
  });

  it('deletes rather than invalidates, so a re-publish is seen on reload', async () => {
    process.env.VERCEL = '1';
    await purgePublishedCache('ws-1');
    expect(deleteByTag).toHaveBeenCalledWith('p:ws-1');
  });

  it('swallows a purge failure: the write it follows already succeeded', async () => {
    process.env.VERCEL = '1';
    deleteByTag.mockRejectedValueOnce(new Error('edge network down'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(purgePublishedCache('ws-1')).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
