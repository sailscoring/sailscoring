'use client';

import { useState } from 'react';
import { Tags } from 'lucide-react';

import { useCategories } from '@/hooks/use-categories';
import { Button } from '@/components/ui/button';
import { ManageCategoriesDialog } from '@/components/manage-categories-dialog';

/**
 * Series categories management, surfaced in workspace settings as well as the
 * home list header (#154). The dialog does the actual editing; this card is
 * the entry point plus a read-only preview of the current set.
 */
export function CategoriesCard() {
  const { data: categories } = useCategories();
  const [open, setOpen] = useState(false);

  const list = categories ?? [];

  return (
    <div className="border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Series categories</h2>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Tags className="h-4 w-4" />
          Manage
        </Button>
      </div>

      {categories === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No categories yet. Series appear under <span className="font-medium">Uncategorized</span>{' '}
          until you add some.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {list.map((c) => (
            <span
              key={c.id}
              className="text-xs border rounded-full px-2.5 py-1 text-muted-foreground"
            >
              {c.name}
            </span>
          ))}
        </div>
      )}

      <ManageCategoriesDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
