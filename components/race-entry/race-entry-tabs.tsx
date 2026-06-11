'use client';

import { cn } from '@/lib/utils';

export type RaceEntryTab = 'finish' | 'checkin' | 'ratings';

/** The result-entry tab strip: finish entry, start check-in (with a present
 *  count), and — for handicap series — ratings. */
export function RaceEntryTabs({
  activeTab,
  onSelect,
  presentCount,
  showRatings,
}: {
  activeTab: RaceEntryTab;
  onSelect: (tab: RaceEntryTab) => void;
  presentCount: number;
  showRatings: boolean;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border bg-card p-1 shadow-sm">
      <button
        type="button"
        onClick={() => onSelect('finish')}
        className={cn(
          'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
          activeTab === 'finish'
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
        )}
      >
        Finish entry
      </button>
      <button
        type="button"
        onClick={() => onSelect('checkin')}
        className={cn(
          'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
          activeTab === 'checkin'
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
        )}
      >
        Start check-in
        {presentCount > 0 && (
          <span className="ml-1.5 text-xs text-muted-foreground">({presentCount})</span>
        )}
      </button>
      {showRatings && (
        <button
          type="button"
          onClick={() => onSelect('ratings')}
          className={cn(
            'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
            activeTab === 'ratings'
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          Ratings
        </button>
      )}
    </div>
  );
}
