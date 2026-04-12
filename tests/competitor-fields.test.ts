import { describe, it, expect } from 'vitest';
import {
  ALL_COMPETITOR_FIELDS,
  COMPETITOR_FIELD_LABELS,
  defaultEnabledCompetitorFields,
} from '@/lib/competitor-fields';

describe('defaultEnabledCompetitorFields', () => {
  it('returns a minimal stable default — just club', () => {
    expect(defaultEnabledCompetitorFields()).toEqual(['club']);
  });

  it('returns a fresh array each call so callers can mutate safely', () => {
    const a = defaultEnabledCompetitorFields();
    const b = defaultEnabledCompetitorFields();
    expect(a).not.toBe(b);
    a.push('gender');
    expect(b).toEqual(['club']);
  });
});

describe('ALL_COMPETITOR_FIELDS', () => {
  it('includes all optional fields in display order', () => {
    expect(ALL_COMPETITOR_FIELDS).toEqual(['boatName', 'boatClass', 'crewName', 'club', 'gender', 'age']);
  });

  it('has a human label for every field', () => {
    for (const field of ALL_COMPETITOR_FIELDS) {
      expect(COMPETITOR_FIELD_LABELS[field]).toBeTruthy();
    }
  });
});
