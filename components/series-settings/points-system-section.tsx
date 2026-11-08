'use client';

import type { DnfScoring, HighPointFormula, SeriesScoringCode } from '@/lib/types';
import { highPointOf, pointsSystemFields, pointsSystemSummary, type PointsSystemFields } from '@/lib/high-point';
import { highPointPreview } from '@/lib/scoring-codes-text';
import { CHANGEABLE_BUILT_IN_CODES } from '@/lib/scoring-codes';
import { useConfirm } from '@/components/confirm-dialog';

const hint = 'text-xs text-muted-foreground';

/** The words that say what a points system does, for the confirmation and
 *  the radios' hints. */
function describe(f: PointsSystemFields): string {
  const hp = highPointOf(f);
  if (!hp) return 'Scores will be recomputed low point (RRS Appendix A): 1st scores 1, 2nd 2, and the lowest total wins.';
  if (hp.formula === 'chips3') {
    return 'Scores will be recomputed high point with CHIPS3: a win scores 86 to 100 whatever the fleet size, and the highest total wins.';
  }
  return `Scores will be recomputed high point: 1 point for finishing and 1 for each boat beaten${hp.pointForComingToStart ? ', and 1 for coming to the start' : ''}, and the highest total wins.`;
}

/** What resetting the built-in codes means under the new system. */
function codesReset(f: PointsSystemFields): string {
  const hp = highPointOf(f);
  if (!hp) return 'Built-in scoring codes will be reset to the RRS.';
  if (hp.formula === 'chips3') {
    return 'Built-in scoring codes will be reset to CHIPS3’s defaults: DNC, DNS and disqualifications 0, a retirement the place after the last boat.';
  }
  return 'Built-in scoring codes will be reset to the high-point defaults: DNC 0, the other codes the place after the last boat.';
}

export type PointsSystemSectionProps = {
  value: PointsSystemFields;
  dnfScoring: DnfScoring;
  scoringCodes: readonly SeriesScoringCode[];
  /** Whether the series has races, so a change rescores something and is
   *  asked about first. */
  hasRaces: boolean;
  /** The gate: off, a high-point series states its system and a low-point
   *  one shows nothing. */
  allowed: boolean;
  onChange: (patch: PointsSystemFields & { scoringCodes?: SeriesScoringCode[] }) => void;
};

/**
 * The Scoring card's Points choice: low point (RRS Appendix A) or high point,
 * boats beaten or CHIPS3, and boats beaten's point for coming to the start.
 * A change that moves the built-in codes' defaults — the system or the
 * formula — resets the series' changes to them and keeps its own codes; on a
 * series with races it says so and asks first.
 */
export function PointsSystemSection({ value, dnfScoring, scoringCodes, hasRaces, allowed, onChange }: PointsSystemSectionProps) {
  const confirm = useConfirm();
  const current = pointsSystemFields(value);
  const hp = highPointOf(current);

  if (!allowed) {
    if (!hp) return null;
    return (
      <div className="space-y-1" data-testid="points-system-locked">
        <p className="text-sm">{pointsSystemSummary(current)}: the highest total wins.</p>
        <p className={hint}>
          Turn on <strong className="text-foreground">High-point scoring</strong> in Workspace settings to change it.
        </p>
      </div>
    );
  }

  async function choose(next: PointsSystemFields) {
    const n = pointsSystemFields(next);
    const resetsCodes = n.pointsSystem !== current.pointsSystem || n.highPointFormula !== current.highPointFormula;
    const changedBuiltIns = scoringCodes.filter((c) => CHANGEABLE_BUILT_IN_CODES.includes(c.code));
    if (hasRaces) {
      const ok = await confirm({
        title: n.pointsSystem === 'highPoint' && current.pointsSystem !== 'highPoint'
          ? 'Score this series high point?'
          : n.pointsSystem !== 'highPoint' && current.pointsSystem === 'highPoint'
            ? 'Score this series low point?'
            : 'Change how high point scores?',
        description: (
          <>
            {describe(n)}
            {resetsCodes && changedBuiltIns.length > 0 ? ` ${codesReset(n)}` : ''}
            {resetsCodes && scoringCodes.length > changedBuiltIns.length ? ' The series’ own codes are kept.' : ''}
          </>
        ),
        confirmLabel: 'Rescore',
      });
      if (!ok) return;
    }
    onChange({
      ...n,
      ...(resetsCodes && changedBuiltIns.length > 0
        ? { scoringCodes: scoringCodes.filter((c) => !CHANGEABLE_BUILT_IN_CODES.includes(c.code)) }
        : {}),
    });
  }

  const formula: HighPointFormula = current.highPointFormula ?? 'boatsBeaten';
  const preview = hp ? highPointPreview(dnfScoring, scoringCodes, hp) : null;

  return (
    <fieldset className="space-y-2" data-testid="points-system">
      <legend className="text-sm font-medium">Points</legend>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="radio"
          name="pointsSystem"
          checked={!hp}
          onChange={() => void choose({ pointsSystem: undefined })}
          className="mt-0.5"
        />
        <span className="text-sm">
          Low point <span className="text-muted-foreground">— RRS Appendix A. 1st scores 1, 2nd 2, … lowest total wins</span>
        </span>
      </label>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="radio"
          name="pointsSystem"
          checked={!!hp}
          onChange={() => void choose({ pointsSystem: 'highPoint', highPointFormula: 'boatsBeaten' })}
          className="mt-0.5"
        />
        <span className="text-sm">
          High point <span className="text-muted-foreground">— highest total wins</span>
        </span>
      </label>
      {hp && preview && (
        <div className="ml-6 space-y-2">
          <p className="text-xs font-medium">Formula</p>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="highPointFormula"
              checked={formula === 'boatsBeaten'}
              onChange={() => void choose({ pointsSystem: 'highPoint', highPointFormula: 'boatsBeaten' })}
              className="mt-0.5"
            />
            <span className="text-sm">
              Boats beaten <span className="text-muted-foreground">— 1 point for finishing and 1 for each boat beaten</span>
            </span>
          </label>
          {formula === 'boatsBeaten' && (
            <label className="ml-6 flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={hp.pointForComingToStart}
                onChange={(e) => void choose({ pointsSystem: 'highPoint', highPointFormula: 'boatsBeaten', pointForComingToStart: e.target.checked })}
                className="mt-0.5"
              />
              <span className="text-sm">And 1 point for coming to the start <span className="text-muted-foreground">(HalSail’s HP scoring)</span></span>
            </label>
          )}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="highPointFormula"
              checked={formula === 'chips3'}
              onChange={() => void choose({ pointsSystem: 'highPoint', highPointFormula: 'chips3' })}
              className="mt-0.5"
            />
            <span className="text-sm">
              CHIPS3 <span className="text-muted-foreground">— a win scores 86 to 100 whatever the fleet size (ISORA)</span>
            </span>
          </label>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">What a race scores:</p>
            <table className="text-xs tabular-nums" data-testid="high-point-preview">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="pr-3 text-left font-normal">boats in race</th>
                  {preview.sizes.map((n) => <th key={n} className="px-2 text-right font-normal">{n}</th>)}
                </tr>
              </thead>
              <tbody>
                {([['1st', preview.first], [formula === 'chips3' ? 'last' : 'last, all finishing', preview.last], ['DNF', preview.dnf]] as const).map(([label, row]) => (
                  <tr key={label}>
                    <td className="pr-3">{label}</td>
                    {row.map((p, i) => <td key={i} className="px-2 text-right">{p}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={hint}>
              Then × the race’s weighting (Race → Scoring options). The fleet size counts finishers and the codes
              marked to count — see Scoring codes.
            </p>
          </div>
        </div>
      )}
    </fieldset>
  );
}
