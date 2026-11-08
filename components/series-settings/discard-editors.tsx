'use client';

import type { DiscardThreshold, ProportionalDiscard } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { describeCountBest, describeDiscardRules, describeProportionalDiscard } from '@/lib/discard-rules';

/**
 * The three ways of stating a discard allowance, as editors that hold no
 * state of their own: the Scoring card saves each change as it is made, and
 * the sub-series dialog keeps its draft until Save. A typed number reports
 * `defer`, so a caller that saves as it goes can coalesce the keystrokes.
 */

type ChangeOpts = { defer?: boolean };

const numberInput = 'h-8 w-14 text-base md:text-sm';
const warning = 'text-xs text-amber-600 dark:text-amber-500';

/** Thresholds: "With [5] races sailed, exclude [1] score", a row each. */
export function StepRulesEditor({
  thresholds,
  onChange,
}: {
  thresholds: DiscardThreshold[];
  onChange: (next: DiscardThreshold[], opts?: ChangeOpts) => void;
}) {
  const described = describeDiscardRules(thresholds);

  function updateThreshold(index: number, field: keyof DiscardThreshold, value: number) {
    onChange(thresholds.map((t, i) => (i === index ? { ...t, [field]: value } : t)), { defer: true });
  }

  function addThreshold() {
    const maxMinRaces = thresholds.reduce((m, t) => Math.max(m, t.minRaces), 0);
    const maxDiscardCount = thresholds.reduce((m, t) => Math.max(m, t.discardCount), 0);
    onChange([...thresholds, { minRaces: maxMinRaces + 1, discardCount: maxDiscardCount + 1 }]);
  }

  return (
    <>
      {thresholds.length === 0 ? (
        <p className="text-sm text-muted-foreground">No discards configured.</p>
      ) : (
        <div className="space-y-2">
          {thresholds.map((t, i) => (
            <div key={i} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>With</span>
                <Input
                  type="number"
                  min={1}
                  aria-label={`Rule ${i + 1}: races sailed`}
                  value={t.minRaces || ''}
                  onChange={(e) => updateThreshold(i, 'minRaces', parseInt(e.target.value) || 0)}
                  className={numberInput}
                />
                <span>{t.minRaces === 1 ? 'race sailed, exclude' : 'races sailed, exclude'}</span>
                <Input
                  type="number"
                  min={0}
                  aria-label={`Rule ${i + 1}: discards`}
                  value={t.discardCount || ''}
                  onChange={(e) => updateThreshold(i, 'discardCount', parseInt(e.target.value) || 0)}
                  className={numberInput}
                />
                <span className="flex-1">{t.discardCount === 1 ? 'score' : 'scores'}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove rule ${i + 1}`}
                  className="h-8 px-2 text-muted-foreground"
                  onClick={() => onChange(thresholds.filter((_, j) => j !== i))}
                >
                  ×
                </Button>
              </div>
              {described[i].warnings.map((w) => (
                <p key={w} className={warning}>{w}</p>
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
}

/** "One discard per [3] races sailed, from [3] races". */
export function ProportionalRuleEditor({
  rule,
  onChange,
}: {
  rule: ProportionalDiscard;
  onChange: (next: ProportionalDiscard, opts?: ChangeOpts) => void;
}) {
  const described = describeProportionalDiscard(rule);
  const update = (field: keyof ProportionalDiscard, value: number) =>
    onChange({ ...rule, [field]: value }, { defer: true });

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>One discard per</span>
        <Input
          type="number"
          min={1}
          aria-label="Races per discard"
          value={rule.everyRaces || ''}
          onChange={(e) => update('everyRaces', parseInt(e.target.value) || 0)}
          className={numberInput}
        />
        <span>races sailed, from</span>
        <Input
          type="number"
          min={1}
          aria-label="Races before the first discard"
          value={rule.firstAt || ''}
          onChange={(e) => update('firstAt', parseInt(e.target.value) || 0)}
          className={numberInput}
        />
        <span>races</span>
      </div>
      {/* Two numbers don't show where the allowance actually steps up, and with
          no rows to read a range off that is the only check against the SI. */}
      {described.stepsLabel && <p className="text-xs text-muted-foreground">{described.stepsLabel}</p>}
      {described.warnings.map((w) => (
        <p key={w} className={warning}>{w}</p>
      ))}
    </div>
  );
}

/** "Count the best [5] races", with what that gives the races there are. */
export function CountBestEditor({
  countBest,
  raceCount,
  scope = 'series',
  onChange,
}: {
  /** 0 while the box is cleared mid-edit. */
  countBest: number;
  /** The races the rule applies to, for its preview. */
  raceCount: number;
  scope?: 'series' | 'sub-series';
  onChange: (next: number) => void;
}) {
  const described = describeCountBest(countBest, raceCount, scope);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-sm">
        <span>Count the best</span>
        <Input
          type="number"
          min={1}
          aria-label="Races that count"
          value={countBest || ''}
          onChange={(e) => onChange(parseInt(e.target.value) || 0)}
          className={numberInput}
        />
        <span>races</span>
      </div>
      {/* One number: what it gives these races is the check against the SI. */}
      {described.preview && <p className="text-xs text-muted-foreground">{described.preview}</p>}
      {described.warnings.map((w) => (
        <p key={w} className={warning}>{w}</p>
      ))}
      <p className="text-xs text-muted-foreground">Each fleet discards the rest of the races it sailed.</p>
    </div>
  );
}
