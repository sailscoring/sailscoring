'use client';

import { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { getDirectorySettings, setDirectorySettings } from '@/lib/api-repository';
import { DIRECTORY_DESCRIPTION_MAX, type DirectorySettings } from '@/lib/features';

/**
 * The workspace's entry in the public directory at `/p/` — the showcase of
 * every club scoring with Sail Scoring. A club workspace with something
 * published is listed unless it opts out here; opting out keeps its results
 * public at their own addresses and only stops advertising them. The
 * description is the one line under its name on the directory card.
 */
export function DirectoryCard() {
  const [saved, setSaved] = useState<DirectorySettings | null>(null);
  const [listed, setListed] = useState(true);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDirectorySettings()
      .then((s) => {
        setSaved(s);
        setListed(s.listed);
        setDescription(s.description);
      })
      .catch(() => setError('Could not load the directory settings.'));
  }, []);

  async function save(next: { listed: boolean; description: string }) {
    setBusy(true);
    setError(null);
    try {
      const s = await setDirectorySettings(next);
      setSaved(s);
      setListed(s.listed);
      setDescription(s.description);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const dirty = saved !== null && description.trim() !== saved.description;

  return (
    <section className="bg-card border rounded-lg p-5 space-y-4" data-testid="directory-card">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Public directory</h2>
        <Globe className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">
        The{' '}
        <a href="/p" className="underline" target="_blank" rel="noopener">
          directory
        </a>{' '}
        lists the clubs and classes publishing their results with Sail Scoring. Your
        results stay public at their own addresses either way; this decides whether
        the directory points to them.
      </p>

      {saved === null ? (
        <p className="text-sm text-muted-foreground">{error ?? 'Loading…'}</p>
      ) : saved.kind !== 'club' ? (
        <p className="text-sm text-muted-foreground">
          Personal workspaces are never listed.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 border rounded-md px-3 py-2">
            <label htmlFor="directory-listed" className="text-sm cursor-pointer">
              List this workspace in the directory
            </label>
            <Switch
              id="directory-listed"
              checked={listed}
              disabled={busy}
              onCheckedChange={(next) =>
                save({ listed: next, description: saved.description })
              }
              aria-label="List this workspace in the directory"
            />
          </div>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save({ listed, description: description.trim() });
            }}
          >
            <label htmlFor="directory-description" className="text-sm font-medium">
              Description
            </label>
            <div className="flex gap-2">
              <Input
                id="directory-description"
                value={description}
                maxLength={DIRECTORY_DESCRIPTION_MAX}
                placeholder="Club racing on Dublin Bay since 1884"
                onChange={(e) => setDescription(e.target.value)}
                disabled={busy}
              />
              <Button type="submit" variant="outline" disabled={busy || !dirty}>
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              One line under your name on the directory card.
            </p>
          </form>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </>
      )}
    </section>
  );
}
