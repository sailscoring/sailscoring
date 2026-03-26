'use client';

import { use, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { seriesRepo } from '@/lib/dexie-repository';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  saveSeriesFile,
  parseSeriesFile,
  checkLineage,
  openSeriesFromFile,
  updateSeriesFromFile,
  type SeriesFile,
  type LineageStatus,
} from '@/lib/series-file';

type UpdateFlow =
  | { step: 'idle' }
  | { step: 'confirm'; file: SeriesFile; status: LineageStatus }
  | { step: 'working' }
  | { step: 'error'; message: string };

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `today at ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `yesterday at ${time}`;
  return d.toLocaleDateString();
}

export default function SettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: seriesId } = use(params);
  const router = useRouter();
  const series = useLiveQuery(async () => (await seriesRepo.get(seriesId)) ?? null, [seriesId]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [updateFlow, setUpdateFlow] = useState<UpdateFlow>({ step: 'idle' });

  if (series === undefined) return <p className="text-muted-foreground">Loading…</p>;
  if (series === null) return <p className="text-muted-foreground">Series not found.</p>;

  const hasFileHistory = series.lastSnapshotId !== null;
  const isModified =
    series.lastSavedAt !== null && series.lastModifiedAt > series.lastSavedAt;

  async function handleSaveToFile() {
    setSaving(true);
    try {
      await saveSeriesFile(seriesId);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  function handleUpdateFromFile() {
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const content = await file.text();
      const parsed = parseSeriesFile(content);

      if (parsed.seriesId !== series!.id) {
        setUpdateFlow({
          step: 'error',
          message:
            'This file is for a different series. Use "Open Series" on the home screen to open it as a new series.',
        });
        return;
      }

      const status = checkLineage(series!, parsed);
      setUpdateFlow({ step: 'confirm', file: parsed, status });
    } catch (err) {
      setUpdateFlow({
        step: 'error',
        message: err instanceof Error ? err.message : 'Could not read file.',
      });
    }
  }

  async function handleConfirmUpdate(asNewCopy: boolean) {
    if (updateFlow.step !== 'confirm') return;
    const { file } = updateFlow;
    setUpdateFlow({ step: 'working' });
    try {
      if (asNewCopy) {
        const newId = await openSeriesFromFile(file);
        router.push(`/series/${newId}/races`);
      } else {
        await updateSeriesFromFile(seriesId, file);
        router.push(`/series/${seriesId}/races`);
      }
    } catch (err) {
      console.error(err);
      setUpdateFlow({ step: 'error', message: 'Failed to update series. Please try again.' });
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      {/* File card */}
      <div className={`border rounded-lg p-5 space-y-4 ${!hasFileHistory ? 'opacity-70' : ''}`}>
        <div>
          <h2 className="text-sm font-medium">File</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {series.lastSavedAt
              ? <>Last saved: {formatTimestamp(series.lastSavedAt)}{isModified && <span className="ml-2 text-amber-600 dark:text-amber-400">· modified since last save</span>}</>
              : hasFileHistory
              ? 'Opened from file — not yet saved from this device'
              : 'Not saved to file'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSaveToFile} disabled={saving} variant="outline">
            {saving ? 'Saving…' : 'Save to File'}
          </Button>
          {hasFileHistory && (
            <Button onClick={handleUpdateFromFile} variant="outline">
              Update from File
            </Button>
          )}
        </div>
        {!hasFileHistory && (
          <p className="text-xs text-muted-foreground">
            Save to a file to share this series with co-scorers or back it up.
          </p>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".sailscoring,application/json"
        className="hidden"
        onChange={handleFileSelected}
      />

      {/* Identical snapshot */}
      <Dialog
        open={updateFlow.step === 'confirm' && updateFlow.status === 'identical'}
        onOpenChange={(open) => { if (!open) setUpdateFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nothing to update</DialogTitle>
            <DialogDescription>
              This file matches your local copy. No changes were made.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setUpdateFlow({ step: 'idle' })}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clean update */}
      <Dialog
        open={updateFlow.step === 'confirm' && updateFlow.status === 'clean'}
        onOpenChange={(open) => { if (!open) setUpdateFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update &ldquo;{series.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              This file is a newer version of your local copy.{' '}
              {updateFlow.step === 'confirm' &&
                `Saved on ${new Date(updateFlow.file.exportedAt).toLocaleString()}.`}
              {' '}Your local copy will be replaced. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateFlow({ step: 'idle' })}>
              Cancel
            </Button>
            <Button onClick={() => handleConfirmUpdate(false)}>Update</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diverged */}
      <Dialog
        open={updateFlow.step === 'confirm' && updateFlow.status === 'diverged'}
        onOpenChange={(open) => { if (!open) setUpdateFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>⚠ This file conflicts with your local copy</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This file and your local copy appear to have diverged — both have changes
                  the other doesn&apos;t.
                </p>
                {updateFlow.step === 'confirm' && (
                  <div className="text-sm">
                    <p>This file: saved {new Date(updateFlow.file.exportedAt).toLocaleString()}</p>
                    <p>Local copy: last modified {formatTimestamp(series.lastModifiedAt)}</p>
                  </div>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateFlow({ step: 'idle' })}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => handleConfirmUpdate(true)}>
              Open as a new copy
            </Button>
            <Button variant="destructive" onClick={() => handleConfirmUpdate(false)}>
              Replace local copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Error */}
      <Dialog
        open={updateFlow.step === 'error'}
        onOpenChange={(open) => { if (!open) setUpdateFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Could not open file</DialogTitle>
            <DialogDescription>
              {updateFlow.step === 'error' ? updateFlow.message : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setUpdateFlow({ step: 'idle' })}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
