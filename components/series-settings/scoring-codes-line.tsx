'use client';

import { useState } from 'react';
import { useFeatures } from '@/components/features-provider';
import { ScoringCodesDialog } from '@/components/series-settings/scoring-codes-dialog';
import { codesSummary, codesSummaryText } from '@/lib/scoring-codes-text';
import type { DnfScoring, SeriesScoringCode } from '@/lib/types';

/**
 * Where the Scoring codes dialog starts: one line under a card's A5 choice.
 * While the series scores the RRS codes it says so and offers the change;
 * once it doesn't, it says what changed. With the feature off it says nothing
 * for a standard series, and states a changed one's codes — they still score
 * and publish — with where to turn editing on.
 */
export function ScoringCodesLine({
  seriesId,
  dnfScoring,
  scoringCodes = [],
}: {
  seriesId: string;
  dnfScoring: DnfScoring;
  scoringCodes?: readonly SeriesScoringCode[];
}) {
  const { has } = useFeatures();
  const [open, setOpen] = useState(false);
  const summary = codesSummary(dnfScoring, scoringCodes);
  const changes = summary.added.length + summary.changed.length;

  if (!has('custom-scoring-codes')) {
    if (changes === 0) return null;
    return (
      <p className="text-xs text-muted-foreground" data-testid="scoring-codes-line">
        This series scores {changes === 1 ? '1 code' : `${changes} codes`} differently from the RRS (
        {[...summary.added, ...summary.changed].join(', ')}). Turn on{' '}
        <strong className="text-foreground">Custom scoring codes</strong> in Workspace settings to edit them.
      </p>
    );
  }

  const counts = [
    summary.added.length ? `${summary.added.length} added` : '',
    summary.changed.length ? `${summary.changed.length} changed` : '',
  ].filter(Boolean).join(', ');

  return (
    <div className="space-y-0.5 text-sm" data-testid="scoring-codes-line">
      {changes === 0 ? (
        <>
          <p>Scoring codes: as RRS Appendix A</p>
          <p className="text-xs text-muted-foreground">
            Do your sailing instructions add a code, or score one differently?{' '}
            <button type="button" className="underline hover:text-foreground" onClick={() => setOpen(true)}>
              Change scoring codes…
            </button>
          </p>
        </>
      ) : (
        <p>
          Scoring codes: {counts} from the RRS ({codesSummaryText(summary)}) —{' '}
          <button type="button" className="underline" onClick={() => setOpen(true)}>
            Edit scoring codes…
          </button>
        </p>
      )}
      <ScoringCodesDialog
        open={open}
        onOpenChange={setOpen}
        seriesId={seriesId}
        dnfScoring={dnfScoring}
        scoringCodes={scoringCodes}
      />
    </div>
  );
}
