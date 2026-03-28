'use client';

import { use, useState, useRef, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Papa from 'papaparse';
import { competitorRepo, seriesRepo } from '@/lib/dexie-repository';
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
import { Pencil, Trash2, Upload } from 'lucide-react';
import type { Competitor } from '@/lib/types';
import { log } from '@/lib/debug';
import { useGlobalKeyDown } from '@/hooks/use-keyboard-shortcut';

interface CompetitorFormData {
  sailNumber: string;
  name: string;
  club: string;
  gender: '' | 'M' | 'F';
  age: string;
}

const emptyForm: CompetitorFormData = {
  sailNumber: '',
  name: '',
  club: '',
  gender: '',
  age: '',
};

type CompetitorField = 'sailNumber' | 'name' | 'club' | 'gender' | 'age' | 'ignore';
type ColumnMap = Record<number, CompetitorField>;

type ImportFlow =
  | { step: 'idle' }
  | { step: 'mapping'; headers: string[]; sampleRows: string[][]; rows: string[][]; columnMap: ColumnMap }
  | { step: 'done'; added: number; updated: number; unchanged: number; errors: { rowIndex: number; reason: string }[] };

const FIELD_LABELS: Record<CompetitorField, string> = {
  sailNumber: 'Sail number',
  name: 'Helm name',
  club: 'Club',
  gender: 'Gender',
  age: 'Age',
  ignore: '(ignore)',
};

function autoDetectField(header: string): CompetitorField {
  const h = header.trim().toLowerCase();
  if (/sail/.test(h)) return 'sailNumber';
  if (/helm|name/.test(h)) return 'name';
  if (/club/.test(h)) return 'club';
  if (/gender|sex/.test(h)) return 'gender';
  if (/age/.test(h)) return 'age';
  return 'ignore';
}

function CompetitorForm({
  initial,
  onSave,
  onCancel,
  existingSailNumbers,
}: {
  initial: CompetitorFormData;
  onSave: (data: CompetitorFormData) => Promise<void>;
  onCancel: () => void;
  existingSailNumbers: string[];
}) {
  const [data, setData] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const sailNumberWarning = data.sailNumber.trim().includes(' ')
    ? "This looks like a name — sail numbers don't usually contain spaces."
    : null;

  function set(field: keyof CompetitorFormData, value: string) {
    setData((d) => ({ ...d, [field]: value }));
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
    const sailLower = data.sailNumber.trim().toUpperCase();
    if (existingSailNumbers.includes(sailLower)) {
      setError(`Sail number ${sailLower} is already in this series.`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({ ...data, sailNumber: sailLower });
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
        <div className="space-y-1.5">
          <Label htmlFor="club">Club</Label>
          <Input
            id="club"
            value={data.club}
            onChange={(e) => set('club', e.target.value)}
            placeholder="e.g. HYC"
          />
        </div>
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

  async function handleAdd(data: CompetitorFormData) {
    const competitor: Competitor = {
      id: crypto.randomUUID(),
      seriesId,
      sailNumber: data.sailNumber,
      name: data.name,
      club: data.club,
      gender: data.gender,
      age: data.age ? parseInt(data.age, 10) : null,
      createdAt: Date.now(),
    };
    log('competitors', 'adding', competitor);
    await competitorRepo.save(competitor);
    await seriesRepo.touch(seriesId);
    setShowAddForm(false);
  }

  async function handleEdit(data: CompetitorFormData) {
    if (!editingCompetitor) return;
    const updated: Competitor = {
      ...editingCompetitor,
      sailNumber: data.sailNumber,
      name: data.name,
      club: data.club,
      gender: data.gender,
      age: data.age ? parseInt(data.age, 10) : null,
    };
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
    const bysail = new Map(existing.map((c) => [c.sailNumber.toUpperCase(), c]));
    let added = 0;
    let updated = 0;
    let unchanged = 0;
    const errors: { rowIndex: number; reason: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // 1-based, accounting for header row

      // Extract values per column map
      let sailNumber = '';
      let name = '';
      let club = '';
      let gender = '';
      let age = '';
      Object.entries(columnMap).forEach(([colStr, field]) => {
        const col = parseInt(colStr, 10);
        const val = row[col]?.trim() ?? '';
        if (field === 'sailNumber') sailNumber = val;
        else if (field === 'name') name = val;
        else if (field === 'club') club = val;
        else if (field === 'gender') gender = val;
        else if (field === 'age') age = val;
      });

      if (!sailNumber) {
        errors.push({ rowIndex: rowNumber, reason: 'missing sail number' });
        continue;
      }

      const normSail = sailNumber.toUpperCase();
      const existingCompetitor = bysail.get(normSail);
      const parsedAge = age ? parseInt(age, 10) : null;
      const normGender = gender.toUpperCase();

      const competitor: Competitor = {
        id: existingCompetitor?.id ?? crypto.randomUUID(),
        seriesId,
        sailNumber: normSail,
        name: name || existingCompetitor?.name || '',
        club: club || existingCompetitor?.club || '',
        gender: (normGender === 'M' || normGender === 'F') ? normGender : (existingCompetitor?.gender ?? ''),
        age: parsedAge !== null && !isNaN(parsedAge) ? parsedAge : (existingCompetitor?.age ?? null),
        createdAt: existingCompetitor?.createdAt ?? Date.now(),
      };

      if (
        existingCompetitor &&
        existingCompetitor.name === competitor.name &&
        existingCompetitor.club === competitor.club &&
        existingCompetitor.gender === competitor.gender &&
        existingCompetitor.age === competitor.age
      ) {
        unchanged++;
        continue;
      }

      log('competitors', existingCompetitor ? 'import-update' : 'import-add', competitor);
      await competitorRepo.save(competitor);
      if (existingCompetitor) updated++; else added++;
    }

    await seriesRepo.touch(seriesId);
    setImportFlow({ step: 'done', added, updated, unchanged, errors });
  }

  const existingSailNumbers = (competitors ?? []).map((c) => c.sailNumber.toUpperCase());
  const editingExcluded = editingCompetitor
    ? existingSailNumbers.filter((s) => s !== editingCompetitor.sailNumber.toUpperCase())
    : existingSailNumbers;

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
            existingSailNumbers={existingSailNumbers}
          />
        </div>
      )}

      {competitors !== undefined && competitors.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sail no.</TableHead>
              <TableHead>Helm</TableHead>
              <TableHead>Club</TableHead>
              <TableHead>Gender</TableHead>
              <TableHead>Age</TableHead>
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
                <TableCell className="font-mono">{c.sailNumber}</TableCell>
                <TableCell>{c.name}</TableCell>
                <TableCell>{c.club}</TableCell>
                <TableCell>{c.gender}</TableCell>
                <TableCell>{c.age ?? ''}</TableCell>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit competitor</DialogTitle>
          </DialogHeader>
          {editingCompetitor && (
            <CompetitorForm
              initial={{
                sailNumber: editingCompetitor.sailNumber,
                name: editingCompetitor.name,
                club: editingCompetitor.club,
                gender: editingCompetitor.gender,
                age: editingCompetitor.age?.toString() ?? '',
              }}
              onSave={handleEdit}
              onCancel={() => setEditingCompetitor(null)}
              existingSailNumbers={editingExcluded}
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
        <DialogContent>
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
