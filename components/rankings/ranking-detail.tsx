'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Globe, Plus, Trash2, TriangleAlert } from 'lucide-react';

import { useFeatures } from '@/components/features-provider';
import { useRanking, useRankingStandings, useDeleteRanking, usePutRanking } from '@/hooks/use-rankings';
import { useSeriesList } from '@/hooks/use-series';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { RankingDto } from '@/lib/api-handlers/rankings';
import { newRankingBucket, type RankingBucket, type RankingConfig } from '@/lib/ranking';
import type { RankingStandingsData } from '@/lib/ranking-standings';
import type { Series } from '@/lib/types';

/** The computed ladder table plus its health warnings. */
function StandingsSection({
  ranking,
  standings,
  workspaceSlug,
  competitorLinks,
}: {
  ranking: RankingDto;
  standings: RankingStandingsData | undefined;
  workspaceSlug: string;
  competitorLinks: boolean;
}) {
  if (!standings) {
    return <p className="text-sm text-muted-foreground">Computing…</p>;
  }
  const { result, unmatchedCount, includedSeries } = standings;
  const buckets = ranking.config.buckets;
  const unpublished = includedSeries.filter((s) => !s.published);

  return (
    <div className="space-y-3">
      {unmatchedCount > 0 && (
        <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
          <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            {unmatchedCount} finishing place{unmatchedCount === 1 ? '' : 's'} in
            these series belong{unmatchedCount === 1 ? 's' : ''} to competitors
            not yet matched across series — the ladder can&rsquo;t see them.
            Reconcile them on the{' '}
            <a href="/workspace/competitors" className="underline">
              Competitors
            </a>{' '}
            tab.
          </span>
        </p>
      )}
      {ranking.published && unpublished.length > 0 && (
        <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
          <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            The public page only counts published series —{' '}
            {unpublished.map((s) => s.name).join(', ')}{' '}
            {unpublished.length === 1 ? 'is' : 'are'} not published yet, so the
            public ladder differs from this one.
          </span>
        </p>
      )}

      {result.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nobody ranks yet — sailors appear once they meet every bucket&rsquo;s
          minimum.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm" data-testid="ranking-standings">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Rank</th>
                <th className="px-3 py-2 font-medium">Sailor</th>
                <th className="px-3 py-2 font-medium">Club</th>
                {buckets.map((b) => (
                  <th key={b.id} className="px-3 py-2 font-medium">
                    {b.name || 'Bucket'}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.identityId} className="border-b last:border-b-0">
                  <td className="px-3 py-2 tabular-nums">{row.rank}</td>
                  <td className="px-3 py-2 font-medium">
                    {competitorLinks && row.slug ? (
                      <a
                        href={`/p/${workspaceSlug}/competitor/${row.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline"
                      >
                        {row.label}
                      </a>
                    ) : (
                      row.label
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.club ?? ''}
                  </td>
                  {row.buckets.map((b) => (
                    <td key={b.bucketId} className="px-3 py-2 tabular-nums text-muted-foreground">
                      {b.counted.map((c) => c.place).join(' + ') || '—'}
                    </td>
                  ))}
                  <td className="px-3 py-2 tabular-nums text-right font-semibold">
                    {row.total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.ineligible.length > 0 && (
        <div className="text-sm text-muted-foreground">
          <span className="font-medium">Not yet ranked:</span>{' '}
          {result.ineligible
            .map((entry) => {
              const short = buckets
                .map((b, i) => ({ bucket: b, score: entry.buckets[i] }))
                .filter(({ bucket, score }) => score.sailed < bucket.requiredMin)
                .map(
                  ({ bucket, score }) =>
                    `${score.sailed}/${bucket.requiredMin} in ${bucket.name || 'bucket'}`,
                )
                .join(', ');
              return `${entry.label} (${short})`;
            })
            .join(' · ')}
        </div>
      )}

      {includedSeries.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Computed over: {includedSeries.map((s) => s.name).join(', ')}.
        </p>
      )}
    </div>
  );
}

/** One bucket's editor card. */
function BucketEditor({
  bucket,
  seriesList,
  onChange,
  onRemove,
  removable,
}: {
  bucket: RankingBucket;
  seriesList: Series[];
  onChange: (next: RankingBucket) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const [filter, setFilter] = useState('');
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return seriesList;
    return seriesList.filter((s) => s.name.toLowerCase().includes(q));
  }, [seriesList, filter]);

  const toggleSeries = (seriesId: string) => {
    const has = bucket.seriesIds.includes(seriesId);
    onChange({
      ...bucket,
      seriesIds: has
        ? bucket.seriesIds.filter((id) => id !== seriesId)
        : [...bucket.seriesIds, seriesId],
    });
  };

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3" data-testid="bucket-editor">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor={`bucket-name-${bucket.id}`}>Bucket name</Label>
          <Input
            id={`bucket-name-${bucket.id}`}
            value={bucket.name}
            onChange={(e) => onChange({ ...bucket, name: e.target.value })}
            placeholder="e.g. Regional events"
            className="h-8 w-48"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`bucket-best-${bucket.id}`}>Count best</Label>
          <Input
            id={`bucket-best-${bucket.id}`}
            type="number"
            min={1}
            max={50}
            value={bucket.countBest}
            onChange={(e) =>
              onChange({ ...bucket, countBest: Math.max(1, Number(e.target.value) || 1) })
            }
            className="h-8 w-20"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`bucket-min-${bucket.id}`}>Need at least</Label>
          <Input
            id={`bucket-min-${bucket.id}`}
            type="number"
            min={0}
            max={50}
            value={bucket.requiredMin}
            onChange={(e) =>
              onChange({ ...bucket, requiredMin: Math.max(0, Number(e.target.value) || 0) })
            }
            className="h-8 w-20"
          />
        </div>
        {removable && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto text-muted-foreground hover:text-destructive"
            title="Remove this bucket"
            onClick={onRemove}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {seriesList.length > 8 && (
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter series…"
            aria-label="Filter series"
            className="h-8 max-w-xs"
          />
        )}
        <ul className="max-h-56 overflow-y-auto divide-y rounded-md border">
          {visible.map((s) => (
            <li key={s.id}>
              <label className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent/50 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-primary"
                  checked={bucket.seriesIds.includes(s.id)}
                  onChange={() => toggleSeries(s.id)}
                />
                <span className="min-w-0 truncate">{s.name}</span>
                {s.startDate && (
                  <span className="ml-auto text-xs text-muted-foreground shrink-0">
                    {s.startDate}
                  </span>
                )}
              </label>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              No matching series.
            </li>
          )}
        </ul>
        <p className="text-xs text-muted-foreground">
          {bucket.seriesIds.length} series selected · a sailor&rsquo;s best{' '}
          {bucket.countBest} count; fewer than {bucket.requiredMin} sailed means
          unranked.
        </p>
      </div>
    </div>
  );
}

function ConfigEditor({
  ranking,
  seriesList,
  onSaved,
}: {
  ranking: RankingDto;
  seriesList: Series[];
  onSaved: () => void;
}) {
  const put = usePutRanking();
  const [name, setName] = useState(ranking.name);
  const [buckets, setBuckets] = useState<RankingBucket[]>(
    ranking.config.buckets,
  );
  const [nationality, setNationality] = useState(
    ranking.config.nationality ?? '',
  );
  const [published, setPublished] = useState(ranking.published);

  const save = () => {
    const config: RankingConfig = {
      buckets,
      ...(nationality.trim()
        ? { nationality: nationality.trim().toUpperCase() }
        : {}),
    };
    put.mutate(
      { id: ranking.id, name: name.trim(), config, published },
      { onSuccess: onSaved },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="ranking-name">Name</Label>
          <Input
            id="ranking-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 w-64"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ranking-nationality">Nationality filter</Label>
          <Input
            id="ranking-nationality"
            value={nationality}
            onChange={(e) => setNationality(e.target.value)}
            placeholder="e.g. IRL"
            maxLength={3}
            className="h-8 w-24 uppercase"
          />
        </div>
        <label className="flex items-center gap-2 pb-1.5 ml-auto">
          <Switch
            checked={published}
            onCheckedChange={setPublished}
            aria-label="Public page"
          />
          <span className="text-sm">Public page</span>
        </label>
      </div>

      <div className="space-y-3">
        {buckets.map((bucket, i) => (
          <BucketEditor
            key={bucket.id}
            bucket={bucket}
            seriesList={seriesList}
            removable={buckets.length > 1}
            onChange={(next) =>
              setBuckets((prev) => prev.map((b, j) => (j === i ? next : b)))
            }
            onRemove={() =>
              setBuckets((prev) => prev.filter((_, j) => j !== i))
            }
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setBuckets((prev) => [...prev, newRankingBucket(crypto.randomUUID())])
          }
        >
          <Plus className="h-3.5 w-3.5" />
          Add bucket
        </Button>
        <Button
          type="button"
          size="sm"
          className="ml-auto"
          disabled={put.isPending || !name.trim()}
          onClick={save}
        >
          Save ranking
        </Button>
      </div>
    </div>
  );
}

export function RankingDetail({
  id,
  workspaceSlug,
  canManage,
}: {
  id: string;
  workspaceSlug: string;
  canManage: boolean;
}) {
  const { data: ranking, isError, refetch } = useRanking(id);
  const { data: standings } = useRankingStandings(id);
  const del = useDeleteRanking();
  const router = useRouter();
  const { has } = useFeatures();
  const { data: seriesList } = useSeriesList();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Remount the editor after each save so its local draft re-seeds from the
  // fresh DTO (and a concurrent edit elsewhere doesn't linger).
  const [editorEpoch, setEditorEpoch] = useState(0);

  if (ranking === undefined) {
    if (isError) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Couldn&rsquo;t load this ranking. Check your connection and try
            again.
          </p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      );
    }
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const publicUrl = `/p/${workspaceSlug}/ranking/${ranking.slug}`;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <h1 className="text-2xl font-semibold">{ranking.name}</h1>
          {ranking.published && ranking.slug && (
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <Globe className="h-3.5 w-3.5" />
              {publicUrl}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        {canManage && (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive shrink-0"
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        )}
      </div>

      <StandingsSection
        ranking={ranking}
        standings={standings}
        workspaceSlug={workspaceSlug}
        competitorLinks={has('competitor-identity')}
      />

      {canManage && (
        <section className="space-y-3 border-t pt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Configuration
          </h2>
          <ConfigEditor
            key={`${ranking.id}:${editorEpoch}`}
            ranking={ranking}
            seriesList={seriesList ?? []}
            onSaved={() => setEditorEpoch((n) => n + 1)}
          />
        </section>
      )}

      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{ranking.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              The ranking configuration is removed and its public page stops
              resolving. Series and results are untouched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={del.isPending}
              onClick={() =>
                del.mutate(ranking.id, {
                  onSuccess: () => router.push('/workspace/rankings'),
                })
              }
            >
              Delete ranking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
