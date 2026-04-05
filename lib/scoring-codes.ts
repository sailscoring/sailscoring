/**
 * Scoring code definitions (Option B from docs/design/scoring-codes.md).
 *
 * Every result code — including all standard RRS codes — is modelled as a
 * ScoringCodeDefinition record. The scoring engine reads these properties at
 * runtime rather than branching on code strings.
 *
 * Built-in definitions ship as a static asset (this file). The engine merges
 * them with any user-defined codes at scoring time. builtIn: true definitions
 * are read-only in the UI.
 */

export type PointsMethod =
  // Standard position-replacing: the boat receives N+1 penalty points.
  // penaltyBase 'entries' → always series entries + 1 (e.g. DNC, BFD).
  // penaltyBase 'starters' → subject to the series dnfScoring setting:
  //   'seriesEntries' (A5.2, default) → entries + 1
  //   'startingArea'  (A5.3)          → starting-area count + 1
  | { type: 'fixed_penalty'; penaltyBase: 'entries' | 'starters' }
  // Additive penalty (applied on top of finish place; A6.2: other scores unchanged).
  // Formula (rule 44.3(c)): min(place + round(pct/100 × dnfScore), dnfScore)
  // penaltyOverride on Finish overrides defaultPct for SCP.
  | { type: 'additive_percentage'; defaultPct: number }
  // Discretionary Points Increase: min(place + override, dnfScore)
  // Finish.penaltyOverride is the stated points to add.
  | { type: 'additive_stated' };
  // Phase 3: redress

export interface ScoringCodeDefinition {
  code: string;
  name: string;
  builtIn: boolean;
  pointsMethod: PointsMethod;
  /** Whether the score for this code can be selected as a discard. */
  discardable: boolean;
  /**
   * RRS A6.2: when true, other boats' scores are not recalculated when this
   * code is applied (two boats may share the same score). Phase 2 concern.
   */
  otherScoresUnchanged: boolean;
}

export const BUILT_IN_CODES: readonly ScoringCodeDefinition[] = [
  {
    code: 'DNC',
    name: 'Did Not Come to start area',
    builtIn: true,
    pointsMethod: { type: 'fixed_penalty', penaltyBase: 'entries' },
    discardable: true,
    otherScoresUnchanged: false,
  },
  {
    code: 'DNS',
    name: 'Did Not Start',
    builtIn: true,
    pointsMethod: { type: 'fixed_penalty', penaltyBase: 'starters' },
    discardable: true,
    otherScoresUnchanged: false,
  },
  {
    code: 'OCS',
    name: 'On Course Side',
    builtIn: true,
    pointsMethod: { type: 'fixed_penalty', penaltyBase: 'starters' },
    discardable: true,
    otherScoresUnchanged: false,
  },
  {
    code: 'NSC',
    name: 'Did Not Sail the Course',
    builtIn: true,
    pointsMethod: { type: 'fixed_penalty', penaltyBase: 'starters' },
    discardable: true,
    otherScoresUnchanged: false,
  },
  {
    code: 'DNF',
    name: 'Did Not Finish',
    builtIn: true,
    pointsMethod: { type: 'fixed_penalty', penaltyBase: 'starters' },
    discardable: true,
    otherScoresUnchanged: false,
  },
  {
    code: 'RET',
    name: 'Retired',
    builtIn: true,
    pointsMethod: { type: 'fixed_penalty', penaltyBase: 'starters' },
    discardable: true,
    otherScoresUnchanged: false,
  },
  {
    code: 'DSQ',
    name: 'Disqualified',
    builtIn: true,
    pointsMethod: { type: 'fixed_penalty', penaltyBase: 'starters' },
    discardable: true,
    otherScoresUnchanged: false,
  },
  {
    code: 'DNE',
    name: 'Disqualification Not Excludable',
    builtIn: true,
    pointsMethod: { type: 'fixed_penalty', penaltyBase: 'starters' },
    discardable: false,
    otherScoresUnchanged: false,
  },
  {
    code: 'UFD',
    name: 'U Flag Disqualification',
    builtIn: true,
    pointsMethod: { type: 'fixed_penalty', penaltyBase: 'starters' },
    discardable: true,
    otherScoresUnchanged: false,
  },
  {
    code: 'BFD',
    name: 'Black Flag Disqualification',
    builtIn: true,
    // Rule 30.4 boats are penalised at entries+1 (same as DNC) — the higher
    // of the two possible penalty bases — since the infringement is
    // pre-start and cannot be discarded in any case.
    pointsMethod: { type: 'fixed_penalty', penaltyBase: 'entries' },
    discardable: false,
    otherScoresUnchanged: false,
  },
  // ── Additive penalty codes (Phase 2) ───────────────────────────────────────
  {
    code: 'ZFP',
    name: 'Two-Turns Penalty',
    builtIn: true,
    // Rule 44.3(a): 20% of the DNF score, added to finish place (no override).
    pointsMethod: { type: 'additive_percentage', defaultPct: 20 },
    discardable: true,
    otherScoresUnchanged: true,   // A6.2: other boats keep their scores
  },
  {
    code: 'SCP',
    name: 'Scoring Penalty',
    builtIn: true,
    // PC-imposed scoring penalty; default 20% but Finish.penaltyOverride can specify a different %.
    pointsMethod: { type: 'additive_percentage', defaultPct: 20 },
    discardable: true,
    otherScoresUnchanged: true,
  },
  {
    code: 'DPI',
    name: 'Discretionary Points Increase',
    builtIn: true,
    // PC-specified points added; Finish.penaltyOverride is the stated amount.
    pointsMethod: { type: 'additive_stated' },
    discardable: true,
    otherScoresUnchanged: true,
  },
];

const BUILT_IN_MAP = new Map(BUILT_IN_CODES.map((d) => [d.code, d]));

/**
 * Look up a scoring code definition. Custom codes (Phase 4) can be passed as
 * the second argument; they take precedence over built-in codes.
 */
export function getCodeDefinition(
  code: string,
  customCodes: readonly ScoringCodeDefinition[] = [],
): ScoringCodeDefinition | undefined {
  for (const def of customCodes) {
    if (def.code === code) return def;
  }
  return BUILT_IN_MAP.get(code);
}
