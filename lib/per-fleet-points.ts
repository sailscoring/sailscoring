/**
 * Shared model for a scorer-stated point value that may differ per fleet for a
 * boat scored in more than one fleet — used by both the redress (RDG stated
 * points) and DPI penalty editors. The UI works in strings (`PerFleetPointsValue`);
 * `toStorage` normalises to the numeric `{ scalar, byFleet }` the `Finish`
 * fields use, and `seedFromFinish` builds the initial UI value from them.
 *
 * Storage convention (mirrors `Finish.redressPointsByFleet` /
 * `penaltyOverrideByFleet`): a populated `byFleet` map is the per-fleet-mode
 * signal and the source of truth — a fleet absent from it is a deliberate gap.
 * A bare `scalar` is the uniform value applied to every fleet, including ones
 * added later. The two are mutually exclusive: per-fleet storage carries no
 * stale scalar a new fleet could silently inherit.
 */

export type PerFleetPointsValue =
  | { mode: 'uniform'; value: string }
  | { mode: 'perFleet'; values: Record<string, string> };

/** Parse a points input string; blank/invalid → null. */
function parsePoints(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build the editor's initial value from the stored fields. A populated map
 * opens in per-fleet mode (one row per current fleet, blank where the map has
 * no entry); otherwise uniform.
 */
export function seedFromFinish(
  scalar: number | null,
  byFleet: Record<string, number> | null | undefined,
  fleetIds: string[],
): PerFleetPointsValue {
  if (byFleet && Object.keys(byFleet).length > 0) {
    const values: Record<string, string> = {};
    for (const id of fleetIds) {
      values[id] = Object.prototype.hasOwnProperty.call(byFleet, id) ? String(byFleet[id]) : '';
    }
    return { mode: 'perFleet', values };
  }
  return { mode: 'uniform', value: scalar != null ? String(scalar) : '' };
}

/**
 * Normalise an editor value to the stored numeric form for `fleetIds` (the
 * boat's current fleets). Per-fleet values that are present for *every* fleet
 * and all equal collapse to a uniform scalar (so future fleets inherit it);
 * blank per-fleet entries are dropped, leaving that fleet a gap.
 */
export function toStorage(
  value: PerFleetPointsValue,
  fleetIds: string[],
): { scalar: number | null; byFleet: Record<string, number> | undefined } {
  if (value.mode === 'uniform') {
    return { scalar: parsePoints(value.value), byFleet: undefined };
  }
  const byFleet: Record<string, number> = {};
  for (const id of fleetIds) {
    const n = parsePoints(value.values[id] ?? '');
    if (n != null) byFleet[id] = n;
  }
  const keys = Object.keys(byFleet);
  if (keys.length === 0) {
    return { scalar: null, byFleet: undefined };
  }
  // Collapse to uniform when every fleet has a value and they're all equal.
  if (keys.length === fleetIds.length) {
    const first = byFleet[keys[0]];
    if (keys.every((k) => byFleet[k] === first)) {
      return { scalar: first, byFleet: undefined };
    }
  }
  return { scalar: null, byFleet };
}
