'use client';

import { use, useState, useRef, useEffect } from 'react';
import { useSeries, useTouchSeries } from '@/hooks/use-series';
import { useFleetsBySeries } from '@/hooks/use-fleets';
import {
  useCompetitorsBySeries,
  useDeleteCompetitor,
  useSaveCompetitor,
} from '@/hooks/use-competitors';
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
import { NationalityInput } from '@/components/nationality-input';
import { UpdateHandicaps, type UpdateHandicapsHandle } from '@/components/update-handicaps';
import type { Competitor, Fleet, CompetitorFieldKey, PrimaryPersonLabel } from '@/lib/types';
import {
  missingRatings,
  formatMissingRatings,
  requiredForFleetsHint,
  competitorRatings,
  configuredRatingSystems,
  type MissingRating,
} from '@/lib/competitor-ratings';
import {
  defaultEnabledCompetitorFields,
  DEFAULT_PRIMARY_PERSON_LABEL,
  PRIMARY_PERSON_LABEL_TEXT,
  COMPETITOR_FIELD_LABELS,
  ALL_COMPETITOR_FIELDS,
  isFieldDisabledByPrimary,
  subdivisionFieldLabel,
} from '@/lib/competitor-fields';
import { log } from '@/lib/debug';
import { useGlobalKeyDown } from '@/hooks/use-keyboard-shortcut';

interface CompetitorFormData {
  sailNumber: string;
  boatName: string;
  boatClass: string;
  name: string;
  owner: string;
  helm: string;
  crewName: string;
  club: string;
  nationality: string;
  gender: '' | 'M' | 'F';
  age: string;
  subdivision: string;
  fleetIds: string[];   // IDs of existing fleets to assign the competitor to
  ircTcc: string;       // decimal string, e.g. "0.972"; empty if not set
  pyNumber: string;     // integer string, e.g. "1034"; empty if not set
  nhcStartingTcf: string; // decimal string, e.g. "1.005"; empty if not set
  echoStartingTcf: string; // decimal string, e.g. "1.020"; empty if not set
}

const emptyForm: CompetitorFormData = {
  sailNumber: '',
  boatName: '',
  boatClass: '',
  name: '',
  owner: '',
  helm: '',
  crewName: '',
  club: '',
  nationality: '',
  gender: '',
  age: '',
  subdivision: '',
  fleetIds: [],
  ircTcc: '',
  pyNumber: '',
  nhcStartingTcf: '',
  echoStartingTcf: '',
};

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
  primaryLabel,
  subdivisionLabel,
}: {
  initial: CompetitorFormData;
  onSave: (data: CompetitorFormData) => Promise<void>;
  onCancel: () => void;
  existingCompetitors: { sailNumber: string; fleetIds: string[] }[];
  availableFleets: Fleet[];
  enabledFields: CompetitorFieldKey[];
  primaryLabel: PrimaryPersonLabel;
  subdivisionLabel: string;
}) {
  const [data, setData] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // "+ More fields" lets scorers add owner/helm/etc. without leaving the form.
  // Defaults to expanded when the initial data already populates one of the
  // extra slots (editing) so the value stays visible.
  const initialExtra = (['owner', 'helm'] as const).some((f) => (initial[f] ?? '').trim().length > 0);
  const [showMore, setShowMore] = useState(initialExtra);
  const primaryFieldLabel = PRIMARY_PERSON_LABEL_TEXT[primaryLabel];
  // Extra role fields available through "+ More fields" — the two role slots
  // minus whichever one the primary already occupies.
  const extraRoleFields: CompetitorFieldKey[] = (['owner', 'helm'] as CompetitorFieldKey[])
    .filter((f) => !isFieldDisabledByPrimary(f, primaryLabel) && !enabledFields.includes(f));

  const sailNumberWarning = data.sailNumber.trim().includes(' ')
    ? "This looks like a name — sail numbers don't usually contain spaces."
    : null;

  // Determine which rating fields to show based on selected fleets
  const selectedFleets = availableFleets.filter((f) => data.fleetIds.includes(f.id));
  const ircFleetNames = selectedFleets.filter((f) => f.scoringSystem === 'irc').map((f) => f.name);
  const pyFleetNames = selectedFleets.filter((f) => f.scoringSystem === 'py').map((f) => f.name);
  const nhcFleetNames = selectedFleets.filter((f) => f.scoringSystem === 'nhc').map((f) => f.name);
  const echoFleetNames = selectedFleets.filter((f) => f.scoringSystem === 'echo').map((f) => f.name);
  const needsIrcTcc = ircFleetNames.length > 0;
  const needsPyNumber = pyFleetNames.length > 0;
  const needsNhcStartingTcf = nhcFleetNames.length > 0;
  const needsEchoStartingTcf = echoFleetNames.length > 0;

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
      setError(`${primaryFieldLabel} name is required.`);
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
    if (needsEchoStartingTcf && data.echoStartingTcf.trim()) {
      const tcf = parseFloat(data.echoStartingTcf);
      if (isNaN(tcf) || tcf < 0.5 || tcf > 2.0) {
        setError('ECHO starting handicap must be a decimal number (typically 0.5–2.0, e.g. 1.020).');
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
          <Label htmlFor="primaryName">{primaryFieldLabel} name *</Label>
          <Input
            id="primaryName"
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
        {enabledFields.includes('helm') && !isFieldDisabledByPrimary('helm', primaryLabel) && (
          <div className="space-y-1.5">
            <Label htmlFor="helm">Helm name</Label>
            <Input
              id="helm"
              value={data.helm}
              onChange={(e) => set('helm', e.target.value)}
              placeholder="e.g. Jane Doe"
            />
          </div>
        )}
        {enabledFields.includes('owner') && !isFieldDisabledByPrimary('owner', primaryLabel) && (
          <div className="space-y-1.5">
            <Label htmlFor="owner">Owner name</Label>
            <Input
              id="owner"
              value={data.owner}
              onChange={(e) => set('owner', e.target.value)}
              placeholder="e.g. John Smith"
            />
          </div>
        )}
        {showMore && extraRoleFields.includes('helm') && (
          <div className="space-y-1.5">
            <Label htmlFor="helm">Helm name</Label>
            <Input
              id="helm"
              value={data.helm}
              onChange={(e) => set('helm', e.target.value)}
              placeholder="e.g. Jane Doe"
            />
          </div>
        )}
        {showMore && extraRoleFields.includes('owner') && (
          <div className="space-y-1.5">
            <Label htmlFor="owner">Owner name</Label>
            <Input
              id="owner"
              value={data.owner}
              onChange={(e) => set('owner', e.target.value)}
              placeholder="e.g. John Smith"
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
        {enabledFields.includes('nationality') && (
          <div className="space-y-1.5">
            <Label htmlFor="nationality">Nationality</Label>
            <NationalityInput
              id="nationality"
              value={data.nationality}
              onChange={(v) => set('nationality', v)}
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
        {enabledFields.includes('subdivision') && (
          <div className="space-y-1.5">
            <Label htmlFor="subdivision">{subdivisionLabel}</Label>
            <Input
              id="subdivision"
              value={data.subdivision}
              onChange={(e) => set('subdivision', e.target.value)}
              placeholder="e.g. Gold"
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
        {needsEchoStartingTcf && (
          <div className="space-y-1.5">
            <Label htmlFor="echoStartingTcf">ECHO starting handicap</Label>
            <Input
              id="echoStartingTcf"
              value={data.echoStartingTcf}
              onChange={(e) => set('echoStartingTcf', e.target.value)}
              placeholder="e.g. 1.020"
            />
            {!data.echoStartingTcf.trim() && (
              <p className="text-sm text-amber-600">{requiredForFleetsHint(echoFleetNames)}</p>
            )}
          </div>
        )}
      </div>
      {!showMore && extraRoleFields.length > 0 && (
        <button
          type="button"
          onClick={() => setShowMore(true)}
          className="text-xs text-muted-foreground hover:text-foreground underline decoration-dotted"
        >
          + More fields ({extraRoleFields.map((f) => COMPETITOR_FIELD_LABELS[f]).join(', ')})
        </button>
      )}
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
  const { data: competitors } = useCompetitorsBySeries(seriesId);
  const { data: fleets } = useFleetsBySeries(seriesId);
  const { data: series } = useSeries(seriesId);
  const saveCompetitor = useSaveCompetitor();
  const deleteCompetitor = useDeleteCompetitor();
  const touchSeries = useTouchSeries();
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

  // 'n' to show add form, 'i' to import CSV, 'u' to update handicaps
  useGlobalKeyDown((e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '')) return;
    if (e.key === 'n') {
      e.preventDefault();
      setShowAddForm(true);
    } else if (e.key === 'i') {
      e.preventDefault();
      importRef.current?.trigger();
    } else if (e.key === 'u' && hasHandicapFleet) {
      e.preventDefault();
      updateHandicapsRef.current?.open();
    }
  });

  function ratingFieldsFromForm(data: CompetitorFormData): Pick<Competitor, 'ircTcc' | 'pyNumber' | 'nhcStartingTcf' | 'echoStartingTcf'> {
    const tcc = data.ircTcc.trim() ? parseFloat(data.ircTcc.trim()) : undefined;
    const py = data.pyNumber.trim() ? parseInt(data.pyNumber.trim(), 10) : undefined;
    const nhc = data.nhcStartingTcf.trim() ? parseFloat(data.nhcStartingTcf.trim()) : undefined;
    const echo = data.echoStartingTcf.trim() ? parseFloat(data.echoStartingTcf.trim()) : undefined;
    return {
      ...(tcc != null && !isNaN(tcc) ? { ircTcc: tcc } : {}),
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
    await touchSeries.mutateAsync(seriesId);
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
    await touchSeries.mutateAsync(seriesId);
    setEditingCompetitor(null);
  }

  async function handleDelete(competitor: Competitor) {
    if (!confirm(`Delete ${competitor.name} (${competitor.sailNumber})?`)) return;
    log('competitors', 'deleting', competitor.id);
    await deleteCompetitor.mutateAsync({ id: competitor.id, seriesId });
    await touchSeries.mutateAsync(seriesId);
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
        {!showAddForm && (
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
        <div className="border rounded-lg p-5">
          <h2 className="font-medium mb-4">Add competitor</h2>
          <CompetitorForm
            initial={emptyForm}
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
              <TableHead className="w-0 p-0" />
            </TableRow>
          </TableHeader>
          <TableBody ref={tbodyRef}>
            {competitors.map((c) => (
              <TableRow
                key={c.id}
                tabIndex={0}
                className="group/row focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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
                <TableCell className="w-0 p-0 relative">
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 rounded-md bg-background/90 px-1 opacity-0 pointer-events-none transition-opacity group-hover/row:opacity-100 group-hover/row:pointer-events-auto group-focus-within/row:opacity-100 group-focus-within/row:pointer-events-auto">
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
                pyNumber: editingCompetitor.pyNumber?.toString() ?? '',
                nhcStartingTcf: editingCompetitor.nhcStartingTcf?.toString() ?? '',
                echoStartingTcf: editingCompetitor.echoStartingTcf?.toString() ?? '',
              }}
              onSave={handleEdit}
              onCancel={() => setEditingCompetitor(null)}
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
