'use client';

import { useRef, useState } from 'react';

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
import { NationalityInput } from '@/components/nationality-input';
import { useCompetitorAudit } from '@/hooks/use-competitors';
import {
  COMPETITOR_FIELD_LABELS,
  PRIMARY_PERSON_LABEL_TEXT,
  isFieldDisabledByPrimary,
  subdivisionAxisLabel,
} from '@/lib/competitor-fields';
import { requiredForFleetsHint } from '@/lib/competitor-ratings';
import { formatRelativeTime } from '@/lib/relative-time';
import type { CompetitorFieldKey, Fleet, PrimaryPersonLabel, SubdivisionAxis } from '@/lib/types';

export interface CompetitorFormData {
  sailNumber: string;
  bowNumber: string;
  boatName: string;
  boatClass: string;
  name: string;
  owner: string;
  helm: string;
  crewNames: string[];  // dynamic rows in the form; blanks dropped on save
  club: string;
  nationality: string;
  gender: '' | 'M' | 'F';
  age: string;
  subdivisions: Record<string, string>;  // per-axis values keyed by SubdivisionAxis.id
  fleetIds: string[];   // IDs of existing fleets to assign the competitor to
  ircTcc: string;       // decimal string, e.g. "0.972"; empty if not set
  vprsTcc: string;      // decimal string, e.g. "0.992"; empty if not set
  pyNumber: string;     // integer string, e.g. "1034"; empty if not set
  nhcStartingTcf: string; // decimal string, e.g. "1.005"; empty if not set
  echoStartingTcf: string; // decimal string, e.g. "1.020"; empty if not set
}

export const emptyCompetitorForm: CompetitorFormData = {
  sailNumber: '',
  bowNumber: '',
  boatName: '',
  boatClass: '',
  name: '',
  owner: '',
  helm: '',
  crewNames: [],
  club: '',
  nationality: '',
  gender: '',
  age: '',
  subdivisions: {},
  fleetIds: [],
  ircTcc: '',
  vprsTcc: '',
  pyNumber: '',
  nhcStartingTcf: '',
  echoStartingTcf: '',
};

/** Passive "who last edited this" stamp in the edit dialog (#153). */
export function CompetitorAuditLine({ competitorId }: { competitorId: string }) {
  const { data } = useCompetitorAudit(competitorId);
  if (!data?.updatedAt) return null;
  const who = data.actor?.displayName ?? data.actor?.email ?? 'someone';
  return (
    <p className="text-xs text-muted-foreground">
      Last edited by {who} · {formatRelativeTime(data.updatedAt)}
    </p>
  );
}

export function CompetitorForm({
  initial,
  onSave,
  onCancel,
  onDelete,
  existingCompetitors,
  availableFleets,
  enabledFields,
  primaryLabel,
  subdivisionAxes,
}: {
  initial: CompetitorFormData;
  onSave: (data: CompetitorFormData) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
  existingCompetitors: { sailNumber: string; fleetIds: string[] }[];
  availableFleets: Fleet[];
  enabledFields: CompetitorFieldKey[];
  primaryLabel: PrimaryPersonLabel;
  subdivisionAxes: SubdivisionAxis[];
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
  const vprsFleetNames = selectedFleets.filter((f) => f.scoringSystem === 'vprs').map((f) => f.name);
  const pyFleetNames = selectedFleets.filter((f) => f.scoringSystem === 'py').map((f) => f.name);
  const nhcFleetNames = selectedFleets.filter((f) => f.scoringSystem === 'nhc').map((f) => f.name);
  const echoFleetNames = selectedFleets.filter((f) => f.scoringSystem === 'echo').map((f) => f.name);
  const needsIrcTcc = ircFleetNames.length > 0;
  const needsVprsTcc = vprsFleetNames.length > 0;
  const needsPyNumber = pyFleetNames.length > 0;
  const needsNhcStartingTcf = nhcFleetNames.length > 0;
  const needsEchoStartingTcf = echoFleetNames.length > 0;

  function set<K extends keyof CompetitorFormData>(field: K, value: CompetitorFormData[K]) {
    setData((d) => ({ ...d, [field]: value }));
  }

  // Crew rows: the stored list, or one blank row so the field is immediately
  // typable. Blanks are dropped on save (cleanCrewNames at the page boundary).
  const crewRows = data.crewNames.length > 0 ? data.crewNames : [''];
  // "Add crew" focuses the row it appends; the ref callback fires when the new
  // input mounts. A ref (not state) so no re-render is involved.
  const pendingCrewFocus = useRef<number | null>(null);

  function setCrewRow(index: number, value: string) {
    const next = [...crewRows];
    next[index] = value;
    set('crewNames', next);
  }

  function addCrewRow() {
    pendingCrewFocus.current = crewRows.length;
    set('crewNames', [...crewRows, '']);
  }

  function removeCrewRow(index: number) {
    set('crewNames', crewRows.filter((_, i) => i !== index));
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
    if (needsVprsTcc && data.vprsTcc.trim()) {
      const tcc = parseFloat(data.vprsTcc);
      if (isNaN(tcc) || tcc < 0.5 || tcc > 1.5) {
        setError('VPRS TCC must be a decimal number between 0.5 and 1.5 (e.g. 0.992).');
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
        {enabledFields.includes('bowNumber') && (
          <div className="space-y-1.5">
            <Label htmlFor="bowNumber">Bow number</Label>
            <Input
              id="bowNumber"
              value={data.bowNumber}
              onChange={(e) => set('bowNumber', e.target.value)}
              placeholder="e.g. 42"
            />
          </div>
        )}
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
            <Label>Crew</Label>
            {crewRows.map((crewName, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  ref={(el) => {
                    if (el && pendingCrewFocus.current === i) {
                      pendingCrewFocus.current = null;
                      el.focus();
                    }
                  }}
                  aria-label={`Crew ${i + 1}`}
                  value={crewName}
                  onChange={(e) => setCrewRow(i, e.target.value)}
                  placeholder={i === 0 ? 'e.g. Mark Smith' : undefined}
                />
                {crewRows.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs text-muted-foreground"
                    onClick={() => removeCrewRow(i)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={addCrewRow}
            >
              Add crew
            </Button>
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
        {enabledFields.includes('subdivision') &&
          subdivisionAxes.map((axis) => (
            <div className="space-y-1.5" key={axis.id}>
              <Label htmlFor={`subdivision-${axis.id}`}>{subdivisionAxisLabel(axis)}</Label>
              <Input
                id={`subdivision-${axis.id}`}
                value={data.subdivisions[axis.id] ?? ''}
                onChange={(e) =>
                  set('subdivisions', { ...data.subdivisions, [axis.id]: e.target.value })
                }
                placeholder="e.g. Gold"
              />
            </div>
          ))}
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
        {needsVprsTcc && (
          <div className="space-y-1.5">
            <Label htmlFor="vprsTcc">VPRS TCC</Label>
            <Input
              id="vprsTcc"
              value={data.vprsTcc}
              onChange={(e) => set('vprsTcc', e.target.value)}
              placeholder="e.g. 0.992"
            />
            {!data.vprsTcc.trim() && (
              <p className="text-sm text-amber-600">{requiredForFleetsHint(vprsFleetNames)}</p>
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
      <div className="flex justify-between gap-3">
        <div className="flex gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
        {onDelete && (
          <Button type="button" variant="destructive" onClick={onDelete} disabled={saving}>
            Delete
          </Button>
        )}
      </div>
    </form>
  );
}

