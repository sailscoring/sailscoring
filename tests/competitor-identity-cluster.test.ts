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
    ...(p.role ? { role: p.role } : {}),
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

  it('links a career when the one club is spelled two ways', () => {
    // A single-club workspace states the club on nearly every row and spells
    // it however the entry form was filled in. Under a plain normalisation
    // "KSC" and "Killaloe Sailing Club" are two clubs, and neither ever
    // corroborates the other.
    const r = clusterCompetitors([
      row({ competitorId: 'a', name: 'Frank Larkin', sailNumber: '189732', club: 'KSC', raceYear: 2019 }),
      row({ competitorId: 'b', name: 'Frank Larkin', sailNumber: '211044', club: 'Killaloe Sailing Club', raceYear: 2024 }),
    ]);
    expect(clusterOf(r, 'a')?.competitorIds.sort()).toEqual(['a', 'b']);
    expect(r.suggestions).toHaveLength(0);
  });

  it('will not fold an acronym two clubs in the corpus answer to', () => {
    // Howth and Holywood are both HYC. A bare "HYC" names neither, so the
    // match stays a suggestion rather than becoming a link.
    const r = clusterCompetitors([
      row({ competitorId: 'a', name: 'Ruth Ennis', sailNumber: '400', club: 'HYC', raceYear: 2019 }),
      row({ competitorId: 'b', name: 'Ruth Ennis', sailNumber: '811', club: 'Howth Yacht Club', raceYear: 2024 }),
      row({ competitorId: 'c', name: 'Colm Dunne', sailNumber: '77', club: 'Holywood YC', raceYear: 2021 }),
    ]);
    expect(clusterOf(r, 'a')?.competitorIds).toEqual(['a']);
    expect(r.suggestions).toHaveLength(1);
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

describe('a blank club, read from the corpus', () => {
  /** Filler rows that name a club, to set which regime the corpus is in. */
  function stating(n: number) {
    return Array.from({ length: n }, (_, i) =>
      row({ name: `Filler ${i} Person`, club: 'RIYC', raceYear: 2020 }),
    );
  }
  function blank(n: number) {
    return Array.from({ length: n }, (_, i) =>
      row({ name: `Blank ${i} Person`, raceYear: 2020 }),
    );
  }

  const pair = () => [
    row({ competitorId: 'a', name: 'Ruth Ennis', sailNumber: '400', raceYear: 2019 }),
    row({ competitorId: 'b', name: 'Ruth Ennis', sailNumber: '811', raceYear: 2024 }),
  ];

  it('stays unknown where most rows name a club', () => {
    // The field is habitually filled, so an empty one is an omission and
    // corroborates nothing — two namesakes must not fuse on a missing value.
    const r = clusterCompetitors([...pair(), ...stating(10)]);
    expect(clusterOf(r, 'a')?.competitorIds).toEqual(['a']);
    expect(r.suggestions).toHaveLength(1);
  });

  it('means the workspace’s own people where most rows name none', () => {
    // A club scoring its own racing fills the club in for visitors and leaves
    // it blank for members, so two blanks agree.
    const r = clusterCompetitors([...pair(), ...blank(10)]);
    expect(clusterOf(r, 'a')?.competitorIds.sort()).toEqual(['a', 'b']);
  });

  it('does not make a blank row match a visitor who named their club', () => {
    const r = clusterCompetitors([
      row({ competitorId: 'a', name: 'Ruth Ennis', sailNumber: '400', raceYear: 2019 }),
      row({ competitorId: 'b', name: 'Ruth Ennis', sailNumber: '811', club: 'RIYC', raceYear: 2024 }),
      ...blank(10),
    ]);
    expect(r.clusters.filter((c) => c.label === 'Ruth Ennis')).toHaveLength(2);
    expect(r.suggestions).toHaveLength(1);
  });
});

describe('names that rest on an initial', () => {
  it('demotes an initialled co-owner fragment to a review suggestion', () => {
    // "J. & M. Murphy" splits into two fragments, and "J. Murphy" is any
    // Murphy whose first name starts with a J. Two boats at one club is
    // exactly the shape that fuses two of them.
    const r = clusterCompetitors([
      row({ competitorId: 'a', name: 'J. Murphy', sailNumber: '1200', club: 'HYC', raceYear: 2019 }),
      row({ competitorId: 'b', name: 'J. Murphy', sailNumber: '3400', club: 'HYC', raceYear: 2023 }),
    ]);
    expect(r.clusters).toHaveLength(2);
    expect(r.suggestions).toHaveLength(1);
  });

  it('links two whole names off the same co-owned boat', () => {
    // The fragment is only fragile because of the initial. "John Murphy"
    // appearing at one club across two seasons is ordinary evidence, whether
    // or not he shares a boat with Mary.
    const r = clusterCompetitors([
      row({ competitorId: 'a', name: 'John Murphy', sailNumber: '1200', club: 'HYC', raceYear: 2019 }),
      row({ competitorId: 'b', name: 'John Murphy', sailNumber: '3400', club: 'HYC', raceYear: 2023 }),
    ]);
    expect(clusterOf(r, 'a')?.competitorIds.sort()).toEqual(['a', 'b']);
  });

  it('still links an initialled name when the sail number carries the match', () => {
    const r = clusterCompetitors([
      row({ competitorId: 'a', name: 'J. Murphy', sailNumber: 'IRL1200', club: 'HYC', raceYear: 2019 }),
      row({ competitorId: 'b', name: 'John Murphy', sailNumber: '1200', club: 'HYC', raceYear: 2023 }),
    ]);
    expect(clusterOf(r, 'a')?.competitorIds.sort()).toEqual(['a', 'b']);
  });
});

describe('crew on the same boat (#348)', () => {
  it('never fuses two people on one row, however well their names agree', () => {
    // A family boat: mother helming, daughter crewing. Name, club and sail all
    // agree — every signal the matcher has — so only the shared row can tell
    // them apart.
    const r = clusterCompetitors([
      row({ competitorId: 'boat', name: 'Ann Ryan', sailNumber: '1234', club: 'KSC', raceYear: 2024 }),
      row({ competitorId: 'boat', name: 'A Ryan', sailNumber: '1234', club: 'KSC', raceYear: 2024, role: 'crew' }),
    ]);
    expect(r.clusters).toHaveLength(2);
    expect(r.suggestions).toHaveLength(0); // not even offered for review
  });

  it('still links a crew to their own appearances on other boats', () => {
    const r = clusterCompetitors([
      row({ competitorId: 'boat1', name: 'Frank Larkin', sailNumber: '900', club: 'KSC', raceYear: 2023 }),
      row({ competitorId: 'boat1', name: 'Maeve Dervan', sailNumber: '900', club: 'KSC', raceYear: 2023, role: 'crew' }),
      row({ competitorId: 'boat2', name: 'Maeve Dervan', sailNumber: '900', club: 'KSC', raceYear: 2024, role: 'crew' }),
    ]);
    const maeve = clusterOf(r, 'boat2')!;
    expect(maeve.competitorIds.sort()).toEqual(['boat1', 'boat2']);
    expect(maeve.members.every((m) => m.role === 'crew')).toBe(true);
  });

  it('carries the slot through to each membership', () => {
    const r = clusterCompetitors([
      row({ competitorId: 'boat1', name: 'Frank Larkin', sailNumber: '900', club: 'KSC', raceYear: 2023 }),
      row({ competitorId: 'boat2', name: 'Frank Larkin', sailNumber: '900', club: 'KSC', raceYear: 2024, role: 'crew' }),
    ]);
    // Same person on the same boat, helming one season and crewing the next:
    // one identity, two memberships, each stamped with the slot it came out
    // of. Sail-number continuity is what corroborates the match — club alone
    // would not, since a crew shares the boat's club by construction.
    const frank = clusterOf(r, 'boat1')!;
    expect(frank.competitorIds.sort()).toEqual(['boat1', 'boat2']);
    expect(
      frank.members.map((m) => `${m.competitorId}:${m.role}`).sort(),
    ).toEqual(['boat1:primary', 'boat2:crew']);
  });

  it('defaults an unstamped input to the primary slot', () => {
    const r = clusterCompetitors([
      row({ competitorId: 'a', name: 'Solo Sailor', sailNumber: 'IRL3', raceYear: 2021 }),
    ]);
    expect(r.clusters[0].members).toEqual([
      { competitorId: 'a', role: 'primary', needsLink: true },
    ]);
  });

  it('links a crew across boats on name and club, as it would a helm', () => {
    // Two people on one boat share its club by construction — but that is a
    // fact about *one row*, and same-row pairs never match at all. Across two
    // boats a shared club is the same evidence for a crew as for a helm.
    const r = clusterCompetitors([
      row({ competitorId: 'a', name: 'Sam Cronin', sailNumber: '11', club: 'KSC', raceYear: 2019, role: 'crew' }),
      row({ competitorId: 'b', name: 'Sam Cronin', sailNumber: '77', club: 'KSC', raceYear: 2024, role: 'crew' }),
    ]);
    expect(clusterOf(r, 'a')?.competitorIds.sort()).toEqual(['a', 'b']);
    expect(r.suggestions).toHaveLength(0);
  });

  it('still demotes a crew match that rests on an initial', () => {
    // "S Cronin" is any Cronin whose first name starts with an S; the club
    // they all share cannot tell them apart.
    const r = clusterCompetitors([
      row({ competitorId: 'a', name: 'S Cronin', sailNumber: '11', club: 'KSC', raceYear: 2019, role: 'crew' }),
      row({ competitorId: 'b', name: 'Sam Cronin', sailNumber: '77', club: 'KSC', raceYear: 2024, role: 'crew' }),
    ]);
    expect(r.clusters).toHaveLength(2);
    expect(r.suggestions).toHaveLength(1);
  });
});
