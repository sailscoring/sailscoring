'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarRange } from 'lucide-react';

import {
  adoptYearCategories,
  createSeason,
  listSeasons,
  setCurrentSeason,
  type SeasonsView,
} from '@/lib/api-repository';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Workspace seasons management (ADR-011). Seasons mostly derive from what's
 * published — this card handles the rest: defining a season before its first
 * publish, choosing the **current** one (the public index expands it and the
 * publish dialog defaults to it), and adopting year-named categories as
 * season pins for workspaces that filed by year before seasons existed.
 */
export function SeasonsCard() {
  const [view, setView] = useState<SeasonsView | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adopted, setAdopted] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listSeasons()
      .then(setView)
      .catch(() => setError('Could not load seasons.'));
  }, []);
  useEffect(refresh, [refresh]);

  async function run(op: () => Promise<SeasonsView>) {
    setBusy(true);
    setError(null);
    try {
      setView(await op());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const items = view?.items ?? [];

  return (
    <div className="bg-card border rounded-lg p-5 space-y-4" data-testid="seasons-card">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Seasons</h2>
        <CalendarRange className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">
        Published results group by season. The current season opens first on
        your public results page and is the default when publishing.
      </p>

      {view === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No seasons yet — they appear as you publish, or add one below.
        </p>
      ) : (
        <ul className="space-y-1">
          {items.map((s) => (
            <li key={s.label} className="flex items-center gap-2 text-sm">
              <span className="font-medium">{s.label}</span>
              <span className="text-xs text-muted-foreground">
                {s.folderCount === 0
                  ? 'nothing published yet'
                  : `${s.folderCount} folder${s.folderCount === 1 ? '' : 's'}`}
              </span>
              {s.current ? (
                <span className="text-xs border rounded-full px-2 py-0.5 text-muted-foreground">
                  Current
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={busy}
                  onClick={() => run(() => setCurrentSeason(s.label))}
                >
                  Make current
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = label.trim();
          if (!trimmed) return;
          // Clear eagerly — a delayed clear would race the next keystrokes.
          setLabel('');
          void run(() => createSeason(trimmed));
        }}
      >
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="New season, e.g. 2027 or 2026-27"
          aria-label="New season label"
          className="h-8 text-sm"
        />
        <Button type="submit" variant="outline" size="sm" disabled={busy || !label.trim()}>
          Add
        </Button>
      </form>

      {(view?.yearCategories.length ?? 0) > 0 && (
        <div className="space-y-1">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const r = await adoptYearCategories();
                setAdopted(
                  `Pinned ${r.pinned} folder${r.pinned === 1 ? '' : 's'} from ${r.adopted} year categor${r.adopted === 1 ? 'y' : 'ies'}.`,
                );
                refresh();
              } catch {
                setError('Adopting year categories failed.');
              } finally {
                setBusy(false);
              }
            }}
          >
            Adopt year categories as seasons
          </Button>
          <p className="text-xs text-muted-foreground">
            Files everything published under {view!.yearCategories.join(', ')}{' '}
            into those seasons. The categories themselves are left for you to
            delete when ready.
          </p>
        </div>
      )}
      {adopted && <p className="text-xs text-muted-foreground">{adopted}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
