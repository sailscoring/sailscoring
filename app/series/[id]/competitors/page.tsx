'use client';

import { use, useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSeries } from '@/hooks/use-series';
import { FollowOnProvenanceNote } from '@/components/follow-on-provenance-note';
import { useSeriesReadOnly } from '@/components/series-read-only';
import { useFeatures } from '@/components/features-provider';
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions';
import { useFleetsBySeries } from '@/hooks/use-fleets';
import {
  useCompetitorsBySeries,
  useDeleteCompetitor,
  useDeleteCompetitors,
  useSaveCompetitor,
} from '@/hooks/use-competitors';
import { useFinishesBySeries } from '@/hooks/use-finishes';
import { queryKeys } from '@/hooks/query-keys';
import { finishRepo, raceRatingOverrideRepo } from '@/lib/api-repository';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { AlertTriangle } from 'lucide-react';
import { CompetitorImport, type CompetitorImportHandle } from '@/components/competitor-import';
import {
  bulkEditFieldOptions,
  CompetitorBulkEditDialog,
} from '@/components/competitor-bulk-edit-dialog';
import {
  CompetitorAuditLine,
  CompetitorForm,
  emptyCompetitorForm,
  type CompetitorFormData,
} from '@/components/competitor-form';
import { UpdateHandicaps, type UpdateHandicapsHandle } from '@/components/update-handicaps';
import type { Competitor, Fleet, CompetitorFieldKey, Finish, PrimaryPersonLabel, RaceRatingOverride } from '@/lib/types';
import {
  missingRatings,
  formatMissingRatings,
  competitorRatings,
  configuredRatingSystems,
  type MissingRating,
} from '@/lib/competitor-ratings';
import {
  defaultEnabledCompetitorFields,
  DEFAULT_PRIMARY_PERSON_LABEL,
  PRIMARY_PERSON_LABEL_TEXT,
  ALL_COMPETITOR_FIELDS,
  isFieldDisabledByPrimary,
  sameFleetIdSet,
  subdivisionAxes,
  subdivisionAxisLabel,
  cleanCrewNames,
  cleanSubdivisions,
} from '@/lib/competitor-fields';
import {
  duplicateDeletionIds,
  findDuplicateGroups,
  findPossibleDuplicateGroups,
  planDuplicateMerge,
  type PossibleDuplicateGroup,
} from '@/lib/competitor-duplicates';
import { competitorMatchesFilter } from '@/lib/competitor-filter';
import { log } from '@/lib/debug';
import { useShortcutHelp, useShortcuts } from '@/hooks/use-keyboard-shortcut';

function TruncatedCell({ value }: { value: string | null | undefined }) {
  const text = value ?? '';
  return (
    <TableCell>
      {text ? (
        <div className="max-w-[24ch] truncate" title={text}>
          {text}
        </div>
      ) : null}
    </TableCell>
  );
}

function MissingRatingIcon({ missing }: { missing: MissingRating[] }) {
  if (missing.length === 0) return null;
  const label = formatMissingRatings(missing);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex align-middle mr-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xs">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 -mt-0.5" aria-label={label} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export default function CompetitorsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: seriesId } = use(params);
  const { can } = useWorkspacePermissions();
  // Archived series and roles without manage-series both view-only here.
  const readOnly = useSeriesReadOnly() || !can('manage-series');
  const { data: competitors } = useCompetitorsBySeries(seriesId);
  const { data: fleets } = useFleetsBySeries(seriesId);
  const { data: series } = useSeries(seriesId);
  const saveCompetitor = useSaveCompetitor();
  const deleteCompetitor = useDeleteCompetitor();
  const deleteCompetitors = useDeleteCompetitors();
  const queryClient = useQueryClient();
  const enabledFields: CompetitorFieldKey[] =
    series?.enabledCompetitorFields ?? defaultEnabledCompetitorFields();
  const primaryLabel: PrimaryPersonLabel =
    series?.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL;
  const primaryFieldLabel = PRIMARY_PERSON_LABEL_TEXT[primaryLabel];
  const axes = series ? subdivisionAxes(series) : [];
  const fleetById = new Map((fleets ?? []).map((f) => [f.id, f]));
  const multipleFleets = (fleets ?? []).length > 1;
  const ratingSystems = configuredRatingSystems(fleets ?? []);
  const showRating = ratingSystems.length > 0;
  const showRatingLabels = ratingSystems.length > 1;


  const [showAddForm, setShowAddForm] = useState(false);
  const [editingCompetitor, setEditingCompetitor] = useState<Competitor | null>(null);
  const [filter, setFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);
  // Possible-duplicates review (same boat under two sail numbers). Finishes
  // and rating overrides are captured at scan time to plan each merge.
  const [possibleDuplicates, setPossibleDuplicates] = useState<{
    groups: PossibleDuplicateGroup[];
    finishes: Finish[];
    overrides: RaceRatingOverride[];
  } | null>(null);
  const [merging, setMerging] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  // Result line for the bulk actions (duplicate scan, field set).
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const editingRowRef = useRef<HTMLTableRowElement | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const importRef = useRef<CompetitorImportHandle>(null);
  const updateHandicapsRef = useRef<UpdateHandicapsHandle>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  const didAutoFocus = useRef(false);

  const filteredCompetitors = (competitors ?? []).filter((c) =>
    competitorMatchesFilter(c, filter),
  );
  // The selection is kept as raw ids so it survives filter changes; count and
  // delete against the ids that still exist, so a row removed elsewhere can't
  // linger in the tally.
  const selectedCompetitors = (competitors ?? []).filter((c) => selectedIds.has(c.id));
  const selectedCount = selectedCompetitors.length;
  const visibleSelectedCount = filteredCompetitors.filter((c) => selectedIds.has(c.id)).length;
  const allVisibleSelected =
    filteredCompetitors.length > 0 && visibleSelectedCount === filteredCompetitors.length;

  // `indeterminate` is a DOM property, not an attribute, so it needs a ref.
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate =
        visibleSelectedCount > 0 && !allVisibleSelected;
    }
  });

  // Fetch finishes once a selection exists so the bulk-delete confirm can
  // warn about competitors whose race results would cascade away.
  const { data: finishes } = useFinishesBySeries(seriesId, {
    enabled: !readOnly && selectedIds.size > 0,
  });
  const competitorIdsWithFinishes = new Set((finishes ?? []).map((f) => f.competitorId));
  const selectedWithResults = selectedCompetitors.filter((c) =>
    competitorIdsWithFinishes.has(c.id),
  ).length;

  // Two tiers: exact duplicates (same sail number + fleet set) pre-select
  // everything except each group's keeper for the bulk-delete flow;
  // possible duplicates (same boat/person under two sail numbers) open a
  // review dialog with a per-group merge. Finishes feed the keeper
  // heuristic and the merge plans, so fetch them here rather than waiting
  // on the selection-gated query above.
  async function handleFindDuplicates() {
    setStatusMessage(null);
    const seriesFinishes = await queryClient.fetchQuery({
      queryKey: queryKeys.finishes.bySeries(seriesId),
      queryFn: () => finishRepo.listBySeries(seriesId),
    });
    const counts = new Map<string, number>();
    for (const f of seriesFinishes) {
      if (f.competitorId === null) continue;
      counts.set(f.competitorId, (counts.get(f.competitorId) ?? 0) + 1);
    }
    const groups = findDuplicateGroups(competitors ?? [], counts);
    const ids = duplicateDeletionIds(groups);
    const possible = findPossibleDuplicateGroups(competitors ?? [], counts);
    if (ids.length === 0 && possible.length === 0) {
      setStatusMessage('No duplicates found.');
      return;
    }
    if (ids.length > 0) {
      setSelectedIds((prev) => new Set([...prev, ...ids]));
      setStatusMessage(
        `${groups.length} duplicate group${groups.length === 1 ? '' : 's'} found — the extra copies are selected. Review, then delete.`,
      );
    }
    if (possible.length > 0) {
      const overrides = await raceRatingOverrideRepo.listBySeries(seriesId);
      setPossibleDuplicates({ groups: possible, finishes: seriesFinishes, overrides });
    }
  }

  /** Merge one possible-duplicate group: repoint the other rows' finishes
   *  and rating overrides at the keeper (before their deletes cascade),
   *  save the merged survivor, then delete the leftovers. */
  async function handleMergeGroup(group: PossibleDuplicateGroup) {
    if (!possibleDuplicates || merging) return;
    const plan = planDuplicateMerge(group, possibleDuplicates.finishes, possibleDuplicates.overrides);
    if (!plan.ok) return;
    setMerging(true);
    try {
      const finishById = new Map(possibleDuplicates.finishes.map((f) => [f.id, f]));
      const reassignedFinishes = plan.reassignFinishIds
        .map((id) => finishById.get(id))
        .filter((f): f is Finish => !!f)
        .map((f) => ({ ...f, competitorId: plan.survivor.id }));
      if (reassignedFinishes.length > 0) await finishRepo.saveMany(reassignedFinishes);
      const overrideById = new Map(possibleDuplicates.overrides.map((o) => [o.id, o]));
      const reassignedOverrides = plan.reassignOverrideIds
        .map((id) => overrideById.get(id))
        .filter((o): o is RaceRatingOverride => !!o)
        .map((o) => ({ ...o, competitorId: plan.survivor.id }));
      if (reassignedOverrides.length > 0) await raceRatingOverrideRepo.saveMany(reassignedOverrides);
      await saveCompetitor.mutateAsync(plan.survivor);
      await deleteCompetitors.mutateAsync({ ids: plan.deleteIds, seriesId });
      queryClient.invalidateQueries({ queryKey: queryKeys.finishes.all });
      // Merged rows can't stay in the possible list (or the selection).
      const goneIds = new Set(group.competitors.map((c) => c.id));
      setSelectedIds((prev) => new Set([...prev].filter((id) => !goneIds.has(id))));
      setPossibleDuplicates((prev) => {
        if (!prev) return prev;
        const remaining = prev.groups.filter((g) => g !== group);
        return remaining.length > 0 ? { ...prev, groups: remaining } : null;
      });
      setStatusMessage(
        `Merged ${group.competitors.length} entries into ${plan.survivor.sailNumber}.`,
      );
    } finally {
      setMerging(false);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const c of filteredCompetitors) next.delete(c.id);
      } else {
        for (const c of filteredCompetitors) next.add(c.id);
      }
      return next;
    });
  }

  // Auto-focus first row when list first loads
  useEffect(() => {
    if (didAutoFocus.current || !competitors?.length) return;
    didAutoFocus.current = true;
    (tbodyRef.current?.querySelector<HTMLElement>('tr[tabindex="0"]'))?.focus();
  }, [competitors]);

  // Return focus to the row that triggered the edit dialog
  useEffect(() => {
    if (editingCompetitor === null) {
      editingRowRef.current?.focus();
      editingRowRef.current = null;
    }
  }, [editingCompetitor]);

  const hasHandicapFleet = (fleets ?? []).some((f) => f.scoringSystem !== 'scratch');
  const hasRrsImport = useFeatures().has('rrs-import');
  const bulkFieldOptions = bulkEditFieldOptions(enabledFields, axes, fleets ?? []);

  useShortcuts([
    { key: 'n', description: 'Add competitor', section: 'Competitors', handler: () => setShowAddForm(true) },
    { key: 'i', description: hasRrsImport ? 'Import (spreadsheet / rrs.org)' : 'Import spreadsheet', section: 'Competitors', handler: () => importRef.current?.trigger() },
    {
      key: 'u',
      description: 'Update handicaps (handicap fleets only)',
      section: 'Competitors',
      when: () => hasHandicapFleet,
      handler: () => updateHandicapsRef.current?.open(),
    },
    { key: '/', description: 'Filter competitors', section: 'Competitors', handler: () => filterInputRef.current?.focus() },
    {
      key: 's',
      description: 'Set a field on selected competitors',
      section: 'Competitors',
      when: () => !readOnly && selectedCount > 0 && bulkFieldOptions.length > 0,
      handler: () => setBulkEditOpen(true),
    },
    {
      // Not Shift+D — that's the global dark-mode toggle.
      key: 'Delete',
      displayKeys: ['Del'],
      description: 'Delete selected competitors',
      section: 'Competitors',
      when: () => !readOnly && selectedCount > 0,
      handler: () => setConfirmingBulkDelete(true),
    },
  ]);
  // Row-level keys bound on the focused table row itself.
  useShortcutHelp([
    { key: 'e', description: 'Edit focused row', section: 'Competitors' },
    { key: 'd', description: 'Delete focused row', section: 'Competitors' },
    { key: 'x', description: 'Select/deselect focused row', section: 'Competitors' },
  ]);

  function ratingFieldsFromForm(data: CompetitorFormData): Pick<Competitor, 'ircTcc' | 'vprsTcc' | 'pyNumber' | 'nhcStartingTcf' | 'echoStartingTcf'> {
    const tcc = data.ircTcc.trim() ? parseFloat(data.ircTcc.trim()) : undefined;
    const vprs = data.vprsTcc.trim() ? parseFloat(data.vprsTcc.trim()) : undefined;
    const py = data.pyNumber.trim() ? parseInt(data.pyNumber.trim(), 10) : undefined;
    const nhc = data.nhcStartingTcf.trim() ? parseFloat(data.nhcStartingTcf.trim()) : undefined;
    const echo = data.echoStartingTcf.trim() ? parseFloat(data.echoStartingTcf.trim()) : undefined;
    return {
      ...(tcc != null && !isNaN(tcc) ? { ircTcc: tcc } : {}),
      ...(vprs != null && !isNaN(vprs) ? { vprsTcc: vprs } : {}),
      ...(py != null && !isNaN(py) ? { pyNumber: py } : {}),
      ...(nhc != null && !isNaN(nhc) ? { nhcStartingTcf: nhc } : {}),
      ...(echo != null && !isNaN(echo) ? { echoStartingTcf: echo } : {}),
    };
  }

  async function handleAdd(data: CompetitorFormData) {
    // Use selected fleet IDs, falling back to the first available fleet
    let fleetIds = data.fleetIds.length > 0
      ? data.fleetIds
      : (fleets ?? []).length > 0
        ? [(fleets ?? [])[0].id]
        : [];
    const competitor: Competitor = {
      id: crypto.randomUUID(),
      seriesId,
      fleetIds,
      sailNumber: data.sailNumber,
      ...(data.bowNumber.trim() ? { bowNumber: data.bowNumber.trim() } : {}),
      ...(data.boatName.trim() ? { boatName: data.boatName.trim() } : {}),
      ...(data.boatClass.trim() ? { boatClass: data.boatClass.trim() } : {}),
      name: data.name,
      ...(data.owner.trim() ? { owner: data.owner.trim() } : {}),
      ...((): { crewNames?: string[] } => {
        const crew = cleanCrewNames(data.crewNames);
        return crew ? { crewNames: crew } : {};
      })(),
      club: data.club,
      ...(data.nationality.trim() ? { nationality: data.nationality.trim() } : {}),
      gender: data.gender,
      age: data.age ? parseInt(data.age, 10) : null,
      ...((): { subdivisions?: Record<string, string> } => {
        const subs = cleanSubdivisions(data.subdivisions);
        return subs ? { subdivisions: subs } : {};
      })(),
      createdAt: Date.now(),
      ...ratingFieldsFromForm(data),
    };
    log('competitors', 'adding', competitor);
    await saveCompetitor.mutateAsync(competitor);
    setShowAddForm(false);
  }

  async function handleEdit(data: CompetitorFormData) {
    if (!editingCompetitor) return;
    // Use selected fleet IDs, falling back to the first available fleet
    let newFleetIds = data.fleetIds.length > 0
      ? data.fleetIds
      : (fleets ?? []).length > 0
        ? [(fleets ?? [])[0].id]
        : [];
    const updated: Competitor = {
      ...editingCompetitor,
      fleetIds: newFleetIds,
      sailNumber: data.sailNumber,
      ...(data.bowNumber.trim() ? { bowNumber: data.bowNumber.trim() } : {}),
      ...(data.boatName.trim() ? { boatName: data.boatName.trim() } : {}),
      ...(data.boatClass.trim() ? { boatClass: data.boatClass.trim() } : {}),
      name: data.name,
      ...(data.owner.trim() ? { owner: data.owner.trim() } : {}),
      ...(data.helm.trim() ? { helm: data.helm.trim() } : {}),
      ...((): { crewNames?: string[] } => {
        const crew = cleanCrewNames(data.crewNames);
        return crew ? { crewNames: crew } : {};
      })(),
      club: data.club,
      ...(data.nationality.trim() ? { nationality: data.nationality.trim() } : {}),
      gender: data.gender,
      age: data.age ? parseInt(data.age, 10) : null,
      ...((): { subdivisions?: Record<string, string> } => {
        const subs = cleanSubdivisions(data.subdivisions);
        return subs ? { subdivisions: subs } : {};
      })(),
      ...ratingFieldsFromForm(data),
    };
    // Clear ratings no longer relevant
    if (!updated.ircTcc) delete updated.ircTcc;
    if (!updated.vprsTcc) delete updated.vprsTcc;
    if (!updated.pyNumber) delete updated.pyNumber;
    if (!updated.nhcStartingTcf) delete updated.nhcStartingTcf;
    if (!updated.echoStartingTcf) delete updated.echoStartingTcf;
    if (!data.bowNumber.trim()) delete updated.bowNumber;
    if (!data.boatName.trim()) delete updated.boatName;
    if (!data.boatClass.trim()) delete updated.boatClass;
    if (!data.owner.trim()) delete updated.owner;
    if (!data.helm.trim()) delete updated.helm;
    if (!cleanCrewNames(data.crewNames)) delete updated.crewNames;
    if (!data.nationality.trim()) delete updated.nationality;
    if (!cleanSubdivisions(data.subdivisions)) delete updated.subdivisions;
    log('competitors', 'updating', updated);
    await saveCompetitor.mutateAsync(updated);
    setEditingCompetitor(null);
  }

  async function handleDelete(competitor: Competitor) {
    if (!confirm(`Delete ${competitor.name} (${competitor.sailNumber})?`)) return;
    log('competitors', 'deleting', competitor.id);
    await deleteCompetitor.mutateAsync({ id: competitor.id, seriesId });
    // Close the edit dialog (delete is now dialog-only) and drop the stale
    // row ref so the close effect doesn't try to refocus a removed row.
    editingRowRef.current = null;
    setEditingCompetitor(null);
  }

  async function handleBulkDelete() {
    const ids = selectedCompetitors.map((c) => c.id);
    if (ids.length === 0) return;
    log('competitors', 'bulk deleting', ids);
    await deleteCompetitors.mutateAsync({ ids, seriesId });
    setSelectedIds(new Set());
    setConfirmingBulkDelete(false);
    setStatusMessage(null);
  }

  const existingCompetitors = (competitors ?? []).map((c) => ({ sailNumber: c.sailNumber.toUpperCase(), fleetIds: c.fleetIds }));
  const editingExcluded = editingCompetitor
    ? existingCompetitors.filter((c) => c.sailNumber !== editingCompetitor.sailNumber.toUpperCase() || !sameFleetIdSet(c.fleetIds, editingCompetitor.fleetIds))
    : existingCompetitors;
  const showBow = enabledFields.includes('bowNumber');
  const showBoat = enabledFields.includes('boatName');
  const showClass = enabledFields.includes('boatClass');
  const showOwner = enabledFields.includes('owner') && !isFieldDisabledByPrimary('owner', primaryLabel);
  const showHelm = enabledFields.includes('helm') && !isFieldDisabledByPrimary('helm', primaryLabel);
  const showCrew = enabledFields.includes('crewName');
  const showClub = enabledFields.includes('club');
  const showNationality = enabledFields.includes('nationality');
  const showGender = enabledFields.includes('gender');
  const showAge = enabledFields.includes('age');
  const visibleAxes = enabledFields.includes('subdivision') ? axes : [];

  return (
    <div className="space-y-6">
      {series?.previousSeriesId && (
        <FollowOnProvenanceNote previousSeriesId={series.previousSeriesId} />
      )}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {competitors === undefined
            ? 'Loading…'
            : filter.trim()
              ? `${filteredCompetitors.length} of ${competitors.length} competitors`
              : `${competitors.length} competitor${competitors.length === 1 ? '' : 's'}`}
        </p>
        {!showAddForm && !readOnly && (
          <div className="flex gap-2">
            {hasHandicapFleet && (
              <Button
                variant="outline"
                onClick={() => updateHandicapsRef.current?.open()}
              >
                Update handicaps
              </Button>
            )}
            <CompetitorImport
              ref={importRef}
              seriesId={seriesId}
              fleets={fleets ?? []}
            />
            <Button onClick={() => setShowAddForm(true)}>Add competitor</Button>
          </div>
        )}
        <UpdateHandicaps ref={updateHandicapsRef} seriesId={seriesId} />
      </div>

      {showAddForm && (
        <div className="bg-card border rounded-lg p-5">
          <h2 className="font-medium mb-4">Add competitor</h2>
          <CompetitorForm
            initial={emptyCompetitorForm}
            onSave={handleAdd}
            onCancel={() => setShowAddForm(false)}
            existingCompetitors={existingCompetitors}
            availableFleets={fleets ?? []}
            enabledFields={enabledFields}
            primaryLabel={primaryLabel}
            subdivisionAxes={axes}
          />
        </div>
      )}

      {competitors !== undefined && competitors.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Input
            ref={filterInputRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setFilter('');
                e.currentTarget.blur();
              }
            }}
            placeholder="Filter competitors…"
            aria-label="Filter competitors"
            className="max-w-sm"
          />
          {!readOnly && competitors.length > 1 && (
            <Button variant="outline" size="sm" onClick={handleFindDuplicates}>
              Find duplicates
            </Button>
          )}
          {selectedCount > 0 && (
            <>
              <p className="text-sm text-muted-foreground">
                {selectedCount} selected
              </p>
              {bulkFieldOptions.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBulkEditOpen(true)}
                >
                  Set field…
                </Button>
              )}
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmingBulkDelete(true)}
              >
                Delete selected
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedIds(new Set());
                  setStatusMessage(null);
                }}
              >
                Clear selection
              </Button>
            </>
          )}
          {statusMessage && (
            <p className="text-sm text-muted-foreground" role="status">
              {statusMessage}
            </p>
          )}
        </div>
      )}

      {competitors !== undefined && competitors.length > 0 && filteredCompetitors.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No competitors match the filter.
        </p>
      )}

      {competitors !== undefined && filteredCompetitors.length > 0 && (
        <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {!readOnly && (
                <TableHead className="w-8">
                  <input
                    ref={headerCheckboxRef}
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    aria-label="Select all shown competitors"
                  />
                </TableHead>
              )}
              <TableHead>Sail no.</TableHead>
              {showBow && <TableHead>Bow no.</TableHead>}
              {showBoat && <TableHead>Boat</TableHead>}
              {showClass && <TableHead>Class</TableHead>}
              <TableHead className="whitespace-normal break-words">{primaryFieldLabel}</TableHead>
              {showHelm && <TableHead className="whitespace-normal break-words">Helm</TableHead>}
              {showOwner && <TableHead className="whitespace-normal break-words">Owner</TableHead>}
              {showCrew && <TableHead className="whitespace-normal break-words">Crew</TableHead>}
              {showClub && <TableHead>Club</TableHead>}
              {showNationality && <TableHead>Nat</TableHead>}
              {multipleFleets && <TableHead className="whitespace-normal break-words">Fleet</TableHead>}
              {showRating && <TableHead>Rating</TableHead>}
              {showGender && <TableHead>Gender</TableHead>}
              {showAge && <TableHead>Age</TableHead>}
              {visibleAxes.map((axis) => (
                <TableHead key={axis.id} className="whitespace-normal break-words">{subdivisionAxisLabel(axis)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody ref={tbodyRef}>
            {filteredCompetitors.map((c) => (
              <TableRow
                key={c.id}
                tabIndex={0}
                className={`group/row focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset${readOnly ? '' : ' cursor-pointer'}`}
                onClick={(e) => {
                  if (readOnly) return;
                  editingRowRef.current = e.currentTarget;
                  setEditingCompetitor(c);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'e' || e.key === 'Enter') {
                    e.preventDefault();
                    editingRowRef.current = e.currentTarget;
                    setEditingCompetitor(c);
                  } else if (e.key === 'x' && !readOnly) {
                    e.preventDefault();
                    toggleSelected(c.id);
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    (e.currentTarget.nextElementSibling as HTMLElement)?.focus();
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    (e.currentTarget.previousElementSibling as HTMLElement)?.focus();
                  }
                }}
              >
                {!readOnly && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {/* Generic label on purpose: a sail number here would leak
                        into the cell's accessible name and collide with the
                        sail-number cell locators used throughout the e2e
                        suite. The row itself provides the context. */}
                    <input
                      type="checkbox"
                      checked={selectedIds.has(c.id)}
                      onChange={() => toggleSelected(c.id)}
                      aria-label="Select row"
                    />
                  </TableCell>
                )}
                <TableCell className="font-mono">
                  <MissingRatingIcon missing={missingRatings(c, fleetById)} />
                  {c.sailNumber}
                </TableCell>
                {showBow && <TableCell className="font-mono">{c.bowNumber ?? ''}</TableCell>}
                {showBoat && <TruncatedCell value={c.boatName} />}
                {showClass && <TruncatedCell value={c.boatClass} />}
                <TableCell className="whitespace-normal break-words">{c.name}</TableCell>
                {showHelm && <TableCell className="whitespace-normal break-words">{c.helm ?? ''}</TableCell>}
                {showOwner && <TableCell className="whitespace-normal break-words">{c.owner ?? ''}</TableCell>}
                {showCrew && <TableCell className="whitespace-normal break-words">{(c.crewNames ?? []).map((n, i) => <div key={i}>{n}</div>)}</TableCell>}
                {showClub && <TruncatedCell value={c.club} />}
                {showNationality && <TableCell className="font-mono">{c.nationality ?? ''}</TableCell>}
                {multipleFleets && <TableCell className="whitespace-normal break-words">{c.fleetIds.map((id) => fleetById.get(id)?.name ?? '').join(', ')}</TableCell>}
                {showRating && (
                  <TableCell className="font-mono">
                    {(() => {
                      const ratings = competitorRatings(c, fleetById);
                      if (ratings.length === 0) return '—';
                      return ratings
                        .map((r) => (showRatingLabels ? `${r.value} ${r.label}` : r.value))
                        .join(' · ');
                    })()}
                  </TableCell>
                )}
                {showGender && <TableCell>{c.gender}</TableCell>}
                {showAge && <TableCell>{c.age ?? ''}</TableCell>}
                {visibleAxes.map((axis) => (
                  <TableCell key={axis.id} className="whitespace-normal break-words">{c.subdivisions?.[axis.id] ?? ''}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      )}

      {competitors !== undefined && competitors.length === 0 && !showAddForm && (
        <p className="text-sm text-muted-foreground">
          No competitors yet. Add the first one above.
        </p>
      )}

      {/* Bulk delete confirm */}
      {/* Possible-duplicates review: one boat under two sail numbers, merge per group */}
      <Dialog open={possibleDuplicates !== null} onOpenChange={(open) => { if (!open) setPossibleDuplicates(null); }}>
        <DialogContent className="w-[90vw] max-w-2xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Possible duplicates</DialogTitle>
            <DialogDescription>
              These entries share a fleet and a boat or person name but carry
              different sail numbers — usually one boat whose number changed
              between imports. Merging keeps a single entry with all the
              recorded results and the newest details, including the newest
              sail number.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-y-auto space-y-3">
            {possibleDuplicates?.groups.map((group) => {
              const plan = planDuplicateMerge(group, possibleDuplicates.finishes, possibleDuplicates.overrides);
              return (
                <div key={group.keeperId} className="rounded-md border p-3 space-y-2">
                  {group.competitors.map((c) => {
                    const resultCount = possibleDuplicates.finishes.filter(
                      (f) => f.competitorId === c.id,
                    ).length;
                    return (
                      <div key={c.id} className="flex items-center gap-3 text-sm">
                        <span className="font-mono whitespace-nowrap">{c.sailNumber}</span>
                        <span className="truncate min-w-0">
                          {[c.boatName, c.name].filter(Boolean).join(' — ')}
                        </span>
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          {resultCount} result{resultCount === 1 ? '' : 's'}
                        </span>
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-xs text-muted-foreground">
                      matched on {group.matchedOn.join(' and ')}
                    </span>
                    {plan.ok ? (
                      <Button
                        size="sm"
                        className="ml-auto"
                        disabled={merging}
                        onClick={() => void handleMergeGroup(group)}
                      >
                        Merge into {plan.survivor.sailNumber}
                      </Button>
                    ) : (
                      <span className="ml-auto flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        These entries both have a finish in the same race —
                        resolve that by hand before merging.
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPossibleDuplicates(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmingBulkDelete} onOpenChange={(open) => { if (!open) setConfirmingBulkDelete(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {selectedCount} competitor{selectedCount === 1 ? '' : 's'}?
            </DialogTitle>
            <DialogDescription>
              This removes {selectedCount === 1 ? 'the selected competitor' : 'the selected competitors'} from the series.
            </DialogDescription>
          </DialogHeader>
          {selectedWithResults > 0 && (
            <p className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-500">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {selectedWithResults === 1
                  ? '1 of these has recorded race results, which will also be deleted.'
                  : `${selectedWithResults} of these have recorded race results, which will also be deleted.`}
              </span>
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingBulkDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={deleteCompetitors.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!readOnly && (
        <CompetitorBulkEditDialog
          open={bulkEditOpen}
          onOpenChange={setBulkEditOpen}
          seriesId={seriesId}
          selected={selectedCompetitors}
          allCompetitors={competitors ?? []}
          options={bulkFieldOptions}
          onApplied={setStatusMessage}
        />
      )}

      {/* Edit dialog */}
      <Dialog open={editingCompetitor !== null} onOpenChange={(open) => { if (!open) setEditingCompetitor(null); }}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Edit competitor</DialogTitle>
            {editingCompetitor && (
              <CompetitorAuditLine competitorId={editingCompetitor.id} />
            )}
          </DialogHeader>
          {editingCompetitor && (
            <CompetitorForm
              initial={{
                sailNumber: editingCompetitor.sailNumber,
                bowNumber: editingCompetitor.bowNumber ?? '',
                boatName: editingCompetitor.boatName ?? '',
                boatClass: editingCompetitor.boatClass ?? '',
                name: editingCompetitor.name,
                owner: editingCompetitor.owner ?? '',
                helm: editingCompetitor.helm ?? '',
                crewNames: editingCompetitor.crewNames ?? [],
                club: editingCompetitor.club,
                nationality: editingCompetitor.nationality ?? '',
                gender: editingCompetitor.gender,
                age: editingCompetitor.age?.toString() ?? '',
                subdivisions: editingCompetitor.subdivisions ?? {},
                fleetIds: editingCompetitor.fleetIds,
                ircTcc: editingCompetitor.ircTcc?.toString() ?? '',
                vprsTcc: editingCompetitor.vprsTcc?.toString() ?? '',
                pyNumber: editingCompetitor.pyNumber?.toString() ?? '',
                nhcStartingTcf: editingCompetitor.nhcStartingTcf?.toString() ?? '',
                echoStartingTcf: editingCompetitor.echoStartingTcf?.toString() ?? '',
              }}
              onSave={handleEdit}
              onCancel={() => setEditingCompetitor(null)}
              onDelete={() => handleDelete(editingCompetitor)}
              existingCompetitors={editingExcluded}
              availableFleets={fleets ?? []}
              enabledFields={enabledFields}
              primaryLabel={primaryLabel}
              subdivisionAxes={axes}
            />
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
