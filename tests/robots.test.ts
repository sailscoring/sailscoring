import { describe, it, expect } from 'vitest';

import robots from '@/app/robots';

describe('robots.txt', () => {
  it('disallows the whole app domain for every crawler', () => {
    const { rules } = robots();
    expect(Array.isArray(rules)).toBe(false);
    const rule = rules as Exclude<typeof rules, unknown[]>;
    expect(rule.userAgent).toBe('*');
    expect(rule.disallow).toBe('/');
  });

  it('allows back only the directory page itself — anchored, so nothing beneath it', () => {
    // Any other Allow would re-open a served path; an unanchored `/p` would
    // re-open the whole publication tree.
    const rule = robots().rules as Exclude<ReturnType<typeof robots>['rules'], unknown[]>;
    expect(rule.allow).toBe('/p$');
  });
});
