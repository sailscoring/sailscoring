'use client';

import { use, useState, useRef, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Papa from 'papaparse';
import { competitorRepo, fleetRepo, seriesRepo, ensureFleet, pruneFleet } from '@/lib/dexie-repository';
import { parseFleetCell } from '@/lib/csv-import';
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
import { AlertTriangle, Pencil, Trash2, Upload } from 'lucide-react';
import type { Competitor, Fleet, CompetitorFieldKey } from '@/lib/types';
import { hasFleetRating } from '@/lib/scoring';
import { defaultEnabledCompetitorFields } from '@/lib/competitor-fields';
import { log } from '@/lib/debug';
import { useGlobalKeyDown } from '@/hooks/use-keyboard-shortcut';

interface CompetitorFormData {
  sailNumber: string;
  boatName: string;
  name: string;
  crewName: string;
  club: string;
  gender: '' | 'M' | 'F';
  age: string;
  fleetIds: string[];   // IDs of existing fleets to assign the competitor to
  newFleetName: string; // typed name for a new fleet to create (optional)
  ircTcc: string;       // decimal string, e.g. "0.972"; empty if not set
  pyNumber: string;     // integer string, e.g. "1034"; empty if not set
}

const emptyForm: CompetitorFormData = {
  sailNumber: '',
  boatName: '',
  name: '',
  crewName: '',
  club: '',
  gender: '',
  age: '',
  fleetIds: [],
  newFleetName: '',
  ircTcc: '',
  pyNumber: '',
};

type CompetitorField = 'sailNumber' | 'boatName' | 'name' | 'crewName' | 'club' | 'gender' | 'age' | 'fleet' | 'tcc' | 'py' | 'ignore';
type ColumnMap = Record<number, CompetitorField>;

type ImportFlow =
  | { step: 'idle' }
  | { step: 'mapping'; headers: string[]; sampleRows: string[][]; rows: string[][]; columnMap: ColumnMap }
  | { step: 'done'; added: number; updated: number; unchanged: number; errors: { rowIndex: number; reason: string }[] };

const FIELD_LABELS: Record<CompetitorField, string> = {
  sailNumber: 'Sail number',
  boatName: 'Boat name',
  name: 'Helm name',
  crewName: 'Crew name',
  club: 'Club',
  gender: 'Gender',
  age: 'Age',
  fleet: 'Fleet',
  tcc: 'IRC TCC',
  py: 'PY number',
  ignore: '(ignore)',
};

function sameFleetIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  for (const id of b) if (!set.has(id)) return false;
  return true;
}

function autoDetectField(header: string): CompetitorField {
  const h = header.trim().toLowerCase();
  if (/sail/.test(h)) return 'sailNumber';
  if (/\bboat\b/.test(h)) return 'boatName';
  if (/crew/.test(h)) return 'crewName';
  if (/helm|name/.test(h)) return 'name';
  if (/club/.test(h)) return 'club';
  if (/gender|sex/.test(h)) return 'gender';
  if (/age/.test(h)) return 'age';
  if (/fleet|division/.test(h)) return 'fleet';
  if (/tcc|irc.*rating|rating.*irc/.test(h)) return 'tcc';
  if (/\bpy\b|portsmouth/.test(h)) return 'py';
  return 'ignore';
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
  const needsIrcTcc = selectedFleets.some((f) => f.scoringSystem === 'irc');
  const needsPyNumber = selectedFleets.some((f) => f.scoringSystem === 'py');

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
        <div className="space-y-1.5 col-span-2">
          <Label htmlFor="newFleetName">Fleet</Label>
          {availableFleets.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-1.5">
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
          )}
          <Input
            id="newFleetName"
            value={data.newFleetName}
            onChange={(e) => set('newFleetName', e.target.value)}
            placeholder={availableFleets.length > 0 ? 'New fleet name (optional)…' : 'e.g. Junior'}
          />
        </div>
        {needsIrcTcc && (
          <div className="space-y-1.5">
            <Label htmlFor="ircTcc">IRC TCC</Label>
            <Input
              id="ircTcc"
              value={data.ircTcc}
              onChange={(e) => set('ircTcc', e.target.value)}
              placeholder="e.g. 0.972"
            />
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

  const isMissingRating = (c: Competitor): boolean =>
    c.fleetIds.some((id) => { const f = fleetById.get(id); return f != null && !hasFleetRating(c, f); });

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingCompetitor, setEditingCompetitor] = useState<Competitor | null>(null);
  const [importFlow, setImportFlow] = useState<ImportFlow>({ step: 'idle' });
  const editingRowRef = useRef<HTMLTableRowElement | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
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
      csvInputRef.current?.click();
    }
  });

  function ratingFieldsFromForm(data: CompetitorFormData): Pick<Competitor, 'ircTcc' | 'pyNumber'> {
    const tcc = data.ircTcc.trim() ? parseFloat(data.ircTcc.trim()) : undefined;
    const py = data.pyNumber.trim() ? parseInt(data.pyNumber.trim(), 10) : undefined;
    return {
      ...(tcc != null && !isNaN(tcc) ? { ircTcc: tcc } : {}),
      ...(py != null && !isNaN(py) ? { pyNumber: py } : {}),
    };
  }

  async function handleAdd(data: CompetitorFormData) {
    // Resolve fleet IDs: existing selections + optional new fleet by name (deduplicated)
    const fleetIdSet = new Set(data.fleetIds);
    if (data.newFleetName.trim()) {
      fleetIdSet.add(await ensureFleet(seriesId, data.newFleetName.trim()));
    }
    let fleetIds = [...fleetIdSet];
    if (fleetIds.length === 0) {
      fleetIds = [await ensureFleet(seriesId, '')];
    }
    const competitor: Competitor = {
      id: crypto.randomUUID(),
      seriesId,
      fleetIds,
      sailNumber: data.sailNumber,
      ...(data.boatName.trim() ? { boatName: data.boatName.trim() } : {}),
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
    const oldFleetIds = editingCompetitor.fleetIds;
    const newFleetIdSet = new Set(data.fleetIds);
    if (data.newFleetName.trim()) {
      newFleetIdSet.add(await ensureFleet(seriesId, data.newFleetName.trim()));
    }
    let newFleetIds = [...newFleetIdSet];
    if (newFleetIds.length === 0) {
      newFleetIds = [await ensureFleet(seriesId, '')];
    }
    const updated: Competitor = {
      ...editingCompetitor,
      fleetIds: newFleetIds,
      sailNumber: data.sailNumber,
      ...(data.boatName.trim() ? { boatName: data.boatName.trim() } : {}),
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
    if (!data.boatName.trim()) delete updated.boatName;
    if (!data.crewName.trim()) delete updated.crewName;
    log('competitors', 'updating', updated);
    await competitorRepo.save(updated);
    // Prune any fleets that were removed
    for (const fId of oldFleetIds) {
      if (!newFleetIds.includes(fId)) await pruneFleet(seriesId, fId);
    }
    await seriesRepo.touch(seriesId);
    setEditingCompetitor(null);
  }

  async function handleDelete(competitor: Competitor) {
    if (!confirm(`Delete ${competitor.name} (${competitor.sailNumber})?`)) return;
    log('competitors', 'deleting', competitor.id);
    await competitorRepo.delete(competitor.id);
    for (const fId of competitor.fleetIds) await pruneFleet(seriesId, fId);
    await seriesRepo.touch(seriesId);
  }

  function handleCsvFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: true,
      complete: (result) => {
        const allRows = result.data;
        if (allRows.length < 2) return; // need at least a header row + 1 data row
        const headers = allRows[0];
        const dataRows = allRows.slice(1);
        const sampleRows = dataRows.slice(0, 3);
        const columnMap: ColumnMap = {};
        headers.forEach((h, i) => { columnMap[i] = autoDetectField(h); });
        setImportFlow({ step: 'mapping', headers, sampleRows, rows: dataRows, columnMap });
      },
    });
    // Reset so the same file can be re-selected
    e.target.value = '';
  }

  function resetImport() {
    setImportFlow({ step: 'idle' });
    if (csvInputRef.current) csvInputRef.current.value = '';
  }

  async function handleImport() {
    if (importFlow.step !== 'mapping') return;
    const { rows, columnMap } = importFlow;
    const existing = await competitorRepo.listBySeries(seriesId);
    const bysail = new Map<string, Competitor[]>();
    for (const c of existing) {
      const key = c.sailNumber.toUpperCase();
      const arr = bysail.get(key);
      if (arr) arr.push(c);
      else bysail.set(key, [c]);
    }
    let added = 0;
    let updated = 0;
    let unchanged = 0;
    const errors: { rowIndex: number; reason: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // 1-based, accounting for header row

      // Extract values per column map
      let sailNumber = '';
      let boatName = '';
      let name = '';
      let crewName = '';
      let club = '';
      let gender = '';
      let age = '';
      let fleet = '';
      let tcc = '';
      let py = '';
      Object.entries(columnMap).forEach(([colStr, field]) => {
        const col = parseInt(colStr, 10);
        const val = row[col]?.trim() ?? '';
        if (field === 'sailNumber') sailNumber = val;
        else if (field === 'boatName') boatName = val;
        else if (field === 'name') name = val;
        else if (field === 'crewName') crewName = val;
        else if (field === 'club') club = val;
        else if (field === 'gender') gender = val;
        else if (field === 'age') age = val;
        else if (field === 'fleet') fleet = val;
        else if (field === 'tcc') tcc = val;
        else if (field === 'py') py = val;
      });

      if (!sailNumber) {
        errors.push({ rowIndex: rowNumber, reason: 'missing sail number' });
        continue;
      }

      const normSail = sailNumber.toUpperCase();
      const parsedAge = age ? parseInt(age, 10) : null;
      const normGender = gender.toUpperCase();

      // Resolve the fleet cell to one or more fleet IDs. A pipe-delimited cell
      // (e.g. "PY|M15") assigns the competitor to multiple fleets. An empty
      // cell falls back to the default fleet, matching the single-fleet path.
      const fleetNames = parseFleetCell(fleet);
      const resolvedFleetIds =
        fleetNames.length === 0
          ? [await ensureFleet(seriesId, '')]
          : await Promise.all(fleetNames.map((n) => ensureFleet(seriesId, n)));
      // Dedupe in case two names resolve to the same existing fleet
      // (e.g. differing only in whitespace or case).
      const fleetIds = [...new Set(resolvedFleetIds)];

      // Disambiguate sail number collisions using fleet membership
      const sailCandidates = bysail.get(normSail) ?? [];
      const existingCompetitor = sailCandidates.length <= 1
        ? sailCandidates[0] ?? null
        : sailCandidates.find((c) => sameFleetIdSet(c.fleetIds, fleetIds)) ?? sailCandidates[0];

      const parsedTcc = tcc ? parseFloat(tcc) : null;
      const parsedPy = py ? parseInt(py, 10) : null;
      const ircTcc = parsedTcc != null && !isNaN(parsedTcc) ? parsedTcc : existingCompetitor?.ircTcc;
      const pyNumber = parsedPy != null && !isNaN(parsedPy) ? parsedPy : existingCompetitor?.pyNumber;

      const resolvedBoatName = boatName || existingCompetitor?.boatName || '';
      const resolvedCrewName = crewName || existingCompetitor?.crewName || '';
      const competitor: Competitor = {
        id: existingCompetitor?.id ?? crypto.randomUUID(),
        seriesId,
        fleetIds,
        sailNumber: normSail,
        ...(resolvedBoatName ? { boatName: resolvedBoatName } : {}),
        name: name || existingCompetitor?.name || '',
        ...(resolvedCrewName ? { crewName: resolvedCrewName } : {}),
        club: club || existingCompetitor?.club || '',
        gender: (normGender === 'M' || normGender === 'F') ? normGender : (existingCompetitor?.gender ?? ''),
        age: parsedAge !== null && !isNaN(parsedAge) ? parsedAge : (existingCompetitor?.age ?? null),
        createdAt: existingCompetitor?.createdAt ?? Date.now(),
        ...(ircTcc != null ? { ircTcc } : {}),
        ...(pyNumber != null ? { pyNumber } : {}),
      };

      if (
        existingCompetitor &&
        sameFleetIdSet(existingCompetitor.fleetIds, competitor.fleetIds) &&
        (existingCompetitor.boatName ?? '') === (competitor.boatName ?? '') &&
        existingCompetitor.name === competitor.name &&
        (existingCompetitor.crewName ?? '') === (competitor.crewName ?? '') &&
        existingCompetitor.club === competitor.club &&
        existingCompetitor.gender === competitor.gender &&
        existingCompetitor.age === competitor.age &&
        existingCompetitor.ircTcc === competitor.ircTcc &&
        existingCompetitor.pyNumber === competitor.pyNumber
      ) {
        unchanged++;
        continue;
      }

      const oldFleetIds = existingCompetitor?.fleetIds ?? [];
      log('competitors', existingCompetitor ? 'import-update' : 'import-add', competitor);
      await competitorRepo.save(competitor);
      if (existingCompetitor) {
        // Prune any fleets the competitor is no longer assigned to.
        for (const fId of oldFleetIds) {
          if (!fleetIds.includes(fId)) await pruneFleet(seriesId, fId);
        }
        updated++;
      } else {
        added++;
      }
    }

    await seriesRepo.touch(seriesId);
    setImportFlow({ step: 'done', added, updated, unchanged, errors });
  }

  const existingCompetitors = (competitors ?? []).map((c) => ({ sailNumber: c.sailNumber.toUpperCase(), fleetIds: c.fleetIds }));
  const editingExcluded = editingCompetitor
    ? existingCompetitors.filter((c) => c.sailNumber !== editingCompetitor.sailNumber.toUpperCase() || !sameFleetIdSet(c.fleetIds, editingCompetitor.fleetIds))
    : existingCompetitors;
  const showBoat = enabledFields.includes('boatName');
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
            <Button variant="outline" onClick={() => csvInputRef.current?.click()}>
              <Upload className="h-4 w-4 mr-2" />
              Import CSV
            </Button>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleCsvFileSelected}
              className="hidden"
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
              <TableHead>Helm</TableHead>
              {showCrew && <TableHead>Crew</TableHead>}
              {showClub && <TableHead>Club</TableHead>}
              {multipleFleets && <TableHead>Fleet</TableHead>}
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
                  {isMissingRating(c) && (
                    <AlertTriangle className="inline h-3.5 w-3.5 text-amber-500 mr-1.5 -mt-0.5" aria-label="Missing handicap rating" />
                  )}
                  {c.sailNumber}
                </TableCell>
                {showBoat && <TableCell>{c.boatName ?? ''}</TableCell>}
                <TableCell>{c.name}</TableCell>
                {showCrew && <TableCell>{c.crewName ?? ''}</TableCell>}
                {showClub && <TableCell>{c.club}</TableCell>}
                {multipleFleets && <TableCell>{c.fleetIds.map((id) => fleetById.get(id)?.name ?? '').join(', ')}</TableCell>}
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
                name: editingCompetitor.name,
                crewName: editingCompetitor.crewName ?? '',
                club: editingCompetitor.club,
                gender: editingCompetitor.gender,
                age: editingCompetitor.age?.toString() ?? '',
                fleetIds: editingCompetitor.fleetIds,
                newFleetName: '',
                ircTcc: editingCompetitor.ircTcc?.toString() ?? '',
                pyNumber: editingCompetitor.pyNumber?.toString() ?? '',
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

      {/* Import — column mapping dialog */}
      <Dialog open={importFlow.step === 'mapping'} onOpenChange={(open) => { if (!open) resetImport(); }}>
        <DialogContent className="w-[90vw] max-w-4xl sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Import competitors — map columns</DialogTitle>
            <DialogDescription>
              Match each CSV column to a competitor field. Sail number is required.
              Use <code>|</code> in the fleet column to assign a competitor to multiple
              fleets, e.g. <code>PY|M15</code>.
            </DialogDescription>
          </DialogHeader>
          {importFlow.step === 'mapping' && (
            <div className="overflow-y-auto max-h-96">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-1/5">Column</TableHead>
                    <TableHead className="w-1/5">Map to</TableHead>
                    <TableHead className="w-3/5">Sample values</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importFlow.headers.map((header, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-sm truncate">{header || `Column ${i + 1}`}</TableCell>
                      <TableCell>
                        <Select
                          value={importFlow.columnMap[i]}
                          onValueChange={(v) =>
                            setImportFlow((f) =>
                              f.step === 'mapping'
                                ? { ...f, columnMap: { ...f.columnMap, [i]: v as CompetitorField } }
                                : f
                            )
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(FIELD_LABELS) as CompetitorField[]).map((field) => (
                              <SelectItem key={field} value={field}>
                                {FIELD_LABELS[field]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground truncate">
                        {importFlow.sampleRows
                          .map((row) => row[i]?.trim() ?? '')
                          .filter(Boolean)
                          .slice(0, 3)
                          .join(', ') || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={resetImport}>Cancel</Button>
            <Button
              onClick={handleImport}
              disabled={
                importFlow.step !== 'mapping' ||
                !Object.values(importFlow.columnMap).includes('sailNumber')
              }
            >
              {importFlow.step === 'mapping'
                ? `Import ${importFlow.rows.length} row${importFlow.rows.length === 1 ? '' : 's'}`
                : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import — done dialog */}
      <Dialog open={importFlow.step === 'done'} onOpenChange={(open) => { if (!open) resetImport(); }}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Import complete</DialogTitle>
          </DialogHeader>
          {importFlow.step === 'done' && (
            <div className="space-y-3">
              <p className="text-sm">
                {importFlow.added} competitor{importFlow.added === 1 ? '' : 's'} added,{' '}
                {importFlow.updated} updated,{' '}
                {importFlow.unchanged} unchanged.
              </p>
              {importFlow.errors.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">
                    {importFlow.errors.length} row{importFlow.errors.length === 1 ? '' : 's'} skipped:
                  </p>
                  <ul className="text-sm text-muted-foreground space-y-0.5 max-h-40 overflow-auto">
                    {importFlow.errors.map((err) => (
                      <li key={err.rowIndex}>Row {err.rowIndex}: {err.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={resetImport}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
