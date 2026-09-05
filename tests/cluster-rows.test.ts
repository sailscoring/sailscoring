import { describe, expect, it } from 'vitest';

import { clusterRowsJson, toClusterInput } from '@/scripts/cluster-rows';
import type { ClusterResult } from '@/lib/competitor-identity-cluster';

describe('toClusterInput', () => {
  it('coerces a full row', () => {
    const r = toClusterInput(
      { competitorId: 'x', name: 'A B', sailNumber: '1', club: 'HYC', age: 12, raceYear: 2020 },
      0,
    );
    expect(r).toMatchObject({ competitorId: 'x', name: 'A B', sailNumber: '1', club: 'HYC', age: 12, raceYear: 2020 });
  });

  it('tolerates missing optionals', () => {
    const r = toClusterInput({ competitorId: 'x', name: 'A B' }, 0);
    expect(r.sailNumber).toBe('');
    expect(r.club).toBeUndefined();
    expect(r.age).toBeNull();
    expect(r.raceYear).toBeNull();
  });

  it('carries the slot through (#348)', () => {
    // Without it an archive bootstrap drafts a manifest from a different
    // matching model than the workspace apply will use.
    const crew = toClusterInput(
      { competitorId: 'x', name: 'A B', role: 'crew' },
      0,
    );
    expect(crew.role).toBe('crew');
  });

  it('defaults an unstamped row to the primary slot', () => {
    const r = toClusterInput({ competitorId: 'x', name: 'A B' }, 0);
    expect(r.role).toBeUndefined();
  });

  it('ignores a slot it does not recognise', () => {
    const r = toClusterInput({ competitorId: 'x', name: 'A B', role: 'tactician' }, 0);
    expect(r.role).toBeUndefined();
  });

  it('rejects a row with no competitorId', () => {
    expect(() => toClusterInput({ name: 'A B' }, 3)).toThrow(/row 3.*competitorId/);
  });
});

describe('clusterRowsJson', () => {
  it('clusters a career across a sail change and echoes the opaque ids back', () => {
    const rows = [
      { competitorId: 'iodai-a-2018|1200', name: 'Aoife Murphy', sailNumber: 'IRL1200', club: 'RCYC', raceYear: 2018 },
      { competitorId: 'iodai-b-2021|1599', name: 'Aoife Murphy', sailNumber: 'IRL1599', club: 'RCYC', raceYear: 2021 },
    ];
    const result = JSON.parse(clusterRowsJson(JSON.stringify(rows))) as ClusterResult;
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].competitorIds.sort()).toEqual([
      'iodai-a-2018|1200',
      'iodai-b-2021|1599',
    ]);
  });

  it('takes the home club from an object-shaped input (#507)', () => {
    // Neither row states a club, so nothing corroborates the name — until the
    // blank is read as the club whose workspace this is.
    const rows = [
      { competitorId: 'a', name: 'Ruth Ennis', sailNumber: '400', raceYear: 2019 },
      { competitorId: 'b', name: 'Ruth Ennis', sailNumber: '811', raceYear: 2024 },
    ];
    const bare = JSON.parse(clusterRowsJson(JSON.stringify(rows))) as ClusterResult;
    expect(bare.clusters).toHaveLength(2);
    const withHome = JSON.parse(
      clusterRowsJson(JSON.stringify({ homeClub: 'Howth Yacht Club', rows })),
    ) as ClusterResult;
    expect(withHome.clusters).toHaveLength(1);
  });

  it('rejects input that is neither an array nor an object with rows', () => {
    expect(() => clusterRowsJson('{}')).toThrow(/JSON array of competitor rows/);
    expect(() => clusterRowsJson('42')).toThrow(/JSON array of competitor rows/);
  });

  it('rejects a non-string home club', () => {
    expect(() => clusterRowsJson('{"rows":[],"homeClub":3}')).toThrow(/homeClub/);
  });

  it('rejects invalid JSON', () => {
    expect(() => clusterRowsJson('not json')).toThrow(/not valid JSON/);
  });
});
