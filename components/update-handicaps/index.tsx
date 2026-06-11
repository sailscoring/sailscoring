'use client';

import { forwardRef, useImperativeHandle, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCompetitorsBySeries, useUpdateHandicaps } from '@/hooks/use-competitors';
import { useFleetsBySeries } from '@/hooks/use-fleets';
import { useFeatures } from '@/components/features-provider';
import { ConflictApiError } from '@/lib/api-client';
import type { HandicapUpdateRow } from '@/lib/api-repository';
import type { HandicapSystem } from '@/lib/source-handicaps';

import { IrcRatingSourceStep } from './irc-rating-source-step';
import { IrishSailingSourceStep } from './irish-sailing-source-step';
import { RyaPySourceStep } from './rya-py-source-step';
import { SeriesSourceStep } from './series-source-step';
import { SourcePickerStep } from './source-picker-step';
import { SYSTEM_LABEL, type ApplyOutcome, type HandicapSource } from './shared';
import { VprsSourceStep } from './vprs-source-step';

export interface UpdateHandicapsHandle {
  open: () => void;
}

/**
 * The Update Handicaps wizard shell. Owns the dialog, the source picker,
 * feature gating, the apply mutation (with its 409 handling), and the done
 * step. Everything about how a source loads data and plans its update rows
 * lives in the per-source step components — adding a source means adding
 * one step component and one picker entry here.
 */
export const UpdateHandicaps = forwardRef<UpdateHandicapsHandle, {
  seriesId: string;
}>(function UpdateHandicaps({ seriesId }, ref) {
  const { has } = useFeatures();
  // ECHO is the single Irish/ECHO gate — it covers both the scoring system
  // and this Irish Sailing ECHO source. IRC TCC is gated separately (on by
  // default).
  const irishSailingEnabled = has('echo');
  const ircRatingEnabled = has('irc-rating');
  const ryaPyEnabled = has('rya-py');
  const vprsRatingEnabled = has('vprs');

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<
    | 'source-picker'
    | 'source-series'
    | 'source-irish-sailing'
    | 'source-irc-rating'
    | 'source-vprs'
    | 'source-rya-py'
    | 'done'
  >('source-picker');
  const [source, setSource] = useState<HandicapSource>('series');
  const [result, setResult] = useState<(ApplyOutcome & { updatedCount: number }) | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Mid-series rating change: keep already-scored races on the old rating
  // (per-race overrides) rather than re-scoring them on the new value. Applies
  // to static systems (IRC/PY); default on. Lives here — not in the series
  // step that renders its checkbox — because it feeds every source's apply,
  // and its toggle deliberately survives reopening the dialog.
  const [freezeScoredRaces, setFreezeScoredRaces] = useState(true);

  useImperativeHandle(ref, () => ({
    open: () => {
      // Per-source state lives in the step components, which unmount with
      // the dialog and so always start fresh; only the shell's own state
      // needs resetting here.
      setStep('source-picker');
      setSource('series');
      setResult(null);
      setErrorMsg(null);
      setOpen(true);
    },
  }));

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
    onCancel: () => setOpen(false),
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="grid-rows-[auto_minmax(0,1fr)_auto] max-h-[90vh] w-[95vw] max-w-5xl sm:max-w-5xl">
        {step === 'source-picker' && (
          <SourcePickerStep
            source={source}
            onSelect={setSource}
            gates={{
              irishSailing: irishSailingEnabled,
              ircRating: ircRatingEnabled,
              ryaPy: ryaPyEnabled,
              vprsRating: vprsRatingEnabled,
            }}
            onNext={() =>
              setStep(
                source === 'irc-rating'
                  ? 'source-irc-rating'
                  : source === 'vprs-rating'
                    ? 'source-vprs'
                    : source === 'irish-sailing'
                      ? 'source-irish-sailing'
                      : source === 'rya-py'
                        ? 'source-rya-py'
                        : 'source-series',
              )
            }
            onCancel={() => setOpen(false)}
          />
        )}

        {step === 'source-series' && (
          <SeriesSourceStep
            {...stepProps}
            freezeScoredRaces={freezeScoredRaces}
            onFreezeScoredRacesChange={setFreezeScoredRaces}
          />
        )}
        {step === 'source-irc-rating' && <IrcRatingSourceStep {...stepProps} />}
        {step === 'source-vprs' && <VprsSourceStep {...stepProps} />}
        {step === 'source-irish-sailing' && <IrishSailingSourceStep {...stepProps} />}
        {step === 'source-rya-py' && <RyaPySourceStep {...stepProps} />}

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
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
});
