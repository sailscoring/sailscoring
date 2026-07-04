'use client';

import { useEffect, useState } from 'react';

import {
  deriveFinishState,
  entryKey,
  makeFinish,
  reorderWithTies,
  type FinishEntry,
  type NonFinisherCode,
} from '@/lib/finish-entry';
import type { Finish } from '@/lib/types';

export interface UseFinishRowOpsArgs {
  raceId: string;
  derived: ReturnType<typeof deriveFinishState>;
  saveFinish: { mutate: (f: Finish) => unknown };
  deleteFinish: { mutate: (input: { id: string; raceId: string }) => unknown };
  patchCache: (updater: (rows: Finish[]) => Finish[]) => void;
}

/**
 * Operations on committed finish rows: remove, tie-toggle, drag reorder,
 * timed-row re-slot, non-finisher code changes, plus the row-flash and
 * inline time-edit UI state those operations share. The sail-number entry
 * flow lives in `useFinishInput`, which reuses `commitOrderChange` and
 * `flashRow` from here.
 *
 * Ordering invariant: every mutation patches the per-race cache first, then
 * mutates — the shared `finishes` mutation scope serializes the writes (see
 * hooks/use-finishes.ts), so a follow-on edit reads the bumped version.
 */
export function useFinishRowOps(args: UseFinishRowOpsArgs) {
  const { raceId, derived, saveFinish, deleteFinish, patchCache } = args;
  const { finishingOrder, finishTimes, tiedWithPrevious, finishByEntryKey, finishByCompetitorId } = derived;

  // Entry-key of a row to briefly flash (recent auto-slot, scratch reorder).
  const [flashedRowId, setFlashedRowId] = useState<string | null>(null);
  // Per-row UI overlay for the finish-time inputs: while a row's input is
  // focused we show the in-progress text; on blur we normalize and persist.
  const [editingTimes, setEditingTimes] = useState<Map<string, string>>(new Map());

  // Clear the row flash after a short delay so the animation only plays
  // once per trigger.
  useEffect(() => {
    if (flashedRowId === null) return;
    const t = setTimeout(() => setFlashedRowId(null), 900);
    return () => clearTimeout(t);
  }, [flashedRowId]);

  /**
   * Apply a new ordered list of entries (with optional ties) to the
   * server: write distinct sortOrders and the `tiedWithPrevious` flag
   * for every row whose values changed. Caller is responsible for
   * inserts/deletes — this only renumbers + retags existing rows.
   */
  function commitOrderChange(targetOrder: FinishEntry[], targetTies: Set<string>) {
    // Resolve each entry to its finish id + target slot. We map via the derived
    // snapshot (entryKey -> finish id is stable across field edits) but spread
    // the *current* cache row as the base below — never the snapshot. Reslotting
    // after a finish-time edit patches the new time into the cache first, and
    // spreading the stale snapshot here would write the old time straight back.
    const targets = new Map<string, { sortOrder: number; tied: boolean }>();
    for (let i = 0; i < targetOrder.length; i++) {
      const finish = finishByEntryKey.get(entryKey(targetOrder[i]));
      if (!finish) continue;
      targets.set(finish.id, {
        sortOrder: i + 1,
        tied: i > 0 && targetTies.has(entryKey(targetOrder[i])),
      });
    }
    const updates: Finish[] = [];
    patchCache((rows) =>
      rows.map((r) => {
        const target = targets.get(r.id);
        if (!target) return r;
        if (r.sortOrder === target.sortOrder && r.tiedWithPrevious === target.tied) return r;
        const updated: Finish = { ...r, sortOrder: target.sortOrder, tiedWithPrevious: target.tied };
        updates.push(updated);
        return updated;
      }),
    );
    if (updates.length === 0) return;
    // Each row needs its own save (sortOrder + boolean both change). The
    // shared `finishes` mutation scope serializes these writes against
    // the per-row save path, so a follow-on edit waits for the last
    // reorder save's onSuccess to land the bumped version.
    for (const u of updates) saveFinish.mutate(u);
  }

  function removeFinisher(eid: string) {
    const finish = finishByEntryKey.get(eid);
    if (!finish) return;
    // Preserve startPresent across remove: if the row was checked in,
    // retain it as a check-in-only record (sortOrder=null, fields cleared).
    const next: Finish | null =
      finish.startPresent === true
        ? {
            ...finish,
            sortOrder: null,
            tiedWithPrevious: false,
            resultCode: null,
            penaltyCode: null,
            penaltyOverride: null,
            redressMethod: null,
            redressExcludeRaceIds: null,
            redressIncludeRaceIds: null,
            redressIncludeAllLater: false,
            redressPoints: null,
            ...(finish.finishTime ? { finishTime: undefined } : {}),
          }
        : null;
    if (next) {
      patchCache((rows) => rows.map((r) => (r.id === finish.id ? next : r)));
      saveFinish.mutate(next);
    } else {
      patchCache((rows) => rows.filter((r) => r.id !== finish.id));
      deleteFinish.mutate({ id: finish.id, raceId });
    }
    const remaining = finishingOrder.filter((e) => entryKey(e) !== eid);
    const remainingTies = new Set(tiedWithPrevious);
    remainingTies.delete(eid);
    commitOrderChange(remaining, remainingTies);
  }

  function toggleTiedWithPrevious(eid: string) {
    const newTies = new Set(tiedWithPrevious);
    if (newTies.has(eid)) newTies.delete(eid);
    else newTies.add(eid);
    commitOrderChange(finishingOrder, newTies);
  }

  /**
   * Move a scratch row from one index to another (drag-and-drop reorder).
   * No-op if either index is out of range or unchanged. Scratch rows can move
   * freely past timed rows; the moved row briefly flashes at its new position
   * as a visual confirmation. Timed rows are not draggable — their position is
   * determined by the time-order invariant.
   *
   * Ties ("tied with the row above") are recomputed: the row that followed the
   * moved row loses its tie unless the moved row was itself part of that group
   * (so the group continues above it), and the moved row's own tie is cleared
   * since its new predecessor differs.
   */
  function moveRowTo(fromIndex: number, toIndex: number) {
    const keys = finishingOrder.map(entryKey);
    const result = reorderWithTies(keys, tiedWithPrevious, fromIndex, toIndex);
    if (result.keys === keys) return; // no-op (equal or out-of-range indices)
    const byKey = new Map(finishingOrder.map((e) => [entryKey(e), e]));
    const nextOrder = result.keys
      .map((k) => byKey.get(k))
      .filter((e): e is FinishEntry => e !== undefined);
    setFlashedRowId(keys[fromIndex]);
    commitOrderChange(nextOrder, result.ties);
  }

  /**
   * Re-slot a row that already has a finish time after its time has been
   * edited so the time-order invariant holds. Scratch rows keep their
   * relative order; the moved row briefly flashes at its new position.
   */
  function reslotTimedRow(eid: string, nextTime: string) {
    const currentIndex = finishingOrder.findIndex((e) => entryKey(e) === eid);
    if (currentIndex === -1) return;
    const without = [
      ...finishingOrder.slice(0, currentIndex),
      ...finishingOrder.slice(currentIndex + 1),
    ];
    let insertAt = without.length;
    for (let i = 0; i < without.length; i++) {
      const otherId = entryKey(without[i]);
      if (otherId === eid) continue;
      const otherTime = finishTimes.get(otherId);
      if (otherTime !== undefined && otherTime > nextTime) {
        insertAt = i;
        break;
      }
    }
    if (insertAt === currentIndex) return;
    const reordered = [
      ...without.slice(0, insertAt),
      finishingOrder[currentIndex],
      ...without.slice(insertAt),
    ];
    setFlashedRowId(eid);
    commitOrderChange(reordered, tiedWithPrevious);
  }

  function setNonFinisherCode(competitorId: string, code: NonFinisherCode) {
    const existing = finishByCompetitorId.get(competitorId);
    if (code === 'implicit-dnc') {
      // "DNC (absent)" asserts the boat never came to the start: drop the
      // row entirely, check-in record included. A retained startPresent
      // would redisplay (and score) the boat as DNF, and a boat declared
      // absent must not count toward a starting-area penalty base. The
      // explicit DNC code below is the alternative that keeps the check-in.
      if (!existing) return;
      patchCache((rows) => rows.filter((r) => r.id !== existing.id));
      deleteFinish.mutate({ id: existing.id, raceId });
    } else if (existing) {
      // Clear redress fields when switching away from RDG to another code.
      const next: Finish = {
        ...existing,
        resultCode: code,
        sortOrder: null,
        tiedWithPrevious: false,
        redressMethod: null,
        redressExcludeRaceIds: null,
        redressIncludeRaceIds: null,
        redressIncludeAllLater: false,
        redressPoints: null,
      };
      patchCache((rows) => rows.map((r) => (r.id === existing.id ? next : r)));
      saveFinish.mutate(next);
    } else {
      const next = makeFinish(raceId, {
        id: crypto.randomUUID(),
        competitorId,
        sortOrder: null,
        resultCode: code,
      });
      patchCache((rows) => [...rows, next]);
      saveFinish.mutate(next);
    }
  }

  return {
    flashedRowId,
    flashRow: setFlashedRowId,
    editingTimes,
    setEditingTimes,
    commitOrderChange,
    removeFinisher,
    toggleTiedWithPrevious,
    moveRowTo,
    reslotTimedRow,
    setNonFinisherCode,
  };
}
