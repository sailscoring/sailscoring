'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

import * as repos from '@/lib/api-repository';
import { queryKeys } from '@/hooks/query-keys';
import { useCategories } from '@/hooks/use-categories';
import {
  openSeriesFromFile,
  parseSeriesFile,
  updateSeriesFromFile,
  type SeriesFile,
} from '@/lib/series-file';
import { describeOpenSeriesError } from '@/lib/open-series-error';
import { parseSailwaveBlw, SailwaveImportError } from '@/lib/sailwave-import';
import { SAILWAVE_HANDOFF_KEY } from '@/app/series/import-sailwave/page';
import type { Series } from '@/lib/types';

export type ImportFormat = 'sailscoring' | 'sailwave';

export type OpenFlow =
  | { step: 'idle' }
  | { step: 'choose-format' }
  | { step: 'confirm-new'; file: SeriesFile; categoryId: string | null }
  | { step: 'disambiguate'; file: SeriesFile; existing: Series }
  | { step: 'confirm-update'; file: SeriesFile; existing: Series }
  | { step: 'working' }
  | { step: 'error'; message: string };

/**
 * The home page's open/import state machine: format choice, the hidden file
 * input, `.sailscoring` parsing, the Sailwave handoff to
 * /series/import-sailwave via sessionStorage, and the re-import
 * (disambiguate / update-from-file) confirmation flow. The dialogs that
 * render each step live in components/open-series-flow.tsx.
 */
export function useOpenSeriesFile() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { seriesRepo } = repos;
  const { data: categories } = useCategories();

  const [openFlow, setOpenFlow] = useState<OpenFlow>({ step: 'idle' });
  const [importFormat, setImportFormat] = useState<ImportFormat>('sailscoring');
  const fileInputRef = useRef<HTMLInputElement>(null);

  function start() {
    setOpenFlow({ step: 'choose-format' });
  }

  function handleFormatChosen(format: ImportFormat) {
    setImportFormat(format);
    setOpenFlow({ step: 'idle' });
    // Defer the picker open one tick so the dialog has finished closing —
    // some browsers swallow the .click() if it fires during the dialog
    // unmount animation.
    setTimeout(() => fileInputRef.current?.click(), 0);
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (importFormat === 'sailwave') {
      try {
        const bytes = await file.arrayBuffer();
        const raw = parseSailwaveBlw(bytes);
        sessionStorage.setItem(
          SAILWAVE_HANDOFF_KEY,
          JSON.stringify({ fileName: file.name, raw }),
        );
        router.push('/series/import-sailwave');
      } catch (err) {
        setOpenFlow({
          step: 'error',
          message: err instanceof SailwaveImportError
            ? err.message
            : `Could not read Sailwave file: ${(err as Error).message}`,
        });
      }
      return;
    }

    let parsed: SeriesFile;
    try {
      const content = await file.text();
      parsed = parseSeriesFile(content);
    } catch (err) {
      setOpenFlow({
        step: 'error',
        message: err instanceof Error ? err.message : 'Could not read file.',
      });
      return;
    }

    setOpenFlow({ step: 'working' });

    try {
      // Check if a series with the same seriesId already exists. Categories
      // are fetched here rather than read from the hook's value: soon after a
      // page load the useCategories query can still be in flight, and treating
      // its undefined as "no categories" would silently skip the confirm step.
      const [all, workspaceCategories] = await Promise.all([
        seriesRepo.list(),
        queryClient.ensureQueryData({
          queryKey: queryKeys.categories.list(),
          queryFn: () => repos.listCategories(),
        }),
      ]);
      const existing = all.find((s) => s.id === parsed.seriesId);

      if (!existing) {
        // No match — open as new. When the workspace has categories, pause on
        // a confirm step so the scorer can file it (and eyeball the details);
        // otherwise open straight through to keep the common case one-click.
        if (workspaceCategories.length > 0) {
          setOpenFlow({ step: 'confirm-new', file: parsed, categoryId: null });
          return;
        }
        await openNewFromFile(parsed, null);
        return;
      }

      setOpenFlow({ step: 'disambiguate', file: parsed, existing });
    } catch (err) {
      console.error(err);
      setOpenFlow({ step: 'error', message: describeOpenSeriesError(err) });
    }
  }

  // Open a parsed file as a brand-new series, optionally filed under a category.
  // No invalidateQueries: the navigation unmounts the page, aborting the
  // refetch and logging a "Failed to fetch" console.error that the e2e
  // console-monitor treats as a failure. The new series's own pages refetch
  // what they need on mount.
  async function openNewFromFile(file: SeriesFile, categoryId: string | null) {
    setOpenFlow({ step: 'working' });
    try {
      const newId = await openSeriesFromFile(file, repos, { categoryId });
      router.push(`/series/${newId}/races`);
    } catch (err) {
      console.error(err);
      setOpenFlow({ step: 'error', message: describeOpenSeriesError(err) });
    }
  }

  async function handleDisambiguate(choice: 'update' | 'new-copy') {
    if (openFlow.step !== 'disambiguate') return;
    const { file, existing } = openFlow;

    if (choice === 'new-copy') {
      setOpenFlow({ step: 'working' });
      try {
        const newId = await openSeriesFromFile(file, repos);
        router.push(`/series/${newId}/races`);
      } catch (err) {
        console.error(err);
        setOpenFlow({ step: 'error', message: describeOpenSeriesError(err) });
      }
      return;
    }

    setOpenFlow({ step: 'confirm-update', file, existing });
  }

  async function handleConfirmUpdate(asNewCopy: boolean) {
    if (openFlow.step !== 'confirm-update') return;
    const { file, existing } = openFlow;
    setOpenFlow({ step: 'working' });
    try {
      if (asNewCopy) {
        const newId = await openSeriesFromFile(file, repos);
        await queryClient.invalidateQueries({ queryKey: queryKeys.series.list() });
        router.push(`/series/${newId}/races`);
      } else {
        await updateSeriesFromFile(existing.id, file, repos);
        // The file-replay path bypasses the React Query cache; force every
        // affected query to refetch before we route to the next page.
        await queryClient.invalidateQueries({ queryKey: queryKeys.series.detail(existing.id) });
        await queryClient.invalidateQueries({ queryKey: queryKeys.series.list() });
        await queryClient.invalidateQueries({ queryKey: queryKeys.fleets.bySeries(existing.id) });
        await queryClient.invalidateQueries({ queryKey: queryKeys.competitors.bySeries(existing.id) });
        await queryClient.invalidateQueries({ queryKey: queryKeys.races.bySeries(existing.id) });
        await queryClient.invalidateQueries({ queryKey: queryKeys.finishes.all });
        await queryClient.invalidateQueries({ queryKey: queryKeys.raceStarts.all });
        router.push(`/series/${existing.id}/races`);
      }
    } catch (err) {
      console.error(err);
      setOpenFlow({ step: 'error', message: describeOpenSeriesError(err) });
    }
  }

  return {
    openFlow,
    setOpenFlow,
    importFormat,
    fileInputRef,
    categories: categories ?? [],
    start,
    handleFormatChosen,
    handleFileSelected,
    openNewFromFile,
    handleDisambiguate,
    handleConfirmUpdate,
  };
}
