import { describe, it, expect } from 'vitest';
import {
  ALL_COMPETITOR_FIELDS,
  COMPETITOR_FIELD_LABELS,
  DEFAULT_PRIMARY_PERSON_LABEL,
  PRIMARY_PERSON_LABELS,
  PRIMARY_PERSON_LABEL_TEXT,
  defaultEnabledCompetitorFields,
  isFieldDisabledByPrimary,
  primaryPersonFieldKey,
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
      'gender',
      'age',
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
