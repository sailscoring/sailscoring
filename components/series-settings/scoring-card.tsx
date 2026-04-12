'use client';

import { useEffect, useState } from 'react';
import type { DiscardThreshold, Series } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type ScoringValues = Pick<Series, 'discardThresholds' | 'dnfScoring'>;

export type ScoringCardProps = {
  value: ScoringValues;
  onChange: (patch: Partial<ScoringValues>) => void | Promise<void>;
  mode?: 'settings' | 'wizard';
};

export function ScoringCard({ value, onChange, mode = 'settings' }: ScoringCardProps) {
  const isWizard = mode === 'wizard';
  const [expanded, setExpanded] = useState(isWizard);
  const [thresholds, setThresholds] = useState<DiscardThreshold[]>(value.discardThresholds ?? []);
  const [dnfScoring, setDnfScoring] = useState<Series['dnfScoring']>(value.dnfScoring ?? 'seriesEntries');
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    setThresholds(value.discardThresholds ?? []);
    setDnfScoring(value.dnfScoring ?? 'seriesEntries');
    setChanged(false);
  }, [value]);

  function updateThresholds(next: DiscardThreshold[]) {
    setThresholds(next);
    setChanged(true);
    if (isWizard) onChange({ discardThresholds: next });
  }

  function updateDnf(next: Series['dnfScoring']) {
    setDnfScoring(next);
    setChanged(true);
    if (isWizard) onChange({ dnfScoring: next });
  }

  function updateThreshold(index: number, field: keyof DiscardThreshold, value: number) {
    updateThresholds(thresholds.map((t, i) => i === index ? { ...t, [field]: value } : t));
  }

  function addThreshold() {
    const maxMinRaces = thresholds.reduce((m, t) => Math.max(m, t.minRaces), 0);
    const maxDiscardCount = thresholds.reduce((m, t) => Math.max(m, t.discardCount), 0);
    updateThresholds([...thresholds, { minRaces: maxMinRaces + 1, discardCount: maxDiscardCount + 1 }]);
  }

  function removeThreshold(index: number) {
    updateThresholds(thresholds.filter((_, i) => i !== index));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    await onChange({ discardThresholds: thresholds, dnfScoring });
    setChanged(false);
    setExpanded(false);
  }

  const thresholdTable = (
    <>
      <p className="text-xs text-muted-foreground">
        Discard rules — drop each competitor&apos;s worst race(s) from the series total.
        Each rule sets the <em>total</em> number of discards once that many races have been sailed.
      </p>
      {thresholds.length === 0 ? (
        <p className="text-sm text-muted-foreground">No discards configured.</p>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs text-muted-foreground px-1">
            <span>From (races)</span>
            <span>Total discards</span>
            <span />
          </div>
          {[...thresholds]
            .sort((a, b) => a.minRaces - b.minRaces)
            .map((t, i, sorted) => {
              const origIndex = thresholds.indexOf(t);
              const minDiscard = i === 0 ? 1 : sorted[i - 1].discardCount + 1;
              return (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                  <Input
                    type="number"
                    min={1}
                    value={t.minRaces}
                    onChange={(e) => updateThreshold(origIndex, 'minRaces', Math.max(1, parseInt(e.target.value) || 1))}
                    className="h-8 text-sm"
                  />
                  <Input
                    type="number"
                    min={minDiscard}
                    max={t.minRaces - 1}
                    value={t.discardCount}
                    onChange={(e) => updateThreshold(origIndex, 'discardCount', Math.max(minDiscard, parseInt(e.target.value) || minDiscard))}
                    className="h-8 text-sm"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-muted-foreground"
                    onClick={() => removeThreshold(origIndex)}
                  >
                    ×
                  </Button>
                </div>
              );
            })}
        </div>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addThreshold}>
          Add rule
        </Button>
      </div>
    </>
  );

  const dnfRadios = (
    <div className="space-y-2 pt-1">
      <Label>DNF/DNS scoring (RRS A5)</Label>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="radio"
          name="dnfScoring"
          checked={dnfScoring === 'seriesEntries'}
          onChange={() => updateDnf('seriesEntries')}
          className="mt-0.5"
        />
        <div>
          <span className="text-sm font-medium">Entries in the series (RRS A5.2 — standard)</span>
          <p className="text-xs text-muted-foreground">DNF/DNS score = series entries + 1. DNC also uses this.</p>
        </div>
      </label>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="radio"
          name="dnfScoring"
          checked={dnfScoring === 'startingArea'}
          onChange={() => updateDnf('startingArea')}
          className="mt-0.5"
        />
        <div>
          <span className="text-sm font-medium">Boats in the starting area (RRS A5.3 — alternative)</span>
          <p className="text-xs text-muted-foreground">
            Uses the boats present in the starting area of each race. Requires start check-in to distinguish DNS from DNC.
            DNC still scores series entries + 1.
          </p>
        </div>
      </label>
    </div>
  );

  if (isWizard) {
    return (
      <div className="space-y-4">
        {thresholdTable}
        {dnfRadios}
      </div>
    );
  }

  const ruleCount = (value.discardThresholds ?? []).length;
  const dnfLabel = (value.dnfScoring ?? 'seriesEntries') === 'startingArea'
    ? 'DNF: starting area'
    : 'DNF: series entries';
  const summary = ruleCount === 0
    ? `No discards · ${dnfLabel}`
    : `${ruleCount} discard rule${ruleCount !== 1 ? 's' : ''} · ${dnfLabel}`;

  return (
    <div className="border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Scoring</h2>
        {!expanded && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            Edit ▸
          </Button>
        )}
      </div>
      {!expanded ? (
        <p className="text-sm text-muted-foreground">{summary}</p>
      ) : (
        <form onSubmit={handleSave} className="space-y-4">
          {thresholdTable}
          {dnfRadios}
          <div className="flex gap-2">
            <Button type="submit" variant="outline" size="sm" disabled={!changed}>
              {changed ? 'Save' : 'Saved'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(false)}>
              Done
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
