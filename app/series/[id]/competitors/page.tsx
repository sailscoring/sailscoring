'use client';

import { use, useState, useRef, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { competitorRepo, fleetRepo, seriesRepo } from '@/lib/dexie-repository';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { AlertTriangle, Pencil, Trash2 } from 'lucide-react';
import { CompetitorImport, type CompetitorImportHandle } from '@/components/competitor-import';
import type { Competitor, Fleet, CompetitorFieldKey } from '@/lib/types';
import {
  missingRatings,
  formatMissingRatings,
  requiredForFleetsHint,
  type MissingRating,
} from '@/lib/competitor-ratings';
import { defaultEnabledCompetitorFields } from '@/lib/competitor-fields';
import { log } from '@/lib/debug';
import { useGlobalKeyDown } from '@/hooks/use-keyboard-shortcut';

interface CompetitorFormData {
  sailNumber: string;
  boatName: string;
  boatClass: string;
  name: string;
  crewName: string;
  club: string;
  gender: '' | 'M' | 'F';
  age: string;
  fleetIds: string[];   // IDs of existing fleets to assign the competitor to
  ircTcc: string;       // decimal string, e.g. "0.972"; empty if not set
  pyNumber: string;     // integer string, e.g. "1034"; empty if not set
  nhcStartingTcf: string; // decimal string, e.g. "1.005"; empty if not set
}

const emptyForm: CompetitorFormData = {
  sailNumber: '',
  boatName: '',
  boatClass: '',
  name: '',
  crewName: '',
  club: '',
  gender: '',
  age: '',
  fleetIds: [],
  ircTcc: '',
  pyNumber: '',
  nhcStartingTcf: '',
};

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

function sameFleetIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  for (const id of b) if (!set.has(id)) return false;
  return true;
}

function CompetitorForm({
  initial,
  onSave,
  onCancel,
  existingCompetitors,
  availableFleets,
  enabledFields,
}: {
  initial: CompetitorFormData;
  onSave: (data: CompetitorFormData) => Promise<void>;
  onCancel: () => void;
  existingCompetitors: { sailNumber: string; fleetIds: string[] }[];
  availableFleets: Fleet[];
  enabledFields: CompetitorFieldKey[];
}) {
  const [data, setData] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const sailNumberWarning = data.sailNumber.trim().includes(' ')
    ? "This looks like a name — sail numbers don't usually contain spaces."
    : null;

  // Determine which rating fields to show based on selected fleets
  const selectedFleets = availableFleets.filter((f) => data.fleetIds.includes(f.id));
  const ircFleetNames = selectedFleets.filter((f) => f.scoringSystem === 'irc').map((f) => f.name);
  const pyFleetNames = selectedFleets.filter((f) => f.scoringSystem === 'py').map((f) => f.name);
  const nhcFleetNames = selectedFleets.filter((f) => f.scoringSystem === 'nhc').map((f) => f.name);
  const needsIrcTcc = ircFleetNames.length > 0;
  const needsPyNumber = pyFleetNames.length > 0;
  const needsNhcStartingTcf = nhcFleetNames.length > 0;

  function set<K extends keyof CompetitorFormData>(field: K, value: CompetitorFormData[K]) {
    setData((d) => ({ ...d, [field]: value }));
  }

  function toggleFleet(fleetId: string, checked: boolean) {
    set('fleetIds', checked
      ? [...data.fleetIds, fleetId]
      : data.fleetIds.filter((id) => id !== fleetId),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!data.sailNumber.trim()) {
      setError('Sail number is required.');
      return;
    }
    if (!data.name.trim()) {
      setError('Helm name is required.');
      return;
    }
    const sailUpper = data.sailNumber.trim().toUpperCase();
    const collision = existingCompetitors.find(
      (c) => c.sailNumber === sailUpper && c.fleetIds.some((id) => data.fleetIds.includes(id)),
    );
    if (collision) {
      const fleetName = availableFleets.find((f) => collision.fleetIds.some((id) => id === f.id))?.name;
      setError(`Sail number ${sailUpper} is already in${fleetName ? ` fleet ${fleetName}` : ' this series'}.`);
      return;
    }
    if (needsIrcTcc && data.ircTcc.trim()) {
      const tcc = parseFloat(data.ircTcc);
      if (isNaN(tcc) || tcc < 0.5 || tcc > 1.5) {
        setError('TCC must be a decimal number between 0.5 and 1.5 (e.g. 0.972).');
        return;
      }
    }
    if (needsPyNumber && data.pyNumber.trim()) {
      const py = parseInt(data.pyNumber, 10);
      if (isNaN(py) || py < 500 || py > 2000) {
        setError('PY number must be a positive integer (e.g. 1034).');
        return;
      }
    }
    if (needsNhcStartingTcf && data.nhcStartingTcf.trim()) {
      const tcf = parseFloat(data.nhcStartingTcf);
      if (isNaN(tcf) || tcf < 0.5 || tcf > 2.0) {
        setError('Starting TCF must be a decimal number (typically 0.5–2.0, e.g. 1.005).');
        return;
      }
    }
    setSaving(true);
    setError('');
    try {
      await onSave({ ...data, sailNumber: sailUpper });
    } catch {
      setError('Failed to save. Please try again.');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="sailNumber">Sail number *</Label>
          <Input
            id="sailNumber"
            value={data.sailNumber}
            onChange={(e) => set('sailNumber', e.target.value)}
            placeholder="e.g. 1234"
            autoFocus
          />
          {sailNumberWarning && (
            <p className="text-sm text-amber-600">{sailNumberWarning}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="helmName">Helm name *</Label>
          <Input
            id="helmName"
            value={data.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Jane Doe"
          />
        </div>
        {enabledFields.includes('boatName') && (
          <div className="space-y-1.5">
            <Label htmlFor="boatName">Boat name</Label>
            <Input
              id="boatName"
              value={data.boatName}
              onChange={(e) => set('boatName', e.target.value)}
              placeholder="e.g. The Big Picture"
            />
          </div>
        )}
        {enabledFields.includes('boatClass') && (
          <div className="space-y-1.5">
            <Label htmlFor="boatClass">Class</Label>
            <Input
              id="boatClass"
              value={data.boatClass}
              onChange={(e) => set('boatClass', e.target.value)}
              placeholder="e.g. Laser"
            />
          </div>
        )}
        {enabledFields.includes('crewName') && (
          <div className="space-y-1.5">
            <Label htmlFor="crewName">Crew name</Label>
            <Input
              id="crewName"
              value={data.crewName}
              onChange={(e) => set('crewName', e.target.value)}
              placeholder="e.g. Mark Smith"
            />
          </div>
        )}
        {enabledFields.includes('club') && (
          <div className="space-y-1.5">
            <Label htmlFor="club">Club</Label>
            <Input
              id="club"
              value={data.club}
              onChange={(e) => set('club', e.target.value)}
              placeholder="e.g. HYC"
            />
          </div>
        )}
        {enabledFields.includes('gender') && (
          <div className="space-y-1.5">
            <Label>Gender</Label>
            <Select value={data.gender} onValueChange={(v) => set('gender', v as '' | 'M' | 'F')}>
              <SelectTrigger>
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="M">M</SelectItem>
                <SelectItem value="F">F</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {enabledFields.includes('age') && (
          <div className="space-y-1.5">
            <Label htmlFor="age">Age</Label>
            <Input
              id="age"
              type="number"
              min={0}
              max={99}
              value={data.age}
              onChange={(e) => set('age', e.target.value)}
              placeholder="e.g. 12"
            />
          </div>
        )}
        {availableFleets.length > 1 && (
          <div className="space-y-1.5 col-span-2">
            <Label>Fleet</Label>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {availableFleets.map((f) => (
                <label key={f.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={data.fleetIds.includes(f.id)}
                    onChange={(e) => toggleFleet(f.id, e.target.checked)}
                    className="h-4 w-4 rounded border"
                  />
                  {f.name}
                  {f.scoringSystem !== 'scratch' && (
                    <span className="text-xs text-muted-foreground">({f.scoringSystem.toUpperCase()})</span>
                  )}
                </label>
              ))}
            </div>
          </div>
        )}
        {needsIrcTcc && (
          <div className="space-y-1.5">
            <Label htmlFor="ircTcc">IRC TCC</Label>
            <Input
              id="ircTcc"
              value={data.ircTcc}
              onChange={(e) => set('ircTcc', e.target.value)}
              placeholder="e.g. 0.972"
            />
            {!data.ircTcc.trim() && (
              <p className="text-sm text-amber-600">{requiredForFleetsHint(ircFleetNames)}</p>
            )}
          </div>
        )}
        {needsPyNumber && (
          <div className="space-y-1.5">
            <Label htmlFor="pyNumber">PY number</Label>
            <Input
              id="pyNumber"
              value={data.pyNumber}
              onChange={(e) => set('pyNumber', e.target.value)}
              placeholder="e.g. 1034"
            />
            {!data.pyNumber.trim() && (
              <p className="text-sm text-amber-600">{requiredForFleetsHint(pyFleetNames)}</p>
            )}
          </div>
        )}
        {needsNhcStartingTcf && (
          <div className="space-y-1.5">
            <Label htmlFor="nhcStartingTcf">NHC starting TCF</Label>
            <Input
              id="nhcStartingTcf"
              value={data.nhcStartingTcf}
              onChange={(e) => set('nhcStartingTcf', e.target.value)}
              placeholder="e.g. 1.005"
            />
            {!data.nhcStartingTcf.trim() && (
              <p className="text-sm text-amber-600">{requiredForFleetsHint(nhcFleetNames)}</p>
            )}
          </div>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function CompetitorsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: seriesId } = use(params);
  const competitors = useLiveQuery(
    () => competitorRepo.listBySeries(seriesId),
    [seriesId],
  );
  const fleets = useLiveQuery(
    () => fleetRepo.listBySeries(seriesId),
    [seriesId],
  );
  const series = useLiveQuery(() => seriesRepo.get(seriesId), [seriesId]);
  const enabledFields: CompetitorFieldKey[] =
    series?.enabledCompetitorFields ?? defaultEnabledCompetitorFields();
  const fleetById = new Map((fleets ?? []).map((f) => [f.id, f]));
  const multipleFleets = (fleets ?? []).length > 1;
  const showIrc = (fleets ?? []).some((f) => f.scoringSystem === 'irc');
  const showPy = (fleets ?? []).some((f) => f.scoringSystem === 'py');
  const showNhc = (fleets ?? []).some((f) => f.scoringSystem === 'nhc');


  const [showAddForm, setShowAddForm] = useState(false);
  const [editingCompetitor, setEditingCompetitor] = useState<Competitor | null>(null);
  const editingRowRef = useRef<HTMLTableRowElement | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const importRef = useRef<CompetitorImportHandle>(null);
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

  // 'n' to show add form, 'i' to import CSV
  useGlobalKeyDown((e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '')) return;
    if (e.key === 'n') {
      e.preventDefault();
      setShowAddForm(true);
    } else if (e.key === 'i') {
      e.preventDefault();
      importRef.current?.trigger();
    }
  });

  function ratingFieldsFromForm(data: CompetitorFormData): Pick<Competitor, 'ircTcc' | 'pyNumber' | 'nhcStartingTcf'> {
    const tcc = data.ircTcc.trim() ? parseFloat(data.ircTcc.trim()) : undefined;
    const py = data.pyNumber.trim() ? parseInt(data.pyNumber.trim(), 10) : undefined;
    const nhc = data.nhcStartingTcf.trim() ? parseFloat(data.nhcStartingTcf.trim()) : undefined;
    return {
      ...(tcc != null && !isNaN(tcc) ? { ircTcc: tcc } : {}),
      ...(py != null && !isNaN(py) ? { pyNumber: py } : {}),
      ...(nhc != null && !isNaN(nhc) ? { nhcStartingTcf: nhc } : {}),
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
      ...(data.crewName.trim() ? { crewName: data.crewName.trim() } : {}),
      club: data.club,
      gender: data.gender,
      age: data.age ? parseInt(data.age, 10) : null,
      createdAt: Date.now(),
      ...ratingFieldsFromForm(data),
    };
    log('competitors', 'adding', competitor);
    await competitorRepo.save(competitor);
    await seriesRepo.touch(seriesId);
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
      ...(data.crewName.trim() ? { crewName: data.crewName.trim() } : {}),
      club: data.club,
      gender: data.gender,
      age: data.age ? parseInt(data.age, 10) : null,
      ...ratingFieldsFromForm(data),
    };
    // Clear ratings no longer relevant
    if (!updated.ircTcc) delete updated.ircTcc;
    if (!updated.pyNumber) delete updated.pyNumber;
    if (!updated.nhcStartingTcf) delete updated.nhcStartingTcf;
    if (!data.boatName.trim()) delete updated.boatName;
    if (!data.boatClass.trim()) delete updated.boatClass;
    if (!data.crewName.trim()) delete updated.crewName;
    log('competitors', 'updating', updated);
    await competitorRepo.save(updated);
    await seriesRepo.touch(seriesId);
    setEditingCompetitor(null);
  }

  async function handleDelete(competitor: Competitor) {
    if (!confirm(`Delete ${competitor.name} (${competitor.sailNumber})?`)) return;
    log('competitors', 'deleting', competitor.id);
    await competitorRepo.delete(competitor.id);
    await seriesRepo.touch(seriesId);
  }


  const existingCompetitors = (competitors ?? []).map((c) => ({ sailNumber: c.sailNumber.toUpperCase(), fleetIds: c.fleetIds }));
  const editingExcluded = editingCompetitor
    ? existingCompetitors.filter((c) => c.sailNumber !== editingCompetitor.sailNumber.toUpperCase() || !sameFleetIdSet(c.fleetIds, editingCompetitor.fleetIds))
    : existingCompetitors;
  const showBoat = enabledFields.includes('boatName');
  const showClass = enabledFields.includes('boatClass');
  const showCrew = enabledFields.includes('crewName');
  const showClub = enabledFields.includes('club');
  const showGender = enabledFields.includes('gender');
  const showAge = enabledFields.includes('age');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {competitors === undefined
            ? 'Loading…'
            : `${competitors.length} competitor${competitors.length === 1 ? '' : 's'}`}
        </p>
        {!showAddForm && (
          <div className="flex gap-2">
            <CompetitorImport
              ref={importRef}
              seriesId={seriesId}
              fleets={fleets ?? []}
            />
            <Button onClick={() => setShowAddForm(true)}>Add competitor</Button>
          </div>
        )}
      </div>

      {showAddForm && (
        <div className="border rounded-lg p-5">
          <h2 className="font-medium mb-4">Add competitor</h2>
          <CompetitorForm
            initial={emptyForm}
            onSave={handleAdd}
            onCancel={() => setShowAddForm(false)}
            existingCompetitors={existingCompetitors}
            availableFleets={fleets ?? []}
            enabledFields={enabledFields}
          />
        </div>
      )}

      {competitors !== undefined && competitors.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sail no.</TableHead>
              {showBoat && <TableHead>Boat</TableHead>}
              {showClass && <TableHead>Class</TableHead>}
              <TableHead>Helm</TableHead>
              {showCrew && <TableHead>Crew</TableHead>}
              {showClub && <TableHead>Club</TableHead>}
              {multipleFleets && <TableHead>Fleet</TableHead>}
              {showIrc && <TableHead>IRC TCC</TableHead>}
              {showPy && <TableHead>PY</TableHead>}
              {showNhc && <TableHead>NHC TCF</TableHead>}
              {showGender && <TableHead>Gender</TableHead>}
              {showAge && <TableHead>Age</TableHead>}
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody ref={tbodyRef}>
            {competitors.map((c) => (
              <TableRow
                key={c.id}
                tabIndex={0}
                className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                onKeyDown={(e) => {
                  if (e.key === 'e') {
                    e.preventDefault();
                    editingRowRef.current = e.currentTarget;
                    setEditingCompetitor(c);
                  } else if (e.key === 'd' || e.key === 'Delete') {
                    e.preventDefault();
                    handleDelete(c);
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
                {showBoat && <TableCell>{c.boatName ?? ''}</TableCell>}
                {showClass && <TableCell>{c.boatClass ?? ''}</TableCell>}
                <TableCell>{c.name}</TableCell>
                {showCrew && <TableCell>{c.crewName ?? ''}</TableCell>}
                {showClub && <TableCell>{c.club}</TableCell>}
                {multipleFleets && <TableCell>{c.fleetIds.map((id) => fleetById.get(id)?.name ?? '').join(', ')}</TableCell>}
                {showIrc && (
                  <TableCell className="font-mono">
                    {c.fleetIds.some((id) => fleetById.get(id)?.scoringSystem === 'irc')
                      ? (c.ircTcc ?? '—')
                      : '—'}
                  </TableCell>
                )}
                {showPy && (
                  <TableCell className="font-mono">
                    {c.fleetIds.some((id) => fleetById.get(id)?.scoringSystem === 'py')
                      ? (c.pyNumber ?? '—')
                      : '—'}
                  </TableCell>
                )}
                {showNhc && (
                  <TableCell className="font-mono">
                    {c.fleetIds.some((id) => fleetById.get(id)?.scoringSystem === 'nhc')
                      ? (c.nhcStartingTcf ?? '—')
                      : '—'}
                  </TableCell>
                )}
                {showGender && <TableCell>{c.gender}</TableCell>}
                {showAge && <TableCell>{c.age ?? ''}</TableCell>}
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      tabIndex={-1}
                      aria-label={`Edit ${c.name}`}
                      onClick={(e) => {
                        editingRowRef.current = e.currentTarget.closest('tr');
                        setEditingCompetitor(c);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      tabIndex={-1}
                      aria-label={`Delete ${c.name}`}
                      onClick={() => handleDelete(c)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
          </DialogHeader>
          {editingCompetitor && (
            <CompetitorForm
              initial={{
                sailNumber: editingCompetitor.sailNumber,
                boatName: editingCompetitor.boatName ?? '',
                boatClass: editingCompetitor.boatClass ?? '',
                name: editingCompetitor.name,
                crewName: editingCompetitor.crewName ?? '',
                club: editingCompetitor.club,
                gender: editingCompetitor.gender,
                age: editingCompetitor.age?.toString() ?? '',
                fleetIds: editingCompetitor.fleetIds,
                ircTcc: editingCompetitor.ircTcc?.toString() ?? '',
                pyNumber: editingCompetitor.pyNumber?.toString() ?? '',
                nhcStartingTcf: editingCompetitor.nhcStartingTcf?.toString() ?? '',
              }}
              onSave={handleEdit}
              onCancel={() => setEditingCompetitor(null)}
              existingCompetitors={editingExcluded}
              availableFleets={fleets ?? []}
              enabledFields={enabledFields}
            />
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
