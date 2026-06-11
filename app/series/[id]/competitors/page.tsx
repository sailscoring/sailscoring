'use client';

import { use, useState, useRef, useEffect } from 'react';
import { useSeries } from '@/hooks/use-series';
import { useSeriesReadOnly } from '@/components/series-read-only';
import { useFleetsBySeries } from '@/hooks/use-fleets';
import {
  useCompetitorsBySeries,
  useDeleteCompetitor,
  useSaveCompetitor,
} from '@/hooks/use-competitors';
import { Button } from '@/components/ui/button';
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
  CompetitorAuditLine,
  CompetitorForm,
  emptyCompetitorForm,
  type CompetitorFormData,
} from '@/components/competitor-form';
import { UpdateHandicaps, type UpdateHandicapsHandle } from '@/components/update-handicaps';
import type { Competitor, Fleet, CompetitorFieldKey, PrimaryPersonLabel } from '@/lib/types';
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
  subdivisionFieldLabel,
} from '@/lib/competitor-fields';
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
  const readOnly = useSeriesReadOnly();
  const { data: competitors } = useCompetitorsBySeries(seriesId);
  const { data: fleets } = useFleetsBySeries(seriesId);
  const { data: series } = useSeries(seriesId);
  const saveCompetitor = useSaveCompetitor();
  const deleteCompetitor = useDeleteCompetitor();
  const enabledFields: CompetitorFieldKey[] =
    series?.enabledCompetitorFields ?? defaultEnabledCompetitorFields();
  const primaryLabel: PrimaryPersonLabel =
    series?.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL;
  const primaryFieldLabel = PRIMARY_PERSON_LABEL_TEXT[primaryLabel];
  const subdivisionLabel = subdivisionFieldLabel({
    subdivisionLabel: series?.subdivisionLabel ?? '',
  });
  const fleetById = new Map((fleets ?? []).map((f) => [f.id, f]));
  const multipleFleets = (fleets ?? []).length > 1;
  const ratingSystems = configuredRatingSystems(fleets ?? []);
  const showRating = ratingSystems.length > 0;
  const showRatingLabels = ratingSystems.length > 1;


  const [showAddForm, setShowAddForm] = useState(false);
  const [editingCompetitor, setEditingCompetitor] = useState<Competitor | null>(null);
  const editingRowRef = useRef<HTMLTableRowElement | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const importRef = useRef<CompetitorImportHandle>(null);
  const updateHandicapsRef = useRef<UpdateHandicapsHandle>(null);
  const didAutoFocus = useRef(false);

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

  useShortcuts([
    { key: 'n', description: 'Add competitor', section: 'Competitors', handler: () => setShowAddForm(true) },
    { key: 'i', description: 'Import CSV', section: 'Competitors', handler: () => importRef.current?.trigger() },
    {
      key: 'u',
      description: 'Update handicaps (handicap fleets only)',
      section: 'Competitors',
      when: () => hasHandicapFleet,
      handler: () => updateHandicapsRef.current?.open(),
    },
  ]);
  // Row-level keys bound on the focused table row itself.
  useShortcutHelp([
    { key: 'e', description: 'Edit focused row', section: 'Competitors' },
    { key: 'd', description: 'Delete focused row', section: 'Competitors' },
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
      ...(data.boatName.trim() ? { boatName: data.boatName.trim() } : {}),
      ...(data.boatClass.trim() ? { boatClass: data.boatClass.trim() } : {}),
      name: data.name,
      ...(data.owner.trim() ? { owner: data.owner.trim() } : {}),
      ...(data.crewName.trim() ? { crewName: data.crewName.trim() } : {}),
      club: data.club,
      ...(data.nationality.trim() ? { nationality: data.nationality.trim() } : {}),
      gender: data.gender,
      age: data.age ? parseInt(data.age, 10) : null,
      ...(data.subdivision.trim() ? { subdivision: data.subdivision.trim() } : {}),
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
      ...(data.boatName.trim() ? { boatName: data.boatName.trim() } : {}),
      ...(data.boatClass.trim() ? { boatClass: data.boatClass.trim() } : {}),
      name: data.name,
      ...(data.owner.trim() ? { owner: data.owner.trim() } : {}),
      ...(data.helm.trim() ? { helm: data.helm.trim() } : {}),
      ...(data.crewName.trim() ? { crewName: data.crewName.trim() } : {}),
      club: data.club,
      ...(data.nationality.trim() ? { nationality: data.nationality.trim() } : {}),
      gender: data.gender,
      age: data.age ? parseInt(data.age, 10) : null,
      ...(data.subdivision.trim() ? { subdivision: data.subdivision.trim() } : {}),
      ...ratingFieldsFromForm(data),
    };
    // Clear ratings no longer relevant
    if (!updated.ircTcc) delete updated.ircTcc;
    if (!updated.vprsTcc) delete updated.vprsTcc;
    if (!updated.pyNumber) delete updated.pyNumber;
    if (!updated.nhcStartingTcf) delete updated.nhcStartingTcf;
    if (!updated.echoStartingTcf) delete updated.echoStartingTcf;
    if (!data.boatName.trim()) delete updated.boatName;
    if (!data.boatClass.trim()) delete updated.boatClass;
    if (!data.owner.trim()) delete updated.owner;
    if (!data.helm.trim()) delete updated.helm;
    if (!data.crewName.trim()) delete updated.crewName;
    if (!data.nationality.trim()) delete updated.nationality;
    if (!data.subdivision.trim()) delete updated.subdivision;
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


  const existingCompetitors = (competitors ?? []).map((c) => ({ sailNumber: c.sailNumber.toUpperCase(), fleetIds: c.fleetIds }));
  const editingExcluded = editingCompetitor
    ? existingCompetitors.filter((c) => c.sailNumber !== editingCompetitor.sailNumber.toUpperCase() || !sameFleetIdSet(c.fleetIds, editingCompetitor.fleetIds))
    : existingCompetitors;
  const showBoat = enabledFields.includes('boatName');
  const showClass = enabledFields.includes('boatClass');
  const showOwner = enabledFields.includes('owner') && !isFieldDisabledByPrimary('owner', primaryLabel);
  const showHelm = enabledFields.includes('helm') && !isFieldDisabledByPrimary('helm', primaryLabel);
  const showCrew = enabledFields.includes('crewName');
  const showClub = enabledFields.includes('club');
  const showNationality = enabledFields.includes('nationality');
  const showGender = enabledFields.includes('gender');
  const showAge = enabledFields.includes('age');
  const showSubdivision = enabledFields.includes('subdivision');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {competitors === undefined
            ? 'Loading…'
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
            subdivisionLabel={subdivisionLabel}
          />
        </div>
      )}

      {competitors !== undefined && competitors.length > 0 && (
        <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sail no.</TableHead>
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
              {showSubdivision && <TableHead className="whitespace-normal break-words">{subdivisionLabel}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody ref={tbodyRef}>
            {competitors.map((c) => (
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
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    (e.currentTarget.nextElementSibling as HTMLElement)?.focus();
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    (e.currentTarget.previousElementSibling as HTMLElement)?.focus();
                  }
                }}
              >
                <TableCell className="font-mono">
                  <MissingRatingIcon missing={missingRatings(c, fleetById)} />
                  {c.sailNumber}
                </TableCell>
                {showBoat && <TruncatedCell value={c.boatName} />}
                {showClass && <TruncatedCell value={c.boatClass} />}
                <TableCell className="whitespace-normal break-words">{c.name}</TableCell>
                {showHelm && <TableCell className="whitespace-normal break-words">{c.helm ?? ''}</TableCell>}
                {showOwner && <TableCell className="whitespace-normal break-words">{c.owner ?? ''}</TableCell>}
                {showCrew && <TableCell className="whitespace-normal break-words">{c.crewName ?? ''}</TableCell>}
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
                {showSubdivision && <TableCell className="whitespace-normal break-words">{c.subdivision ?? ''}</TableCell>}
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
                boatName: editingCompetitor.boatName ?? '',
                boatClass: editingCompetitor.boatClass ?? '',
                name: editingCompetitor.name,
                owner: editingCompetitor.owner ?? '',
                helm: editingCompetitor.helm ?? '',
                crewName: editingCompetitor.crewName ?? '',
                club: editingCompetitor.club,
                nationality: editingCompetitor.nationality ?? '',
                gender: editingCompetitor.gender,
                age: editingCompetitor.age?.toString() ?? '',
                subdivision: editingCompetitor.subdivision ?? '',
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
              subdivisionLabel={subdivisionLabel}
            />
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
