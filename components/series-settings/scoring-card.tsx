'use client';

import { useState } from 'react';
import type { DiscardThreshold, ProportionalDiscard, Series } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  describeCountBest,
  describeDiscardRules,
  describeProportionalDiscard,
  summarizeCountBest,
  summarizeDiscardRules,
  summarizeProportionalDiscard,
} from '@/lib/discard-rules';
import { useFeatures } from '@/components/features-provider';
import { AutosaveNote } from '@/components/series-settings/autosave-note';
import { ScoringCodesLine } from '@/components/series-settings/scoring-codes-line';
import { codesSummary, codesSummaryText } from '@/lib/scoring-codes-text';
import { useSettingsAutosave } from '@/hooks/use-settings-autosave';
import { PointsSystemSection } from '@/components/series-settings/points-system-section';
import { highPointOf, pointsSystemFields, pointsSystemSummary, type PointsSystemFields } from '@/lib/high-point';

export type ScoringValues = Pick<Series, 'discardThresholds' | 'proportionalDiscard' | 'countBest' | 'dnfScoring' | 'excludeDncOnlyCompetitors' | 'scoringCodes' | 'pointsSystem' | 'highPointFormula' | 'pointForComingToStart'>;

/** What a scorer gets on switching to a proportional rule: one discard per
 *  three races sailed, the commonest wording found in club sailing
 *  instructions. */
const DEFAULT_PROPORTIONAL: ProportionalDiscard = { firstAt: 3, everyRaces: 3 };

/** What a scorer gets on switching to "count the best races": the number
 *  ISORA's season counts, and a round one to edit from. */
const DEFAULT_COUNT_BEST = 5;

/** The way a series states its discards; the stored fields decide it. */
type DiscardMode = 'steps' | 'proportional' | 'countBest';

/** The words for a rule the scorer can't edit here, because the gate that
 *  authors it is off. */
function lockedRuleSummary(countBest: number | undefined, proportional: ProportionalDiscard | undefined): string | null {
  if (countBest != null) return summarizeCountBest(countBest);
  if (proportional) return summarizeProportionalDiscard(proportional);
  return null;
}

/** Tidied into order when the card closes, and never before: a row that moves
 *  as its number is typed takes the next keystroke with it, and the engine
 *  sorts for itself either way. */
function orderThresholds(rows: DiscardThreshold[]): DiscardThreshold[] {
  return [...rows].sort((a, b) => a.minRaces - b.minRaces);
}

export type ScoringCardProps = {
  value: ScoringValues;
  /** The series, on its settings page: where the scoring codes are changed.
   *  Absent in the setup wizard, which leaves codes to the settings page. */
  seriesId?: string;
  onChange: (patch: Partial<ScoringValues>) => void | Promise<void>;
  mode?: 'settings' | 'wizard';
  /** The series' races, for saying what a count-best rule gives. Absent or
   *  zero, the card shows what the rule gives as a season grows instead. */
  raceCount?: number;
};

export function ScoringCard({ value, onChange, seriesId, mode = 'settings', raceCount = 0 }: ScoringCardProps) {
  const isWizard = mode === 'wizard';
  const { has } = useFeatures();
  const proportionalAllowed = has('proportional-discards');
  const [expanded, setExpanded] = useState(isWizard);
  const [thresholds, setThresholds] = useState<DiscardThreshold[]>(value.discardThresholds ?? []);
  const [proportional, setProportional] = useState<ProportionalDiscard | undefined>(value.proportionalDiscard);
  const [countBest, setCountBest] = useState<number | undefined>(value.countBest);
  const [dnfScoring, setDnfScoring] = useState<Series['dnfScoring']>(value.dnfScoring ?? 'seriesEntries');
  const [excludeDncOnly, setExcludeDncOnly] = useState(value.excludeDncOnlyCompetitors ?? false);
  const [points, setPoints] = useState<PointsSystemFields>(pointsSystemFields(value));
  const [codes, setCodes] = useState(value.scoringCodes ?? []);
  const highPointAllowed = has('high-point-scoring');
  const autosave = useSettingsAutosave<ScoringValues>({ save: onChange });

  // Re-sync the local draft when the persisted value changes identity (e.g.
  // opening a different series). Done via render-time compare rather than an
  // effect so it plays nicely with the React Compiler. See
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  // Only while the card is closed. Open, the draft is authoritative and its
  // edits are being persisted as they are made, so an echo of our own write —
  // which lands a beat after the edit that caused it — would reset the draft
  // backward and eat whatever was typed since. The same reasoning the wizard
  // path has always used.
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    if (!expanded) {
      setThresholds(value.discardThresholds ?? []);
      setProportional(value.proportionalDiscard);
      setCountBest(value.countBest);
      setDnfScoring(value.dnfScoring ?? 'seriesEntries');
      setExcludeDncOnly(value.excludeDncOnlyCompetitors ?? false);
      setPoints(pointsSystemFields(value));
    }
    // The codes are changed in their own dialog, which saves directly, so
    // they follow the series whether or not the card is open.
    setCodes(value.scoringCodes ?? []);
  }

  // Wizard-mode autosave fires onChange without awaiting (the input mustn't
  // block on the network). Wrap with a swallowing catch so a rejected save
  // — e.g. ConflictApiError — doesn't escape as an unhandled rejection.
  // Errors are surfaced globally by <ConflictNoticeProvider> in app/providers.
  function fireWizardSave(patch: Partial<ScoringValues>) {
    Promise.resolve(onChange(patch)).catch(() => {});
  }

  /** Rows carry typed numbers, so they are coalesced over a pause; everything
   *  else here is a radio or a checkbox and goes on the spot. */
  function updateThresholds(next: DiscardThreshold[], opts?: { defer?: boolean }) {
    setThresholds(next);
    if (isWizard) fireWizardSave({ discardThresholds: next });
    else autosave.commit({ discardThresholds: next }, opts);
  }

  function updateProportional(next: ProportionalDiscard | undefined, opts?: { defer?: boolean }) {
    setProportional(next);
    if (isWizard) fireWizardSave({ proportionalDiscard: next });
    else autosave.commit({ proportionalDiscard: next }, opts);
  }

  /** Typed, so coalesced like the rows. A count cleared mid-edit is held as 0
   *  rather than dropped, which would quietly switch the series back to its
   *  step rules while the scorer is still typing. */
  function updateCountBest(next: number) {
    setCountBest(next);
    if (next < 1) return;
    if (isWizard) fireWizardSave({ countBest: next });
    else autosave.commit({ countBest: next }, { defer: true });
  }

  /** Choosing a mode is what selects it. The count-best rule wins over a
   *  proportional one, so switching to it leaves the proportional rule to come
   *  back to; switching away from it clears it. Step rules are always kept. */
  function chooseMode(next: DiscardMode) {
    const patch: Partial<ScoringValues> =
      next === 'countBest'
        ? { countBest: countBest && countBest >= 1 ? countBest : DEFAULT_COUNT_BEST }
        : next === 'proportional'
          ? { countBest: undefined, proportionalDiscard: proportional ?? DEFAULT_PROPORTIONAL }
          : { countBest: undefined, proportionalDiscard: undefined };
    if ('countBest' in patch) setCountBest(patch.countBest);
    if ('proportionalDiscard' in patch) setProportional(patch.proportionalDiscard);
    if (isWizard) fireWizardSave(patch);
    else autosave.commit(patch);
  }

  function updateProportionalField(field: keyof ProportionalDiscard, fieldValue: number) {
    updateProportional(
      { ...(proportional ?? DEFAULT_PROPORTIONAL), [field]: fieldValue },
      { defer: true },
    );
  }

  function updateDnf(next: Series['dnfScoring']) {
    setDnfScoring(next);
    if (isWizard) fireWizardSave({ dnfScoring: next });
    else autosave.commit({ dnfScoring: next });
  }

  /** A choice of points system goes on the spot, with the built-in codes
   *  reset when it changes their defaults. */
  function updatePoints(patch: PointsSystemFields & { scoringCodes?: Series['scoringCodes'] }) {
    setPoints(pointsSystemFields(patch));
    if (patch.scoringCodes) setCodes(patch.scoringCodes);
    if (isWizard) fireWizardSave(patch);
    else autosave.commit(patch);
  }

  function updateExcludeDncOnly(next: boolean) {
    setExcludeDncOnly(next);
    if (isWizard) fireWizardSave({ excludeDncOnlyCompetitors: next });
    else autosave.commit({ excludeDncOnlyCompetitors: next });
  }

  function updateThreshold(index: number, field: keyof DiscardThreshold, value: number) {
    updateThresholds(
      thresholds.map((t, i) => i === index ? { ...t, [field]: value } : t),
      { defer: true },
    );
  }

  function addThreshold() {
    const maxMinRaces = thresholds.reduce((m, t) => Math.max(m, t.minRaces), 0);
    const maxDiscardCount = thresholds.reduce((m, t) => Math.max(m, t.discardCount), 0);
    updateThresholds([...thresholds, { minRaces: maxMinRaces + 1, discardCount: maxDiscardCount + 1 }]);
  }

  function removeThreshold(index: number) {
    updateThresholds(thresholds.filter((_, i) => i !== index));
  }



  const described = describeDiscardRules(thresholds);
  const describedProportional = proportional ? describeProportionalDiscard(proportional) : null;
  const discardMode: DiscardMode = countBest != null ? 'countBest' : proportional ? 'proportional' : 'steps';
  const describedCountBest = countBest != null ? describeCountBest(countBest, raceCount) : null;

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

  const countBestRule = (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-sm">
        <span>Count the best</span>
        <Input
          type="number"
          min={1}
          aria-label="Races that count"
          value={countBest || ''}
          onChange={(e) => updateCountBest(parseInt(e.target.value) || 0)}
          className="h-8 w-14 text-base md:text-sm"
        />
        <span>races</span>
      </div>
      {/* One number: what it gives this series is the check against the SI. */}
      {describedCountBest?.preview && (
        <p className="text-xs text-muted-foreground">{describedCountBest.preview}</p>
      )}
      {describedCountBest?.warnings.map((warning) => (
        <p key={warning} className="text-xs text-amber-600 dark:text-amber-500">
          {warning}
        </p>
      ))}
      <p className="text-xs text-muted-foreground">
        Each fleet discards the rest of the races it sailed.
      </p>
    </div>
  );

  const lockedRule = lockedRuleSummary(countBest, proportional);

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
                checked={discardMode === 'steps'}
                onChange={() => chooseMode('steps')}
              />
              A rule per step
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="radio"
                name="discardMode"
                checked={discardMode === 'proportional'}
                onChange={() => chooseMode('proportional')}
              />
              One per so many races
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="radio"
                name="discardMode"
                checked={discardMode === 'countBest'}
                onChange={() => chooseMode('countBest')}
              />
              Count the best races
            </label>
          </div>
          {discardMode === 'countBest' ? countBestRule : discardMode === 'proportional' ? proportionalRule : stepRules}
        </>
      ) : lockedRule ? (
        // The rules are authored behind a gate, but a series that already
        // carries one scores with it regardless — so state it rather than
        // showing an empty threshold editor that misrepresents how the series
        // is scored.
        <div className="space-y-1">
          <p className="text-sm">{lockedRule}</p>
          <p className="text-xs text-muted-foreground">
            This series states its discards another way. Turn on{' '}
            <strong className="text-foreground">Alternative discard rules</strong> in Workspace
            settings to edit it.
          </p>
        </div>
      ) : (
        stepRules
      )}
    </>
  );

  const pointsChoice = (
    <PointsSystemSection
      value={points}
      dnfScoring={dnfScoring}
      scoringCodes={codes}
      hasRaces={!isWizard && raceCount > 0}
      allowed={highPointAllowed}
      onChange={updatePoints}
    />
  );
  const highPoint = highPointOf(points);

  // A5.2 and A5.3 are low-point rules; in high point the code table says what
  // each code scores.
  const dnfRadios = (
    <div className="space-y-2 pt-1">
      {!highPoint && (
      <>
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
      </>
      )}
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
        {pointsChoice}
        {thresholdTable}
        {dnfRadios}
      </div>
    );
  }

  const dnfMode = value.dnfScoring ?? 'seriesEntries';
  const valueHighPoint = highPointOf(value);
  // In high point the system leads; A5's DNF base means nothing there.
  const dnfLabel = valueHighPoint
    ? pointsSystemSummary(value)
    : dnfMode === 'startingArea' ? 'DNF: starting area' : 'DNF: series entries';
  const discardSummary =
    lockedRuleSummary(value.countBest, value.proportionalDiscard)
    ?? summarizeDiscardRules(value.discardThresholds ?? []);
  const codesText = codesSummaryText(codesSummary(dnfMode, value.scoringCodes, valueHighPoint));
  const summary =
    (valueHighPoint ? `${dnfLabel} · ${discardSummary}` : `${discardSummary} · ${dnfLabel}`) +
    (value.excludeDncOnlyCompetitors ? ' · Rank only boats that took part' : '') +
    (codesText ? ` · Codes: ${codesText}` : '');

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
        <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
          {pointsChoice}
          {thresholdTable}
          {dnfRadios}
          {seriesId && (
            <ScoringCodesLine seriesId={seriesId} dnfScoring={dnfMode} scoringCodes={value.scoringCodes} highPoint={valueHighPoint} />
          )}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                // The tidy happens here, where a row moving costs nobody a
                // keystroke because the card is closing.
                autosave.commit({ discardThresholds: orderThresholds(thresholds) });
                autosave.flush();
                setExpanded(false);
              }}
            >
              Done
            </Button>
            <AutosaveNote status={autosave.status} />
          </div>
        </form>
      )}
    </div>
  );
}
