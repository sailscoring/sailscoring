'use client';

/**
 * The series-header ⋯ menu: actions on the series as a whole — save/update
 * from file, copy to workspace, archive / delete — as distinct from the
 * configuration that lives on the Settings tab. Mounted in the series layout
 * so the actions are reachable from every tab, and the menu owns the dialogs,
 * hidden file inputs, and the global Ctrl+S binding they imply.
 */
import { useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  Copy,
  FileDown,
  FileUp,
  Loader2,
  MoreVertical,
  Trash2,
} from 'lucide-react';

import * as repos from '@/lib/api-repository';
import {
  saveSeriesFile,
  parseSeriesFile,
  openSeriesFromFile,
  updateSeriesFromFile,
  type SeriesFile,
} from '@/lib/series-file';
import { parseSailwaveBlw, SailwaveImportError } from '@/lib/sailwave-import';
import { SAILWAVE_HANDOFF_KEY } from '@/app/series/import-sailwave/page';
import { queryKeys } from '@/hooks/query-keys';
import { useArchiveSeries, useDeleteSeriesCascade } from '@/hooks/use-series';
import { usePublicationStatus } from '@/hooks/use-published';
import { useGlobalKeyDown } from '@/hooks/use-keyboard-shortcut';
import { useFeatures } from '@/components/features-provider';
import { useWorkspaceMemberships } from '@/components/workspace-memberships-provider';
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions';
import { hasPermission } from '@/lib/auth/permissions';
import { CopySeriesToWorkspaceDialog } from '@/components/copy-series-to-workspace-dialog';
import { formatDayStamp } from '@/lib/format-date';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Series } from '@/lib/types';

type UpdateFlow =
  | { step: 'idle' }
  | { step: 'confirm'; file: SeriesFile }
  | { step: 'working' }
  | { step: 'error'; message: string };

export function SeriesActionsMenu({ series }: { series: Series }) {
  const seriesId = series.id;
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { has } = useFeatures();
  const { memberships, activeOrganizationId } = useWorkspaceMemberships();
  const { can } = useWorkspacePermissions();
  const canManageSeries = can('manage-series');
  const archiveSeries = useArchiveSeries();
  const deleteCascade = useDeleteSeriesCascade();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sailwaveInputRef = useRef<HTMLInputElement>(null);
  const [updateFlow, setUpdateFlow] = useState<UpdateFlow>({ step: 'idle' });
  const [copyOpen, setCopyOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { data: publication } = usePublicationStatus(confirmDelete ? seriesId : null);

  const archived = series.archived ?? false;
  const isModified =
    series.lastSavedAt !== null && series.lastModifiedAt > series.lastSavedAt;
  // A copy target is any other workspace where the user can create series.
  const hasCopyTargets = memberships.some(
    (m) =>
      m.organizationId !== activeOrganizationId &&
      hasPermission(m.role, 'manage-series'),
  );

  async function handleSaveToFile() {
    try {
      await saveSeriesFile(seriesId, repos, { recordSave: canManageSeries });
      // saveSeriesFile writes lastSavedAt directly via the seriesRepo,
      // bypassing the React Query cache. Force a refetch so the menu's
      // "Last saved" label reflects the new state.
      await queryClient.invalidateQueries({ queryKey: queryKeys.series.detail(seriesId) });
    } catch (err) {
      console.error(err);
    }
  }

  useGlobalKeyDown((e) => {
    if (e.ctrlKey && !e.metaKey && e.key === 's' && !/\/races\/[^/]+/.test(pathname)) {
      // Ctrl+S saves to file from any series page except finish entry (which owns Ctrl+S itself)
      e.preventDefault();
      void handleSaveToFile();
    }
  });

  // Re-import over this series from a fresh Sailwave export. Parse here, then
  // hand the wizard the raw data plus this series id so it runs in update mode
  // (retain identity + publishing config, replace the competition data).
  async function handleSailwaveSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const bytes = await file.arrayBuffer();
      const raw = parseSailwaveBlw(bytes);
      sessionStorage.setItem(
        SAILWAVE_HANDOFF_KEY,
        JSON.stringify({ fileName: file.name, raw, updateSeriesId: seriesId }),
      );
      router.push('/series/import-sailwave');
    } catch (err) {
      setUpdateFlow({
        step: 'error',
        message:
          err instanceof SailwaveImportError
            ? err.message
            : `Could not read Sailwave file: ${(err as Error).message}`,
      });
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const content = await file.text();
      const parsed = parseSeriesFile(content);

      if (parsed.seriesId !== seriesId) {
        setUpdateFlow({
          step: 'error',
          message:
            'This file is for a different series. Use "Import Series" on the home screen to open it as a new series.',
        });
        return;
      }

      setUpdateFlow({ step: 'confirm', file: parsed });
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
        const newId = await openSeriesFromFile(file, repos);
        await queryClient.invalidateQueries({ queryKey: queryKeys.series.list() });
        router.push(`/series/${newId}/races`);
        setUpdateFlow({ step: 'idle' });
      } else {
        await updateSeriesFromFile(seriesId, file, repos);
        // updateSeriesFromFile bypasses the React Query cache. The series
        // row keeps its id so invalidate is fine, but every child entity
        // (fleets, competitors, races, race-starts, finishes) is reissued
        // a fresh UUID inside writeFleetsCompetitorsRaces. Plain
        // invalidate leaves the stale OLD lists in cache; the next page
        // mount renders them stale-while-revalidate, then the components
        // fetch by-OLD-id child queries that 404 because the old rows
        // are gone. removeQueries forces the next mount to fetch fresh.
        await queryClient.invalidateQueries({ queryKey: queryKeys.series.detail(seriesId) });
        await queryClient.invalidateQueries({ queryKey: queryKeys.series.list() });
        queryClient.removeQueries({ queryKey: queryKeys.fleets.all });
        queryClient.removeQueries({ queryKey: queryKeys.competitors.all });
        queryClient.removeQueries({ queryKey: queryKeys.races.all });
        queryClient.removeQueries({ queryKey: queryKeys.finishes.all });
        queryClient.removeQueries({ queryKey: queryKeys.raceStarts.all });
        router.push(`/series/${seriesId}/races`);
        // This menu lives in the series layout, which stays mounted across the
        // in-place update's same-series navigation — so the working dialog must
        // be dismissed explicitly rather than relying on an unmount.
        setUpdateFlow({ step: 'idle' });
      }
    } catch (err) {
      console.error(err);
      setUpdateFlow({ step: 'error', message: 'Failed to update series. Please try again.' });
    }
  }

  async function handleConfirmDelete() {
    setConfirmDelete(false);
    await deleteCascade.mutateAsync(seriesId);
    router.push('/');
  }

  /** Defers past the menu's close so Radix's focus restore doesn't race the
   *  native file chooser. */
  function openChooser(ref: React.RefObject<HTMLInputElement | null>) {
    setTimeout(() => ref.current?.click(), 0);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label="Series actions">
            <MoreVertical className="h-4 w-4" />
            Actions
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="font-normal text-xs text-muted-foreground">
            {series.lastSavedAt ? (
              <>
                Last saved {formatDayStamp(series.lastSavedAt)}
                {isModified && (
                  <span className="text-amber-600 dark:text-amber-400"> · modified since</span>
                )}
              </>
            ) : (
              'Not saved to file'
            )}
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => void handleSaveToFile()}>
            <FileDown className="h-4 w-4" />
            Save to File
            <DropdownMenuShortcut>Ctrl+S</DropdownMenuShortcut>
          </DropdownMenuItem>
          {!archived && canManageSeries && (
            <DropdownMenuItem onSelect={() => openChooser(fileInputRef)}>
              <FileUp className="h-4 w-4" />
              Update from File…
            </DropdownMenuItem>
          )}
          {series.source === 'sailwave' && has('sailwave-import') && !archived && canManageSeries && (
            <DropdownMenuItem
              data-testid="update-from-sailwave"
              onSelect={() => openChooser(sailwaveInputRef)}
            >
              <FileUp className="h-4 w-4" />
              Update from Sailwave file…
            </DropdownMenuItem>
          )}
          {hasCopyTargets && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setCopyOpen(true)}>
                <Copy className="h-4 w-4" />
                Copy to workspace…
              </DropdownMenuItem>
            </>
          )}
          {canManageSeries && (
            <>
              <DropdownMenuSeparator />
              {archived ? (
                <>
                  <DropdownMenuItem
                    disabled={archiveSeries.isPending}
                    onSelect={() => archiveSeries.mutate({ id: seriesId, archived: false })}
                  >
                    <ArchiveRestore className="h-4 w-4" />
                    Unarchive
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete…
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem
                  disabled={archiveSeries.isPending}
                  onSelect={() => archiveSeries.mutate({ id: seriesId, archived: true })}
                >
                  <Archive className="h-4 w-4" />
                  Archive series
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <input
        ref={fileInputRef}
        type="file"
        accept=".sailscoring,application/json"
        className="hidden"
        onChange={handleFileSelected}
      />
      <input
        ref={sailwaveInputRef}
        type="file"
        accept=".blw"
        className="hidden"
        data-testid="update-from-sailwave-input"
        onChange={handleSailwaveSelected}
      />

      <CopySeriesToWorkspaceDialog
        seriesId={seriesId}
        seriesName={series.name}
        open={copyOpen}
        onOpenChange={setCopyOpen}
      />

      {/* Confirm update from file */}
      <Dialog
        open={updateFlow.step === 'confirm'}
        onOpenChange={(open) => { if (!open) setUpdateFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update &ldquo;{series.name}&rdquo; from file?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Your workspace copy will be replaced with the contents of this file.
                  This cannot be undone.
                </p>
                {updateFlow.step === 'confirm' && (
                  <div className="text-sm">
                    <p>This file: saved {new Date(updateFlow.file.exportedAt).toLocaleString()}</p>
                    <p>Workspace copy: last modified {formatDayStamp(series.lastModifiedAt)}</p>
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
            <Button onClick={() => handleConfirmUpdate(false)}>Update</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Working — the in-place replace reissues every child UUID and busts the
          cache before routing, so there's a noticeable beat with nothing else
          on screen. Keep a non-dismissable spinner up until navigation lands. */}
      <Dialog open={updateFlow.step === 'working'}>
        <DialogContent
          showCloseButton={false}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Updating series…</DialogTitle>
            <DialogDescription>
              Replacing your workspace copy with the file contents. This may take a
              moment for large series.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center py-2">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
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

      {/* Delete dialog — a soft delete: the series moves to the Trash and is
          recoverable for 30 days. */}
      <Dialog open={confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{series.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              The series, with all its competitors, races, and results, moves to the Trash.
              You can recover it for 30 days, after which it&rsquo;s removed for good.
            </DialogDescription>
          </DialogHeader>
          {publication?.published && (
            <p className="text-sm text-muted-foreground">
              Its published results page stays online but becomes disconnected — recovering
              the series won&rsquo;t reconnect it. Unpublish first if you don&rsquo;t want it
              to remain public.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              Delete series
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
