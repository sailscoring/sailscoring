'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { seriesRepo, fleetRepo, competitorRepo } from '@/lib/dexie-repository';
import { db } from '@/lib/db';
import type { Series } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Upload } from 'lucide-react';
import { CompetitorImport } from '@/components/competitor-import';
import { BasicsCard } from '@/components/series-settings/basics-card';
import { FleetsCard } from '@/components/series-settings/fleets-card';
import { ScoringCard } from '@/components/series-settings/scoring-card';

const STEP_LABELS = ['Name & Basics', 'Competitors', 'Fleets', 'Scoring'];

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
  async function persist(patch: Partial<Series>) {
    await db.series.update(seriesId, patch);
    await seriesRepo.touch(seriesId);
  }

  return (
    <div className="space-y-4">
      <BasicsCard
        mode="wizard"
        includeName
        value={series}
        onChange={persist}
      />
      <div className="flex justify-end pt-2">
        <Button onClick={onNext}>Next: Competitors →</Button>
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
  const competitors = useLiveQuery(() => competitorRepo.listBySeries(seriesId), [seriesId]);
  const fleets = useLiveQuery(() => fleetRepo.listBySeries(seriesId), [seriesId]);
  const count = competitors?.length ?? 0;
  const [lastImportResult, setLastImportResult] = useState<{ added: number; fleetsCreated: string[] } | null>(null);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Import your competitors from a CSV file. Fleet information can be
        detected from the import.
      </p>
      <CompetitorImport
        seriesId={seriesId}
        fleets={fleets ?? []}
        onComplete={(result) => {
          if (result && result.added > 0) {
            setLastImportResult({ added: result.added, fleetsCreated: result.fleetsCreated });
          }
        }}
        trigger={
          <Button variant="outline">
            <Upload className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
        }
      />
      {lastImportResult && (
        <p className="text-sm font-medium">
          {lastImportResult.added} competitor{lastImportResult.added === 1 ? '' : 's'} imported.
          {lastImportResult.fleetsCreated.length > 0 && (
            <> {lastImportResult.fleetsCreated.length} fleet{lastImportResult.fleetsCreated.length === 1 ? '' : 's'} created: {lastImportResult.fleetsCreated.join(', ')}.</>
          )}
        </p>
      )}
      {count > 0 && !lastImportResult && (
        <p className="text-sm font-medium">{count} competitor{count === 1 ? '' : 's'} loaded.</p>
      )}
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

// ── Step 3: Fleets (scoring mode + fleets + start sequence) ───────────────────

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
  async function handleScoringMode(mode: 'scratch' | 'handicap') {
    if (mode === series.scoringMode) return;
    await db.series.update(seriesId, { scoringMode: mode });
    if (mode === 'scratch') {
      const fleets = await fleetRepo.listBySeries(seriesId);
      for (const f of fleets) {
        if (f.scoringSystem !== 'scratch') {
          await fleetRepo.save({ ...f, scoringSystem: 'scratch' });
        }
      }
    }
    await seriesRepo.touch(seriesId);
  }

  return (
    <div className="space-y-4">
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

      <div className="space-y-2">
        <Label>Fleets</Label>
        <FleetsCard mode="wizard" seriesId={seriesId} series={series} />
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
  async function persist(patch: Partial<Series>) {
    await db.series.update(seriesId, patch);
    await seriesRepo.touch(seriesId);
  }

  return (
    <div className="space-y-4">
      <ScoringCard mode="wizard" value={series} onChange={persist} />
      <div className="flex justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <Button onClick={onFinish}>Finish setup →</Button>
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
    router.push(`/series/${seriesId}/competitors`);
  }

  return (
    <div className="max-w-lg space-y-6">
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

      {step === 1 && (
        <Step1 series={series} seriesId={seriesId} onNext={() => setStep(2)} />
      )}
      {step === 2 && (
        <Step2 seriesId={seriesId} onNext={() => setStep(3)} onBack={() => setStep(1)} />
      )}
      {step === 3 && (
        <Step3 series={series} seriesId={seriesId} onNext={() => setStep(4)} onBack={() => setStep(2)} />
      )}
      {step === 4 && (
        <Step4 series={series} seriesId={seriesId} onBack={() => setStep(3)} onFinish={handleFinish} />
      )}
    </div>
  );
}
