import { describe, expect, it } from 'vitest';

import { ApiError, ValidationApiError } from '@/lib/api-client';
import { describeOpenSeriesError } from '@/lib/open-series-error';

describe('describeOpenSeriesError', () => {
  it('names the offending fields from a validation rejection and offers no retry', () => {
    // Shape mirrors the Zod issues array as serialized in the 400 body.
    const err = new ValidationApiError([
      { path: ['venueLogoUrl'], message: 'Required' },
      { path: ['ftpHost'], message: 'Required' },
      { path: ['includeJsonExport'], message: 'Required' },
    ]);
    const msg = describeOpenSeriesError(err);
    expect(msg).toContain('venueLogoUrl');
    expect(msg).toContain('ftpHost');
    expect(msg).toContain('includeJsonExport');
    expect(msg).not.toMatch(/try again/i);
  });

  it('uses the leaf field name for nested (array-item) paths and de-dupes', () => {
    const err = new ValidationApiError([
      { path: ['competitors', 0, 'club'], message: 'Required' },
      { path: ['competitors', 3, 'club'], message: 'Required' },
      { path: ['competitors', 3, 'gender'], message: 'Invalid' },
    ]);
    const msg = describeOpenSeriesError(err);
    expect(msg).toContain('club and gender');
    // "club" appears once despite two failing rows.
    expect(msg.match(/club/g)).toHaveLength(1);
  });

  it('collapses a long field list into "and N more"', () => {
    const err = new ValidationApiError(
      Array.from({ length: 11 }, (_, i) => ({ path: [`field${i}`], message: 'Required' })),
    );
    const msg = describeOpenSeriesError(err);
    expect(msg).toContain('and 3 more');
  });

  it('falls back to a generic non-retry message when a 400 carries no issues', () => {
    const msg = describeOpenSeriesError(new ValidationApiError(undefined));
    expect(msg).toMatch(/didn't pass validation/i);
    expect(msg).not.toMatch(/try again/i);
  });

  it('treats a 5xx as transient and invites a retry', () => {
    const msg = describeOpenSeriesError(new ApiError('HTTP 500', 500));
    expect(msg).toMatch(/our end/i);
    expect(msg).toMatch(/try again/i);
  });

  it('treats a bare fetch reject as a connectivity problem', () => {
    const msg = describeOpenSeriesError(new TypeError('Failed to fetch'));
    expect(msg).toMatch(/connection/i);
    expect(msg).toMatch(/try again/i);
  });

  it('surfaces an ordinary Error message without promising a retry', () => {
    const msg = describeOpenSeriesError(new Error('Invalid file: not valid JSON'));
    expect(msg).toContain('Invalid file: not valid JSON');
    expect(msg).not.toMatch(/try again/i);
  });

  it('handles a non-Error throw', () => {
    expect(describeOpenSeriesError('boom')).toBe('Could not open the file.');
  });
});
