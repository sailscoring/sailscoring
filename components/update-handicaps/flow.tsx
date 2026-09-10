'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCompetitorsBySeries, useUpdateHandicaps } from '@/hooks/use-competitors';
import { useFleetsBySeries } from '@/hooks/use-fleets';
import { useFeatures } from '@/components/features-provider';
import { ConflictApiError } from '@/lib/api-client';
import type { HandicapUpdateRow } from '@/lib/api-repository';
import type { RatingSystemCode } from '@/lib/competitor-ratings';
import type { FeatureKey } from '@/lib/features';
import type { HandicapSystem } from '@/lib/source-handicaps';

import { IrcRatingSourceStep } from './irc-rating-source-step';
import { OrcSourceStep } from './orc-source-step';
import { IrishSailingSourceStep } from './irish-sailing-source-step';
import { RyaPySourceStep } from './rya-py-source-step';
import { SeriesSourceStep } from './series-source-step';
import { SourcePickerStep } from './source-picker-step';
import { SYSTEM_LABEL, type ApplyOutcome, type HandicapSource } from './shared';
import { VprsSourceStep } from './vprs-source-step';

/** Dialog sizing the flow expects of whatever `DialogContent` hosts it: a
 *  three-row grid (header / scrolling body / footer) wide enough for a
 *  preview table. Shared so the importer's ratings step matches the
 *  standalone dialog. */
export const UPDATE_HANDICAPS_CONTENT_CLASS =
  'grid-rows-[auto_minmax(0,1fr)_auto] max-h-[90vh] w-[95vw] max-w-5xl sm:max-w-5xl';

/**
 * The source that fills in each rating system, for a caller that knows which
 * rating is missing and wants to go straight there — the competitor importer's
 * last step. Keyed by the systems a published list or certificate database can
 * fill (`SOURCED_RATING_SYSTEMS`); the `feature` is the gate that must be on,
 * the same one the picker honours.
 *
 * `pitch` says what the source actually does for this system, and differs
 * because the sources differ: IRC and ORC settle fleet membership as well as
 * ratings, Irish Sailing can only add, and the PY list is matched by class.
 */
export const SOURCE_FOR_SYSTEM: Partial<
  Record<
    RatingSystemCode,
    { source: HandicapSource; feature: FeatureKey; action: string; pitch: string }
  >
> = {
  irc: {
    source: 'irc-rating',
    feature: 'irc-rating',
    action: 'Fetch IRC TCCs',
    pitch:
      "The IRC list is the first thing that knows who holds a certificate: it fills in the TCCs it has, and offers the boats it doesn't rate for removal from the fleet.",
  },
  orc: {
    source: 'orc',
    feature: 'orc',
    action: 'Import ORC certificates',
    pitch:
      'The ORC database is the first thing that knows who holds a certificate: it imports the ones it has, and offers the boats with no certificate for removal from the fleet.',
  },
  echo: {
    source: 'irish-sailing',
    feature: 'echo',
    action: 'Fetch ECHO handicaps',
    pitch:
      "The Irish Sailing list carries each rated boat's current ECHO handicap, matched by sail number.",
  },
  vprs: {
    source: 'vprs-rating',
    feature: 'vprs',
    action: 'Fetch VPRS TCCs',
    pitch:
      "A club's published VPRS list carries each rated boat's current TCC, matched by sail number.",
  },
  py: {
    source: 'rya-py',
    feature: 'rya-py',
    action: 'Fetch PY numbers',
    pitch:
      "The RYA's published list sets each class's PY number, matched by boat class rather than sail number.",
  },
};

type Step =
  | 'source-picker'
  | 'source-series'
  | 'source-irish-sailing'
  | 'source-irc-rating'
  | 'source-vprs'
  | 'source-rya-py'
  | 'source-orc'
  | 'done';

/** The step that runs a given source. */
function stepForSource(source: HandicapSource): Step {
  switch (source) {
    case 'irc-rating':
      return 'source-irc-rating';
    case 'vprs-rating':
      return 'source-vprs';
    case 'irish-sailing':
      return 'source-irish-sailing';
    case 'rya-py':
      return 'source-rya-py';
    case 'orc':
      return 'source-orc';
    case 'series':
      return 'source-series';
  }
}

/**
 * The Update Handicaps flow: the source picker, the per-source steps, the apply
 * mutation (with its 409 handling) and the done summary. Rendered inside a
 * `DialogContent` the caller owns — the standalone dialog in `index.tsx`, or
 * the competitor importer's last step.
 *
 * Everything about how a source loads data and plans its update rows lives in
 * the per-source step components; adding a source means adding one step
 * component and one picker entry here.
 *
 * The flow holds no state that should outlive the dialog, so a caller gets a
 * fresh one by mounting it. `freezeScoredRaces` is the exception — it is the
 * one choice that deliberately survives reopening — so it is the caller's.
 */
export function UpdateHandicapsFlow({
  seriesId,
  initialSource,
  freezeScoredRaces,
  onFreezeScoredRacesChange,
  onCancel,
  onFinish,
}: {
  seriesId: string;
  /** Start at one source's step rather than the picker. The caller already
   *  knows which rating is missing, so asking again would be a step backwards. */
  initialSource?: HandicapSource;
  freezeScoredRaces: boolean;
  onFreezeScoredRacesChange: (value: boolean) => void;
  /** Left without applying anything. */
  onCancel: () => void;
  /** Finished with the flow, having applied (or not). */
  onFinish: () => void;
}) {
  const { has } = useFeatures();
  // ECHO is the single Irish/ECHO gate — it covers both the scoring system
  // and this Irish Sailing ECHO source. IRC TCC is gated separately (on by
  // default).
  const irishSailingEnabled = has('echo');
  const ircRatingEnabled = has('irc-rating');
  const ryaPyEnabled = has('rya-py');
  const vprsRatingEnabled = has('vprs');
  const orcEnabled = has('orc');

  const [step, setStep] = useState<Step>(
    initialSource ? stepForSource(initialSource) : 'source-picker',
  );
  const [source, setSource] = useState<HandicapSource>(initialSource ?? 'series');
  const [result, setResult] = useState<(ApplyOutcome & { updatedCount: number }) | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Target data (the active series), shared by every step.
  const targetCompetitors = useCompetitorsBySeries(seriesId);
  const targetFleets = useFleetsBySeries(seriesId);

  const updateMut = useUpdateHandicaps(seriesId);

  async function handleApply(rows: HandicapUpdateRow[], outcome: ApplyOutcome) {
    setErrorMsg(null);
    if (rows.length === 0) return;
    try {
      const response = await updateMut.mutateAsync({
        updates: rows,
        freezeScoredRaces,
      });
      setResult({ updatedCount: response.updated.length, ...outcome });
      setStep('done');
    } catch (err) {
      if (err instanceof ConflictApiError) {
        setErrorMsg(
          'A boat was modified elsewhere since you opened this dialog. Close and reopen to refresh, then try again.',
        );
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Update failed');
      }
    }
  }

  const stepProps = {
    seriesId,
    competitors: targetCompetitors.data,
    fleets: targetFleets.data,
    applying: updateMut.isPending,
    errorMsg,
    onApply: handleApply,
    onCancel,
  };

  return (
    <>
      {step === 'source-picker' && (
        <SourcePickerStep
          source={source}
          onSelect={setSource}
          gates={{
            irishSailing: irishSailingEnabled,
            ircRating: ircRatingEnabled,
            ryaPy: ryaPyEnabled,
            vprsRating: vprsRatingEnabled,
            orc: orcEnabled,
          }}
          onNext={() => setStep(stepForSource(source))}
          onCancel={onCancel}
        />
      )}

      {step === 'source-series' && (
        <SeriesSourceStep
          {...stepProps}
          freezeScoredRaces={freezeScoredRaces}
          onFreezeScoredRacesChange={onFreezeScoredRacesChange}
        />
      )}
      {step === 'source-irc-rating' && <IrcRatingSourceStep {...stepProps} />}
      {step === 'source-vprs' && <VprsSourceStep {...stepProps} />}
      {step === 'source-irish-sailing' && <IrishSailingSourceStep {...stepProps} />}
      {step === 'source-rya-py' && <RyaPySourceStep {...stepProps} />}
      {step === 'source-orc' && <OrcSourceStep {...stepProps} />}

      {step === 'done' && result && (
        <>
          <DialogHeader>
            <DialogTitle>Handicaps updated</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2 text-sm min-h-0 overflow-y-auto">
            <p>
              Updated <strong>{result.updatedCount}</strong> starting handicap
              {result.updatedCount === 1 ? '' : 's'}.
            </p>
            <ul className="ml-5 list-disc text-muted-foreground">
              {(Object.entries(result.bySystem) as [HandicapSystem, number][]).map(
                ([system, count]) => (
                  <li key={system}>
                    {count} {SYSTEM_LABEL[system]}
                  </li>
                ),
              )}
              {result.added > 0 && (
                <li>{result.added} added to a handicap fleet</li>
              )}
              {result.renamed != null && result.renamed > 0 && (
                <li>{result.renamed} class name{result.renamed === 1 ? '' : 's'} normalised</li>
              )}
              <li>{result.unchanged} unchanged</li>
              {result.notFound > 0 && (
                <li>{result.notFound} not found — left at their current value</li>
              )}
            </ul>
          </div>
          <DialogFooter>
            <Button onClick={onFinish}>Done</Button>
          </DialogFooter>
        </>
      )}
    </>
  );
}
