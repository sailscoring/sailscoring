'use client';

import { TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { sortDirectionFor, sortPositionFor, type SortKey } from '@/lib/table-sort';

export interface SortableTableHeadProps {
  columnId: string;
  sortKeys: SortKey[];
  /** `additive` is true when the scorer held shift — append rather than replace. */
  onSort: (columnId: string, additive: boolean) => void;
  className?: string;
  children: React.ReactNode;
}

/**
 * A column header that sorts on click. Shift-click adds the column to the
 * sort instead of replacing it, so several columns can be stacked; the badge
 * shows each column's place in that stack once there is more than one.
 *
 * A keyboard Enter or Space on the header fires the same click, and holding
 * shift while doing so is additive there too — so the stack is reachable
 * without a pointer.
 */
export function SortableTableHead({
  columnId,
  sortKeys,
  onSort,
  className,
  children,
}: SortableTableHeadProps) {
  const dir = sortDirectionFor(sortKeys, columnId);
  const position = sortPositionFor(sortKeys, columnId);

  return (
    <TableHead
      className={cn('p-0', className)}
      aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
    >
      <button
        type="button"
        onClick={(e) => onSort(columnId, e.shiftKey)}
        className={cn(
          'flex h-10 w-full items-center gap-1 px-2 text-left font-medium',
          'hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          className,
        )}
      >
        <span className="min-w-0">{children}</span>
        {dir && (
          <span aria-hidden="true" className="shrink-0 text-muted-foreground">
            {dir === 'asc' ? '▲' : '▼'}
            {position !== undefined && (
              <span className="ml-0.5 text-[0.65rem] align-super">{position}</span>
            )}
          </span>
        )}
      </button>
    </TableHead>
  );
}
