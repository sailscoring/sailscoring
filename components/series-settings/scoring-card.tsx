'use client';

import { useState } from 'react';
import type { DiscardThreshold, Series } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeDiscardRules, discardFreeBelow, summarizeDiscardRules } from '@/lib/discard-rules';

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

  // Re-sync the local draft when the persisted value changes identity (e.g.
  // opening a different series). Done via render-time compare rather than an
  // effect so it plays nicely with the React Compiler. See
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setThresholds(value.discardThresholds ?? []);
    setDnfScoring(value.dnfScoring ?? 'seriesEntries');
    setChanged(false);
  }

  // Wizard-mode autosave fires onChange without awaiting (the input mustn't
  // block on the network). Wrap with a swallowing catch so a rejected save
  // — e.g. ConflictApiError — doesn't escape as an unhandled rejection.
  // Errors are surfaced globally by <ConflictNoticeProvider> in app/providers.
  function fireWizardSave(patch: Partial<ScoringValues>) {
    Promise.resolve(onChange(patch)).catch(() => {});
  }

  function updateThresholds(next: DiscardThreshold[]) {
    setThresholds(next);
    setChanged(true);
    if (isWizard) fireWizardSave({ discardThresholds: next });
  }

  function updateDnf(next: Series['dnfScoring']) {
    setDnfScoring(next);
    setChanged(true);
    if (isWizard) fireWizardSave({ dnfScoring: next });
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
    // Tidy the stored order on save rather than while typing — reordering rows
    // under the cursor as a number is edited is worse than a momentarily
    // out-of-order list, and the engine sorts for itself either way.
    const ordered = [...thresholds].sort((a, b) => a.minRaces - b.minRaces);
    await onChange({ discardThresholds: ordered, dnfScoring });
    setChanged(false);
    setExpanded(false);
  }

  const described = describeDiscardRules(thresholds);
  const freeBelow = discardFreeBelow(thresholds);

  const thresholdTable = (
    <>
      <p className="text-xs text-muted-foreground">
        Discard rules — drop each competitor&apos;s worst race(s) from the series total.
      </p>
      {thresholds.length === 0 ? (
        <p className="text-sm text-muted-foreground">No discards configured.</p>
      ) : (
        <div className="space-y-3">
          {thresholds.map((t, i) => {
            const rule = described[i];
            return (
              <div key={i} className="space-y-1">
                <div className="flex items-start gap-2">
                  {/* Each clause is its own nowrap group, so a card too narrow
                      for the whole sentence breaks at the comma rather than
                      orphaning the trailing number on a line of its own. */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm flex-1">
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      Once
                      <Input
                        type="number"
                        min={1}
                        aria-label={`Rule ${i + 1}: races sailed`}
                        value={t.minRaces || ''}
                        onChange={(e) => updateThreshold(i, 'minRaces', parseInt(e.target.value) || 0)}
                        className="h-8 w-14 text-sm"
                      />
                      races have been sailed,
                    </span>
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      drop the worst
                      <Input
                        type="number"
                        min={0}
                        aria-label={`Rule ${i + 1}: discards`}
                        value={t.discardCount || ''}
                        onChange={(e) => updateThreshold(i, 'discardCount', parseInt(e.target.value) || 0)}
                        className="h-8 w-14 text-sm"
                      />
                      {t.discardCount === 1 ? 'score.' : 'scores.'}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove rule ${i + 1}`}
                    className="h-8 px-2 text-muted-foreground"
                    onClick={() => removeThreshold(i)}
                  >
                    ×
                  </Button>
                </div>
                {rule.appliesLabel && (
                  <p className="text-xs text-muted-foreground">{rule.appliesLabel}</p>
                )}
                {rule.warnings.map((warning) => (
                  <p key={warning} className="text-xs text-amber-600 dark:text-amber-500">
                    {warning}
                  </p>
                ))}
              </div>
            );
          })}
          {freeBelow !== null && (
            <p className="text-xs text-muted-foreground">
              Fewer than {freeBelow} races sailed: no discards.
            </p>
          )}
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
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="radio"
          name="dnfScoring"
          checked={dnfScoring === 'startingAreaInclDnc'}
          onChange={() => updateDnf('startingAreaInclDnc')}
          className="mt-0.5"
        />
        <div>
          <span className="text-sm font-medium">Starting area, including DNC (RRS A5.3 as changed by DBSC)</span>
          <p className="text-xs text-muted-foreground">
            As above, but a boat that did not come to the start (DNC) is also scored from the boats that came + 1.
            Matches DBSC Sailing Instruction A13.2.
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

  const dnfMode = value.dnfScoring ?? 'seriesEntries';
  const dnfLabel = dnfMode === 'startingAreaInclDnc'
    ? 'DNF: starting area (incl. DNC)'
    : dnfMode === 'startingArea'
      ? 'DNF: starting area'
      : 'DNF: series entries';
  const summary = `${summarizeDiscardRules(value.discardThresholds ?? [])} · ${dnfLabel}`;

  return (
    <div className="bg-card border rounded-lg p-5 space-y-4">
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
