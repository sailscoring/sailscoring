import { describe, expect, it } from 'vitest';

import {
  currentFields,
  emptyLegRow,
  rowCurrent,
  rowsInRef,
  type BearingDisplay,
} from '../components/constructed-course/leg-table';

// Cork Harbour in November 2026: magnetic north a couple of degrees west of
// true.
const variation = { deg: -2, date: '2026-11-01' };
const magnetic: BearingDisplay = { ref: 'M', variation };
const trueNorth: BearingDisplay = { ref: 'T' };

describe("a leg's current in the leg table", () => {
  it('is none where both fields are blank', () => {
    expect(rowCurrent(emptyLegRow(), magnetic)).toEqual({ ok: true });
  });

  it('is typed in the table’s north and stored true', () => {
    const row = emptyLegRow({ currentSet: '180', currentRate: '0.5' });
    expect(rowCurrent(row, magnetic)).toEqual({ ok: true, current: { directionDeg: 178, speedKts: 0.5 } });
    expect(rowCurrent(row, trueNorth)).toEqual({ ok: true, current: { directionDeg: 180, speedKts: 0.5 } });
  });

  it('saves a stored figure back exactly where the field was left alone', () => {
    const row = emptyLegRow(currentFields({ currentSpeedKts: 0.5, currentDirectionDeg: 177.73 }, magnetic));
    expect(row.currentSet).toBe('179.7');
    expect(row.currentRate).toBe('0.5');
    expect(rowCurrent(row, magnetic)).toEqual({ ok: true, current: { directionDeg: 177.73, speedKts: 0.5 } });
  });

  it('fills nothing from a leg with no current', () => {
    expect(currentFields({}, magnetic)).toEqual({});
  });

  it('needs both the direction and the rate', () => {
    const half = rowCurrent(emptyLegRow({ currentSet: '180' }), magnetic);
    expect(half.ok).toBe(false);
    expect(rowCurrent(emptyLegRow({ currentRate: '0.5' }), magnetic).ok).toBe(false);
    if (!half.ok) expect(half.error).toContain('both');
  });

  it('refuses a direction or a rate that does not read', () => {
    expect(rowCurrent(emptyLegRow({ currentSet: '400', currentRate: '0.5' }), magnetic).ok).toBe(false);
    expect(rowCurrent(emptyLegRow({ currentSet: '180', currentRate: 'fast' }), magnetic).ok).toBe(false);
    expect(rowCurrent(emptyLegRow({ currentSet: '180', currentRate: '25' }), magnetic).ok).toBe(false);
  });

  it('is re-shown with the bearings when the table changes north', () => {
    const [row] = rowsInRef([emptyLegRow({ currentSet: '180', currentRate: '0.5' })], magnetic, { ref: 'T', variation });
    expect(row.currentSet).toBe('178');
    expect(row.currentRate).toBe('0.5');
  });
});
