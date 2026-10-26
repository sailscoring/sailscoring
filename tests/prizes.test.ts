/**
 * Prize allocation (#240): filter the series standings by the prize's
 * predicate, keep standings order, take the top N. Covers the NoR shapes the
 * first iteration targets — per-division podiums ("Gold Fleet 1st, 2nd, 3rd"),
 * overall podiums (rank ≤ 3) and per-fleet prizes — plus every warning the
 * Prizes tab surfaces.
 */
import { describe, it, expect } from 'vitest';
import { allocatePrize, allocatePrizes, describePrizeClauses, prizeLoops, prizeWarningMessage } from '@/lib/prizes';
import type { PrizeAllocationWarning, PrizeStandingsInput } from '@/lib/prizes';
import type { Competitor, Fleet, Prize, Standing, SubdivisionAxis } from '@/lib/types';

const DIVISION_AXIS: SubdivisionAxis = { id: 'axis-div', label: 'Division' };

function makeFleet(id: string, name: string, displayOrder = 0): Fleet {
  return { id, seriesId: 's1', name, displayOrder, scoringSystem: 'scratch' };
}

function makeCompetitor(
  id: string,
  fleetIds: string[],
  subdivisions?: Record<string, string>,
): Competitor {
  return {
    id,
    seriesId: 's1',
    fleetIds,
    sailNumber: id,
    names: [`Helm ${id}`],
    clubs: [],
    gender: '',
    age: null,
    createdAt: 0,
    ...(subdivisions ? { subdivisions } : {}),
  };
}

function makeStanding(competitor: Competitor, rank: number): Standing {
  return {
    rank,
    competitor,
    racePoints: [],
    raceRanks: [],
    raceCodes: [],
    racePenaltyCodes: [],
    racePenaltyOverrides: [],
    raceRedressFlags: [],
    totalPoints: rank,
    netPoints: rank,
    raceDiscards: [],
    raceNonDiscardable: [],
    raceExcluded: [],
  };
}

/** One fleet, nine boats ranked 1–9, divisions rotating Gold/Silver/Bronze. */
function weekendStandings(): PrizeStandingsInput[] {
  const fleet = makeFleet('fl-1', 'ILCA 6');
  const divisions = ['Gold', 'Silver', 'Bronze'];
  const standings = Array.from({ length: 9 }, (_, i) =>
    makeStanding(
      makeCompetitor(`c${i + 1}`, ['fl-1'], { 'axis-div': divisions[i % 3] }),
      i + 1,
    ),
  );
  return [{ fleet, standings }];
}

function podiumPrize(id: string, division: string): Prize {
  return {
    id,
    name: `${division} Fleet 1st, 2nd, 3rd`,
    recipientCount: 3,
    clauses: [{ kind: 'axis', axisId: 'axis-div', value: division }],
  };
}

describe('allocatePrize — the weekend NoR (per-division podiums)', () => {
  it('awards each division podium to its top three by overall standing', () => {
    const standings = weekendStandings();
    const allocations = allocatePrizes(
      [podiumPrize('p1', 'Gold'), podiumPrize('p2', 'Silver'), podiumPrize('p3', 'Bronze')],
      standings,
      [DIVISION_AXIS],
    );

    // Divisions rotate c1..c9, so Gold = c1,c4,c7; Silver = c2,c5,c8; Bronze = c3,c6,c9.
    expect(allocations[0].recipients.map((r) => r.standing.competitor.id)).toEqual(['c1', 'c4', 'c7']);
    expect(allocations[1].recipients.map((r) => r.standing.competitor.id)).toEqual(['c2', 'c5', 'c8']);
    expect(allocations[2].recipients.map((r) => r.standing.competitor.id)).toEqual(['c3', 'c6', 'c9']);
    for (const a of allocations) {
      expect(a.recipients.map((r) => r.position)).toEqual([1, 2, 3]);
      expect(a.eligibleCount).toBe(3);
      expect(a.warnings).toEqual([]);
    }
  });

  it('axis values match with surrounding whitespace trimmed', () => {
    const standings = weekendStandings();
    standings[0].standings[0].competitor.subdivisions = { 'axis-div': ' Gold ' };
    const [a] = allocatePrizes([podiumPrize('p1', 'Gold')], standings, [DIVISION_AXIS]);
    expect(a.recipients.map((r) => r.standing.competitor.id)).toEqual(['c1', 'c4', 'c7']);
  });
});

describe('allocatePrize — other clause kinds', () => {
  it('rank clause: overall podium is rank ≤ 3', () => {
    const prize: Prize = {
      id: 'p1',
      name: 'Overall 1st, 2nd, 3rd',
      recipientCount: 3,
      clauses: [{ kind: 'rank', max: 3 }],
    };
    const [a] = allocatePrizes([prize], weekendStandings(), [DIVISION_AXIS]);
    expect(a.recipients.map((r) => r.standing.competitor.id)).toEqual(['c1', 'c2', 'c3']);
    expect(a.warnings).toEqual([]);
  });

  it('fleet clause restricts to one fleet and ranks within it', () => {
    const fleetA = makeFleet('fl-a', 'ILCA 6', 0);
    const fleetB = makeFleet('fl-b', 'ILCA 4', 1);
    const standings: PrizeStandingsInput[] = [
      { fleet: fleetA, standings: [makeStanding(makeCompetitor('a1', ['fl-a']), 1), makeStanding(makeCompetitor('a2', ['fl-a']), 2)] },
      { fleet: fleetB, standings: [makeStanding(makeCompetitor('b1', ['fl-b']), 1), makeStanding(makeCompetitor('b2', ['fl-b']), 2)] },
    ];
    const prize: Prize = {
      id: 'p1',
      name: 'ILCA 4: Overall 1st',
      recipientCount: 1,
      clauses: [{ kind: 'fleet', fleetId: 'fl-b' }],
    };
    const [a] = allocatePrize(prize, standings, []).recipients;
    expect(a.standing.competitor.id).toBe('b1');
    expect(a.fleet.id).toBe('fl-b');
  });

  it('an empty clause list makes every scored competitor eligible', () => {
    const prize: Prize = { id: 'p1', name: 'First overall', recipientCount: 1, clauses: [] };
    const a = allocatePrize(prize, weekendStandings(), [DIVISION_AXIS]);
    expect(a.eligibleCount).toBe(9);
    expect(a.recipients[0].standing.competitor.id).toBe('c1');
  });

  it('clauses AND together: division podium within one fleet', () => {
    const fleetA = makeFleet('fl-a', 'ILCA 6', 0);
    const fleetB = makeFleet('fl-b', 'ILCA 4', 1);
    const standings: PrizeStandingsInput[] = [
      { fleet: fleetA, standings: [makeStanding(makeCompetitor('a1', ['fl-a'], { 'axis-div': 'Silver' }), 1)] },
      { fleet: fleetB, standings: [makeStanding(makeCompetitor('b1', ['fl-b'], { 'axis-div': 'Silver' }), 1)] },
    ];
    const prize: Prize = {
      id: 'p1',
      name: 'ILCA 4: Silver 1st',
      recipientCount: 1,
      clauses: [
        { kind: 'fleet', fleetId: 'fl-b' },
        { kind: 'axis', axisId: 'axis-div', value: 'Silver' },
      ],
    };
    const a = allocatePrize(prize, standings, [DIVISION_AXIS]);
    expect(a.recipients.map((r) => r.standing.competitor.id)).toEqual(['b1']);
  });

  it('a competitor scored in two fleets is counted once, at their best rank', () => {
    const fleetA = makeFleet('fl-a', 'Scratch', 0);
    const fleetB = makeFleet('fl-b', 'HPH', 1);
    const both = makeCompetitor('c1', ['fl-a', 'fl-b']);
    const other = makeCompetitor('c2', ['fl-b']);
    const standings: PrizeStandingsInput[] = [
      { fleet: fleetA, standings: [makeStanding(both, 4)] },
      { fleet: fleetB, standings: [makeStanding(other, 1), makeStanding(both, 2)] },
    ];
    const prize: Prize = { id: 'p1', name: 'Everything', recipientCount: 5, clauses: [] };
    const a = allocatePrize(prize, standings, []);
    expect(a.eligibleCount).toBe(2);
    const c1 = a.recipients.find((r) => r.standing.competitor.id === 'c1')!;
    expect(c1.standing.rank).toBe(2);
    expect(c1.fleet.id).toBe('fl-b');
  });
});

describe('allocatePrize — warnings', () => {
  it('warns when the referenced axis has no data on any competitor', () => {
    const fleet = makeFleet('fl-1', 'ILCA 6');
    const standings: PrizeStandingsInput[] = [
      { fleet, standings: [makeStanding(makeCompetitor('c1', ['fl-1']), 1)] },
    ];
    const a = allocatePrize(podiumPrize('p1', 'Gold'), standings, [DIVISION_AXIS]);
    expect(a.recipients).toEqual([]);
    expect(a.warnings).toContainEqual({ kind: 'axis-no-data', axisId: 'axis-div', axisLabel: 'Division' });
    // "0 eligible / field has no data", not a silent empty award (#240).
    expect(a.eligibleCount).toBe(0);
  });

  it('warns on a clause referencing an axis the series no longer has', () => {
    const a = allocatePrize(
      { id: 'p1', name: 'Master 1st', recipientCount: 1, clauses: [{ kind: 'axis', axisId: 'axis-gone', value: 'Master' }] },
      weekendStandings(),
      [DIVISION_AXIS],
    );
    expect(a.warnings).toContainEqual({ kind: 'unknown-axis', axisId: 'axis-gone' });
  });

  it('warns on a clause referencing a deleted fleet', () => {
    const a = allocatePrize(
      { id: 'p1', name: 'Gone 1st', recipientCount: 1, clauses: [{ kind: 'fleet', fleetId: 'fl-gone' }] },
      weekendStandings(),
      [DIVISION_AXIS],
    );
    expect(a.warnings).toContainEqual({ kind: 'unknown-fleet', fleetId: 'fl-gone' });
    expect(a.recipients).toEqual([]);
  });

  it('warns when fewer competitors are eligible than places requested', () => {
    const a = allocatePrize(
      { id: 'p1', name: 'Gold 1st–5th', recipientCount: 5, clauses: [{ kind: 'axis', axisId: 'axis-div', value: 'Gold' }] },
      weekendStandings(),
      [DIVISION_AXIS],
    );
    expect(a.recipients).toHaveLength(3);
    expect(a.warnings).toContainEqual({ kind: 'short', eligible: 3, requested: 5 });
  });

  it('warns when a fleet-less prize compares ranks across fleets', () => {
    const fleetA = makeFleet('fl-a', 'ILCA 6', 0);
    const fleetB = makeFleet('fl-b', 'ILCA 4', 1);
    const standings: PrizeStandingsInput[] = [
      { fleet: fleetA, standings: [makeStanding(makeCompetitor('a1', ['fl-a']), 1)] },
      { fleet: fleetB, standings: [makeStanding(makeCompetitor('b1', ['fl-b']), 1)] },
    ];
    const a = allocatePrize({ id: 'p1', name: 'First', recipientCount: 1, clauses: [] }, standings, []);
    expect(a.warnings).toContainEqual({ kind: 'spans-fleets', fleetNames: ['ILCA 6', 'ILCA 4'] });
  });

  it('warns when the cut falls inside an unbroken tie', () => {
    const fleet = makeFleet('fl-1', 'ILCA 6');
    // Ranks 1, 2, 2 — an RRS A8 unbreakable tie shares the rank.
    const standings: PrizeStandingsInput[] = [
      {
        fleet,
        standings: [
          makeStanding(makeCompetitor('c1', ['fl-1']), 1),
          makeStanding(makeCompetitor('c2', ['fl-1']), 2),
          makeStanding(makeCompetitor('c3', ['fl-1']), 2),
        ],
      },
    ];
    const a = allocatePrize({ id: 'p1', name: 'Top two', recipientCount: 2, clauses: [] }, standings, []);
    expect(a.recipients.map((r) => r.standing.competitor.id)).toEqual(['c1', 'c2']);
    expect(a.warnings).toContainEqual({ kind: 'tie-at-cut', rank: 2 });
  });

  it('every warning renders a message', () => {
    const warnings: PrizeAllocationWarning[] = [
      { kind: 'unknown-axis', axisId: 'x' },
      { kind: 'axis-no-data', axisId: 'x', axisLabel: 'Division' },
      { kind: 'unknown-fleet', fleetId: 'x' },
      { kind: 'short', eligible: 1, requested: 3 },
      { kind: 'spans-fleets', fleetNames: ['A', 'B'] },
      { kind: 'tie-at-cut', rank: 3 },
      { kind: 'unknown-prize' },
      { kind: 'prize-loop', prizeNames: ['ECHO Overall'] },
      { kind: 'prize-loop', prizeNames: [] },
    ];
    for (const w of warnings) {
      expect(prizeWarningMessage(w).length).toBeGreaterThan(0);
    }
  });
});

describe('allocatePrize — intrinsic competitor-field clauses (v18)', () => {
  function intrinsicStandings(): PrizeStandingsInput[] {
    const fleet = makeFleet('fl-1', 'ILCA 6');
    const specs: Array<[string, 'M' | 'F' | '', string | undefined, string]> = [
      ['c1', 'M', 'IRL', 'HYC'],
      ['c2', 'F', 'GBR', 'RStGYC'],
      ['c3', 'F', 'IRL', 'HYC'],
      ['c4', 'M', undefined, ''],
    ];
    const standings = specs.map(([id, gender, nationality, club], i) => {
      const c = makeCompetitor(id, ['fl-1']);
      c.gender = gender;
      if (nationality) c.nationality = nationality;
      c.clubs = club ? [club] : [];
      return makeStanding(c, i + 1);
    });
    return [{ fleet, standings }];
  }

  it('gender clause: the Lady prize takes the top female helms by standing', () => {
    const prize: Prize = {
      id: 'p1',
      name: 'Lady 1st, 2nd',
      recipientCount: 2,
      clauses: [{ kind: 'gender', value: 'F' }],
    };
    const a = allocatePrize(prize, intrinsicStandings(), []);
    expect(a.recipients.map((r) => r.standing.competitor.id)).toEqual(['c2', 'c3']);
    expect(a.warnings).toEqual([]);
  });

  it('nationality clause matches case-insensitively (restricted title)', () => {
    const prize: Prize = {
      id: 'p1',
      name: 'First Irish boat',
      recipientCount: 1,
      clauses: [{ kind: 'nationality', value: 'irl' }],
    };
    const a = allocatePrize(prize, intrinsicStandings(), []);
    expect(a.recipients.map((r) => r.standing.competitor.id)).toEqual(['c1']);
  });

  it('club clause matches trimmed-exact', () => {
    const prize: Prize = {
      id: 'p1',
      name: 'First HYC boat',
      recipientCount: 1,
      clauses: [{ kind: 'club', value: ' HYC ' }],
    };
    const a = allocatePrize(prize, intrinsicStandings(), []);
    expect(a.recipients.map((r) => r.standing.competitor.id)).toEqual(['c1']);
  });

  it('club clause is a membership test: a second affiliation still wins the prize', () => {
    const prize: Prize = {
      id: 'p1',
      name: 'First HYC boat',
      recipientCount: 1,
      clauses: [{ kind: 'club', value: 'HYC' }],
    };
    const standings = intrinsicStandings();
    // c2 leads c3 and lists HYC second, behind its own club.
    standings[0].standings[1].competitor.clubs = ['RStGYC', 'HYC'];
    const a = allocatePrize(prize, standings, []);
    expect(a.recipients.map((r) => r.standing.competitor.id)).toEqual(['c1']);
    expect(a.eligibleCount).toBe(3);
  });

  it('warns when the referenced intrinsic field has no data at all', () => {
    // weekendStandings competitors carry no gender/nationality and empty clubs.
    const prize: Prize = {
      id: 'p1',
      name: 'Lady 1st',
      recipientCount: 1,
      clauses: [{ kind: 'gender', value: 'F' }],
    };
    const a = allocatePrize(prize, weekendStandings(), [DIVISION_AXIS]);
    expect(a.recipients).toEqual([]);
    expect(a.warnings).toContainEqual({ kind: 'field-no-data', field: 'gender' });
    expect(prizeWarningMessage({ kind: 'field-no-data', field: 'gender' })).toContain('gender');
  });

  it('describes the new clause kinds in plain words', () => {
    const text = describePrizeClauses(
      [
        { kind: 'gender', value: 'F' },
        { kind: 'nationality', value: 'irl' },
        { kind: 'club', value: 'HYC' },
      ],
      [],
      [],
    );
    expect(text).toBe('Helm is female · Nationality is IRL · Club is HYC');
  });
});

/**
 * Prize exclusion: a boat placed in one prize is passed over for another and
 * the places move down. Modelled on DBSC NoR 9.2 (a prize under IRC rules a
 * boat out of the ECHO prize) and HYC Autumn League NoR 18.2 (a prize on IRC
 * or Scratch rules a boat out of the HPH prize). The same six boats are
 * scored in every fleet, as a class scored under several systems at once is.
 *
 *   IRC ranks:     a b c d e f
 *   ECHO ranks:    d a b e f c
 *   Scratch ranks: e d c b a f
 */
describe('allocatePrizes — not-awarded conditions', () => {
  const irc = makeFleet('fl-irc', 'IRC', 0);
  const echo = makeFleet('fl-echo', 'ECHO', 1);
  const scratch = makeFleet('fl-scratch', 'Scratch', 2);
  const boats = new Map(
    ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => [
      id,
      makeCompetitor(id, ['fl-irc', 'fl-echo', 'fl-scratch']),
    ]),
  );
  const ranked = (fleet: Fleet, order: string): PrizeStandingsInput => ({
    fleet,
    standings: [...order].map((id, i) => makeStanding(boats.get(id)!, i + 1)),
  });
  const standings = [
    ranked(irc, 'abcdef'),
    ranked(echo, 'dabefc'),
    ranked(scratch, 'edcbaf'),
  ];

  const fleetPrize = (id: string, name: string, fleetId: string, extra: Prize['clauses'] = []): Prize => ({
    id,
    name,
    recipientCount: 3,
    clauses: [{ kind: 'fleet', fleetId }, ...extra],
  });
  const ircOverall = fleetPrize('irc', 'IRC Overall', 'fl-irc');
  const scratchOverall = { ...fleetPrize('scratch', 'Scratch Overall', 'fl-scratch'), recipientCount: 1 };
  const sails = (a: { recipients: { standing: Standing }[] }) =>
    a.recipients.map((r) => r.standing.competitor.id);

  it('DBSC 9.2: an IRC prize-winner is passed over for the ECHO prize', () => {
    const echoOverall = fleetPrize('echo', 'ECHO Overall', 'fl-echo', [
      { kind: 'not-awarded', prizeId: 'irc' },
    ]);
    const [ircA, echoA] = allocatePrizes([ircOverall, echoOverall], standings, []);
    expect(sails(ircA)).toEqual(['a', 'b', 'c']);
    // d is 1st; a (IRC 1st) and b (IRC 2nd) are skipped; e and f move up.
    expect(sails(echoA)).toEqual(['d', 'e', 'f']);
    expect(echoA.skipped.map((s) => [s.standing.competitor.id, s.prizeId, s.place])).toEqual([
      ['a', 'irc', 1],
      ['b', 'irc', 2],
    ]);
    expect(echoA.warnings).toEqual([]);
  });

  it('the result does not depend on where the prizes sit in the list', () => {
    const echoOverall = fleetPrize('echo', 'ECHO Overall', 'fl-echo', [
      { kind: 'not-awarded', prizeId: 'irc' },
    ]);
    // Presented ECHO first: still awarded after IRC, still returned in list order.
    const [echoA, ircA] = allocatePrizes([echoOverall, ircOverall], standings, []);
    expect(echoA.prize.id).toBe('echo');
    expect(sails(echoA)).toEqual(['d', 'e', 'f']);
    expect(sails(ircA)).toEqual(['a', 'b', 'c']);
  });

  it('places: 1 passes over only the winner of the named prize', () => {
    const echoOverall = fleetPrize('echo', 'ECHO Overall', 'fl-echo', [
      { kind: 'not-awarded', prizeId: 'irc', places: 1 },
    ]);
    const [, echoA] = allocatePrizes([ircOverall, echoOverall], standings, []);
    // b is IRC 2nd, which this condition doesn't exclude.
    expect(sails(echoA)).toEqual(['d', 'b', 'e']);
    expect(echoA.skipped.map((s) => s.standing.competitor.id)).toEqual(['a']);
  });

  it('HYC 18.2: two conditions rule out an IRC or a Scratch prize-winner', () => {
    const hph = fleetPrize('hph', 'HPH Overall', 'fl-echo', [
      { kind: 'not-awarded', prizeId: 'irc' },
      { kind: 'not-awarded', prizeId: 'scratch' },
    ]);
    const [, scratchA, hphA] = allocatePrizes([ircOverall, scratchOverall, hph], standings, []);
    expect(sails(scratchA)).toEqual(['e']);
    // d, then a/b (IRC) and e (Scratch) skipped, then f; c (IRC 3rd) skipped too.
    expect(sails(hphA)).toEqual(['d', 'f']);
    expect(hphA.skipped.map((s) => s.standing.competitor.id)).toEqual(['a', 'b', 'e', 'c']);
    expect(hphA.warnings).toContainEqual({ kind: 'short', eligible: 2, requested: 3 });
  });

  it('a boat skipped past the cut is not reported', () => {
    const echoOne = { ...fleetPrize('echo', 'ECHO 1st', 'fl-echo', [
      { kind: 'not-awarded', prizeId: 'irc' },
    ]), recipientCount: 1 };
    const [, echoA] = allocatePrizes([ircOverall, echoOne], standings, []);
    // d takes the one place; a and b come after it and would not have won.
    expect(sails(echoA)).toEqual(['d']);
    expect(echoA.skipped).toEqual([]);
  });

  it('with no prize named, any prize listed above counts — one prize per boat', () => {
    const fleet = standings.slice(1, 2); // ECHO alone: d a b e f c
    const overall: Prize = { id: 'o', name: 'Overall 1st, 2nd', recipientCount: 2, clauses: [] };
    const next: Prize = { id: 'n', name: 'Next 1st, 2nd', recipientCount: 2, clauses: [{ kind: 'not-awarded' }] };
    const [overallA, nextA] = allocatePrizes([overall, next], fleet, []);
    expect(sails(overallA)).toEqual(['d', 'a']);
    expect(sails(nextA)).toEqual(['b', 'e']);
    // Moved to the top, nothing is above it: position is the rule here.
    const [topA] = allocatePrizes([next, overall], fleet, []);
    expect(sails(topA)).toEqual(['d', 'a']);
  });

  it('a condition on a prize the series no longer has awards nobody', () => {
    const echoOverall = fleetPrize('echo', 'ECHO Overall', 'fl-echo', [
      { kind: 'not-awarded', prizeId: 'deleted' },
    ]);
    const [echoA] = allocatePrizes([echoOverall], standings, []);
    expect(echoA.recipients).toEqual([]);
    expect(echoA.warnings).toContainEqual({ kind: 'unknown-prize' });
  });

  it('prizes waiting on each other award nobody; a prize waiting on the loop is awarded', () => {
    const a: Prize = fleetPrize('A', 'IRC Overall', 'fl-irc', [{ kind: 'not-awarded', prizeId: 'B' }]);
    const b: Prize = fleetPrize('B', 'ECHO Overall', 'fl-echo', [{ kind: 'not-awarded', prizeId: 'A' }]);
    const c: Prize = fleetPrize('C', 'Scratch Overall', 'fl-scratch', [{ kind: 'not-awarded', prizeId: 'A' }]);
    const [aA, bA, cA] = allocatePrizes([a, b, c], standings, []);
    expect(aA.recipients).toEqual([]);
    expect(aA.warnings).toEqual([{ kind: 'prize-loop', prizeNames: ['ECHO Overall'] }]);
    expect(bA.warnings).toEqual([{ kind: 'prize-loop', prizeNames: ['IRC Overall'] }]);
    expect(sails(cA)).toEqual(['e', 'd', 'c']);
    expect(prizeLoops([a, b, c])).toEqual(new Map([['A', ['B']], ['B', ['A']]]));
  });

  it('a prize that names itself is a loop of one', () => {
    const self: Prize = fleetPrize('S', 'IRC Overall', 'fl-irc', [{ kind: 'not-awarded', prizeId: 'S' }]);
    const [selfA] = allocatePrizes([self], standings, []);
    expect(selfA.recipients).toEqual([]);
    expect(selfA.warnings).toEqual([{ kind: 'prize-loop', prizeNames: [] }]);
  });

  it('describes the condition by the prize it names', () => {
    const prizes = [ircOverall];
    const describe1 = (clause: Prize['clauses'][number]) =>
      describePrizeClauses([clause], [], [], prizes);
    expect(describe1({ kind: 'not-awarded', prizeId: 'irc' })).toBe('Not a prize-winner in IRC Overall');
    expect(describe1({ kind: 'not-awarded', prizeId: 'irc', places: 1 })).toBe('Not the winner of IRC Overall');
    expect(describe1({ kind: 'not-awarded', prizeId: 'irc', places: 2 })).toBe('Not in the top 2 of IRC Overall');
    expect(describe1({ kind: 'not-awarded' })).toBe('Not a prize-winner in a prize above');
    expect(describe1({ kind: 'not-awarded', prizeId: 'gone' })).toBe('Not a prize-winner in a deleted prize');
  });
});
