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
import { RankBadge } from '@/components/fleet-standings-table';
import type { RankingDto } from '@/lib/api-handlers/rankings';
import {
  bucketSailed,
  formatPlace,
  newRankingBucket,
  type RankingAdjustment,
  type RankingBucket,
  type RankingConfig,
} from '@/lib/ranking';
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
  const { result, unmatchedCount, unflaggedCount, includedSeries } = standings;
  const buckets = ranking.config.buckets;
  const unpublished = includedSeries.filter((s) => !s.published);
  // The ladder reads like a standings table: one column per series, a
  // sailor's place in each, discards in parentheses. Net (the ranking basis)
  // only earns its own column when a discard exists somewhere.
  const hasDiscards = result.rows.some((row) => row.gross !== row.total);
  interface SeriesPlace {
    place: number;
    counted: boolean;
    adjusted: boolean;
  }
  const placesBySeries = (row: {
    buckets: Array<{ places: Array<SeriesPlace & { seriesId: string }> }>;
  }) => {
    const map = new Map<string, SeriesPlace>();
    for (const b of row.buckets) {
      for (const p of b.places) {
        if (!map.has(p.seriesId)) map.set(p.seriesId, p);
      }
    }
    return map;
  };
  // The scorer's explanation for each adjusted place, keyed for the tooltip.
  const adjustmentNotes = new Map(
    (ranking.config.adjustments ?? []).map((a) => [
      `${a.identityId}:${a.seriesId}`,
      a.note,
    ]),
  );

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
      {unflaggedCount > 0 && (
        <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
          <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            {unflaggedCount} ranked sailor{unflaggedCount === 1 ? ' has' : 's have'}{' '}
            no nationality set, so they&rsquo;re left out of the place numbering
            — a missing flag improves every place behind it. Set nationality on
            their competitor records.
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
                {includedSeries.map((s) => (
                  <th key={s.id} className="px-3 py-2 font-medium text-center">
                    {s.name}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium text-right">Total</th>
                {hasDiscards && (
                  <th className="px-3 py-2 font-medium text-right">Net</th>
                )}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => {
                const places = placesBySeries(row);
                return (
                <tr key={row.identityId} className="border-b last:border-b-0">
                  <td className="px-3 py-2 tabular-nums">
                    <RankBadge rank={row.rank} />
                  </td>
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
                  {includedSeries.map((s) => {
                    const p = places.get(s.id);
                    if (!p) {
                      return (
                        <td key={s.id} className="px-3 py-2 text-center text-muted-foreground">
                          —
                        </td>
                      );
                    }
                    const note = p.adjusted
                      ? adjustmentNotes.get(`${row.identityId}:${s.id}`)
                      : undefined;
                    const text = `${formatPlace(p.place)}${p.adjusted ? '*' : ''}`;
                    if (!p.counted) {
                      return (
                        <td
                          key={s.id}
                          className="px-3 py-2 text-center tabular-nums text-muted-foreground"
                          title={note}
                        >
                          ({text})
                        </td>
                      );
                    }
                    return (
                      <td key={s.id} className="px-3 py-2 text-center tabular-nums" title={note}>
                        {Number.isInteger(p.place) && p.place <= 3 ? (
                          <RankBadge rank={p.place} label={text} />
                        ) : (
                          text
                        )}
                      </td>
                    );
                  })}
                  <td
                    className={
                      hasDiscards
                        ? 'px-3 py-2 tabular-nums text-right font-semibold'
                        : 'px-3 py-2 tabular-nums text-right font-bold text-primary'
                    }
                  >
                    {formatPlace(row.gross)}
                  </td>
                  {hasDiscards && (
                    <td className="px-3 py-2 tabular-nums text-right font-bold text-primary">
                      {formatPlace(row.total)}
                    </td>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {result.ineligible.length > 0 && (
        <div className="text-sm text-muted-foreground">
          <span className="font-medium">Not yet ranked:</span>{' '}
          {result.ineligible
            .map((entry) => {
              // Match scores to config buckets by id, not index: right after
              // a save the config (detail query) can be ahead of the computed
              // standings (still refetching), so a just-added bucket has no
              // score yet — treat it as 0 sailed rather than crashing.
              const short = buckets
                .map((b) => ({
                  bucket: b,
                  sailed: entry.buckets.find((s) => s.bucketId === b.id),
                }))
                .filter(
                  ({ bucket, sailed }) =>
                    (sailed ? bucketSailed(sailed) : 0) < bucket.requiredMin,
                )
                .map(
                  ({ bucket, sailed }) =>
                    `${sailed ? bucketSailed(sailed) : 0}/${bucket.requiredMin} in ${bucket.name || 'bucket'}`,
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
          {ranking.config.fleet && (
            <> {ranking.config.fleet} fleet only.</>
          )}
          {ranking.config.recomputePlaces && ranking.config.nationality && (
            <> Places counted among {ranking.config.nationality} sailors only.</>
          )}
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

/** The scorer-entered place adjustments: a committee's number with its
 *  explanation, shown on the ladder as an asterisked place. */
function AdjustmentsCard({
  adjustments,
  entrants,
  seriesOptions,
  onChange,
}: {
  adjustments: RankingAdjustment[];
  entrants: Array<{ identityId: string; label: string }>;
  seriesOptions: Array<{ id: string; name: string }>;
  onChange: (next: RankingAdjustment[]) => void;
}) {
  const [identityId, setIdentityId] = useState('');
  const [seriesId, setSeriesId] = useState('');
  const [place, setPlace] = useState('');
  const [note, setNote] = useState('');

  const labelOf = (id: string) =>
    entrants.find((e) => e.identityId === id)?.label ?? 'Unknown sailor';
  const seriesNameOf = (id: string) =>
    seriesOptions.find((s) => s.id === id)?.name ?? 'Removed series';

  const parsedPlace = Number(place);
  const canAdd =
    identityId !== '' &&
    seriesId !== '' &&
    Number.isFinite(parsedPlace) &&
    parsedPlace > 0 &&
    note.trim() !== '';

  const add = () => {
    onChange([
      // One adjustment per sailor+series: adding again replaces it.
      ...adjustments.filter(
        (a) => !(a.identityId === identityId && a.seriesId === seriesId),
      ),
      { identityId, seriesId, place: parsedPlace, note: note.trim() },
    ]);
    setIdentityId('');
    setSeriesId('');
    setPlace('');
    setNote('');
  };

  const selectClass =
    'h-8 rounded-md border bg-background px-2 text-sm max-w-48';
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3" data-testid="adjustments-card">
      <div>
        <h3 className="text-sm font-medium">Adjustments</h3>
        <p className="text-xs text-muted-foreground">
          Set a sailor&rsquo;s place for an event by hand — an averaged place
          for representational duty, medical redress. Shown with an asterisk;
          the note explains it.
        </p>
      </div>
      {adjustments.length > 0 && (
        <ul className="divide-y rounded-md border">
          {adjustments.map((a) => (
            <li
              key={`${a.identityId}:${a.seriesId}`}
              className="flex items-center gap-2 px-3 py-1.5 text-sm"
            >
              <span className="min-w-0 truncate">
                {labelOf(a.identityId)} — {seriesNameOf(a.seriesId)}:{' '}
                <span className="font-medium">{formatPlace(a.place)}*</span>
              </span>
              <span className="min-w-0 truncate text-muted-foreground text-xs ml-auto">
                {a.note}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                title="Remove this adjustment"
                onClick={() =>
                  onChange(
                    adjustments.filter(
                      (x) =>
                        !(
                          x.identityId === a.identityId &&
                          x.seriesId === a.seriesId
                        ),
                    ),
                  )
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <select
          aria-label="Adjustment sailor"
          className={selectClass}
          value={identityId}
          onChange={(e) => setIdentityId(e.target.value)}
        >
          <option value="">Sailor…</option>
          {entrants.map((e) => (
            <option key={e.identityId} value={e.identityId}>
              {e.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Adjustment series"
          className={selectClass}
          value={seriesId}
          onChange={(e) => setSeriesId(e.target.value)}
        >
          <option value="">Series…</option>
          {seriesOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <Input
          aria-label="Adjustment place"
          type="number"
          min={0.5}
          step={0.1}
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          placeholder="Place"
          className="h-8 w-24"
        />
        <Input
          aria-label="Adjustment note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why — e.g. Worlds team duty"
          maxLength={200}
          className="h-8 w-64"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!canAdd}
          onClick={add}
        >
          <Plus className="h-3.5 w-3.5" />
          Add adjustment
        </Button>
      </div>
    </div>
  );
}

function ConfigEditor({
  ranking,
  seriesList,
  entrants,
  workspaceSlug,
  onSaved,
}: {
  ranking: RankingDto;
  seriesList: Series[];
  entrants: Array<{ identityId: string; label: string }>;
  workspaceSlug: string;
  onSaved: () => void;
}) {
  const put = usePutRanking();
  const [name, setName] = useState(ranking.name);
  const [buckets, setBuckets] = useState<RankingBucket[]>(
    ranking.config.buckets,
  );
  const [adjustments, setAdjustments] = useState<RankingAdjustment[]>(
    ranking.config.adjustments ?? [],
  );
  const [nationality, setNationality] = useState(
    ranking.config.nationality ?? '',
  );
  const [fleet, setFleet] = useState(ranking.config.fleet ?? '');
  const [recomputePlaces, setRecomputePlaces] = useState(
    ranking.config.recomputePlaces ?? false,
  );
  const [published, setPublished] = useState(ranking.published);
  const [slug, setSlug] = useState(ranking.slug ?? '');
  // Like a series slug: choosable while the ranking is private, fixed once
  // it has been published.
  const slugFrozen = ranking.published;

  const save = () => {
    const config: RankingConfig = {
      buckets,
      ...(nationality.trim()
        ? { nationality: nationality.trim().toUpperCase() }
        : {}),
      ...(nationality.trim() && recomputePlaces ? { recomputePlaces: true } : {}),
      ...(fleet.trim() ? { fleet: fleet.trim() } : {}),
      ...(adjustments.length > 0 ? { adjustments } : {}),
    };
    put.mutate(
      {
        id: ranking.id,
        name: name.trim(),
        config,
        published,
        ...(!slugFrozen && slug.trim() ? { slug: slug.trim() } : {}),
      },
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
        <div className="space-y-1">
          <Label htmlFor="ranking-fleet">Fleet filter</Label>
          <Input
            id="ranking-fleet"
            value={fleet}
            onChange={(e) => setFleet(e.target.value)}
            placeholder="e.g. Junior"
            maxLength={80}
            className="h-8 w-36"
          />
        </div>
        <label
          className="flex items-center gap-2 pb-1.5 text-sm"
          title="A sailor's place becomes their position among matching sailors — visiting boats don't occupy a place"
        >
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-primary"
            checked={nationality.trim() !== '' && recomputePlaces}
            disabled={!nationality.trim()}
            onChange={(e) => setRecomputePlaces(e.target.checked)}
          />
          Count places among {nationality.trim() || 'filtered'} sailors only
        </label>
        <label className="flex items-center gap-2 pb-1.5 ml-auto">
          <Switch
            checked={published}
            onCheckedChange={setPublished}
            aria-label="Public page"
          />
          <span className="text-sm">Public page</span>
        </label>
      </div>

      <div className="space-y-1">
        <Label htmlFor="ranking-slug">Public URL</Label>
        <div className="flex items-center gap-1">
          <span className="text-sm text-muted-foreground shrink-0">
            /p/{workspaceSlug}/ranking/
          </span>
          <Input
            id="ranking-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            disabled={slugFrozen}
            title={
              slugFrozen
                ? 'The URL is fixed while the ranking is published'
                : undefined
            }
            maxLength={60}
            className="h-8 w-64"
          />
        </div>
        {!slugFrozen && (
          <p className="text-xs text-muted-foreground">
            Lowercase letters, numbers, and hyphens. Fixed once published.
          </p>
        )}
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

      <AdjustmentsCard
        adjustments={adjustments}
        entrants={entrants}
        seriesOptions={[...new Set(buckets.flatMap((b) => b.seriesIds))]
          .map((id) => ({
            id,
            name: seriesList.find((s) => s.id === id)?.name ?? 'Removed series',
          }))}
        onChange={setAdjustments}
      />

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
      {put.isError && (
        <p className="text-sm text-destructive">
          Couldn&rsquo;t save:{' '}
          {put.error instanceof Error ? put.error.message : 'try again'}
        </p>
      )}
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
            entrants={
              standings
                ? [...standings.result.rows, ...standings.result.ineligible]
                    .map(({ identityId, label }) => ({ identityId, label }))
                    .sort((a, b) => a.label.localeCompare(b.label))
                : []
            }
            workspaceSlug={workspaceSlug}
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
