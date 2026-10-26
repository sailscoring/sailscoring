'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUpdateSeriesPublishPrefs } from '@/hooks/use-series';
import { useFtpServers } from '@/hooks/use-ftp-servers';
import { resolveFtpServerId } from '@/lib/ftp-publish';
import type { PublishPage } from '@/lib/publish-pages';
import type { Series } from '@/lib/types';

export interface FtpSettingsPaneProps {
  series: Series;
  /** The pages this series publishes — the list the Pages tab offers, so a
   *  path is set against exactly the pages publishing builds. */
  pages: PublishPage[];
  /** What the dialog calls the lone default page, when there is one. */
  lonePageLabel: string;
  /** Whether the series publishes one page per block, which changes where
   *  each block's copy goes. */
  hasBlocks: boolean;
  onClose: () => void;
}

/** A page's stored path, as the series holds it: under the page's key, the
 *  bare fleet id older settings used, or — for the lone default page — the
 *  single path a series carried before pages had their own. */
function storedPath(page: PublishPage, series: Series): string {
  const stored = series.ftpPaths ?? {};
  return (
    stored[page.key] ??
    (page.fleetId ? stored[page.fleetId] : undefined) ??
    (page.isDefault ? series.ftpPath : undefined) ??
    ''
  );
}

/**
 * The Publish dialog's FTP tab: where on a club's own web server each page
 * goes when it is published. Configuration only — publishing a page uploads
 * it, server-side, to the path set here; a page with no path stays off the
 * club's site.
 *
 * Everything saves as it changes, through the publish-prefs write: where
 * results go is not an edit to the series.
 */
export function FtpSettingsPane({ series, pages, lonePageLabel, hasBlocks, onClose }: FtpSettingsPaneProps) {
  const { mutate: mutatePrefs } = useUpdateSeriesPublishPrefs();
  const { data: ftpServers } = useFtpServers();
  const [selectedServerId, setSelectedServerId] = useState('');
  const [paths, setPaths] = useState<Record<string, string>>(() =>
    Object.fromEntries(pages.map((p) => [p.key, storedPath(p, series)])),
  );
  // Paths typed but not yet written. Flushed on blur, and on unmount — the
  // dialog can close from the keyboard without the field ever losing focus.
  const dirty = useRef(new Set<string>());

  /* eslint-disable react-hooks/set-state-in-effect */
  // Open on the server the series remembers, once the server list resolves.
  useEffect(() => {
    if (!ftpServers) return;
    setSelectedServerId(resolveFtpServerId(ftpServers, series));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ftpServers]);

  // `pages` waits on the sub-series and split-fleet state, so it can grow
  // while the tab is open: seed the newcomers without touching anything typed.
  useEffect(() => {
    setPaths((prev) => {
      const missing = pages.filter((p) => !(p.key in prev));
      if (missing.length === 0) return prev;
      return { ...prev, ...Object.fromEntries(missing.map((p) => [p.key, storedPath(p, series)])) };
    });
  }, [pages, series]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /** Write the typed paths. Built over what the series holds, so paths for
   *  pages this list doesn't show (a block series' other shape, a fleet
   *  since removed) survive; a page's bare-fleet-id entry gives way to its
   *  key. A cleared path is stored empty rather than dropped, so it doesn't
   *  fall back to an older setting. */
  const latest = useRef({ series, paths, pages });
  useEffect(() => {
    latest.current = { series, paths, pages };
  });
  const flush = useCallback(() => {
    if (dirty.current.size === 0) return;
    const { series: s, paths: typed, pages: shown } = latest.current;
    const next = { ...(s.ftpPaths ?? {}) };
    for (const page of shown) {
      if (!dirty.current.has(page.key)) continue;
      if (page.fleetId) delete next[page.fleetId];
      next[page.key] = (typed[page.key] ?? '').trim();
    }
    dirty.current.clear();
    mutatePrefs({ id: s.id, prefs: { ftpPaths: next } });
  }, [mutatePrefs]);
  useEffect(() => flush, [flush]);

  /** Picking a server remembers it there and then; the host rides along as
   *  the fallback for a series carried into another workspace. */
  function pickServer(id: string) {
    setSelectedServerId(id);
    const server = ftpServers?.find((s) => s.id === id);
    if (!server) return;
    mutatePrefs({
      id: series.id,
      prefs: { ftpServerId: server.id, ftpHost: server.host },
    });
  }

  function setPath(key: string, value: string) {
    dirty.current.add(key);
    setPaths((prev) => ({ ...prev, [key]: value }));
  }

  /** What a page is called here: the lone default page takes the dialog's
   *  own label for it, since its fleet name is often synthetic. */
  const labelFor = (page: PublishPage): string =>
    page.isDefault && page.kind === 'fleet' ? lonePageLabel : page.name;

  if (ftpServers !== undefined && ftpServers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No FTP servers configured.{' '}
        <Link href="/workspace" className="underline" onClick={onClose}>
          Add one in Workspace Settings.
        </Link>
      </p>
    );
  }

  return (
    <div className="space-y-3 min-w-0">
      <p className="text-xs text-muted-foreground">
        Publishing a page also uploads it to your website, at the path set here. A page with no
        path stays off your website.
        {hasBlocks && ' Each block’s page goes to the path with the block’s name added (results.html → results-winter.html).'}
      </p>
      <div className="space-y-1.5">
        <Label>Server</Label>
        <Select value={selectedServerId} onValueChange={pickServer}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a server…" />
          </SelectTrigger>
          <SelectContent>
            {ftpServers?.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.ftps ? 'ftps' : 'ftp'}://{s.host}:{s.port}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground pb-1">
          <span className="w-36 shrink-0">Page</span>
          <span>Path</span>
        </div>
        <div className="space-y-1 max-h-[50vh] overflow-y-auto">
          {pages.map((page) => {
            const label = labelFor(page);
            return (
              <div key={page.key} className="flex items-center gap-2">
                <span className="w-36 shrink-0 truncate text-sm" title={label}>
                  {label}
                </span>
                <Input
                  value={paths[page.key] ?? ''}
                  onChange={(e) => setPath(page.key, e.target.value)}
                  onBlur={flush}
                  placeholder="Not uploaded"
                  aria-label={`${label} path`}
                  className="flex-1 min-w-0 h-7 text-xs font-mono"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
