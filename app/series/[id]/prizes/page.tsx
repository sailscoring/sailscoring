'use client';

import { use, useState } from 'react';
import { AlertTriangle, Pencil, Plus, Trash2 } from 'lucide-react';
import { useSeriesData } from '@/hooks/use-series-data';
import { useUpdateSeries } from '@/hooks/use-series';
import { useIsMutating } from '@tanstack/react-query';
import { seriesRowMutationKey } from '@/hooks/use-series';
import {
  calculateFleetStandings,
  buildRaceFleetExclusionMap,
} from '@/lib/scoring';
import { subdivisionAxes, subdivisionAxisLabel } from '@/lib/competitor-fields';
import {
  allocatePrizes,
  describePrizeClauses,
  ordinal,
  prizeWarningMessage,
  PRIZE_NAME_MAX_LENGTH,
  PRIZE_RECIPIENT_COUNT_MAX,
  PRIZE_CLAUSES_MAX,
} from '@/lib/prizes';
import type { Prize, PrizeClause } from '@/lib/types';
import { SeriesTabFallback } from '@/components/series-tab-fallback';
import { useSeriesReadOnly } from '@/components/series-read-only';
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions';
import { useShortcuts } from '@/hooks/use-keyboard-shortcut';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SortableList, DragHandle } from '@/components/ui/sortable-list';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/** The clause-field picker's value: a fixed clause kind, or an axis id
 *  prefixed so it can't collide with the fixed kinds. */
type ClauseField = 'fleet' | 'rank' | 'gender' | 'nationality' | 'club' | `axis:${string}`;

function clauseField(c: PrizeClause): ClauseField {
  return c.kind === 'axis' ? `axis:${c.axisId}` : c.kind;
}

export default function PrizesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: seriesId } = use(params);
  const readOnly = useSeriesReadOnly();
  const { can } = useWorkspacePermissions();
  const updateSeries = useUpdateSeries();
  const canEdit = !readOnly && can('manage-series');
  const [editing, setEditing] = useState<Prize | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Prize | null>(null);

  const data = useSeriesData(seriesId, { finishes: true, raceStarts: true });

  // Local mirror so drag-reorder stays responsive while the save is in
  // flight; re-synced from the persisted row once the save queue drains
  // (same pattern as the competitor-fields card's axes editor).
  const persisted: Prize[] =
    (data.status === 'ready' ? data.series.prizes : undefined) ?? [];
  const [localPrizes, setLocalPrizes] = useState<Prize[]>(persisted);
  const savesInFlight = useIsMutating({ mutationKey: seriesRowMutationKey }) > 0;
  const persistedKey = JSON.stringify(persisted);
  const [prevPersistedKey, setPrevPersistedKey] = useState(persistedKey);
  if (prevPersistedKey !== persistedKey && !savesInFlight) {
    setPrevPersistedKey(persistedKey);
    setLocalPrizes(persisted);
  }

  useShortcuts([
    ...(canEdit
      ? [{ key: 'a', description: 'Add prize', section: 'Prizes', handler: () => setEditing('new') }]
      : []),
  ]);

  if (data.status !== 'ready') {
    return <SeriesTabFallback status={data.status === 'missing' ? 'missing' : 'loading'} />;
  }
  const { series, competitors, fleets, races } = data;
  const axes = subdivisionAxes(series);

  async function persistPrizes(next: Prize[]) {
    setLocalPrizes(next);
    await updateSeries.mutateAsync({
      id: seriesId,
      patch: {
        prizes: next,
        lastModifiedAt: Date.now(),
      },
    });
  }

  // Prizes rank by the whole-series standings (the only ranking rule so far).
  const { fleetStandings } = calculateFleetStandings(
    fleets,
    competitors,
    races,
    data.finishes ?? [],
    series.discardThresholds ?? [],
    series.dnfScoring ?? 'seriesEntries',
    data.raceStarts ?? [],
    undefined,
    undefined,
    buildRaceFleetExclusionMap(series.raceFleetExclusions),
  );
  const allocations = allocatePrizes(localPrizes, fleetStandings, axes);
  const multiFleet = fleets.length > 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {localPrizes.length === 0
            ? 'Named awards allocated from the series standings.'
            : `${localPrizes.length} prize${localPrizes.length === 1 ? '' : 's'} · recipients update live with the standings.`}
        </p>
        {canEdit && (
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" />
            Add prize
          </Button>
        )}
      </div>

      {localPrizes.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <p>
              No prizes yet. A prize is a named award — say, &ldquo;Gold Fleet 1st, 2nd,
              3rd&rdquo; — with conditions on who is eligible; the top finishers in the
              series standings that meet them are the recipients.
            </p>
            {canEdit && (
              <Button className="mt-4" size="sm" onClick={() => setEditing('new')}>
                <Plus className="h-4 w-4" />
                Add the first prize
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <SortableList
          items={localPrizes}
          onReorder={(orderedIds) => {
            const byId = new Map(localPrizes.map((p) => [p.id, p]));
            void persistPrizes(
              orderedIds
                .map((pid) => byId.get(pid))
                .filter((p): p is Prize => p !== undefined),
            );
          }}
          isDisabled={() => !canEdit}
        >
          {(prize, { ref, style, handleProps, isDragging }) => {
            const allocation = allocations.find((a) => a.prize.id === prize.id);
            return (
              <div ref={ref} style={style} className={isDragging ? 'opacity-70' : undefined}>
                <Card className="mb-3">
                  <CardContent className="pt-4 space-y-3">
                    <div className="flex items-start gap-2">
                      {canEdit && (
                        <DragHandle {...handleProps} data-testid={`prize-drag-${prize.id}`} />
                      )}
                      <div className="min-w-0 flex-1">
                        <h3 className="font-medium">{prize.name}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {describePrizeClauses(prize.clauses, fleets, axes)}
                          {` · top ${prize.recipientCount === 1 ? 'finisher' : prize.recipientCount}`}
                        </p>
                      </div>
                      {canEdit && (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit ${prize.name}`}
                            onClick={() => setEditing(prize)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete ${prize.name}`}
                            onClick={() => setConfirmDelete(prize)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>

                    {allocation && allocation.warnings.length > 0 && (
                      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200 space-y-1">
                        {allocation.warnings.map((w, i) => (
                          <p key={i} className="flex items-start gap-1.5">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                            {prizeWarningMessage(w)}
                          </p>
                        ))}
                      </div>
                    )}

                    {allocation && allocation.recipients.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-16">Place</TableHead>
                            <TableHead>Sail No</TableHead>
                            <TableHead>Name</TableHead>
                            {multiFleet && <TableHead>Fleet</TableHead>}
                            <TableHead className="text-right">Series rank</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {allocation.recipients.map((r) => (
                            <TableRow key={r.standing.competitor.id}>
                              <TableCell>{ordinal(r.position)}</TableCell>
                              <TableCell>{r.standing.competitor.sailNumber}</TableCell>
                              <TableCell>{r.standing.competitor.name}</TableCell>
                              {multiFleet && <TableCell>{r.fleet.name}</TableCell>}
                              <TableCell className="text-right">{r.standing.rank}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No eligible competitors yet.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            );
          }}
        </SortableList>
      )}

      {editing !== null && (
        <PrizeEditorDialog
          prize={editing === 'new' ? null : editing}
          fleets={fleets}
          axes={axes}
          competitors={competitors}
          onClose={() => setEditing(null)}
          onSave={async (saved) => {
            const exists = localPrizes.some((p) => p.id === saved.id);
            await persistPrizes(
              exists
                ? localPrizes.map((p) => (p.id === saved.id ? saved : p))
                : [...localPrizes, saved],
            );
            setEditing(null);
          }}
        />
      )}

      <Dialog open={confirmDelete !== null} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete prize?</DialogTitle>
            <DialogDescription>
              &ldquo;{confirmDelete?.name}&rdquo; will be removed from the prize list.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!confirmDelete) return;
                await persistPrizes(localPrizes.filter((p) => p.id !== confirmDelete.id));
                setConfirmDelete(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PrizeEditorDialog({
  prize,
  fleets,
  axes,
  competitors,
  onClose,
  onSave,
}: {
  prize: Prize | null;
  fleets: { id: string; name: string }[];
  axes: { id: string; label: string }[];
  competitors: {
    subdivisions?: Record<string, string>;
    gender?: string;
    nationality?: string;
    club?: string;
  }[];
  onClose: () => void;
  onSave: (prize: Prize) => Promise<void>;
}) {
  const [name, setName] = useState(prize?.name ?? '');
  const [count, setCount] = useState(prize?.recipientCount ?? 3);
  const [clauses, setClauses] = useState<PrizeClause[]>(prize?.clauses ?? []);
  const [saving, setSaving] = useState(false);

  // Distinct recorded values per axis, for the value dropdown's suggestions.
  const axisValues = new Map<string, string[]>(
    axes.map((axis) => [
      axis.id,
      [...new Set(
        competitors
          .map((c) => c.subdivisions?.[axis.id]?.trim())
          .filter((v): v is string => !!v),
      )].sort(),
    ]),
  );

  // Intrinsic competitor fields: the picker offers only fields the series has
  // data for (a condition on an empty field can never match — the allocator
  // warns about exactly that on prizes that already carry one).
  const distinct = (read: (c: (typeof competitors)[number]) => string | undefined): string[] =>
    [...new Set(competitors.map((c) => read(c)?.trim()).filter((v): v is string => !!v))].sort();
  const nationalities = distinct((c) => c.nationality);
  const clubs = distinct((c) => c.club);
  const hasGender = competitors.some((c) => c.gender === 'M' || c.gender === 'F');

  function defaultClauseFor(field: ClauseField): PrizeClause {
    if (field === 'fleet') return { kind: 'fleet', fleetId: fleets[0]?.id ?? '' };
    if (field === 'rank') return { kind: 'rank', max: 3 };
    // "Lady 1st, 2nd, 3rd" is the common gendered prize, so female is the seed.
    if (field === 'gender') return { kind: 'gender', value: 'F' };
    if (field === 'nationality') return { kind: 'nationality', value: nationalities[0] ?? '' };
    if (field === 'club') return { kind: 'club', value: clubs[0] ?? '' };
    const axisId = field.slice('axis:'.length);
    return { kind: 'axis', axisId, value: axisValues.get(axisId)?.[0] ?? '' };
  }

  function setClause(i: number, clause: PrizeClause) {
    setClauses(clauses.map((c, j) => (j === i ? clause : c)));
  }

  const trimmedName = name.trim();
  const valid =
    trimmedName.length > 0 &&
    count >= 1 &&
    clauses.every(
      (c) =>
        (c.kind === 'fleet' && c.fleetId) ||
        (c.kind === 'axis' && c.axisId && c.value.trim()) ||
        (c.kind === 'rank' && c.max >= 1) ||
        c.kind === 'gender' ||
        ((c.kind === 'nationality' || c.kind === 'club') && c.value.trim()),
    );

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{prize ? 'Edit prize' : 'Add prize'}</DialogTitle>
          <DialogDescription>
            The top finishers in the series standings that meet every condition
            receive the prize.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="prize-name">Name</Label>
            <Input
              id="prize-name"
              value={name}
              maxLength={PRIZE_NAME_MAX_LENGTH}
              placeholder="Gold Fleet 1st, 2nd, 3rd"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prize-count">Places awarded</Label>
            <Input
              id="prize-count"
              type="number"
              min={1}
              max={PRIZE_RECIPIENT_COUNT_MAX}
              className="w-24"
              value={count}
              onChange={(e) => setCount(Math.floor(Number(e.target.value)))}
            />
          </div>

          <div className="space-y-2">
            <Label>Conditions</Label>
            {clauses.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No conditions — every competitor in the standings is eligible.
              </p>
            )}
            {clauses.map((clause, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select
                  value={clauseField(clause)}
                  onValueChange={(v) => setClause(i, defaultClauseFor(v as ClauseField))}
                >
                  <SelectTrigger className="w-44" aria-label="Condition field">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {axes.map((axis) => (
                      <SelectItem key={axis.id} value={`axis:${axis.id}`}>
                        {subdivisionAxisLabel(axis)}
                      </SelectItem>
                    ))}
                    <SelectItem value="fleet">Fleet</SelectItem>
                    <SelectItem value="rank">Series rank</SelectItem>
                    {(hasGender || clause.kind === 'gender') && (
                      <SelectItem value="gender">Helm gender</SelectItem>
                    )}
                    {(nationalities.length > 0 || clause.kind === 'nationality') && (
                      <SelectItem value="nationality">Nationality</SelectItem>
                    )}
                    {(clubs.length > 0 || clause.kind === 'club') && (
                      <SelectItem value="club">Club</SelectItem>
                    )}
                  </SelectContent>
                </Select>

                {clause.kind === 'fleet' && (
                  <Select
                    value={clause.fleetId}
                    onValueChange={(v) => setClause(i, { kind: 'fleet', fleetId: v })}
                  >
                    <SelectTrigger className="flex-1" aria-label="Fleet">
                      <SelectValue placeholder="Choose a fleet" />
                    </SelectTrigger>
                    <SelectContent>
                      {fleets.map((f) => (
                        <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {clause.kind === 'axis' && (
                  <>
                    <span className="text-sm text-muted-foreground">is</span>
                    <ValuePicker
                      key={clauseField(clause)}
                      value={clause.value}
                      options={axisValues.get(clause.axisId) ?? []}
                      ariaLabel="Axis value"
                      onChange={(v) => setClause(i, { ...clause, value: v })}
                    />
                  </>
                )}

                {clause.kind === 'rank' && (
                  <>
                    <span className="text-sm text-muted-foreground">at most</span>
                    <Input
                      type="number"
                      min={1}
                      className="w-24"
                      value={clause.max}
                      aria-label="Maximum rank"
                      onChange={(e) => setClause(i, { kind: 'rank', max: Math.floor(Number(e.target.value)) })}
                    />
                  </>
                )}

                {clause.kind === 'gender' && (
                  <>
                    <span className="text-sm text-muted-foreground">is</span>
                    <Select
                      value={clause.value}
                      onValueChange={(v) => setClause(i, { kind: 'gender', value: v as 'M' | 'F' })}
                    >
                      <SelectTrigger className="flex-1" aria-label="Gender">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="F">Female</SelectItem>
                        <SelectItem value="M">Male</SelectItem>
                      </SelectContent>
                    </Select>
                  </>
                )}

                {(clause.kind === 'nationality' || clause.kind === 'club') && (
                  <>
                    <span className="text-sm text-muted-foreground">is</span>
                    <ValuePicker
                      key={clauseField(clause)}
                      value={clause.value}
                      options={clause.kind === 'nationality' ? nationalities : clubs}
                      ariaLabel={clause.kind === 'nationality' ? 'Nationality' : 'Club'}
                      onChange={(v) => setClause(i, { ...clause, value: v })}
                    />
                  </>
                )}

                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove condition"
                  onClick={() => setClauses(clauses.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {clauses.length < PRIZE_CLAUSES_MAX && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setClauses([
                    ...clauses,
                    defaultClauseFor(axes.length > 0 ? `axis:${axes[0].id}` : 'rank'),
                  ])
                }
              >
                <Plus className="h-4 w-4" />
                Add condition
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!valid || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave({
                  id: prize?.id ?? crypto.randomUUID(),
                  name: trimmedName,
                  recipientCount: count,
                  clauses,
                });
              } finally {
                setSaving(false);
              }
            }}
          >
            {prize ? 'Save' : 'Add prize'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Value control for an equality condition: a dropdown of the values the
 * series' competitors actually carry, with an "Other…" escape into free text
 * for a value nobody carries yet — the Leinsters shape, where the NoR's
 * Silver prizes reference a Division no competitor has recorded (the
 * allocator then surfaces "field has no data"). Free text from the start
 * when there are no recorded values at all.
 */
function ValuePicker({
  value,
  options,
  ariaLabel,
  onChange,
}: {
  value: string;
  options: string[];
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  const [freeEntry, setFreeEntry] = useState(
    options.length === 0 || (value !== '' && !options.includes(value)),
  );

  if (freeEntry) {
    return (
      <Input
        className="flex-1"
        value={value}
        placeholder={options.length === 0 ? 'No values recorded yet' : undefined}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <Select
      value={options.includes(value) ? value : ''}
      onValueChange={(v) => {
        if (v === '__other__') {
          setFreeEntry(true);
          onChange('');
        } else {
          onChange(v);
        }
      }}
    >
      <SelectTrigger className="flex-1" aria-label={ariaLabel}>
        <SelectValue placeholder="Choose a value" />
      </SelectTrigger>
      <SelectContent>
        {options.map((v) => (
          <SelectItem key={v} value={v}>{v}</SelectItem>
        ))}
        <SelectItem value="__other__">Other…</SelectItem>
      </SelectContent>
    </Select>
  );
}
