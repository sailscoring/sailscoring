'use client';

import type { Competitor, Finish } from '@/lib/types';

export interface UseStartCheckInArgs {
  raceId: string;
  competitors: Competitor[];
  savedFinishes: Finish[] | undefined;
  /** Competitors currently in the finishing order (implicitly present). */
  finishedIds: Set<string>;
  saveFinish: { mutateAsync: (f: Finish) => Promise<unknown> };
  deleteFinish: { mutateAsync: (input: { id: string; raceId: string }) => Promise<unknown> };
}

/**
 * Start check-in presence: who is effectively at the start (explicitly
 * checked in, or in the finishing order and not explicitly un-checked),
 * and the toggle that persists a check-in change. Check-in writes go
 * straight through the mutations (no optimistic cache patch) — the tab
 * is a deliberate-click surface, not the rapid-entry path.
 */
export function useStartCheckIn(args: UseStartCheckInArgs) {
  const { raceId, competitors, savedFinishes, finishedIds, saveFinish, deleteFinish } = args;

  // A competitor is effectively present if they are in the unsaved finishing
  // order OR explicitly checked in via savedFinishes, unless they have been
  // explicitly un-checked (startPresent === false).
  const explicitlyAbsentIds = new Set(
    (savedFinishes ?? [])
      .filter((f): f is Finish & { competitorId: string } => f.competitorId !== null && f.startPresent === false)
      .map((f) => f.competitorId),
  );
  const effectivelyPresent = (id: string) =>
    !explicitlyAbsentIds.has(id) &&
    (finishedIds.has(id) || (savedFinishes?.some((f) => f.competitorId === id && f.startPresent === true) ?? false));
  const presentCount = competitors.filter((c) => effectivelyPresent(c.id)).length;

  async function toggleStartPresent(competitor: Competitor) {
    const existing = savedFinishes?.find((f) => f.competitorId === competitor.id);
    const isExplicitlyAbsent = existing?.startPresent === false;
    // A finisher in the unsaved finishing order is implicitly present unless explicitly un-checked
    const isImplicitlyPresent = finishedIds.has(competitor.id) && !isExplicitlyAbsent;
    const isPresent = existing?.startPresent === true || isImplicitlyPresent;

    if (isPresent) {
      // Un-check: remove startPresent flag
      if (existing && existing.sortOrder === null && existing.resultCode === null) {
        if (isImplicitlyPresent) {
          // Check-in-only record but competitor is also in finishing order — mark explicitly absent
          await saveFinish.mutateAsync({ ...existing, startPresent: false });
        } else {
          // Pure check-in-only record — delete it entirely
          await deleteFinish.mutateAsync({ id: existing.id, raceId });
        }
      } else if (existing) {
        // Has other data — clear just the flag
        await saveFinish.mutateAsync({ ...existing, startPresent: false });
      } else {
        // Implicitly present via finishing order but no DB record yet — create explicit absence record
        await saveFinish.mutateAsync({
          id: crypto.randomUUID(),
          raceId,
          competitorId: competitor.id,
          sortOrder: null,
          tiedWithPrevious: false,
          resultCode: null,
          startPresent: false,
          penaltyCode: null,
          penaltyOverride: null,
          redressMethod: null,
          redressExcludeRaces: null,
          redressIncludeRaces: null,
          redressIncludeAllLater: false,
          redressPoints: null,
        });
      }
    } else {
      // Check: set startPresent = true
      if (existing) {
        await saveFinish.mutateAsync({ ...existing, startPresent: true });
      } else {
        await saveFinish.mutateAsync({
          id: crypto.randomUUID(),
          raceId,
          competitorId: competitor.id,
          sortOrder: null,
          tiedWithPrevious: false,
          resultCode: null,
          startPresent: true,
          penaltyCode: null,
          penaltyOverride: null,
          redressMethod: null,
          redressExcludeRaces: null,
          redressIncludeRaces: null,
          redressIncludeAllLater: false,
          redressPoints: null,
        });
      }
    }
  }

  return { presentCount, effectivelyPresent, toggleStartPresent };
}
