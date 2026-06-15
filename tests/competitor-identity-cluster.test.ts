import { describe, expect, it } from 'vitest';

import {
  clusterCompetitors,
  isLongArc,
  type ClusterInput,
} from '@/lib/competitor-identity-cluster';

let seq = 0;
function row(p: Partial<ClusterInput> & { name: string }): ClusterInput {
  return {
    competitorId: p.competitorId ?? `c${seq++}`,
    name: p.name,
    sailNumber: p.sailNumber ?? '',
    club: p.club,
    nationality: p.nationality,
    age: p.age ?? null,
    raceYear: p.raceYear ?? null,
    existingIdentityId: p.existingIdentityId ?? null,
  };
}

/** The cluster a given competitorId landed in. */
function clusterOf(
  result: ReturnType<typeof clusterCompetitors>,
  competitorId: string,
) {
  return result.clusters.find((c) => c.competitorIds.includes(competitorId));
}

describe('clusterCompetitors', () => {
  it('links a career across a sail-number change via name + club', () => {
    const r = clusterCompetitors([
      row({ competitorId: 'a', name: 'Aoife Murphy', sailNumber: 'IRL1200', club: 'RCYC', raceYear: 2018 }),
      row({ competitorId: 'b', name: 'Aoife Murphy', sailNumber: 'IRL1599', club: 'RCYC', raceYear: 2021 }),
    ]);
    const c = clusterOf(r, 'a');
    expect(c?.competitorIds.sort()).toEqual(['a', 'b']);
    // Representative is the most-recent row.
    expect(c?.sailNumber).toBe('IRL1599');
    expect(c?.firstYear).toBe(2018);
    expect(c?.lastYear).toBe(2021);
  });

  it('links across a sail-number change when the country prefix is dropped', () => {
    const r = clusterCompetitors([
      row({ competitorId: 'a', name: 'John Keating', sailNumber: '1431', club: 'HYC', raceYear: 2015 }),
      row({ competitorId: 'b', name: 'J Keating', sailNumber: 'IRL1431', club: 'HYC', raceYear: 2016 }),
    ]);
    expect(clusterOf(r, 'a')?.competitorIds.sort()).toEqual(['a', 'b']);
  });

  it('splits namesakes at different clubs into separate clusters (no corroboration)', () => {
    const r = clusterCompetitors([
      row({ competitorId: 'a', name: 'John Murphy', sailNumber: 'IRL1000', club: 'MYC', raceYear: 2012 }),
      row({ competitorId: 'b', name: 'John Murphy', sailNumber: 'IRL2000', club: 'KYC', raceYear: 2019 }),
    ]);
    expect(clusterOf(r, 'a')?.competitorIds).toEqual(['a']);
    expect(clusterOf(r, 'b')?.competitorIds).toEqual(['b']);
    // But it's surfaced as a review suggestion, not silently dropped.
    expect(r.suggestions).toHaveLength(1);
  });

  it('splits namesakes by conflicting implied birth year even if other signals align', () => {
    const r = clusterCompetitors([
      // Same name + same club, but ages imply births 6 years apart → two people.
      row({ competitorId: 'a', name: 'Sean Byrne', sailNumber: 'IRL1', club: 'NYC', age: 14, raceYear: 2014 }),
      row({ competitorId: 'b', name: 'Sean Byrne', sailNumber: 'IRL2', club: 'NYC', age: 9, raceYear: 2023 }),
    ]);
    expect(clusterOf(r, 'a')?.competitorIds).toEqual(['a']);
    expect(clusterOf(r, 'b')?.competitorIds).toEqual(['b']);
    // A birth-year conflict is a hard split, not even a suggestion.
    expect(r.suggestions).toHaveLength(0);
  });

  it('links namesakes when implied birth year agrees within a year', () => {
    const r = clusterCompetitors([
      row({ competitorId: 'a', name: 'Sean Byrne', sailNumber: 'IRL1', club: 'NYC', age: 13, raceYear: 2014 }),
      row({ competitorId: 'b', name: 'Sean Byrne', sailNumber: 'IRL2', club: 'CYC', age: 14, raceYear: 2015 }),
    ]);
    expect(clusterOf(r, 'a')?.competitorIds.sort()).toEqual(['a', 'b']);
  });

  it('keeps different first names with a shared surname apart', () => {
    const r = clusterCompetitors([
      row({ competitorId: 'a', name: 'Jack Keating', sailNumber: 'IRL1', club: 'HYC', raceYear: 2015 }),
      row({ competitorId: 'b', name: 'John Keating', sailNumber: 'IRL1', club: 'HYC', raceYear: 2015 }),
    ]);
    expect(clusterOf(r, 'a')?.competitorIds).toEqual(['a']);
    expect(clusterOf(r, 'b')?.competitorIds).toEqual(['b']);
    expect(r.suggestions).toHaveLength(0); // not even a suggestion — distinct names
  });

  it('does not let a bare-surname row bridge siblings into one identity', () => {
    // The real Dempsey over-merge: three siblings at one club, boats handed
    // down, ages partly missing — plus a lone "Dempsey" row. The bare row must
    // not fuse Ella, Edward and Jonathan into a single 12-year "career".
    const r = clusterCompetitors([
      row({ competitorId: 'ella1', name: 'Ella Dempsey', sailNumber: '1423', club: 'NYC', raceYear: 2013 }),
      row({ competitorId: 'ella2', name: 'Ella Dempsey', sailNumber: '1423', club: 'NYC', age: 11, raceYear: 2016 }),
      row({ competitorId: 'ed1', name: 'Edward Dempsey', sailNumber: '1274', club: 'NYC', age: 9, raceYear: 2015 }),
      row({ competitorId: 'ed2', name: 'Edward Dempsey', sailNumber: '1423', club: 'NYC', raceYear: 2019 }),
      row({ competitorId: 'bare', name: 'Dempsey', sailNumber: '1274', club: 'NYC', age: 9, raceYear: 2019 }),
      row({ competitorId: 'jon1', name: 'Jonathan Dempsey', sailNumber: '1605', club: 'NYC', age: 11, raceYear: 2021 }),
      row({ competitorId: 'jon2', name: 'Jonathan Dempsey', sailNumber: '1605', club: 'NYC', age: 15, raceYear: 2025 }),
    ]);
    // Each sibling clusters with their own rows only.
    expect(clusterOf(r, 'ella1')?.competitorIds.sort()).toEqual(['ella1', 'ella2']);
    expect(clusterOf(r, 'ed1')?.competitorIds.sort()).toEqual(['ed1', 'ed2']);
    expect(clusterOf(r, 'jon1')?.competitorIds.sort()).toEqual(['jon1', 'jon2']);
    // The bare-surname row stays a singleton.
    expect(clusterOf(r, 'bare')?.competitorIds).toEqual(['bare']);
    // And nothing reads as a long arc any more.
    expect(r.stats.longArcs).toBe(0);
  });

  it('is idempotent: pre-seeds clusters from existing identity links', () => {
    const r = clusterCompetitors([
      // Two rows the matcher would NOT link on its own (different club, no age),
      // but a prior pass confirmed them as one identity.
      row({ competitorId: 'a', name: 'Niamh Walsh', sailNumber: 'IRL1', club: 'MYC', raceYear: 2012, existingIdentityId: 'id-1' }),
      row({ competitorId: 'b', name: 'Niamh Walsh', sailNumber: 'IRL9', club: 'KYC', raceYear: 2019, existingIdentityId: 'id-1' }),
    ]);
    const c = clusterOf(r, 'a');
    expect(c?.competitorIds.sort()).toEqual(['a', 'b']);
    expect(c?.existingIdentityIds).toEqual(['id-1']);
  });

  it('flags a cluster that spans two confirmed identities as a conflict', () => {
    const r = clusterCompetitors([
      row({ competitorId: 'a', name: 'Tom Daly', sailNumber: 'IRL5', club: 'RCYC', raceYear: 2018, existingIdentityId: 'id-1' }),
      // Strong signal (same name+club+sail) would merge, but each carries a
      // different confirmed identity → must not auto-merge.
      row({ competitorId: 'b', name: 'Tom Daly', sailNumber: 'IRL5', club: 'RCYC', raceYear: 2019, existingIdentityId: 'id-2' }),
    ]);
    const c = clusterOf(r, 'a');
    expect(c?.existingIdentityIds.sort()).toEqual(['id-1', 'id-2']);
    expect(r.stats.conflicts).toBe(1);
  });

  it('flags an implausibly long arc as a probable over-merge', () => {
    // Same name, club and reused club sail number across 12 years — with no
    // recorded age the matcher fuses them, but the span betrays an over-merge.
    const r = clusterCompetitors([
      row({ competitorId: 'a', name: 'Jonathan Dempsey', sailNumber: '1605', club: 'NYC', raceYear: 2013 }),
      row({ competitorId: 'b', name: 'Jonathan Dempsey', sailNumber: '1605', club: 'NYC', raceYear: 2025 }),
    ]);
    const c = clusterOf(r, 'a')!;
    expect(c.competitorIds.sort()).toEqual(['a', 'b']); // still merged…
    expect(isLongArc(c)).toBe(true); // …but flagged
    expect(r.stats.longArcs).toBe(1);
  });

  it('does not flag a plausible career span', () => {
    const r = clusterCompetitors([
      row({ competitorId: 'a', name: 'Holly Cantwell', sailNumber: 'IRL1641', club: 'RSGYC', raceYear: 2021 }),
      row({ competitorId: 'b', name: 'Holly Cantwell', sailNumber: 'IRL1641', club: 'RSGYC', raceYear: 2026 }),
    ]);
    expect(r.stats.longArcs).toBe(0);
  });

  it('reports stats: singletons, multi-row clusters and surname-less rows', () => {
    const r = clusterCompetitors([
      row({ competitorId: 'a', name: 'Mark Field', sailNumber: 'IRL1', club: 'HYC', raceYear: 2020 }),
      row({ competitorId: 'b', name: 'Mark Field', sailNumber: 'IRL1', club: 'HYC', raceYear: 2021 }),
      row({ competitorId: 'c', name: 'Solo Sailor', sailNumber: 'IRL3', club: 'HYC', raceYear: 2021 }),
      row({ competitorId: 'd', name: '', sailNumber: 'IRL4', raceYear: 2021 }), // unparseable
    ]);
    expect(r.stats.competitors).toBe(4);
    expect(r.stats.withoutSurname).toBe(1);
    expect(r.stats.multiRowClusters).toBe(1);
    expect(r.stats.largestCluster).toBe(2);
  });
});
