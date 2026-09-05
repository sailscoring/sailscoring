'use client';

import { useState } from 'react';
import type { DiscardThreshold, ProportionalDiscard, Series } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  describeDiscardRules,
  describeProportionalDiscard,
  summarizeDiscardRules,
  summarizeProportionalDiscard,
} from '@/lib/discard-rules';
import { useFeatures } from '@/components/features-provider';

export type ScoringValues = Pick<Series, 'discardThresholds' | 'proportionalDiscard' | 'dnfScoring' | 'excludeDncOnlyCompetitors'>;

/** What a scorer gets on switching to a proportional rule: one discard per
 *  three races sailed, the commonest wording found in club sailing
 *  instructions. */
const DEFAULT_PROPORTIONAL: ProportionalDiscard = { firstAt: 3, everyRaces: 3 };

export type ScoringCardProps = {
  value: ScoringValues;
  onChange: (patch: Partial<ScoringValues>) => void | Promise<void>;
  mode?: 'settings' | 'wizard';
};

export function ScoringCard({ value, onChange, mode = 'settings' }: ScoringCardProps) {
  const isWizard = mode === 'wizard';
  const { has } = useFeatures();
  const proportionalAllowed = has('proportional-discards');
  const [expanded, setExpanded] = useState(isWizard);
  const [thresholds, setThresholds] = useState<DiscardThreshold[]>(value.discardThresholds ?? []);
  const [proportional, setProportional] = useState<ProportionalDiscard | undefined>(value.proportionalDiscard);
  const [dnfScoring, setDnfScoring] = useState<Series['dnfScoring']>(value.dnfScoring ?? 'seriesEntries');
  const [excludeDncOnly, setExcludeDncOnly] = useState(value.excludeDncOnlyCompetitors ?? false);
  const [changed, setChanged] = useState(false);

  // Re-sync the local draft when the persisted value changes identity (e.g.
  // opening a different series). Done via render-time compare rather than an
  // effect so it plays nicely with the React Compiler. See
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setThresholds(value.discardThresholds ?? []);
    setProportional(value.proportionalDiscard);
    setDnfScoring(value.dnfScoring ?? 'seriesEntries');
    setExcludeDncOnly(value.excludeDncOnlyCompetitors ?? false);
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

  function updateProportional(next: ProportionalDiscard | undefined) {
    setProportional(next);
    setChanged(true);
    if (isWizard) fireWizardSave({ proportionalDiscard: next });
  }

  function updateProportionalField(field: keyof ProportionalDiscard, fieldValue: number) {
    updateProportional({ ...(proportional ?? DEFAULT_PROPORTIONAL), [field]: fieldValue });
  }

  function updateDnf(next: Series['dnfScoring']) {
    setDnfScoring(next);
    setChanged(true);
    if (isWizard) fireWizardSave({ dnfScoring: next });
  }

  function updateExcludeDncOnly(next: boolean) {
    setExcludeDncOnly(next);
    setChanged(true);
    if (isWizard) fireWizardSave({ excludeDncOnlyCompetitors: next });
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
    await onChange({
      discardThresholds: ordered,
      proportionalDiscard: proportional,
      dnfScoring,
      excludeDncOnlyCompetitors: excludeDncOnly,
    });
    setChanged(false);
    setExpanded(false);
  }

  const described = describeDiscardRules(thresholds);
  const describedProportional = proportional ? describeProportionalDiscard(proportional) : null;

  const stepRules = (
    <>
      {thresholds.length === 0 ? (
        <p className="text-sm text-muted-foreground">No discards configured.</p>
      ) : (
        <div className="space-y-2">
          {thresholds.map((t, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center gap-2 text-sm">
                <span>With</span>
                <Input
                  type="number"
                  min={1}
                  aria-label={`Rule ${i + 1}: races sailed`}
                  value={t.minRaces || ''}
                  onChange={(e) => updateThreshold(i, 'minRaces', parseInt(e.target.value) || 0)}
                  className="h-8 w-14 text-sm"
                />
                <span>{t.minRaces === 1 ? 'race sailed, exclude' : 'races sailed, exclude'}</span>
                <Input
                  type="number"
                  min={0}
                  aria-label={`Rule ${i + 1}: discards`}
                  value={t.discardCount || ''}
                  onChange={(e) => updateThreshold(i, 'discardCount', parseInt(e.target.value) || 0)}
                  className="h-8 w-14 text-sm"
                />
                <span className="flex-1">{t.discardCount === 1 ? 'score' : 'scores'}</span>
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
              {described[i].warnings.map((warning) => (
                <p key={warning} className="text-xs text-amber-600 dark:text-amber-500">
                  {warning}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addThreshold}>
          Add rule
        </Button>
      </div>
    </>
  );

  const proportionalRule = (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-sm">
        <span>One discard per</span>
        <Input
          type="number"
          min={1}
          aria-label="Races per discard"
          value={proportional?.everyRaces || ''}
          onChange={(e) => updateProportionalField('everyRaces', parseInt(e.target.value) || 0)}
          className="h-8 w-14 text-sm"
        />
        <span>races sailed, from</span>
        <Input
          type="number"
          min={1}
          aria-label="Races before the first discard"
          value={proportional?.firstAt || ''}
          onChange={(e) => updateProportionalField('firstAt', parseInt(e.target.value) || 0)}
          className="h-8 w-14 text-sm"
        />
        <span>races</span>
      </div>
      {/* Two numbers don't show where the allowance actually steps up, and with
          no rows to read a range off that is the only check against the SI. */}
      {describedProportional?.stepsLabel && (
        <p className="text-xs text-muted-foreground">{describedProportional.stepsLabel}</p>
      )}
      {describedProportional?.warnings.map((warning) => (
        <p key={warning} className="text-xs text-amber-600 dark:text-amber-500">
          {warning}
        </p>
      ))}
    </div>
  );

  const thresholdTable = (
    <>
      <p className="text-xs text-muted-foreground">
        Discard rules — drop each competitor&apos;s worst race(s) from the series total.
      </p>
      {proportionalAllowed ? (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="radio"
                name="discardMode"
                checked={!proportional}
                onChange={() => updateProportional(undefined)}
              />
              A rule per step
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="radio"
                name="discardMode"
                checked={!!proportional}
                onChange={() => updateProportional(proportional ?? DEFAULT_PROPORTIONAL)}
              />
              One per so many races
            </label>
          </div>
          {proportional ? proportionalRule : stepRules}
        </>
      ) : proportional ? (
        // The rule is authored behind a gate, but a series that already carries
        // one scores with it regardless — so state it rather than showing an
        // empty threshold editor that misrepresents how the series is scored.
        <div className="space-y-1">
          <p className="text-sm">{summarizeProportionalDiscard(proportional)}</p>
          <p className="text-xs text-muted-foreground">
            This series uses a proportional discard rule. Turn on{' '}
            <strong className="text-foreground">Proportional discards</strong> in Workspace
            settings to edit it.
          </p>
        </div>
      ) : (
        stepRules
      )}
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
      <label className="flex items-start gap-3 cursor-pointer pt-2">
        <input
          type="checkbox"
          checked={excludeDncOnly}
          onChange={(e) => updateExcludeDncOnly(e.target.checked)}
          className="mt-0.5"
        />
        <div>
          <span className="text-sm font-medium">Rank only boats that took part</span>
          <p className="text-xs text-muted-foreground">
            A boat with no result other than DNC in any race is treated as not entered: left off the
            standings and out of the entry count that DNC and DNF points are based on, as if you had
            excluded it. It joins the moment it sails a race. Sailwave calls this “mark all un-sailed
            competitors as excluded”; a new sub-series starts from this setting.
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
  const discardSummary = value.proportionalDiscard
    ? summarizeProportionalDiscard(value.proportionalDiscard)
    : summarizeDiscardRules(value.discardThresholds ?? []);
  const summary =
    `${discardSummary} · ${dnfLabel}` +
    (value.excludeDncOnlyCompetitors ? ' · Rank only boats that took part' : '');

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
