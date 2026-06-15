import { describe, expect, it } from 'vitest';

import {
  clusterCompetitors,
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
