/** The World Magnetic Model package ships no types; this is the part used. */
declare module 'magvar' {
  /** Magnetic variation (declination) in degrees, east positive, rounded to
   *  0.01°. `altitude` is in kilometres; `when` a decimal year or a Date. */
  export function magvar(latitude: number, longitude: number, altitude?: number, when?: number | Date): number;
}
