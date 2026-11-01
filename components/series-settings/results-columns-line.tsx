'use client';

import { useState } from 'react';
import { useFeatures } from '@/components/features-provider';
import { ResultsColumnsDialog } from '@/components/series-settings/results-columns-dialog';
import type { Series } from '@/lib/types';

/**
 * Where the Results columns dialog starts: one line at the end of the
 * Competitor fields card. While the series has automatic columns it says so
 * and offers the change; once it has its own, it says that. With the feature
 * off it says nothing for a series with automatic columns, and states that
 * one with its own columns has them — they still publish — with where to
 * turn editing on.
 */
export function ResultsColumnsLine({ series }: { series: Series }) {
  const { has } = useFeatures();
  const [open, setOpen] = useState(false);
  const own = series.resultsColumns != null;

  if (!has('custom-columns')) {
    if (!own) return null;
    return (
      <p className="text-xs text-muted-foreground" data-testid="results-columns-line">
        This series sets its own results columns. Turn on{' '}
        <strong className="text-foreground">Custom results columns</strong> in Workspace settings to change them.
      </p>
    );
  }

  return (
    <div className="space-y-0.5 pt-2 border-t text-sm" data-testid="results-columns-line">
      {own ? (
        <p>
          Results columns: set for this series —{' '}
          <button type="button" className="underline" onClick={() => setOpen(true)}>
            Edit results columns…
          </button>
        </p>
      ) : (
        <>
          <p>Results columns: chosen from these fields</p>
          <p className="text-xs text-muted-foreground">
            Do your results need other columns, in another order, or under other titles?{' '}
            <button type="button" className="underline hover:text-foreground" onClick={() => setOpen(true)}>
              Change results columns…
            </button>
          </p>
        </>
      )}
      <ResultsColumnsDialog open={open} onOpenChange={setOpen} series={series} />
    </div>
  );
}
