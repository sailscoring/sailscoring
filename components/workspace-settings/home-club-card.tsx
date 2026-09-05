'use client';

import { useState } from 'react';
import { Anchor } from 'lucide-react';

import { setWorkspaceHomeClub } from '@/lib/api-repository';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * The club whose workspace this is (#507). In a club's own workspace most
 * competitors carry no club at all — everyone is assumed to be a member, and
 * only visitors to open events get the field filled in — which leaves the
 * identity matcher without the one signal a single-club roster most needs.
 * Naming the club here lets a blank mean what the scorer meant by it.
 *
 * Read by the identity pass and nothing else: the value is never written onto
 * a competitor row, so an open event still publishes exactly what was entered.
 */
export function HomeClubCard({ initial }: { initial: string | null }) {
  const [value, setValue] = useState(initial ?? '');
  const [saved, setSaved] = useState(initial ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = value.trim() !== saved;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await setWorkspaceHomeClub(value.trim());
      setSaved(r.homeClub ?? '');
      setValue(r.homeClub ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-card border rounded-lg p-5 space-y-4" data-testid="home-club-card">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Home club</h2>
        <Anchor className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">
        The club this workspace scores for. Entries that leave the club blank
        are treated as members of it when matching one competitor across
        series, so a regular&rsquo;s record stays in one piece. Visitors who
        name their own club are unaffected.
      </p>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) void save();
        }}
      >
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. Howth Yacht Club"
          aria-label="Home club"
          maxLength={120}
          className="h-8 text-sm"
        />
        <Button type="submit" variant="outline" size="sm" disabled={busy || !dirty}>
          Save
        </Button>
      </form>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
