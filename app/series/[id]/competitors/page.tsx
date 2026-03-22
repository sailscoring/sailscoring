'use client';

import { use, useState, useRef, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { competitorRepo } from '@/lib/dexie-repository';
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
import { Pencil, Trash2 } from 'lucide-react';
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
  const editingRowRef = useRef<HTMLTableRowElement | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
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

  // 'n' to show add form
  useGlobalKeyDown((e) => {
    if (e.key === 'n' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(
      (document.activeElement?.tagName ?? '')
    )) {
      e.preventDefault();
      setShowAddForm(true);
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
    setEditingCompetitor(null);
  }

  async function handleDelete(competitor: Competitor) {
    if (!confirm(`Delete ${competitor.name} (${competitor.sailNumber})?`)) return;
    log('competitors', 'deleting', competitor.id);
    await competitorRepo.delete(competitor.id);
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
          <Button onClick={() => setShowAddForm(true)}>Add competitor</Button>
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
    </div>
  );
}
