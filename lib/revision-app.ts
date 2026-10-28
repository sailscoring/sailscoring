import type { ActivityEntry } from '@/lib/types';

/**
 * The outside app a revision's changes were all made through, if there is
 * one: what History names beside the person ("Pat Tanner via Cork Harbour
 * Course Plot"). A revision coalesces one person's edits, so it can mix
 * edits made in the app with edits made through an outside app, or through
 * two apps; then nothing is named here and each change says its own.
 */
export function revisionApp(
  captured: readonly Pick<ActivityEntry, 'via'>[],
): { clientId: string; name: string } | null {
  const first = captured[0]?.via;
  if (!first) return null;
  return captured.every((a) => a.via?.clientId === first.clientId) ? first : null;
}
