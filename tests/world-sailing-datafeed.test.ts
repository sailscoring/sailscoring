import { describe, expect, it } from 'vitest';

import {
  batchIds,
  compareToRecord,
  lookupPersonsByIds,
  parsePersonRecords,
} from '@/lib/world-sailing-datafeed';

// Shaped like a real XRR response: attribute-only Person elements, and far
// more about the sailor than we asked for.
const XRR = `<?xml version="1.0" encoding="utf-8"?>
<XRR Version="1.3.1">
  <Person PersonID="79789533-c727-4689-8505-febd6caab609" IFPersonID="GBRHM15"
          FamilyName="Mills" GivenName="Hannah" Gender="F" DOB="1988-02-29"
          NOC="GBR" PlaceOfBirth="Cardiff" SailingClub="WPNSA" />
  <Person PersonID="0f0a" IFPersonID="IRLMM1" FamilyName="McLoughlin"
          GivenName="Mark" NOC="IRL" />
</XRR>`;

describe('parsePersonRecords', () => {
  it('reads the name and nation, and nothing else', () => {
    const people = parsePersonRecords(XRR);
    expect(people).toEqual([
      { worldSailingId: 'GBRHM15', familyName: 'Mills', givenName: 'Hannah', nationality: 'GBR' },
      { worldSailingId: 'IRLMM1', familyName: 'McLoughlin', givenName: 'Mark', nationality: 'IRL' },
    ]);
    // Date and place of birth are in the response and stay there.
    expect(JSON.stringify(people)).not.toContain('1988');
    expect(JSON.stringify(people)).not.toContain('Cardiff');
  });

  it('survives a response shape it has never seen', () => {
    expect(parsePersonRecords('<XRR><Person Something="else" /></XRR>')).toEqual([]);
    expect(parsePersonRecords('not xml at all')).toEqual([]);
    expect(parsePersonRecords('')).toEqual([]);
  });

  it('handles an element written with a closing tag', () => {
    const people = parsePersonRecords('<Person IFPersonID="espfe" NOC="esp"></Person>');
    expect(people).toEqual([{ worldSailingId: 'ESPFE', nationality: 'ESP' }]);
  });
});

describe('batchIds', () => {
  it('chunks the lookup so one request can’t grow unbounded', () => {
    expect(batchIds(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']]);
    expect(batchIds([], 2)).toEqual([]);
  });
});

describe('lookupPersonsByIds', () => {
  it('sends one comma-separated query and parses the answer', async () => {
    let seen = '';
    const people = await lookupPersonsByIds(['GBRHM15', 'IRLMM1'], {
      baseUrl: 'https://datafeed.example/query',
      fetchImpl: (async (url: string) => {
        seen = url;
        return new Response(XRR, { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(seen).toContain('type=Person');
    expect(seen).toContain('IFPersonID=GBRHM15%2CIRLMM1');
    expect(people).toHaveLength(2);
  });

  it('raises on an HTTP error so the caller can report "couldn’t check"', async () => {
    await expect(
      lookupPersonsByIds(['GBRHM15'], {
        baseUrl: 'https://datafeed.example/query',
        fetchImpl: (async () => new Response('', { status: 503 })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow('HTTP 503');
  });

  it('asks nothing when there is nothing to ask about', async () => {
    const people = await lookupPersonsByIds([], {
      fetchImpl: (() => {
        throw new Error('should not fetch');
      }) as unknown as typeof fetch,
    });
    expect(people).toEqual([]);
  });
});

describe('compareToRecord', () => {
  const mills = {
    worldSailingId: 'GBRHM15',
    familyName: 'Mills',
    givenName: 'Hannah',
    nationality: 'GBR',
  };

  it('accepts a name written in either order, with or without accents', () => {
    expect(compareToRecord({ names: ['Hannah Mills'], nationality: 'GBR' }, mills).status)
      .toBe('valid');
    expect(compareToRecord({ names: ['Mills, Hannah'], nationality: 'GBR' }, mills).status)
      .toBe('valid');
    expect(
      compareToRecord(
        { names: ['Seamus O Briain'] },
        { worldSailingId: 'IRLSB1', givenName: 'Séamus', familyName: 'Ó Briain' },
      ).status,
    ).toBe('valid');
  });

  it('flags the transposed ID — the reason to run the check at all', () => {
    const outcome = compareToRecord({ names: ['Mark McLoughlin'], nationality: 'IRL' }, mills);
    expect(outcome).toEqual({ status: 'mismatch', person: mills, on: ['name', 'nation'] });
  });

  it('treats a nationality we don’t hold as a gap, not a contradiction', () => {
    expect(compareToRecord({ names: ['Hannah Mills'] }, mills).status).toBe('valid');
  });

  it('accepts a multi-name entry when any of its names agrees', () => {
    // One Sailor ID, two names on the entry — the ID belongs to one of them.
    expect(
      compareToRecord({ names: ['Hannah Mills', 'Eilidh McIntyre'], nationality: 'GBR' }, mills)
        .status,
    ).toBe('valid');
  });

  describe('names the same sailor is written under', () => {
    // Every pair below is a real one: the 2026 ILCA Men's Worlds entry list on
    // the left, what datafeed.sailing.org returned for that sailor's ID on the
    // right. All of them read as "doesn't match" before the comparison learned
    // to tolerate them.
    const sameSailor: [string, { givenName: string; familyName: string; nationality: string }][] = [
      ['Zachary Littlewood', { givenName: 'Zac', familyName: 'Littlewood', nationality: 'AUS' }],
      [
        'Leopoldo Barreto Haschke',
        { givenName: 'Leo', familyName: 'Barreto Haschke', nationality: 'ESP' },
      ],
      [
        'Philipp Grochtmann',
        { givenName: 'Philipp Andreas', familyName: 'Grochtmann', nationality: 'BRA' },
      ],
      ['Nooa Laukkanen', { givenName: 'Nooa Henrik', familyName: 'Laukkanen', nationality: 'FIN' }],
      ['Kenje Sem Werpers', { givenName: 'Kenje', familyName: 'Werpers', nationality: 'ITA' }],
      ['Sergio Garcia Garrido', { givenName: 'Sergio', familyName: 'Garrido', nationality: 'ESP' }],
      ['Karol Krupski Teterycz', { givenName: 'Karol', familyName: 'KRUPSKI', nationality: 'ESP' }],
      ['Dean Mathiot', { givenName: 'Dean,John', familyName: 'Mathiot', nationality: 'SEY' }],
      [
        'Sultan Khalid Mohamed Sultan Alowaus',
        {
          givenName: 'Sultan Khalid Mohamed Sultan',
          familyName: 'Alowais',
          nationality: 'UAE',
        },
      ],
    ];

    it.each(sameSailor)('reads %s as the same sailor, spelled differently', (entry, record) => {
      const outcome = compareToRecord(
        { names: [entry], nationality: record.nationality },
        { worldSailingId: 'TESTX1', ...record },
      );
      expect(outcome.status).toBe('spelling');
    });

    it('reads past a generational suffix as if it weren’t there', () => {
      expect(
        compareToRecord(
          { names: ['Robert Meek'], nationality: 'USA' },
          {
            worldSailingId: 'USARM234',
            givenName: 'Robert',
            familyName: 'Meek IV',
            nationality: 'USA',
          },
        ).status,
      ).toBe('valid');
    });

    it('still says valid when the two agree outright', () => {
      expect(
        compareToRecord(
          { names: ['Louis Hupé'], nationality: 'FRA' },
          { worldSailingId: 'FRALH16', givenName: 'LOUIS', familyName: 'HUPE', nationality: 'FRA' },
        ).status,
      ).toBe('valid');
    });

    it('does not let a shared family name pass for a sibling', () => {
      // Nothing else agrees, so nothing here should.
      expect(
        compareToRecord(
          { names: ['Fiachra Geraghty-McDonnell'] },
          { worldSailingId: 'IRLEG1', givenName: 'Eve', familyName: 'McDonnell' },
        ).status,
      ).toBe('mismatch');
    });

    it('holds the line on a different sailor of the same nation', () => {
      expect(
        compareToRecord(
          { names: ['Sergio Garcia Garrido'], nationality: 'ESP' },
          {
            worldSailingId: 'ESPJG1',
            givenName: 'Javier',
            familyName: 'Garrido',
            nationality: 'ESP',
          },
        ).status,
      ).toBe('mismatch');
    });

    it('treats the neutral-athlete nation code as the nation it stands for', () => {
      // World Sailing writes it AINX; an entry list writes it AIN.
      expect(
        compareToRecord(
          { names: ['Daniil Krutskikh'], nationality: 'AIN' },
          {
            worldSailingId: 'AINXDK2',
            givenName: 'Daniil',
            familyName: 'Krutskikh',
            nationality: 'AINX',
          },
        ).status,
      ).toBe('valid');
    });
  });
});
