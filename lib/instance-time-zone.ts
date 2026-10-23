/**
 * The instance's time zone: the IANA zone every local date and time in every
 * workspace and series is in — race dates, gun times, finish times — since
 * scorers enter them as clock times with no zone attached. The public data
 * file and the published indexes declare it as `timeZone`, and the results
 * renderer prints its "provisional as of" stamp in it.
 *
 * Defaults to `Europe/Dublin` (Sail Scoring's home instance is Irish),
 * overridable per deployment via `NEXT_PUBLIC_DEFAULT_TIMEZONE` — mirrors
 * `defaultSailCountry()` in `rating-match.ts`. A fixed zone matters because
 * publishing renders server-side on Vercel (UTC). An unset, empty, or invalid
 * value falls back to the default.
 *
 * The variable is read by its literal name so Next inlines it into the client
 * bundle, where downloads build the export.
 */
export function instanceTimeZone(): string {
  const tz = process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE?.trim();
  if (!tz) return 'Europe/Dublin';
  try {
    // Throws RangeError on an unrecognised IANA zone.
    new Intl.DateTimeFormat('en-IE', { timeZone: tz });
    return tz;
  } catch {
    return 'Europe/Dublin';
  }
}
