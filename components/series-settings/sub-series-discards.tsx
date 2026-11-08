'use client';

import type { DiscardThreshold, ProportionalDiscard, SubSeriesDiscards } from '@/lib/types';
import type { ReactNode } from 'react';
import { CountBestEditor, ProportionalRuleEditor, StepRulesEditor } from '@/components/series-settings/discard-editors';

/** Where the sub-series dialog's discard choice stands while it is open. Each
 *  rule keeps what was typed into it, so trying another choice and coming
 *  back loses nothing; only the chosen one is saved. */
export type SubSeriesDiscardsDraft = {
  choice: 'series' | 'none' | 'countBest' | 'own';
  /** How "its own rule" is stated. */
  ownKind: 'steps' | 'proportional';
  /** 0 while the box is cleared mid-edit. */
  countBest: number;
  thresholds: DiscardThreshold[];
  proportional: ProportionalDiscard;
};

/** What a scorer gets on first choosing "count the best": ISORA's coastal
 *  series count their best 3. */
const DEFAULT_COUNT_BEST = 3;
const DEFAULT_PROPORTIONAL: ProportionalDiscard = { firstAt: 3, everyRaces: 3 };

/** The draft for a sub-series' stored rule. A rule of its own starts from
 *  the series' thresholds, the likeliest place to begin editing. */
export function subSeriesDiscardsDraft(
  discards: SubSeriesDiscards | undefined,
  seriesThresholds: DiscardThreshold[],
): SubSeriesDiscardsDraft {
  const draft: SubSeriesDiscardsDraft = {
    choice: 'series',
    ownKind: 'steps',
    countBest: DEFAULT_COUNT_BEST,
    thresholds: seriesThresholds,
    proportional: DEFAULT_PROPORTIONAL,
  };
  switch (discards?.kind) {
    case undefined:
      return draft;
    case 'none':
      return { ...draft, choice: 'none' };
    case 'countBest':
      return { ...draft, choice: 'countBest', countBest: discards.countBest };
    case 'steps':
      return { ...draft, choice: 'own', thresholds: discards.thresholds };
    case 'proportional':
      return {
        ...draft,
        choice: 'own',
        ownKind: 'proportional',
        proportional: { firstAt: discards.firstAt, everyRaces: discards.everyRaces },
      };
  }
}

/** The rule to save, or what stops it being saved. Absent means the
 *  series' rule. */
export function subSeriesDiscardsOfDraft(
  draft: SubSeriesDiscardsDraft,
): { discards?: SubSeriesDiscards; error?: string } {
  switch (draft.choice) {
    case 'series':
      return {};
    case 'none':
      return { discards: { kind: 'none' } };
    case 'countBest':
      return draft.countBest >= 1
        ? { discards: { kind: 'countBest', countBest: draft.countBest } }
        : { error: 'Enter how many races count — at least 1.' };
    case 'own':
      if (draft.ownKind === 'proportional') {
        const { firstAt, everyRaces } = draft.proportional;
        return everyRaces >= 1
          ? { discards: { kind: 'proportional', firstAt, everyRaces } }
          : { error: 'Enter how many races earn each further discard.' };
      }
      return {
        discards: {
          kind: 'steps',
          thresholds: [...draft.thresholds].sort((a, b) => a.minRaces - b.minRaces),
        },
      };
  }
}

/**
 * The sub-series dialog's Discards choice: the series' rule, none, the best N
 * races, or a rule of its own. Count-best and proportional rules are offered
 * behind the gate that authors them on the Scoring card, and shown whenever
 * the sub-series already has one.
 */
export function SubSeriesDiscardsSection({
  draft,
  onChange,
  seriesSummary,
  raceCount,
  alternativeAllowed,
}: {
  draft: SubSeriesDiscardsDraft;
  onChange: (next: SubSeriesDiscardsDraft) => void;
  /** The series' rule in a line: "Best 5 count". */
  seriesSummary: string;
  /** The races selected for the sub-series, for the count-best preview. */
  raceCount: number;
  alternativeAllowed: boolean;
}) {
  const set = (patch: Partial<SubSeriesDiscardsDraft>) => onChange({ ...draft, ...patch });
  const showCountBest = alternativeAllowed || draft.choice === 'countBest';
  const showProportional = alternativeAllowed || draft.ownKind === 'proportional';

  const radio = (choice: SubSeriesDiscardsDraft['choice'], label: ReactNode) => (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input
        type="radio"
        name="subSeriesDiscards"
        className="mt-0.5"
        checked={draft.choice === choice}
        onChange={() => set({ choice })}
      />
      <span>{label}</span>
    </label>
  );

  return (
    <fieldset className="space-y-1.5" data-testid="sub-series-discards">
      <legend className="text-sm font-medium leading-none">Discards</legend>
      <div className="space-y-1.5 rounded-md border p-2">
        {radio('series', <>As the series <span className="text-muted-foreground">— {seriesSummary}</span></>)}
        {radio('none', <>No discards <span className="text-muted-foreground">— every race counts</span></>)}
        {showCountBest && radio('countBest', 'Count the best races')}
        {draft.choice === 'countBest' && (
          <div className="ml-6">
            <CountBestEditor
              countBest={draft.countBest}
              raceCount={raceCount}
              scope="sub-series"
              onChange={(countBest) => set({ countBest })}
            />
          </div>
        )}
        {radio('own', 'Its own rule')}
        {draft.choice === 'own' && (
          <div className="ml-6 space-y-2">
            {showProportional && (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="subSeriesOwnDiscards"
                    checked={draft.ownKind === 'steps'}
                    onChange={() => set({ ownKind: 'steps' })}
                  />
                  A rule per step
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="subSeriesOwnDiscards"
                    checked={draft.ownKind === 'proportional'}
                    onChange={() => set({ ownKind: 'proportional' })}
                  />
                  One per so many races
                </label>
              </div>
            )}
            {draft.ownKind === 'proportional' ? (
              <ProportionalRuleEditor rule={draft.proportional} onChange={(proportional) => set({ proportional })} />
            ) : (
              <StepRulesEditor thresholds={draft.thresholds} onChange={(thresholds) => set({ thresholds })} />
            )}
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        A sub-series takes the series&apos; discards over its own races unless it states its own:
        a coastal series counting its best 3 inside a season counting its best 5.
      </p>
    </fieldset>
  );
}
