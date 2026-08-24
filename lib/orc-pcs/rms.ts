/**
 * Fixed-width RMS certificate parsing — the ORC database's legacy per-boat
 * line format, still served alongside the JSON. Ported from the reference
 * module's SetFromRMS: only the allowance block PCS needs is read (the JSON
 * feed is the primary format; RMS matters for scoring older reference
 * fixtures and RMS-only integrations).
 */

import type { PcsAllowances } from './pcs';

const WIND_SPEEDS_STD = [6, 8, 10, 12, 14, 16, 20];
const WIND_SPEEDS_2024 = [6, 8, 10, 12, 14, 16, 20, 24];

const WIND_ANGLES = [52, 60, 75, 90, 110, 120, 135, 150];

/** Delphi Copy(s, pos, len) — 1-based. */
function copy(s: string, pos: number, len: number): string {
  return s.substring(pos - 1, pos - 1 + len);
}

function readRow(s: string, base: number, width: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(Number.parseFloat(copy(s, base + i * width, width).trim()));
  }
  return out;
}

/** Parse one RMS line's allowance matrix into the JSON `Allowances` shape.
 *  Certificates issued before 2024 tabulate seven wind speeds; 2024-era
 *  lines append the 24 kt column in a tail block. */
export function parseRmsAllowances(rms: string): PcsAllowances {
  const year = Number.parseInt(copy(rms, 1255, 6).trim(), 10) || 0;
  const is2024 = year >= 2024;
  const windSpeeds = is2024 ? WIND_SPEEDS_2024 : WIND_SPEEDS_STD;

  const base: Record<string, number[]> = {
    WL: readRow(rms, 374, 7, 7),
    CR: readRow(rms, 472, 7, 7),
    OC: readRow(rms, 570, 7, 7),
    BeatAngle: readRow(rms, 619, 6, 7),
    GybeAngle: readRow(rms, 661, 6, 7),
    Beat: readRow(rms, 703, 7, 7),
  };
  WIND_ANGLES.forEach((angle, i) => {
    base[`R${angle}`] = readRow(rms, 752 + i * 49, 7, 7);
  });
  base.Run = readRow(rms, 1144, 7, 7);

  if (is2024) {
    const tail: Array<[string, number]> = [
      ['WL', 1460],
      ['CR', 1467],
      ['OC', 1474],
      ['BeatAngle', 1481],
      ['GybeAngle', 1488],
      ['Beat', 1495],
    ];
    WIND_ANGLES.forEach((angle, i) => {
      tail.push([`R${angle}`, 1502 + i * 7]);
    });
    tail.push(['Run', 1558]);
    for (const [key, pos] of tail) {
      base[key] = [...base[key], Number.parseFloat(copy(rms, pos, 6).trim()) || 0];
    }
  }

  return { WindSpeeds: windSpeeds, WindAngles: WIND_ANGLES, ...base };
}
