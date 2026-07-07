'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import * as repos from '@/lib/api-repository';
import { authClient } from '@/lib/auth-client';
import { useWorkspaceMemberships } from '@/components/workspace-memberships-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { queryKeys } from '@/hooks/query-keys';
import { useCategories } from '@/hooks/use-categories';
import { openSeriesFromFile, updateSeriesFromSailwave } from '@/lib/series-file';
import {
  buildSeriesFileFromSailwave,
  inspectSailwave,
  SailwaveImportError,
  type SailwaveImportOptions,
  type SailwavePreview,
  type SailwaveRaw,
  type ScoringSystem,
} from '@/lib/sailwave-import';
import {
  PRIMARY_PERSON_LABELS,
  PRIMARY_PERSON_LABEL_TEXT,
} from '@/lib/competitor-fields';
import type { PrimaryPersonLabel } from '@/lib/types';

/** Hand-off key used by the home-page "Import Series" dialog. The parsed
 *  SailwaveRaw is JSON-stringified into sessionStorage so it survives the
 *  client-side navigation without needing to refile the picker. */
export const SAILWAVE_HANDOFF_KEY = 'sailwave-import-handoff';

interface Handoff {
  fileName: string;
  raw: SailwaveRaw;
  /** Present when re-importing over an existing Sailwave-born series ("Update
   *  from Sailwave file" on the series Settings page). Drives update mode: the
   *  series' identity and publishing config are retained and only the
   *  competition data is replaced. Absent for a fresh import. */
  updateSeriesId?: string;
}

const SCORING_SYSTEM_OPTIONS: { value: ScoringSystem; label: string }[] = [
  { value: 'scratch', label: 'Scratch' },
  { value: 'irc', label: 'IRC' },
  { value: 'py', label: 'Portsmouth Yardstick' },
  { value: 'nhc', label: 'NHC' },
  { value: 'echo', label: 'ECHO' },
];

export default function ImportSailwavePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { memberships, activeOrganizationId } = useWorkspaceMemberships();
  const showWorkspacePicker = memberships.length > 1;

  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SAILWAVE_HANDOFF_KEY);
      sessionStorage.removeItem(SAILWAVE_HANDOFF_KEY);
      if (!raw) {
        setLoadError('No Sailwave file to import. Return to the Series list and try again.');
        return;
      }
      const parsed = JSON.parse(raw) as Handoff;
      setHandoff(parsed);
    } catch (e) {
      setLoadError(`Could not read the file hand-off: ${(e as Error).message}`);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (loadError) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <h1 className="text-2xl font-semibold">Import from Sailwave</h1>
        <p className="text-destructive">{loadError}</p>
        <Button variant="outline" onClick={() => router.replace('/')}>
          Back to Series list
        </Button>
      </div>
    );
  }

  if (!handoff) {
    return (
      <div className="max-w-2xl mx-auto py-12 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Wizard
      handoff={handoff}
      router={router}
      queryClient={queryClient}
      memberships={memberships}
      activeOrganizationId={activeOrganizationId}
      showWorkspacePicker={showWorkspacePicker}
    />
  );
}

interface WizardProps {
  handoff: Handoff;
  router: ReturnType<typeof useRouter>;
  queryClient: ReturnType<typeof useQueryClient>;
  memberships: ReturnType<typeof useWorkspaceMemberships>['memberships'];
  activeOrganizationId: string | null;
  showWorkspacePicker: boolean;
}

function Wizard({
  handoff,
  router,
  queryClient,
  memberships,
  activeOrganizationId,
  showWorkspacePicker,
}: WizardProps) {
  const { raw, fileName, updateSeriesId } = handoff;
  const isUpdate = updateSeriesId != null;

  const preview: SailwavePreview | null = useMemo(() => {
    try {
      return inspectSailwave(raw);
    } catch {
      return null;
    }
  }, [raw]);

  // Form state
  const [name, setName] = useState(preview?.name ?? '');
  const [venue, setVenue] = useState(preview?.venue ?? '');
  const [primaryLabel, setPrimaryLabel] = useState<PrimaryPersonLabel>('helm');
  const [subdivisionLabel, setSubdivisionLabel] = useState(preview?.detectedSubdivisionLabels[0] ?? '');
  const [dnfScoring, setDnfScoring] = useState<'auto' | 'seriesEntries' | 'startingArea'>('auto');
  const [fleetOverrides, setFleetOverrides] = useState<Map<string, ScoringSystem>>(() => {
    const m = new Map<string, ScoringSystem>();
    for (const f of preview?.fleets ?? []) m.set(f.name, f.detectedScoringSystem);
    return m;
  });
  const [targetWorkspaceId, setTargetWorkspaceId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Categories belong to the active workspace, so only offer the picker when
  // the import will land there (single-workspace, or the target still matches
  // the active one). Switching the target away hides it and clears the choice.
  const { data: categories } = useCategories();
  const categoryPickerAvailable =
    (categories?.length ?? 0) > 0 &&
    (!showWorkspacePicker || targetWorkspaceId === activeOrganizationId);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!showWorkspacePicker) return;
    if (targetWorkspaceId) return;
    if (activeOrganizationId) setTargetWorkspaceId(activeOrganizationId);
  }, [showWorkspacePicker, activeOrganizationId, targetWorkspaceId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!preview) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <h1 className="text-2xl font-semibold">Import from Sailwave</h1>
        <p className="text-destructive">
          Could not read this file. It doesn&apos;t look like a Sailwave .blw file.
        </p>
        <Button variant="outline" onClick={() => router.replace('/')}>
          Back to Series list
        </Button>
      </div>
    );
  }

  function setFleetOverride(fleet: string, system: ScoringSystem) {
    setFleetOverrides((prev) => {
      const next = new Map(prev);
      next.set(fleet, system);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const opts: SailwaveImportOptions = {
      name,
      venue,
      primaryLabel,
      subdivisionLabel: subdivisionLabel.trim() || undefined,
      fleetScoringOverrides: fleetOverrides,
      includeScratchCompanions: true,
      includeResults: true,
      dnfScoring: dnfScoring === 'auto' ? undefined : dnfScoring,
    };

    setSubmitting(true);
    try {
      const file = buildSeriesFileFromSailwave(raw, opts);

      if (isUpdate) {
        // Re-import in place: the series stays in its current workspace and
        // keeps its identity + publishing config; only the competition data is
        // replaced. The series-level fields in `file` (name, venue, labels) are
        // discarded by updateSeriesFromSailwave in favour of the existing row.
        await updateSeriesFromSailwave(updateSeriesId, file, repos);
        // Every child entity gets a fresh id, so the stale by-id child queries
        // must be evicted (mirrors the .sailscoring "Update from File" flow).
        await queryClient.invalidateQueries({ queryKey: queryKeys.series.detail(updateSeriesId) });
        await queryClient.invalidateQueries({ queryKey: queryKeys.series.list() });
        queryClient.removeQueries({ queryKey: queryKeys.fleets.all });
        queryClient.removeQueries({ queryKey: queryKeys.competitors.all });
        queryClient.removeQueries({ queryKey: queryKeys.races.all });
        queryClient.removeQueries({ queryKey: queryKeys.finishes.all });
        queryClient.removeQueries({ queryKey: queryKeys.raceStarts.all });
        window.location.assign(`/series/${updateSeriesId}/competitors`);
        return;
      }

      // Flip the active workspace before any write so every repository call
      // in openSeriesFromFile resolves to the chosen workspace — same pattern
      // as /app/import/page.tsx.
      if (
        showWorkspacePicker &&
        targetWorkspaceId &&
        targetWorkspaceId !== activeOrganizationId
      ) {
        await authClient.organization.setActive({ organizationId: targetWorkspaceId });
      }
      const newId = await openSeriesFromFile(file, repos, {
        categoryId: categoryPickerAvailable ? categoryId : null,
        source: 'sailwave',
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.series.list() });
      // Hard navigate (matching /import) so server-rendered shells pick up
      // the workspace switch. Land on Competitors — the scorer's first job
      // after a Sailwave import is to fill in missing ratings and check the
      // entry list, not look at races.
      window.location.assign(`/series/${newId}/competitors`);
    } catch (err) {
      if (err instanceof SailwaveImportError) {
        setSubmitError(err.message);
      } else {
        console.error(err);
        setSubmitError('Failed to import. Please try again.');
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 bg-card border rounded-lg p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">
          {isUpdate ? 'Update from Sailwave' : 'Import from Sailwave'}
        </h1>
        <p className="text-sm text-muted-foreground">
          Reading <span className="font-mono">{fileName}</span>.
        </p>
      </div>

      {isUpdate && (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
          data-testid="sailwave-update-warning"
        >
          This replaces all competitors, fleets, races and finishes in this
          series with what&apos;s in the file. The series name, venue,
          competitor-field setup and publishing destination are kept. Published
          results aren&apos;t changed until you publish again.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Detected</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span><span className="text-muted-foreground">Name:</span> {preview.name || '—'}</span>
            <span><span className="text-muted-foreground">Venue:</span> {preview.venue || '—'}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{preview.competitorCount} competitors</Badge>
            <Badge variant="secondary">{preview.raceCount} races</Badge>
            <Badge variant="secondary">{preview.fleets.length} fleets</Badge>
            {preview.hasResults && <Badge variant="secondary">has results</Badge>}
            {preview.detectedDnfScoring && (
              <Badge variant="outline">
                DNF scoring: {preview.detectedDnfScoring === 'seriesEntries' ? 'A5.2 (entries)' : 'A5.3 (starters)'}
              </Badge>
            )}
            {preview.detectedDiscardThresholds.length > 0 && (
              <Badge variant="outline">
                Discards: {preview.detectedDiscardThresholds
                  .map((t) => `${t.discardCount} after ${t.minRaces}`)
                  .join(', ')}
              </Badge>
            )}
            {preview.detectedSubdivisionLabels.length > 0 && (
              <Badge variant="outline">
                {preview.detectedSubdivisionLabels.length > 1 ? 'Subdivisions' : 'Subdivision'}: {preview.detectedSubdivisionLabels.join(', ')}
              </Badge>
            )}
            {preview.hasHelmGender && (
              <Badge variant="outline">Helm gender</Badge>
            )}
          </div>
          {preview.scoringWarnings.length > 0 && (
            <div
              className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
              data-testid="sailwave-scoring-warnings"
            >
              <p className="font-medium">
                Sail Scoring can&apos;t exactly reproduce this file&apos;s scoring codes
              </p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5">
                {preview.scoringWarnings.map((w, i) => (
                  <li key={i}>{w.detail}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs">
                The import will still proceed using the closest scoring rule
                {preview.detectedDnfScoring ? '' : ' (A5.2 — series entries + 1)'}. Check
                the affected standings and adjust in Settings if needed.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* In update mode the series name, venue, workspace and category are
            retained from the existing series, so the Basics card is omitted. */}
        {!isUpdate && (
          <Card>
            <CardHeader>
              <CardTitle>Basics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="series-name">Name</Label>
                <Input
                  id="series-name"
                  data-testid="sailwave-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="series-venue">Venue</Label>
                <Input
                  id="series-venue"
                  data-testid="sailwave-venue"
                  value={venue}
                  onChange={(e) => setVenue(e.target.value)}
                />
              </div>
              {showWorkspacePicker && (
                <div className="space-y-1.5">
                  <Label htmlFor="sailwave-workspace">Workspace</Label>
                  <Select value={targetWorkspaceId} onValueChange={setTargetWorkspaceId}>
                    <SelectTrigger id="sailwave-workspace" data-testid="sailwave-workspace" className="w-full">
                      <SelectValue placeholder="Select a workspace…" />
                    </SelectTrigger>
                    <SelectContent>
                      {memberships.map((m) => (
                        <SelectItem key={m.organizationId} value={m.organizationId}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Fleets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              {preview.fleets.map((f) => {
                const detected = f.detectedScoringSystem;
                return (
                  <div key={f.name} className="flex items-center justify-between gap-3">
                    <span className="text-sm">
                      {f.name}
                      {f.isBareName && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (auto-detected from ratings)
                        </span>
                      )}
                    </span>
                    <Select
                      value={fleetOverrides.get(f.name) ?? detected}
                      onValueChange={(v) => setFleetOverride(f.name, v as ScoringSystem)}
                    >
                      <SelectTrigger
                        className="w-48"
                        data-testid={`sailwave-fleet-${slug(f.name)}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SCORING_SYSTEM_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Options</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isUpdate && categoryPickerAvailable && (
              <div className="space-y-1.5">
                <Label htmlFor="series-category">Category</Label>
                <Select
                  value={categoryId ?? 'none'}
                  onValueChange={(v) => setCategoryId(v === 'none' ? null : v)}
                >
                  <SelectTrigger id="series-category" className="w-48" data-testid="sailwave-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Uncategorized</SelectItem>
                    {(categories ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Which section of your series list to file this under. You can move it later.
                </p>
              </div>
            )}
            {/* Primary identifier and subdivision label set display-only series
                fields that are retained from the existing series on update, so
                they're omitted in update mode. */}
            {!isUpdate && (
              <div className="space-y-1.5">
                <Label htmlFor="primary-label">Primary identifier</Label>
                <Select
                  value={primaryLabel}
                  onValueChange={(v) => setPrimaryLabel(v as PrimaryPersonLabel)}
                >
                  <SelectTrigger id="primary-label" className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIMARY_PERSON_LABELS.map((p) => (
                      <SelectItem key={p} value={p}>{PRIMARY_PERSON_LABEL_TEXT[p]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Which field identifies each entry across the app — pick &ldquo;Helm&rdquo; or
                  &ldquo;Owner&rdquo; if every boat is identified by that role, or &ldquo;Competitor&rdquo;
                  for generic mixed entries.
                </p>
              </div>
            )}
            {!isUpdate && preview.detectedSubdivisionLabels.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="subdivision-label">
                  {preview.detectedSubdivisionLabels.length > 1 ? 'First subdivision column label' : 'Subdivision column label'}
                </Label>
                <Input
                  id="subdivision-label"
                  value={subdivisionLabel}
                  onChange={(e) => setSubdivisionLabel(e.target.value)}
                  className="w-48"
                />
                <p className="text-xs text-muted-foreground">
                  {preview.detectedSubdivisionLabels.length > 1
                    ? `This file has prize-giving subdivision columns (${preview.detectedSubdivisionLabels.join(', ')}). Values are imported as-is; this sets the first column's heading. You can rename or disable any of them later in Settings.`
                    : 'This file has a prize-giving subdivision column (Gold/Silver/Bronze, age categories, …). Values are imported as-is; this only sets the column heading. You can rename or disable it later in Settings.'}
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="dnf-scoring">DNF / DNS scoring</Label>
              <Select
                value={dnfScoring}
                onValueChange={(v) => setDnfScoring(v as typeof dnfScoring)}
              >
                <SelectTrigger id="dnf-scoring" className="w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    Auto (use Sailwave&apos;s setting{preview.detectedDnfScoring ? `: ${preview.detectedDnfScoring === 'seriesEntries' ? 'A5.2' : 'A5.3'}` : ''})
                  </SelectItem>
                  <SelectItem value="seriesEntries">A5.2 — series entries + 1</SelectItem>
                  <SelectItem value="startingArea">A5.3 — starters in race + 1</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {submitError && (
          <p className="text-sm text-destructive">{submitError}</p>
        )}

        <div className="flex gap-3">
          <Button type="submit" disabled={submitting} data-testid="sailwave-import-submit">
            {isUpdate
              ? (submitting ? 'Updating…' : 'Update series')
              : (submitting ? 'Importing…' : 'Import')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => router.replace('/')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
