'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useUpdateSeries } from '@/hooks/use-series';
import type { Series } from '@/lib/types';

export function PublishingCard({ seriesId, series, anyProgressiveFleet }: { seriesId: string; series: Series; anyProgressiveFleet: boolean }) {
  const updateSeries = useUpdateSeries();
  const [expanded, setExpanded] = useState(false);

  const includeJson = series.includeJsonExport ?? true;
  const publishRatingCalcs = series.publishRatingCalculations ?? true;
  const showPerRaceRatings = series.showPerRaceRatingsInSummary ?? true;
  const summaryParts = [
    includeJson ? 'JSON export included' : 'JSON export excluded',
    ...(anyProgressiveFleet
      ? [
          publishRatingCalcs ? 'rating calculations published' : 'rating calculations hidden',
          showPerRaceRatings ? 'per-race ratings shown in summary' : 'per-race ratings hidden in summary',
        ]
      : []),
  ];
  const summary = summaryParts.join(' · ');

  return (
    <div className="bg-card border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Publishing</h2>
        {!expanded && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            Edit ▸
          </Button>
        )}
      </div>
      {!expanded ? (
        <p className="text-sm text-muted-foreground">{summary}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-2.5">
            <input
              id="includeJsonExport"
              type="checkbox"
              checked={includeJson}
              onChange={(e) => {
                updateSeries.mutate({ id: seriesId, patch: { includeJsonExport: e.target.checked } });
              }}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <div>
              <label htmlFor="includeJsonExport" className="text-sm font-medium cursor-pointer">
                Include data export in published results
              </label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Embeds a JSON snapshot of the results in every exported HTML file, with a
                &ldquo;Download results (JSON)&rdquo; link in the footer. Disable if you prefer
                to share results without the underlying data.
              </p>
            </div>
          </div>
          {anyProgressiveFleet && (
            <div className="flex items-start gap-2.5">
              <input
                id="publishRatingCalculations"
                type="checkbox"
                checked={publishRatingCalcs}
                onChange={(e) => {
                  updateSeries.mutate({ id: seriesId, patch: { publishRatingCalculations: e.target.checked } });
                }}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <div>
                <label htmlFor="publishRatingCalculations" className="text-sm font-medium cursor-pointer">
                  Publish progressive rating calculations alongside results
                </label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Adds per-race rating-calculation columns and a brief explainer so competitors can
                  verify each rating update with a calculator. NHC fleets get CT ratio, Fair TCF,
                  and Adjustment; ECHO fleets get 1/T_E, PI, and Adjustment. The rating, finish,
                  elapsed, corrected-time, and next-rating columns are always shown.
                </p>
              </div>
            </div>
          )}
          {anyProgressiveFleet && (
            <div className="flex items-start gap-2.5">
              <input
                id="showPerRaceRatingsInSummary"
                type="checkbox"
                checked={showPerRaceRatings}
                onChange={(e) => {
                  updateSeries.mutate({ id: seriesId, patch: { showPerRaceRatingsInSummary: e.target.checked } });
                }}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <div>
                <label htmlFor="showPerRaceRatingsInSummary" className="text-sm font-medium cursor-pointer">
                  Show per-race ratings in summary table
                </label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  For NHC and ECHO fleets, adds a seed-rating column to the summary table and
                  prints the applied rating in small text beneath each score from race 2 onwards.
                  Race 1&rsquo;s rating is the seed, shown in the dedicated column.
                </p>
              </div>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => setExpanded(false)}>
            Done
          </Button>
        </div>
      )}
    </div>
  );
}
