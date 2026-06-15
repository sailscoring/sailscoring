import type { PublishRequest } from './client';

/**
 * ADR-009 M3.1 — publish orchestration. Publishes a list of series. With a
 * shared `slug`, the series co-publish into one namespace (the IODAI case:
 * several series' fleets under a single `/p/{ws}/{slug}`); the server treats a
 * slug as shared and we pass `join: true` so the 2nd+ series merge in rather
 * than being rejected. Without a slug, each series publishes under its own
 * server-derived slug.
 *
 * Sequential by design: co-publishing depends on each join seeing the prior
 * publications (slug occupancy + sub-path uniqueness), and the volume is a
 * handful of series. Resume-on-failure: a failed series is reported and the
 * rest continue.
 */

export interface PublishResultLine {
  seriesId: string;
  status: 'published' | 'failed';
  slug?: string;
  urls?: string[];
  error?: string;
}

interface PublishClient {
  publishSeries(
    seriesId: string,
    input: PublishRequest,
  ): Promise<{ slug: string; pages: { url: string }[] }>;
}

export interface RunPublishOptions {
  seriesIds: string[];
  client: PublishClient;
  /** Shared slug — when set, all series co-publish into it (auto-join). */
  slug?: string;
  fleets?: string[];
  subPaths?: Record<string, string>;
  defaultSubPath?: string;
  onResult?: (result: PublishResultLine) => void;
}

export async function runPublish(
  opts: RunPublishOptions,
): Promise<PublishResultLine[]> {
  const results: PublishResultLine[] = [];
  for (const seriesId of opts.seriesIds) {
    let line: PublishResultLine;
    try {
      const input: PublishRequest = {
        ...(opts.slug ? { slug: opts.slug, join: true } : {}),
        ...(opts.fleets ? { fleets: opts.fleets } : {}),
        ...(opts.subPaths ? { subPaths: opts.subPaths } : {}),
        ...(opts.defaultSubPath ? { defaultSubPath: opts.defaultSubPath } : {}),
      };
      const r = await opts.client.publishSeries(seriesId, input);
      line = {
        seriesId,
        status: 'published',
        slug: r.slug,
        urls: r.pages.map((p) => p.url),
      };
    } catch (err) {
      line = {
        seriesId,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
    results.push(line);
    opts.onResult?.(line);
  }
  return results;
}
