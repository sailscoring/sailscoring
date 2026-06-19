import { AlertTriangle } from 'lucide-react';
import type { Competitor, ScoringRejection } from '@/lib/types';

export interface ScoringRejectionsWarningProps {
  rejections: ScoringRejection[];
  competitors: Competitor[];
}

export function ScoringRejectionsWarning({
  rejections,
  competitors,
}: ScoringRejectionsWarningProps) {
  const competitorById = new Map(competitors.map((c) => [c.id, c]));
  if (rejections.length === 0) return null;

  function nameOf(r: ScoringRejection): string {
    const c = competitorById.get(r.competitorId);
    return c ? `${c.sailNumber} (${c.name})` : r.competitorId;
  }

  const noRating = rejections.filter((r) => r.reason === 'no_rating');
  const noStartingTcf = rejections.filter((r) => r.reason === 'no_starting_tcf');
  const rdgMissing = rejections.filter((r) => r.reason === 'rdg_missing_fleet_points');
  const dpiMissing = rejections.filter((r) => r.reason === 'dpi_missing_fleet_points');

  const messages: string[] = [];
  if (noRating.length > 0) {
    messages.push(`${noRating.length} competitor${noRating.length === 1 ? ' lacks' : 's lack'} a rating and cannot be scored: ${noRating.map(nameOf).join(', ')}`);
  }
  if (noStartingTcf.length > 0) {
    messages.push(`${noStartingTcf.length} competitor${noStartingTcf.length === 1 ? ' lacks' : 's lack'} a starting TCF for NHC scoring: ${noStartingTcf.map(nameOf).join(', ')}`);
  }
  if (rdgMissing.length > 0) {
    messages.push(`${rdgMissing.length === 1 ? 'Redress with' : `${rdgMissing.length} boats have redress with`} per-fleet stated points but none set for this fleet — scored as the A9 average pending a value: ${rdgMissing.map(nameOf).join(', ')}`);
  }
  if (dpiMissing.length > 0) {
    messages.push(`${dpiMissing.length === 1 ? 'A DPI penalty has' : `${dpiMissing.length} DPI penalties have`} per-fleet points but none set for this fleet — no penalty applied pending a value: ${dpiMissing.map(nameOf).join(', ')}`);
  }
  if (messages.length === 0) return null;

  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400 flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      <span>{messages.join(' · ')}</span>
    </div>
  );
}
