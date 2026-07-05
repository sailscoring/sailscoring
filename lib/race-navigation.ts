import type { Race } from './types';

/**
 * The races immediately before and after `currentId` in an ordered race list —
 * powering the prev/next pager in the race-entry switcher. Both are undefined
 * at the ends, and when `currentId` isn't in the list.
 */
export function adjacentRaces(
  races: Race[],
  currentId: string,
): { prev: Race | undefined; next: Race | undefined } {
  const i = races.findIndex((r) => r.id === currentId);
  if (i === -1) return { prev: undefined, next: undefined };
  return {
    prev: i > 0 ? races[i - 1] : undefined,
    next: i < races.length - 1 ? races[i + 1] : undefined,
  };
}
