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
  personFieldFormLabel,
  personFieldHeader,
  subdivisionAxisLabel,
} from '@/lib/competitor-fields';
import { requiredForFleetsHint } from '@/lib/competitor-ratings';
import { orcCertificatePageUrl } from '@/lib/orc-certificate';
import { formatRelativeTime } from '@/lib/relative-time';
import { isValidWorldSailingId, normalizeWorldSailingId } from '@/lib/world-sailing';
import type { CompetitorFieldKey, Fleet, MultiPersonFieldKey, OrcCertData, PrimaryPersonLabel, SubdivisionAxis } from '@/lib/types';

export interface CompetitorFormData {
  sailNumber: string;
  bowNumber: string;
  /** Comma-separated; parsed on save (see parseAlternativeSailNumbers). */
  alternativeSailNumbers: string;
  entryNumber: string;
  tallyNumber: string;
  seed: string;
  initialFleet: string;
  worldSailingId: string;
  boatName: string;
  boatClass: string;
  names: string[];   // primary person rows; blanks dropped on save, at least one non-blank required
  owners: string[];  // dynamic rows; blanks dropped on save
  helms: string[];
  crewNames: string[];
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
  alternativeSailNumbers: '',
  entryNumber: '',
  tallyNumber: '',
  seed: '',
  initialFleet: '',
  worldSailingId: '',
  boatName: '',
  boatClass: '',
  names: [''],
  owners: [],
  helms: [],
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

/** One input row per person, shared by the primary, owner, helm, and crew
 *  fields. "Add" appends a row and focuses it (ref callback — no re-render);
 *  "Remove" appears once there is more than one row; blanks are dropped on
 *  save at the page boundary. Row aria-labels are numbered from 1 so a
 *  single-row field still answers to its base label as a prefix. */
function PersonRowsField({
  heading,
  rowLabelBase,
  addLabel,
  rows,
  onChange,
  placeholder,
  allowMultiple,
}: {
  heading: React.ReactNode;
  rowLabelBase: string;
  addLabel: string;
  rows: string[];
  onChange: (rows: string[]) => void;
  placeholder?: string;
  /** Entry affordance gate (#316): false hides the add-a-row button, so the
   *  field behaves as a single input. Stored extra rows still render (with
   *  Remove) — data is never hidden by switching the setting off. */
  allowMultiple: boolean;
}) {
  const displayRows = rows.length > 0 ? rows : [''];
  const pendingFocus = useRef<number | null>(null);
  return (
    <div className="space-y-1.5">
      <Label>{heading}</Label>
      {displayRows.map((value, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            ref={(el) => {
              if (el && pendingFocus.current === i) {
                pendingFocus.current = null;
                el.focus();
              }
            }}
            aria-label={`${rowLabelBase} ${i + 1}`}
            value={value}
            onChange={(e) => {
              const next = [...displayRows];
              next[i] = e.target.value;
              onChange(next);
            }}
            placeholder={i === 0 ? placeholder : undefined}
          />
          {displayRows.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-muted-foreground"
              onClick={() => onChange(displayRows.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      {allowMultiple && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => {
            pendingFocus.current = displayRows.length;
            onChange([...displayRows, '']);
          }}
        >
          {addLabel}
        </Button>
      )}
    </div>
  );
}

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
  multiPersonFields,
  orcCert,
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
  /** Person fields opened to multiple names (#316); [] = all single. */
  multiPersonFields: MultiPersonFieldKey[];
  /** The boat's stored ORC certificate, shown read-only when editing — the
   *  certificate itself is imported via Update handicaps, never typed in. */
  orcCert?: OrcCertData;
}) {
  const [data, setData] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // "+ More fields" lets scorers add owner/helm/etc. without leaving the form.
  // Defaults to expanded when the initial data already populates one of the
  // extra slots (editing) so the value stays visible.
  const initialExtra = (['owners', 'helms'] as const).some((f) => initial[f].some((n) => n.trim().length > 0));
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
  const orcFleetNames = selectedFleets.filter((f) => f.scoringSystem === 'orc').map((f) => f.name);
  const needsIrcTcc = ircFleetNames.length > 0;
  const needsVprsTcc = vprsFleetNames.length > 0;
  const showOrcSection = orcFleetNames.length > 0 || orcCert != null;
  const needsPyNumber = pyFleetNames.length > 0;
  const needsNhcStartingTcf = nhcFleetNames.length > 0;
  const needsEchoStartingTcf = echoFleetNames.length > 0;

  function set<K extends keyof CompetitorFormData>(field: K, value: CompetitorFormData[K]) {
    setData((d) => ({ ...d, [field]: value }));
  }

  // Gender and age describe the primary person, and only when the primary is
  // a single individual — a syndicate entry carries neither (#316).
  const multiPrimary = data.names.filter((n) => n.trim()).length > 1;
  const clearsDemographics = multiPrimary && (data.gender !== '' || data.age.trim() !== '');

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
    if (!data.names.some((n) => n.trim())) {
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
          <PersonRowsField
            heading={<>{primaryFieldLabel} {multiPersonFields.includes('primary') ? 'names' : 'name'} *</>}
            rowLabelBase={`${primaryFieldLabel} name`}
            addLabel="Add name"
            rows={data.names}
            onChange={(rows) => set('names', rows)}
            placeholder="e.g. Jane Doe"
            allowMultiple={multiPersonFields.includes('primary')}
          />
          {clearsDemographics && (
            <p className="text-sm text-amber-600">
              Gender and age apply to a single named {primaryFieldLabel.toLowerCase()} and will be cleared.
            </p>
          )}
        </div>
        {enabledFields.includes('entryNumber') && (
          <div className="space-y-1.5">
            <Label htmlFor="entryNumber">Entry number</Label>
            <Input
              id="entryNumber"
              value={data.entryNumber}
              onChange={(e) => set('entryNumber', e.target.value)}
            />
          </div>
        )}
        {enabledFields.includes('tallyNumber') && (
          <div className="space-y-1.5">
            <Label htmlFor="tallyNumber">Tally number</Label>
            <Input
              id="tallyNumber"
              value={data.tallyNumber}
              onChange={(e) => set('tallyNumber', e.target.value)}
            />
          </div>
        )}
        {enabledFields.includes('seed') && (
          <div className="space-y-1.5">
            <Label htmlFor="seed">Seeding rank</Label>
            <Input
              id="seed"
              type="number"
              min={1}
              value={data.seed}
              onChange={(e) => set('seed', e.target.value)}
            />
          </div>
        )}
        {enabledFields.includes('initialFleet') && (
          <div className="space-y-1.5">
            <Label htmlFor="initialFleet">Initial fleet</Label>
            <Input
              id="initialFleet"
              value={data.initialFleet}
              onChange={(e) => set('initialFleet', e.target.value)}
              placeholder="e.g. Yellow"
            />
          </div>
        )}
        {enabledFields.includes('worldSailingId') && (
          <div className="space-y-1.5">
            <Label htmlFor="worldSailingId">World Sailing ID</Label>
            <Input
              id="worldSailingId"
              className="font-mono"
              value={data.worldSailingId}
              onChange={(e) => set('worldSailingId', e.target.value)}
              placeholder="e.g. IRLMM1"
            />
            {/* A warning, never a rejection: an entry list is transcribed by
                humans, and a scorer needs to see what it actually said. */}
            {data.worldSailingId.trim() &&
              !isValidWorldSailingId(normalizeWorldSailingId(data.worldSailingId)) && (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  Doesn&apos;t look like a Sailor ID (nation code, initials, then a
                  number — IRLMM1). Saved as entered.
                </p>
              )}
          </div>
        )}
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
        {enabledFields.includes('alternativeSailNumbers') && (
          <div className="space-y-1.5">
            <Label htmlFor="alternativeSailNumbers">Alternative sail numbers</Label>
            <Input
              id="alternativeSailNumbers"
              value={data.alternativeSailNumbers}
              onChange={(e) => set('alternativeSailNumbers', e.target.value)}
              placeholder="e.g. IRL 1234, 99"
            />
            <p className="text-xs text-muted-foreground">
              Other sail numbers this boat may show, separated by commas. Finish
              entry matches any of them; results still show the registered sail
              number.
            </p>
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
          <PersonRowsField
            heading={personFieldFormLabel('helm', multiPersonFields)}
            rowLabelBase="Helm name"
            addLabel="Add helm"
            rows={data.helms}
            onChange={(rows) => set('helms', rows)}
            placeholder="e.g. Jane Doe"
            allowMultiple={multiPersonFields.includes('helm')}
          />
        )}
        {enabledFields.includes('owner') && !isFieldDisabledByPrimary('owner', primaryLabel) && (
          <PersonRowsField
            heading={personFieldFormLabel('owner', multiPersonFields)}
            rowLabelBase="Owner name"
            addLabel="Add owner"
            rows={data.owners}
            onChange={(rows) => set('owners', rows)}
            placeholder="e.g. John Smith"
            allowMultiple={multiPersonFields.includes('owner')}
          />
        )}
        {showMore && extraRoleFields.includes('helm') && (
          <PersonRowsField
            heading={personFieldFormLabel('helm', multiPersonFields)}
            rowLabelBase="Helm name"
            addLabel="Add helm"
            rows={data.helms}
            onChange={(rows) => set('helms', rows)}
            placeholder="e.g. Jane Doe"
            allowMultiple={multiPersonFields.includes('helm')}
          />
        )}
        {showMore && extraRoleFields.includes('owner') && (
          <PersonRowsField
            heading={personFieldFormLabel('owner', multiPersonFields)}
            rowLabelBase="Owner name"
            addLabel="Add owner"
            rows={data.owners}
            onChange={(rows) => set('owners', rows)}
            placeholder="e.g. John Smith"
            allowMultiple={multiPersonFields.includes('owner')}
          />
        )}
        {enabledFields.includes('crewName') && (
          <PersonRowsField
            heading={personFieldHeader('crewName', multiPersonFields)}
            rowLabelBase="Crew"
            addLabel="Add crew"
            rows={data.crewNames}
            onChange={(rows) => set('crewNames', rows)}
            placeholder="e.g. Mark Smith"
            allowMultiple={multiPersonFields.includes('crewName')}
          />
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
        {enabledFields.includes('gender') && !multiPrimary && (
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
        {enabledFields.includes('age') && !multiPrimary && (
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
        {showOrcSection && (
          <div className="space-y-1.5">
            <Label>ORC certificate</Label>
            {orcCert ? (
              <p className="text-sm text-muted-foreground">
                {orcCert.record.RefNo ? (
                  <a
                    href={orcCertificatePageUrl(orcCert.record.RefNo)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2"
                  >
                    {orcCert.record.RefNo}
                  </a>
                ) : 'No reference number'}
                {orcCert.record.C_Type ? ` · ${orcCert.record.C_Type}` : ''}
                {orcCert.record.APHT != null ? ` · APHT ${orcCert.record.APHT.toFixed(4)}` : ''}
                {orcCert.expiryDate
                  ? ` · expires ${orcCert.expiryDate.slice(0, 10)}`
                  : ''}
              </p>
            ) : (
              <p className="text-sm text-amber-600">
                {requiredForFleetsHint(orcFleetNames)} Import it from the ORC
                database via Update handicaps.
              </p>
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

