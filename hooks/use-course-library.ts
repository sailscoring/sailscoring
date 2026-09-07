'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  deleteSeriesCourse,
  deleteSeriesMark,
  seriesCourseRepo,
  seriesMarkRepo,
} from '@/lib/api-repository';
import type { SeriesCourse, SeriesMark } from '@/lib/types';

import { queryKeys } from './query-keys';
import { useVersionedSave } from './use-versioned-save';

/** The course library (ORC constructed courses): the series' marks and
 *  courses, and the mutations on them. */

export function useSeriesMarks(seriesId: string, opts?: { enabled?: boolean }) {
  return useQuery<SeriesMark[]>({
    queryKey: queryKeys.seriesMarks.bySeries(seriesId),
    queryFn: () => seriesMarkRepo.listBySeries(seriesId),
    enabled: opts?.enabled ?? true,
  });
}

export function useSeriesCourses(seriesId: string, opts?: { enabled?: boolean }) {
  return useQuery<SeriesCourse[]>({
    queryKey: queryKeys.seriesCourses.bySeries(seriesId),
    queryFn: () => seriesCourseRepo.listBySeries(seriesId),
    enabled: opts?.enabled ?? true,
  });
}

export function useSaveSeriesMark() {
  return useVersionedSave<SeriesMark>({
    listKey: (m) => queryKeys.seriesMarks.bySeries(m.seriesId),
    readCachedVersion: (qc, m) =>
      qc.getQueryData<SeriesMark[]>(queryKeys.seriesMarks.bySeries(m.seriesId))?.find((x) => x.id === m.id)?.version,
    save: (m, opts) => seriesMarkRepo.save(m, opts),
    scopeId: 'seriesMarks',
    onSaved: async (qc, saved) => {
      await qc.invalidateQueries({ queryKey: queryKeys.seriesMarks.bySeries(saved.seriesId) });
      qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
  });
}

/** Adopt a card's marks in one write. */
export function useSaveSeriesMarks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (marks: SeriesMark[]) => seriesMarkRepo.saveMany(marks),
    onSuccess: async (_void, marks) => {
      if (marks.length === 0) return;
      await qc.invalidateQueries({ queryKey: queryKeys.seriesMarks.bySeries(marks[0].seriesId) });
      qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
  });
}

export function useDeleteSeriesMark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ seriesId, markId }: { seriesId: string; markId: string }) =>
      deleteSeriesMark(seriesId, markId),
    onSuccess: async (_void, { seriesId }) => {
      await qc.invalidateQueries({ queryKey: queryKeys.seriesMarks.bySeries(seriesId) });
      qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
  });
}

export function useSaveSeriesCourse() {
  return useVersionedSave<SeriesCourse>({
    listKey: (c) => queryKeys.seriesCourses.bySeries(c.seriesId),
    readCachedVersion: (qc, c) =>
      qc.getQueryData<SeriesCourse[]>(queryKeys.seriesCourses.bySeries(c.seriesId))?.find((x) => x.id === c.id)?.version,
    save: (c, opts) => seriesCourseRepo.save(c, opts),
    scopeId: 'seriesCourses',
    onSaved: async (qc, saved) => {
      await qc.invalidateQueries({ queryKey: queryKeys.seriesCourses.bySeries(saved.seriesId) });
      qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
  });
}

export function useDeleteSeriesCourse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ seriesId, courseId }: { seriesId: string; courseId: string }) =>
      deleteSeriesCourse(seriesId, courseId),
    onSuccess: async (_void, { seriesId }) => {
      await qc.invalidateQueries({ queryKey: queryKeys.seriesCourses.bySeries(seriesId) });
      qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
  });
}
