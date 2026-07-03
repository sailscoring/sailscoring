import { replaceEqualDeep } from '@tanstack/react-query';

/**
 * `structuralSharing` guards for queries whose data is a versioned row (or a
 * list of them). React Query applies query results and `setQueryData` writes
 * last-resolve-wins: a refetch dispatched before a save can resolve after the
 * save's `onSuccess` and overwrite the fresh row with the pre-save one. The
 * poisoned cache then reverts any UI state synced from it until the next
 * refetch. Every server row carries a monotonically increasing `version`
 * (the CAS token), so the fix is cheap: never let a row with a lower version
 * replace one with a higher version.
 */

type VersionedRow = { id: string; version: number };

function asVersionedRow(value: unknown): VersionedRow | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const row = value as Partial<VersionedRow>;
  return typeof row.id === 'string' && typeof row.version === 'number'
    ? (row as VersionedRow)
    : undefined;
}

/** True when `incoming` is the same row as `cached` but an older snapshot. */
function isStaleSnapshot(cached: unknown, incoming: unknown): boolean {
  const prev = asVersionedRow(cached);
  const next = asVersionedRow(incoming);
  return prev !== undefined && next !== undefined && next.id === prev.id && next.version < prev.version;
}

/** Guard for a single-row query (e.g. the series detail, `Series | null`). */
export function keepNewerVersionedRow(oldData: unknown, newData: unknown): unknown {
  if (isStaleSnapshot(oldData, newData)) return oldData;
  return replaceEqualDeep(oldData, newData);
}

/**
 * Guard for a list-of-rows query (e.g. fleets by series). Per row: an
 * incoming snapshot older than the cached one keeps the cached row. The
 * incoming list still decides membership and order — a stale response can in
 * principle re-add a deleted row or drop a new one, but rows carry no
 * tombstones, so per-row versions are as far as the guard can see.
 */
export function keepNewerVersionedRows(oldData: unknown, newData: unknown): unknown {
  if (!Array.isArray(oldData) || !Array.isArray(newData)) {
    return replaceEqualDeep(oldData, newData);
  }
  const cachedById = new Map<string, unknown>();
  for (const row of oldData) {
    const versioned = asVersionedRow(row);
    if (versioned) cachedById.set(versioned.id, row);
  }
  const merged = newData.map((row) => {
    const versioned = asVersionedRow(row);
    const cached = versioned ? cachedById.get(versioned.id) : undefined;
    return cached !== undefined && isStaleSnapshot(cached, row) ? cached : row;
  });
  return replaceEqualDeep(oldData, merged);
}
