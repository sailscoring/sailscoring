'use client';

import { use, useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { seriesRepo, fleetRepo, competitorRepo } from '@/lib/dexie-repository';
import { db } from '@/lib/db';
import type { Series, Fleet, DiscardThreshold, StartGroup } from '@/lib/types';
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
import { Upload } from 'lucide-react';

const STEP_LABELS = ['Name & Basics', 'Competitors', 'Fleets', 'Scoring'];
const TOTAL_STEPS = STEP_LABELS.length;

// ── Step 1: Name & Basics ─────────────────────────────────────────────────────

function Step1({
  series,
  seriesId,
  onNext,
}: {
  series: Series;
  seriesId: string;
  onNext: () => void;
}) {
  const [name, setName] = useState(series.name);
  const [venue, setVenue] = useState(series.venue);
  const [startDate, setStartDate] = useState(series.startDate);
  const [endDate, setEndDate] = useState(series.endDate);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-select the placeholder name so the scorer can type over it
    nameRef.current?.select();
  }, []);

  async function save() {
    await db.series.update(seriesId, {
      name: name.trim() || series.name,
      venue: venue.trim(),
      startDate,
      endDate,
    });
    await seriesRepo.touch(seriesId);
  }

  async function handleNext() {
    await save();
    onNext();
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input
          ref={nameRef}
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. HYC Frostbite 2026"
          autoFocus
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="venue">Venue</Label>
        <Input
          id="venue"
          value={venue}
          onChange={(e) => setVenue(e.target.value)}
          placeholder="e.g. Howth Yacht Club"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="startDate">Start date</Label>
          <Input
            id="startDate"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="endDate">End date</Label>
          <Input
            id="endDate"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end pt-2">
        <Button onClick={handleNext}>Next: Competitors →</Button>
      </div>
    </div>
  );
}

// ── Step 2: Competitors ───────────────────────────────────────────────────────

function Step2({
  seriesId,
  onNext,
  onBack,
}: {
  seriesId: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const router = useRouter();
  const competitors = useLiveQuery(
    () => competitorRepo.listBySeries(seriesId),
    [seriesId],
  );
  const count = competitors?.length ?? 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Import your competitors from a CSV file, or add them manually later.
        Fleet information can be detected from the import.
      </p>
      {count > 0 && (
        <p className="text-sm font-medium">{count} competitor{count === 1 ? '' : 's'} loaded.</p>
      )}
      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={() => router.push(`/series/${seriesId}/competitors`)}
        >
          <Upload className="h-4 w-4 mr-2" />
          Go to Competitors
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        You can import CSV files and add competitors from the Competitors tab.
        Return here to continue the wizard when you&apos;re ready.
      </p>
      <div className="flex justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onNext}>Skip for now</Button>
          <Button onClick={onNext}>Next: Fleets →</Button>
        </div>
      </div>
    </div>
  );
}

// ── Step 3: Fleets ────────────────────────────────────────────────────────────

function Step3({
  series,
  seriesId,
  onNext,
  onBack,
}: {
  series: Series;
  seriesId: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const fleets = useLiveQuery(() => fleetRepo.listBySeries(seriesId), [seriesId]) ?? [];
  const sorted = [...fleets].sort((a, b) => a.displayOrder - b.displayOrder);
  const isOnlyDefault = fleets.length === 1 && fleets[0].name === 'Default';

  const [addingFleet, setAddingFleet] = useState(false);
  const [newFleetName, setNewFleetName] = useState('');
  const [newFleetError, setNewFleetError] = useState('');

  async function handleScoringMode(mode: 'scratch' | 'handicap') {
    if (mode === series.scoringMode) return;
    await db.series.update(seriesId, { scoringMode: mode });
    if (mode === 'scratch') {
      for (const f of fleets) {
        if (f.scoringSystem !== 'scratch') {
          await fleetRepo.save({ ...f, scoringSystem: 'scratch' });
        }
      }
    }
    await seriesRepo.touch(seriesId);
  }

  async function handleAddFleet() {
    const name = newFleetName.trim();
    if (!name) { setNewFleetError('Fleet name is required.'); return; }
    if (fleets.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      setNewFleetError(`"${name}" already exists.`);
      return;
    }
    const maxOrder = fleets.reduce((max, f) => Math.max(max, f.displayOrder), -1);
    await fleetRepo.save({
      id: crypto.randomUUID(),
      seriesId,
      name,
      displayOrder: maxOrder + 1,
      scoringSystem: 'scratch',
    });
    await seriesRepo.touch(seriesId);
    setNewFleetName('');
    setNewFleetError('');
    setAddingFleet(false);
  }

  async function changeScoringSystem(fleet: Fleet, system: Fleet['scoringSystem']) {
    await fleetRepo.save({ ...fleet, scoringSystem: system });
    await seriesRepo.touch(seriesId);
  }

  async function deleteFleet(fleet: Fleet) {
    if (!confirm(`Delete fleet "${fleet.name}"?`)) return;
    await fleetRepo.delete(fleet.id);
    await seriesRepo.touch(seriesId);
  }

  return (
    <div className="space-y-4">
      {/* Scoring mode */}
      <div className="space-y-2">
        <Label>How will this series be scored?</Label>
        <div className="space-y-2">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="wizardScoringMode"
              checked={series.scoringMode === 'scratch'}
              onChange={() => handleScoringMode('scratch')}
              className="mt-0.5"
            />
            <div>
              <span className="text-sm font-medium">Scratch (position-based)</span>
              <p className="text-xs text-muted-foreground">No finish times needed.</p>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="wizardScoringMode"
              checked={series.scoringMode === 'handicap'}
              onChange={() => handleScoringMode('handicap')}
              className="mt-0.5"
            />
            <div>
              <span className="text-sm font-medium">Handicap (time-corrected)</span>
              <p className="text-xs text-muted-foreground">Some or all fleets use IRC, PY, or other time-based scoring.</p>
            </div>
          </label>
        </div>
      </div>

      {/* Fleet list */}
      <div className="space-y-2">
        <Label>Fleets</Label>
        {sorted.length === 0 || isOnlyDefault ? (
          <p className="text-sm text-muted-foreground">No fleets configured yet.</p>
        ) : (
          <div className="space-y-1">
            {sorted.map((fleet) => (
              <div key={fleet.id} className="flex items-center gap-2 text-sm border rounded-md px-3 py-2">
                <span className="flex-1">{fleet.name}</span>
                {series.scoringMode === 'handicap' && (
                  <Select
                    value={fleet.scoringSystem}
                    onValueChange={(v) => changeScoringSystem(fleet, v as Fleet['scoringSystem'])}
                  >
                    <SelectTrigger className="w-28 h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="scratch">Scratch</SelectItem>
                      <SelectItem value="irc">IRC</SelectItem>
                      <SelectItem value="py">PY</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-1.5 text-destructive/70 hover:text-destructive"
                  onClick={() => deleteFleet(fleet)}
                >
                  ×
                </Button>
              </div>
            ))}
          </div>
        )}
        {addingFleet ? (
          <div className="flex items-center gap-2">
            <Input
              value={newFleetName}
              autoFocus
              placeholder="Fleet name"
              onChange={(e) => { setNewFleetName(e.target.value); setNewFleetError(''); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleAddFleet(); }
                if (e.key === 'Escape') { setAddingFleet(false); setNewFleetName(''); setNewFleetError(''); }
              }}
              className="flex-1"
            />
            <Button size="sm" onClick={handleAddFleet}>Add</Button>
            <Button variant="ghost" size="sm" onClick={() => { setAddingFleet(false); setNewFleetName(''); setNewFleetError(''); }}>Cancel</Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAddingFleet(true)}>
            + Add fleet
          </Button>
        )}
        {newFleetError && <p className="text-xs text-destructive">{newFleetError}</p>}
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <Button onClick={onNext}>Next: Scoring →</Button>
      </div>
    </div>
  );
}

// ── Step 4: Scoring & Discards ────────────────────────────────────────────────

function Step4({
  series,
  seriesId,
  onBack,
  onFinish,
}: {
  series: Series;
  seriesId: string;
  onBack: () => void;
  onFinish: () => void;
}) {
  const [dnfScoring, setDnfScoring] = useState<Series['dnfScoring']>(series.dnfScoring);
  const [discardMode, setDiscardMode] = useState<'rrs' | 'custom'>(
    series.discardThresholds.length === 0 ? 'rrs' : 'custom',
  );
  const [thresholds, setThresholds] = useState<DiscardThreshold[]>(series.discardThresholds);

  async function handleFinish() {
    const finalThresholds = discardMode === 'rrs' ? [] : thresholds;
    await db.series.update(seriesId, {
      dnfScoring,
      discardThresholds: finalThresholds,
    });
    await seriesRepo.touch(seriesId);
    onFinish();
  }

  return (
    <div className="space-y-4">
      {/* DNF scoring */}
      <div className="space-y-2">
        <Label>DNF/DNS scoring (RRS A5)</Label>
        <div className="space-y-2">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="wizardDnfScoring"
              checked={dnfScoring === 'seriesEntries'}
              onChange={() => setDnfScoring('seriesEntries')}
              className="mt-0.5"
            />
            <div>
              <span className="text-sm font-medium">Entries in the series (RRS A5.2 — standard)</span>
              <p className="text-xs text-muted-foreground">DNF/DNS score = fleet size + 1.</p>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="wizardDnfScoring"
              checked={dnfScoring === 'startingArea'}
              onChange={() => setDnfScoring('startingArea')}
              className="mt-0.5"
            />
            <div>
              <span className="text-sm font-medium">Boats in the starting area (RRS A5.3 — alternative)</span>
              <p className="text-xs text-muted-foreground">Requires start check-in to distinguish DNS from DNC.</p>
            </div>
          </label>
        </div>
      </div>

      {/* Discards */}
      <div className="space-y-2">
        <Label>Discards</Label>
        <div className="space-y-2">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="wizardDiscards"
              checked={discardMode === 'rrs'}
              onChange={() => setDiscardMode('rrs')}
              className="mt-0.5"
            />
            <span className="text-sm">RRS standard (1 discard after 5 races; 2 after 9; etc.)</span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="wizardDiscards"
              checked={discardMode === 'custom'}
              onChange={() => {
                setDiscardMode('custom');
                if (thresholds.length === 0) setThresholds([{ minRaces: 5, discardCount: 1 }]);
              }}
              className="mt-0.5"
            />
            <span className="text-sm">Custom</span>
          </label>
        </div>
        {discardMode === 'custom' && (
          <div className="space-y-2 pl-7">
            {thresholds.map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span>After</span>
                <Input
                  type="number"
                  min={1}
                  value={t.minRaces}
                  onChange={(e) => {
                    const updated = [...thresholds];
                    updated[i] = { ...t, minRaces: parseInt(e.target.value, 10) || 1 };
                    setThresholds(updated);
                  }}
                  className="w-16 h-7 text-xs"
                />
                <span>races, discard</span>
                <Input
                  type="number"
                  min={1}
                  value={t.discardCount}
                  onChange={(e) => {
                    const updated = [...thresholds];
                    updated[i] = { ...t, discardCount: parseInt(e.target.value, 10) || 1 };
                    setThresholds(updated);
                  }}
                  className="w-16 h-7 text-xs"
                />
                <span>worst</span>
                <Button variant="ghost" size="sm" className="h-7 px-1.5" onClick={() => setThresholds(thresholds.filter((_, j) => j !== i))}>×</Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setThresholds([...thresholds, { minRaces: thresholds.length > 0 ? thresholds[thresholds.length - 1].minRaces + 4 : 5, discardCount: thresholds.length + 1 }])}>
              + Add threshold
            </Button>
          </div>
        )}
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <Button onClick={handleFinish}>Finish setup →</Button>
      </div>
    </div>
  );
}

// ── Wizard Container ──────────────────────────────────────────────────────────

export default function SetupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: seriesId } = use(params);
  const router = useRouter();
  const series = useLiveQuery(() => seriesRepo.get(seriesId), [seriesId]);
  const [step, setStep] = useState(1);

  if (series === undefined) {
    return <p className="text-muted-foreground">Loading…</p>;
  }
  if (series === null) {
    return <p className="text-muted-foreground">Series not found.</p>;
  }

  function handleFinish() {
    router.push(`/series/${seriesId}/races`);
  }

  return (
    <div className="max-w-lg space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {STEP_LABELS.map((label, i) => (
          <button
            key={i}
            className={`px-2 py-1 rounded ${step === i + 1 ? 'bg-foreground text-background font-medium' : 'hover:bg-muted cursor-pointer'}`}
            onClick={() => setStep(i + 1)}
          >
            {i + 1}. {label}
          </button>
        ))}
      </div>

      {/* Step content */}
      {step === 1 && (
        <Step1
          series={series}
          seriesId={seriesId}
          onNext={() => setStep(2)}
        />
      )}
      {step === 2 && (
        <Step2
          seriesId={seriesId}
          onNext={() => setStep(3)}
          onBack={() => setStep(1)}
        />
      )}
      {step === 3 && (
        <Step3
          series={series}
          seriesId={seriesId}
          onNext={() => setStep(4)}
          onBack={() => setStep(2)}
        />
      )}
      {step === 4 && (
        <Step4
          series={series}
          seriesId={seriesId}
          onBack={() => setStep(3)}
          onFinish={handleFinish}
        />
      )}
    </div>
  );
}
