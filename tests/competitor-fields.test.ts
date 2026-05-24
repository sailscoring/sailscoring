import { describe, it, expect } from 'vitest';
import {
  ALL_COMPETITOR_FIELDS,
  COMPETITOR_FIELD_LABELS,
  DEFAULT_PRIMARY_PERSON_LABEL,
  DEFAULT_SUBDIVISION_LABEL,
  PRIMARY_PERSON_LABELS,
  PRIMARY_PERSON_LABEL_TEXT,
  SUBDIVISION_LABEL_PRESETS,
  competitorFleetNames,
  defaultEnabledCompetitorFields,
  displayCompetitorLabel,
  isFieldDisabledByPrimary,
  primaryPersonFieldKey,
  subdivisionFieldLabel,
} from '@/lib/competitor-fields';

describe('defaultEnabledCompetitorFields', () => {
  it('includes boat name and club so both dinghy and cruiser defaults read naturally', () => {
    expect(defaultEnabledCompetitorFields()).toEqual(['boatName', 'club']);
  });

  it('returns a fresh array each call so callers can mutate safely', () => {
    const a = defaultEnabledCompetitorFields();
    const b = defaultEnabledCompetitorFields();
    expect(a).not.toBe(b);
    a.push('gender');
    expect(b).toEqual(['boatName', 'club']);
  });
});

describe('ALL_COMPETITOR_FIELDS', () => {
  it('includes all optional fields in display order', () => {
    expect(ALL_COMPETITOR_FIELDS).toEqual([
      'boatName',
      'boatClass',
      'helm',
      'owner',
      'crewName',
      'club',
      'nationality',
      'gender',
      'age',
      'subdivision',
    ]);
  });

  it('has a human label for every field', () => {
    for (const field of ALL_COMPETITOR_FIELDS) {
      expect(COMPETITOR_FIELD_LABELS[field]).toBeTruthy();
    }
  });
});

describe('primary-person label helpers', () => {
  it('defaults to the generic "competitor" label', () => {
    expect(DEFAULT_PRIMARY_PERSON_LABEL).toBe('competitor');
  });

  it('lists all four options in display order', () => {
    expect(PRIMARY_PERSON_LABELS).toEqual(['competitor', 'entrant', 'helm', 'owner']);
    for (const label of PRIMARY_PERSON_LABELS) {
      expect(PRIMARY_PERSON_LABEL_TEXT[label]).toBeTruthy();
    }
  });

  it('maps role primaries to their field key', () => {
    expect(primaryPersonFieldKey('helm')).toBe('helm');
    expect(primaryPersonFieldKey('owner')).toBe('owner');
  });

  it('returns null for generic primaries (no field is occupied)', () => {
    expect(primaryPersonFieldKey('competitor')).toBeNull();
    expect(primaryPersonFieldKey('entrant')).toBeNull();
  });

  it('disables only the matching role field', () => {
    expect(isFieldDisabledByPrimary('helm', 'helm')).toBe(true);
    expect(isFieldDisabledByPrimary('owner', 'helm')).toBe(false);
    expect(isFieldDisabledByPrimary('helm', 'owner')).toBe(false);
    expect(isFieldDisabledByPrimary('owner', 'owner')).toBe(true);
    // Generic primaries disable nothing
    expect(isFieldDisabledByPrimary('helm', 'competitor')).toBe(false);
    expect(isFieldDisabledByPrimary('owner', 'competitor')).toBe(false);
    expect(isFieldDisabledByPrimary('boatName', 'entrant')).toBe(false);
  });
});

describe('displayCompetitorLabel', () => {
  const keelboat = { name: 'Hogan', crewName: 'Dyson', boatName: 'Eclipse' };
  const dinghy = { name: 'Ian Dickson', crewName: 'J. Crew', boatName: undefined };

  it('leads with the boat name when boatName is enabled (keelboat)', () => {
    expect(
      displayCompetitorLabel(keelboat, { enabledCompetitorFields: ['boatName'], showCrew: false }),
    ).toBe('Eclipse — Hogan');
  });

  it('appends the crew after the person when crew is shown too', () => {
    expect(
      displayCompetitorLabel(keelboat, { enabledCompetitorFields: ['boatName', 'crewName'], showCrew: true }),
    ).toBe('Eclipse — Hogan / Dyson');
  });

  it('falls back to the person when boatName is not an enabled field (dinghy)', () => {
    expect(
      displayCompetitorLabel(dinghy, { enabledCompetitorFields: ['crewName'], showCrew: true }),
    ).toBe('Ian Dickson / J. Crew');
  });

  it('ignores an enabled-but-empty boat name', () => {
    expect(
      displayCompetitorLabel(
        { name: 'Hogan', crewName: '', boatName: '   ' },
        { enabledCompetitorFields: ['boatName'], showCrew: false },
      ),
    ).toBe('Hogan');
  });

  it('does not show the boat name when boatName is present but disabled', () => {
    expect(
      displayCompetitorLabel(keelboat, { enabledCompetitorFields: [], showCrew: false }),
    ).toBe('Hogan');
  });
});

describe('competitorFleetNames', () => {
  const fleetById = new Map([
    ['f-hph', { name: 'Puppeteer HPH' }],
    ['f-scr', { name: 'Puppeteer Scr' }],
  ]);

  it('returns every fleet a competitor belongs to, in stored order', () => {
    expect(competitorFleetNames(['f-hph', 'f-scr'], fleetById)).toEqual([
      'Puppeteer HPH',
      'Puppeteer Scr',
    ]);
  });

  it('preserves order rather than always leading with the first-registered fleet', () => {
    expect(competitorFleetNames(['f-scr', 'f-hph'], fleetById)).toEqual([
      'Puppeteer Scr',
      'Puppeteer HPH',
    ]);
  });

  it('returns a single name for a single-fleet competitor', () => {
    expect(competitorFleetNames(['f-hph'], fleetById)).toEqual(['Puppeteer HPH']);
  });

  it('drops unresolvable fleet ids and returns empty when none resolve', () => {
    expect(competitorFleetNames(['f-hph', 'missing'], fleetById)).toEqual(['Puppeteer HPH']);
    expect(competitorFleetNames(['missing'], fleetById)).toEqual([]);
    expect(competitorFleetNames([], fleetById)).toEqual([]);
  });
});

describe('subdivisionFieldLabel', () => {
  it('defaults to "Division"', () => {
    expect(DEFAULT_SUBDIVISION_LABEL).toBe('Division');
    expect(subdivisionFieldLabel({ subdivisionLabel: '' })).toBe('Division');
  });

  it('uses the configured label when set', () => {
    expect(subdivisionFieldLabel({ subdivisionLabel: 'Category' })).toBe('Category');
  });

  it('trims and falls back to the default for whitespace-only labels', () => {
    expect(subdivisionFieldLabel({ subdivisionLabel: '  Flight  ' })).toBe('Flight');
    expect(subdivisionFieldLabel({ subdivisionLabel: '   ' })).toBe('Division');
  });

  it('offers "Division" and "Category" among the presets', () => {
    expect(SUBDIVISION_LABEL_PRESETS).toContain('Division');
    expect(SUBDIVISION_LABEL_PRESETS).toContain('Category');
  });
});
