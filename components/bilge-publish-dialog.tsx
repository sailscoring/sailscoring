'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRepos } from '@/lib/repos';
import { useUpdateSeries } from '@/hooks/use-series';
import {
  uploadToBilge,
  lookupPrefix,
  checkPublishStatus,
  publishedUrl,
  fetchPolicy,
} from '@/lib/bilge';
import { slugify, isValidPrefix } from '@/lib/bilge-slug';
import { buildFleetHtmlFiles, fleetBilgeSlug } from '@/lib/results-export';
import type { BilgeBundle, Fleet, Series } from '@/lib/types';

type PublishState =
  | 'idle'
  | 'publishing'
  | 'checking'
  | { error: string };

export interface BilgePublishDialogProps {
  series: Series;
  fleets: Fleet[];
  open: boolean;
  onClose: () => void;
}

export function BilgePublishDialog({
  series,
  open,
  onClose,
}: BilgePublishDialogProps) {
  const repos = useRepos();
  const updateSeries = useUpdateSeries();
  const bundle = series.bilgeBundle;

  // Setup view state
  const [prefix, setPrefix] = useState(() => slugify(series.name) || 'results');
  const [email, setEmail] = useState('');
  const [prefixAvailable, setPrefixAvailable] = useState<boolean | null>(null);
  const [checkingPrefix, setCheckingPrefix] = useState(false);

  // Shared publish state
  const [publishState, setPublishState] = useState<PublishState>('idle');

  // Retention days from policy — null = no expiry, undefined = not yet fetched
  const [retentionDays, setRetentionDays] = useState<number | null | undefined>(undefined);

  // Reset dialog state when it reopens. This effect syncs with the external
  // dialog-open signal from the parent, so setState-in-effect is expected.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) {
      setPublishState('idle');
      if (!bundle) {
        setPrefix(slugify(series.name) || 'results');
        setEmail('');
        setPrefixAvailable(null);
      } else {
        fetchPolicy().then((p) => setRetentionDays(p.retentionDays));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Debounced prefix availability check — this effect subscribes to an
  // external system (the prefix lookup API). The synchronous resets below
  // exist to clear stale UI before the new fetch fires.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open || bundle || !prefix || !isValidPrefix(prefix)) {
      setPrefixAvailable(null);
      return;
    }
    setCheckingPrefix(true);
    setPrefixAvailable(null);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const result = await lookupPrefix(prefix, controller.signal);
      setCheckingPrefix(false);
      setPrefixAvailable(!result.found);
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, bundle, prefix]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handlePublish() {
    setPublishState('publishing');

    const fleetFiles = await buildFleetHtmlFiles(repos, series.id);
    if (!fleetFiles) {
      setPublishState({ error: 'No results to publish.' });
      return;
    }

    const isSingleDefault = fleetFiles.length === 1 && fleetFiles[0].isDefault;
    const uuid = bundle?.uuid ?? crypto.randomUUID();
    const effectivePrefix = bundle?.prefix ?? prefix;

    // Upload first fleet — email only sent on first-ever publish
    const primarySlug = fleetBilgeSlug(effectivePrefix, fleetFiles[0].fleetName, isSingleDefault);
    const firstResult = await uploadToBilge({
      uuid,
      slug: primarySlug,
      email: bundle ? undefined : email,
      html: fleetFiles[0].html,
    });

    if (firstResult.status === 'error') {
      setPublishState({ error: firstResult.message ?? firstResult.code });
      return;
    }

    // Upload remaining fleets (email verification not needed again)
    const fleetUrls: { name: string; url: string | null }[] = [{
      name: fleetFiles[0].fleetName,
      url: firstResult.status === 'published' ? firstResult.url : null,
    }];

    for (const file of fleetFiles.slice(1)) {
      const slug = fleetBilgeSlug(effectivePrefix, file.fleetName, false);
      const result = await uploadToBilge({ uuid, slug, html: file.html });
      fleetUrls.push({
        name: file.fleetName,
        url: result.status === 'published' ? result.url : null,
      });
    }

    const updatedBundle: BilgeBundle = {
      uuid,
      prefix: effectivePrefix,
      slug: primarySlug,
      email: bundle ? bundle.email : email,
      status: firstResult.status === 'published' ? 'published'
            : firstResult.status === 'pending'   ? 'pending'
            :                                      'unpublished',
      publishedUrl: fleetUrls[0].url,
      lastPublishedAt: Date.now(),
      fleets: isSingleDefault ? undefined : fleetUrls,
    };

    await updateSeries.mutateAsync({ id: series.id, patch: { bilgeBundle: updatedBundle } });
    setPublishState('idle');
  }

  async function handleCheckStatus() {
    if (!bundle) return;
    setPublishState('checking');
    const live = await checkPublishStatus(bundle.slug);
    if (live) {
      const updatedFleets = bundle.fleets?.map((f) => ({
        ...f,
        url: publishedUrl(fleetBilgeSlug(bundle.prefix, f.name, false)),
      }));
      await updateSeries.mutateAsync({
        id: series.id,
        patch: {
          bilgeBundle: {
            ...bundle,
            status: 'published',
            publishedUrl: publishedUrl(bundle.slug),
            ...(updatedFleets ? { fleets: updatedFleets } : {}),
          },
        },
      });
    }
    setPublishState('idle');
  }

  const isPublishing = publishState === 'publishing';
  const isChecking = publishState === 'checking';
  const hasError = typeof publishState === 'object';

  const prefixValid = isValidPrefix(prefix);
  const canPublish = !isPublishing && (
    bundle
      ? true
      : prefixValid && !!email.trim()
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Publish results</DialogTitle>
        </DialogHeader>

        {bundle ? (
          // Manage view — bundle already configured
          <form id="bilge-publish-form" onSubmit={(e) => { e.preventDefault(); handlePublish(); }} className="space-y-3 min-w-0">
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground truncate">
                Published at{' '}
                <span className="font-mono text-xs">{bundle.slug}</span>
              </p>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">Status:</span>
                {bundle.status === 'published' ? (
                  <span className="text-xs text-green-600 dark:text-green-400 font-medium">Published</span>
                ) : bundle.status === 'pending' ? (
                  <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Pending verification</span>
                ) : (
                  <span className="text-xs text-muted-foreground">Unpublished</span>
                )}
              </div>
              {bundle.lastPublishedAt !== null && (
                <p className="text-xs text-muted-foreground">
                  {new Date(bundle.lastPublishedAt).toLocaleString()}
                  {retentionDays != null && (
                    <>{' · Expires '}{new Date(bundle.lastPublishedAt + retentionDays * 86_400_000).toLocaleDateString()}</>
                  )}
                </p>
              )}
            </div>

            {bundle.status === 'published' && (
              <div className="space-y-1.5">
                {(bundle.fleets ?? (bundle.publishedUrl ? [{ name: '', url: bundle.publishedUrl }] : [])).map(({ name, url }) =>
                  url ? (
                    <div key={name} className="flex items-center gap-2">
                      <div className="flex-1 min-w-0 overflow-hidden">
                        {name && <p className="text-xs font-medium mb-0.5">{name}</p>}
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-mono truncate block hover:underline"
                        >
                          {url}
                        </a>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => navigator.clipboard.writeText(url)}
                      >
                        Copy
                      </Button>
                    </div>
                  ) : null
                )}
              </div>
            )}

            {bundle.status === 'pending' && (
              <p className="text-sm text-muted-foreground">
                Check your email for a verification link. Once verified, re-publish to make it live.
              </p>
            )}

            {hasError && (
              <p className="text-sm text-destructive">{(publishState as { error: string }).error}</p>
            )}
          </form>
        ) : (
          // Setup view — first publish
          <form id="bilge-publish-form" onSubmit={(e) => { e.preventDefault(); handlePublish(); }} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bilge-prefix">URL prefix</Label>
              <Input
                id="bilge-prefix"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="hyc-autumn-league-2026"
                autoFocus
              />
              {prefix && !prefixValid && (
                <p className="text-xs text-destructive">
                  Use only lowercase letters, numbers, and hyphens (e.g. hyc-autumn-2026).
                </p>
              )}
              {prefixValid && (
                <p className="text-xs text-muted-foreground">
                  {checkingPrefix
                    ? 'Checking…'
                    : prefixAvailable === true
                    ? '✓ Available'
                    : prefixAvailable === false
                    ? 'Already in use — choose another prefix.'
                    : null}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bilge-email">Your email</Label>
              <Input
                id="bilge-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="scorer@example.com"
              />
              <p className="text-xs text-muted-foreground">
                A verification link will be sent on first publish. Not stored in the series file.
              </p>
            </div>
            {hasError && (
              <p className="text-sm text-destructive">{(publishState as { error: string }).error}</p>
            )}
          </form>
        )}

        <DialogFooter className="sm:justify-between">
          <a
            href={`${process.env.NEXT_PUBLIC_BILGE_URL}/l/`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:underline self-center"
          >
            bilge.sailscoring.ie
          </a>
          <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {bundle?.status === 'pending' && (
            <Button variant="outline" onClick={handleCheckStatus} disabled={isChecking}>
              {isChecking ? 'Checking…' : 'Check status'}
            </Button>
          )}
          <Button
            type="submit"
            form="bilge-publish-form"
            disabled={!canPublish}
          >
            {isPublishing ? 'Publishing…' : bundle ? 'Re-publish' : 'Publish'}
          </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
