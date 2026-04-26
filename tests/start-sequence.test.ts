import { describe, it, expect } from 'vitest';
import { generateStarts } from '@/lib/start-sequence';
import type { StartGroup } from '@/lib/types';

describe('generateStarts', () => {
  it('returns empty array for empty groups', () => {
    expect(generateStarts([], '14:00:00')).toEqual([]);
  });

  it('generates a single start with no interval', () => {
    const groups: StartGroup[] = [
      { fleetIds: ['f1', 'f2'], intervalMinutes: 0 },
    ];
    expect(generateStarts(groups, '14:05:00')).toEqual([
      { fleetIds: ['f1', 'f2'], startTime: '14:05:00' },
    ]);
  });

  it('generates two starts separated by an interval', () => {
    const groups: StartGroup[] = [
      { fleetIds: ['ilca7', 'ilca6', 'ilca4'], intervalMinutes: 0 },
      { fleetIds: ['py', 'm15'], intervalMinutes: 3 },
    ];
    expect(generateStarts(groups, '14:05:00')).toEqual([
      { fleetIds: ['ilca7', 'ilca6', 'ilca4'], startTime: '14:05:00' },
      { fleetIds: ['py', 'm15'], startTime: '14:08:00' },
    ]);
  });

  it('accumulates intervals across three start groups', () => {
    const groups: StartGroup[] = [
      { fleetIds: ['c1'], intervalMinutes: 0 },
      { fleetIds: ['c2'], intervalMinutes: 5 },
      { fleetIds: ['c3'], intervalMinutes: 5 },
    ];
    expect(generateStarts(groups, '13:00:00')).toEqual([
      { fleetIds: ['c1'], startTime: '13:00:00' },
      { fleetIds: ['c2'], startTime: '13:05:00' },
      { fleetIds: ['c3'], startTime: '13:10:00' },
    ]);
  });

  it('handles start times near midnight', () => {
    const groups: StartGroup[] = [
      { fleetIds: ['f1'], intervalMinutes: 0 },
      { fleetIds: ['f2'], intervalMinutes: 5 },
    ];
    expect(generateStarts(groups, '23:57:00')).toEqual([
      { fleetIds: ['f1'], startTime: '23:57:00' },
      { fleetIds: ['f2'], startTime: '24:02:00' },
    ]);
  });

  it('ignores non-zero interval on first group', () => {
    const groups: StartGroup[] = [
      { fleetIds: ['f1'], intervalMinutes: 10 },
      { fleetIds: ['f2'], intervalMinutes: 3 },
    ];
    expect(generateStarts(groups, '14:00:00')).toEqual([
      { fleetIds: ['f1'], startTime: '14:00:00' },
      { fleetIds: ['f2'], startTime: '14:03:00' },
    ]);
  });
});
