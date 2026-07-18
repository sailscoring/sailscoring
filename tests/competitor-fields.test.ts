import { describe, it, expect } from 'vitest';
import {
  ALL_COMPETITOR_FIELDS,
  COMPETITOR_FIELD_LABELS,
  DEFAULT_PRIMARY_PERSON_LABEL,
  DEFAULT_SUBDIVISION_LABEL,
  PRIMARY_PERSON_LABELS,
  PRIMARY_PERSON_LABEL_TEXT,
  cleanPersonNames,
  competitorFleetNames,
  defaultEnabledCompetitorFields,
  displayCompetitorLabel,
  isFieldDisabledByPrimary,
  primaryPersonFieldKey,
  subdivisionAxisLabel,
  subdivisionAxes,
  cleanSubdivisions,
  samePersonNames,
  subdivisionsEqual,
  upgradeSubdivisionAxes,
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
      'bowNumber',
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
  const keelboat = { names: ['Hogan'], crewNames: ['Dyson'], boatName: 'Eclipse' };
  const dinghy = { names: ['Ian Dickson'], crewNames: ['J. Crew'], boatName: undefined };

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
        { names: ['Hogan'], crewNames: [], boatName: '   ' },
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

describe('subdivisionAxisLabel', () => {
  it('defaults to "Division" for a blank label', () => {
    expect(DEFAULT_SUBDIVISION_LABEL).toBe('Division');
    expect(subdivisionAxisLabel({ label: '' })).toBe('Division');
  });

  it('uses the configured label when set', () => {
    expect(subdivisionAxisLabel({ label: 'Category' })).toBe('Category');
  });

  it('trims and falls back to the default for whitespace-only labels', () => {
    expect(subdivisionAxisLabel({ label: '  Flight  ' })).toBe('Flight');
    expect(subdivisionAxisLabel({ label: '   ' })).toBe('Division');
  });
});

describe('subdivisionAxes', () => {
  it('returns the configured axes', () => {
    const axes = [{ id: 'a', label: 'Division' }];
    expect(subdivisionAxes({ subdivisionAxes: axes })).toBe(axes);
  });

  it('tolerates a missing array', () => {
    expect(subdivisionAxes({ subdivisionAxes: undefined as never })).toEqual([]);
  });
});

describe('cleanSubdivisions', () => {
  it('trims values and drops empties', () => {
    expect(cleanSubdivisions({ a: '  Silver ', b: '   ', c: 'Master' })).toEqual({
      a: 'Silver',
      c: 'Master',
    });
  });

  it('returns undefined when nothing remains', () => {
    expect(cleanSubdivisions({ a: '', b: '  ' })).toBeUndefined();
    expect(cleanSubdivisions(undefined)).toBeUndefined();
  });
});

describe('subdivisionsEqual', () => {
  it('is order-insensitive and ignores empty values', () => {
    expect(subdivisionsEqual({ a: 'Gold', b: 'Master' }, { b: 'Master', a: 'Gold' })).toBe(true);
    expect(subdivisionsEqual({ a: 'Gold', b: '' }, { a: 'Gold' })).toBe(true);
    expect(subdivisionsEqual({ a: 'Gold' }, { a: 'Silver' })).toBe(false);
    expect(subdivisionsEqual(undefined, {})).toBe(true);
  });
});

describe('upgradeSubdivisionAxes', () => {
  it('synthesises one axis when the legacy field was enabled', () => {
    const { axes, axisId } = upgradeSubdivisionAxes({
      legacyLabel: 'Category',
      fieldEnabled: true,
      hasAnyValue: false,
    });
    expect(axes).toHaveLength(1);
    expect(axes[0].label).toBe('Category');
    expect(axisId).toBe(axes[0].id);
  });

  it('synthesises an axis when a competitor holds a value even if disabled', () => {
    const { axes } = upgradeSubdivisionAxes({
      fieldEnabled: false,
      hasAnyValue: true,
    });
    expect(axes).toHaveLength(1);
    expect(axes[0].label).toBe('Division');
  });

  it('produces no axis when the field is unused and the label is default', () => {
    expect(
      upgradeSubdivisionAxes({ legacyLabel: 'Division', fieldEnabled: false, hasAnyValue: false }),
    ).toEqual({ axes: [], axisId: null });
  });
});

describe('cleanPersonNames', () => {
  it('trims names and drops empties', () => {
    expect(cleanPersonNames([' Alice Byrne ', '', '  ', 'Bob Malone'])).toEqual(['Alice Byrne', 'Bob Malone']);
  });

  it('returns undefined when nothing remains', () => {
    expect(cleanPersonNames([])).toBeUndefined();
    expect(cleanPersonNames(['  '])).toBeUndefined();
    expect(cleanPersonNames(undefined)).toBeUndefined();
  });
});

describe('samePersonNames', () => {
  it('ignores blanks and trims when comparing', () => {
    expect(samePersonNames(['Alice', ''], [' Alice '])).toBe(true);
    expect(samePersonNames(undefined, [])).toBe(true);
  });

  it('is order-sensitive', () => {
    expect(samePersonNames(['Alice', 'Bob'], ['Bob', 'Alice'])).toBe(false);
  });

  it('detects changed and added names', () => {
    expect(samePersonNames(['Alice'], ['Alice', 'Bob'])).toBe(false);
    expect(samePersonNames(['Alice'], ['Bob'])).toBe(false);
  });
});

describe('displayCompetitorLabel — multi-crew', () => {
  it('shows the single crew inline', () => {
    expect(
      displayCompetitorLabel(
        { names: ['Hogan'], crewNames: ['Dyson'], boatName: undefined },
        { enabledCompetitorFields: ['crewName'], showCrew: true },
      ),
    ).toBe('Hogan / Dyson');
  });

  it('shows the primary alone when more than one crew is set', () => {
    expect(
      displayCompetitorLabel(
        { names: ['Hogan'], crewNames: ['Dyson', 'Byrne', 'Malone'], boatName: undefined },
        { enabledCompetitorFields: ['crewName'], showCrew: true },
      ),
    ).toBe('Hogan');
  });
});
