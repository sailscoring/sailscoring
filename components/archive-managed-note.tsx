'use client';

/**
 * The ⋯-menu footnote on an as-published archive (ADR-010). Deletion, copies,
 * and follow-ons are refused server-side for such a series, so the menus don't
 * offer them — this says where the series is actually managed, so the missing
 * entries read as a rule rather than an oversight.
 */
import { Landmark } from 'lucide-react';

import { DropdownMenuLabel } from '@/components/ui/dropdown-menu';

export function ArchiveManagedNote() {
  return (
    <DropdownMenuLabel
      data-testid="archive-managed-note"
      className="flex max-w-64 gap-2 font-normal text-xs whitespace-normal text-muted-foreground"
    >
      <Landmark className="h-3 w-3 shrink-0 translate-y-0.5" />
      <span>
        Managed by the archive that supplies it — corrections and removal
        happen there, not here.
      </span>
    </DropdownMenuLabel>
  );
}
