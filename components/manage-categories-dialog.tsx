'use client';

/**
 * Manage Categories dialog (#154). Scorer-defined, per-workspace series
 * categories: add, rename, reorder (menu-driven up/down — DnD is post-MVP),
 * and delete. "Uncategorized" is synthetic (not a row) so it never appears
 * here and can't be removed. Deleting a category drops its series back to
 * Uncategorized server-side.
 *
 * Surfaced from the home list header and from workspace settings.
 */
import { useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from 'lucide-react';

import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useRenameCategory,
  useReorderCategories,
} from '@/hooks/use-categories';
import { CATEGORY_NAME_MAX_LENGTH } from '@/lib/validation/category';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function ManageCategoriesDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data: categories } = useCategories();
  const createCategory = useCreateCategory();
  const renameCategory = useRenameCategory();
  const deleteCategory = useDeleteCategory();
  const reorderCategories = useReorderCategories();

  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const list = categories ?? [];

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    try {
      await createCategory.mutateAsync(name);
      setNewName('');
    } catch {
      setError('Could not add that category — the name may already be in use.');
    }
  }

  async function handleRename(id: string, name: string, original: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === original) return;
    setError(null);
    try {
      await renameCategory.mutateAsync({ id, name: trimmed });
    } catch {
      setError('Could not rename — the name may already be in use.');
    }
  }

  async function handleMove(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= list.length) return;
    const ids = list.map((c) => c.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await reorderCategories.mutateAsync(ids);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setError(null); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage categories</DialogTitle>
          <DialogDescription>
            Group your series. Series with no category appear under{' '}
            <span className="font-medium">Uncategorized</span>; deleting a
            category moves its series there.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {list.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No categories yet. Add one below.
            </p>
          )}
          {list.map((c, i) => (
            <div key={c.id} className="flex items-center gap-1">
              <div className="flex flex-col">
                <button
                  type="button"
                  aria-label={`Move ${c.name} up`}
                  disabled={i === 0 || reorderCategories.isPending}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  onClick={() => handleMove(i, -1)}
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${c.name} down`}
                  disabled={i === list.length - 1 || reorderCategories.isPending}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  onClick={() => handleMove(i, 1)}
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
              <Input
                key={c.name}
                defaultValue={c.name}
                maxLength={CATEGORY_NAME_MAX_LENGTH}
                aria-label={`Category name`}
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                onBlur={(e) => handleRename(c.id, e.target.value, c.name)}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${c.name}`}
                disabled={deleteCategory.isPending}
                onClick={() => deleteCategory.mutate(c.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 pt-2 border-t">
          <Input
            value={newName}
            maxLength={CATEGORY_NAME_MAX_LENGTH}
            placeholder="New category name"
            aria-label="New category name"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          />
          <Button onClick={handleAdd} disabled={!newName.trim() || createCategory.isPending}>
            {createCategory.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Add
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
