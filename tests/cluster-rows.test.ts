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

  it('rejects non-array input', () => {
    expect(() => clusterRowsJson('{}')).toThrow(/must be a JSON array/);
  });

  it('rejects invalid JSON', () => {
    expect(() => clusterRowsJson('not json')).toThrow(/not valid JSON/);
  });
});
