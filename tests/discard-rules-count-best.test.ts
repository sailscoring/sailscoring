import { describe, it, expect } from 'vitest';
import { describeCountBest, summarizeCountBest } from '@/lib/discard-rules';

describe('describeCountBest', () => {
  it('states what the series’ races give', () => {
    expect(describeCountBest(5, 18)).toEqual({ preview: 'With 18 races: 13 discards, 5 count.', warnings: [] });
    expect(describeCountBest(3, 4)).toEqual({ preview: 'With 4 races: 1 discard, 3 count.', warnings: [] });
    expect(describeCountBest(1, 1).preview).toBe('With 1 race: 0 discards, 1 counts.');
  });

  it('shows a ladder before the series has races', () => {
    expect(describeCountBest(5, 0).preview).toBe('6 races: 1 discard · 10 races: 5 · 15 races: 10');
    expect(describeCountBest(1, 0).preview).toBe('2 races: 1 discard · 3 races: 2');
  });

  it('warns when more races count than the series has', () => {
    const { preview, warnings } = describeCountBest(5, 3);
    expect(preview).toBe('With 3 races: 0 discards, 3 count.');
    expect(warnings).toEqual(['The series has 3 races, so every race counts until it has more than 5.']);
  });

  it('refuses a count of none', () => {
    expect(describeCountBest(0, 6)).toEqual({ preview: '', warnings: ['Enter how many races count — at least 1.'] });
  });
});

describe('summarizeCountBest', () => {
  it('reads as the sailing instructions would put it', () => {
    expect(summarizeCountBest(5)).toBe('Best 5 count');
  });
});
