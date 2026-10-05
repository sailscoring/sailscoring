/**
 * True and magnetic bearings. Every bearing and wind direction the app
 * stores is true: positions give true bearings, true does not depend on the
 * date, and the weather sources give wind in true. People on the water use
 * magnetic — sailors steer by compass, committees post the compass bearing
 * to the first mark, race officers read the wind off one — so the app shows
 * and takes magnetic by default, converting at the place and date the
 * figure belongs to, and labels every figure with its reference.
 *
 * The variation comes from the World Magnetic Model for that place and
 * date, never from a figure typed by hand, so a magnetic figure the app
 * shows never goes stale. Pure and client-safe.
 */

import { magvar } from 'magvar';

import type { Position } from '@sailscoring/course-cards';

/** Which north a bearing is measured from. */
export type BearingRef = 'M' | 'T';

/** The magnetic variation applied at a place and date: degrees, east
 *  positive (magnetic north east of true north), and the ISO date the model
 *  was read at. */
export interface Variation {
  deg: number;
  date: string;
}

/** The variation at a position on a day, from the World Magnetic Model. */
export function variationAt(position: Position, isoDate: string): Variation {
  const when = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  return { deg: magvar(position.lat, position.lng, 0, when), date: isoDate.slice(0, 10) };
}

/** Today as an ISO date in the scorer's own clock: what a figure with no
 *  race behind it — a library course, a mark — is converted at. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Where a set of positions is: their centroid. Undefined when there are
 *  none. Fine for a race area, which spans a few miles at most. */
export function centroid(positions: readonly Position[]): Position | undefined {
  if (positions.length === 0) return undefined;
  return {
    lat: positions.reduce((s, p) => s + p.lat, 0) / positions.length,
    lng: positions.reduce((s, p) => s + p.lng, 0) / positions.length,
  };
}

/** The variation for a course: at its own marks where it has any, else at
 *  the venue. Undefined when neither is known — the one case where figures
 *  have to stay in true. */
export function courseVariation(
  marks: readonly Position[],
  venue: Position | undefined,
  isoDate: string,
): Variation | undefined {
  const at = centroid(marks) ?? venue;
  return at ? variationAt(at, isoDate) : undefined;
}

const norm = (deg: number): number => ((deg % 360) + 360) % 360;

/** A true bearing in magnetic. */
export function toMagnetic(trueDeg: number, v: Variation): number {
  return norm(trueDeg - v.deg);
}

/** A bearing given in either reference, in true. A magnetic figure with no
 *  variation to apply cannot be converted, and is the caller's to refuse. */
export function toTrue(deg: number, ref: BearingRef, v: Variation | undefined): number {
  if (ref === 'T') return deg;
  if (!v) throw new Error('a magnetic bearing needs a variation to convert');
  return norm(deg + v.deg);
}

/** A figure to 0.1°, with no trailing ".0": what an entry field holds and
 *  what a leg table prints. 359.96 reads 0, not 360. */
export function formatDeg(deg: number): string {
  const r = Math.round(norm(deg) * 10) / 10;
  return String(r === 360 ? 0 : r);
}

/** A stored (true) bearing as a figure in the given reference, for an entry
 *  field. Magnetic is worked from the unrounded true value, then rounded. */
export function bearingFigure(trueDeg: number, ref: BearingRef, v: Variation | undefined): string {
  return formatDeg(ref === 'M' && v ? toMagnetic(trueDeg, v) : trueDeg);
}

/** The reference figures are shown and taken in: magnetic wherever a
 *  variation is known, else true. */
export function defaultRef(v: Variation | undefined): BearingRef {
  return v ? 'M' : 'T';
}

/**
 * A stored (true) bearing, labelled: `174°M`, or `174°M (172°T)` with
 * `both`, or `172°T` where no variation is known. `whole` rounds to whole
 * degrees, for a summary line rather than a leg table.
 */
export function formatBearing(
  trueDeg: number,
  v: Variation | undefined,
  opts: { both?: boolean; whole?: boolean } = {},
): string {
  const fmt = (deg: number) => {
    if (!opts.whole) return formatDeg(deg);
    const r = Math.round(norm(deg));
    return String(r === 360 ? 0 : r).padStart(3, '0');
  };
  if (!v) return `${fmt(trueDeg)}°T`;
  const m = `${fmt(toMagnetic(trueDeg, v))}°M`;
  return opts.both ? `${m} (${fmt(trueDeg)}°T)` : m;
}

/** "1.7°W": a variation as a chart states it. */
export function formatVariation(v: Variation): string {
  const r = Math.round(Math.abs(v.deg) * 10) / 10;
  return r === 0 ? '0°' : `${r}°${v.deg < 0 ? 'W' : 'E'}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "variation 1.7°W (World Magnetic Model, 6 Sep 2026)": what was applied,
 *  so a reader can check it or undo it. */
export function describeVariation(v: Variation): string {
  const [y, m, d] = v.date.split('-').map(Number);
  return `variation ${formatVariation(v)} (World Magnetic Model, ${d} ${MONTHS[m - 1]} ${y})`;
}

/**
 * A bearing as typed: a number from 0 to 360, optionally followed by the
 * reference it is in (`105`, `105M`, `105°M`, `103.1 T`). A figure with no
 * reference is in `fallback`. Null for anything else.
 */
export function parseBearing(text: string, fallback: BearingRef): { deg: number; ref: BearingRef } | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[°º]?\s*([MmTt])?\s*$/.exec(text);
  if (!m) return null;
  const deg = Number(m[1]);
  if (!Number.isFinite(deg) || deg < 0 || deg > 360) return null;
  return { deg, ref: m[2] ? (m[2].toUpperCase() as BearingRef) : fallback };
}

/**
 * An entry field's text in true, ready to store. `kept` is the stored true
 * value the field was filled from, with the text it was filled as: while
 * the scorer has not changed the text, the stored value comes back exactly,
 * so opening a course and saving it never moves a bearing by a rounding.
 * Null when the text is not a bearing, or is magnetic with no variation to
 * apply.
 */
export function enteredTrue(
  text: string,
  ref: BearingRef,
  v: Variation | undefined,
  kept?: { text: string; trueDeg: number },
): number | null {
  if (kept && kept.text.trim() === text.trim()) return kept.trueDeg;
  const parsed = parseBearing(text, ref);
  if (!parsed || (parsed.ref === 'M' && !v)) return null;
  return toTrue(parsed.deg, parsed.ref, v);
}
