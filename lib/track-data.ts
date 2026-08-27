import { formatElapsedInput } from './time-parse';
import type { FinishTrackData } from './types';

/**
 * Reading RaceSense track data for display.
 *
 * One module so the published columns and the app's own surfaces render the
 * same numbers the same way: the published race table maps these readers into
 * its column spec, and the finish sheet composes them into a per-boat line.
 * The only place the two differ is the distance to the line, where the
 * published column keeps the signed value that sorts and the app spells the
 * sign out in words.
 *
 * Nothing here is scored. These are recordings of how a boat sailed, shown
 * back to whoever wants to look at them.
 */

/** What a reader takes from a finish row: the times riding on the row itself,
 *  and the metrics the RaceSense import recorded. */
export interface TrackDataCell {
  finishTime?: string | null;
  elapsedSecs?: number | null;
  trackData?: FinishTrackData | null;
}

/** True when the import actually recorded something for this boat.
 *
 *  Elapsed time deliberately does not count. It can come from a stopwatch on
 *  the finish boat, so counting it would claim track data on every row of a
 *  hand-timed race. */
export function hasTrackData(t: FinishTrackData | null | undefined): boolean {
  return t != null
    && (t.dtlAtStartM != null || t.distanceKm != null || t.maxSpeedKts != null);
}

/** Average speed in knots, from the distance sailed and the elapsed time; the
 *  one derived figure, never stored, so it cannot drift from its inputs. */
export function avgSpeedKn(c: TrackDataCell): number | null {
  const km = c.trackData?.distanceKm;
  const secs = c.elapsedSecs;
  if (km == null || secs == null || secs <= 0) return null;
  return (km / 1.852) / (secs / 3600);
}

// Each reader renders one metric, or an empty string when the boat has none —
// which is how a column decides it has nothing to show.

export function finishTimeText(c: TrackDataCell | undefined): string {
  return c?.finishTime ?? '';
}

export function elapsedText(c: TrackDataCell | undefined): string {
  return c?.elapsedSecs != null ? formatElapsedInput(Math.round(c.elapsedSecs)) : '';
}

export function distanceKmText(c: TrackDataCell | undefined): string {
  return c?.trackData?.distanceKm != null ? String(c.trackData.distanceKm) : '';
}

export function avgSpeedKnText(c: TrackDataCell | undefined): string {
  const kn = c ? avgSpeedKn(c) : null;
  return kn != null ? kn.toFixed(2) : '';
}

export function maxSpeedKtsText(c: TrackDataCell | undefined): string {
  return c?.trackData?.maxSpeedKts != null ? String(c.trackData.maxSpeedKts) : '';
}

/** Distance to the line at the starting signal, as stored. Signed, so a
 *  published column sorts the boats over the line to one end. */
export function dtlAtStartText(c: TrackDataCell | undefined): string {
  return c?.trackData?.dtlAtStartM != null ? String(c.trackData.dtlAtStartM) : '';
}

/** The same figure for the app's own surfaces, where there is no column
 *  header to explain the sign.
 *
 *  The device writes a negative distance for a boat over the line at the gun:
 *  across a full Worlds fleet every OCS boat read negative and every clean
 *  starter positive. So the words say which side of the line the boat was on
 *  and the number is left as a magnitude, rounded to the tenth of a metre
 *  that a reader can do anything with. */
export function dtlAtStartWords(c: TrackDataCell | undefined): string {
  const m = c?.trackData?.dtlAtStartM;
  if (m == null) return '';
  return m < 0 ? `${Math.abs(m).toFixed(1)} m over` : `${m.toFixed(1)} m to line`;
}

/** The whole of a boat's track data as one line of segments, for the finish
 *  sheet. Segments a boat has nothing for are dropped rather than blanked —
 *  the line is prose, not a row of cells. */
export function trackDataStrip(c: TrackDataCell | undefined): string[] {
  const elapsed = elapsedText(c);
  const distance = distanceKmText(c);
  const avg = avgSpeedKnText(c);
  const max = maxSpeedKtsText(c);
  const dtl = dtlAtStartWords(c);
  return [
    elapsed && `Elapsed ${elapsed}`,
    distance && `${distance} km`,
    avg && `${avg} kn avg`,
    max && `${max} kn max`,
    dtl,
  ].filter((s): s is string => s !== '');
}
