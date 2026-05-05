import { describe, test, expect } from 'vitest';

import { feedbackInputSchema } from '@/lib/validation/feedback';

describe('feedbackInputSchema', () => {
  const VALID = {
    message: 'Hello, scoring world',
    pageUrl: 'https://app.sailscoring.ie/series/abc',
  };

  test('accepts a well-formed input', () => {
    expect(() => feedbackInputSchema.parse(VALID)).not.toThrow();
  });

  test('trims whitespace on the message', () => {
    const parsed = feedbackInputSchema.parse({ ...VALID, message: '  hi  ' });
    expect(parsed.message).toBe('hi');
  });

  test('rejects empty message', () => {
    expect(() => feedbackInputSchema.parse({ ...VALID, message: '' })).toThrow();
  });

  test('rejects whitespace-only message after trim', () => {
    expect(() =>
      feedbackInputSchema.parse({ ...VALID, message: '   ' }),
    ).toThrow();
  });

  test('accepts a 5000-char message', () => {
    expect(() =>
      feedbackInputSchema.parse({ ...VALID, message: 'a'.repeat(5000) }),
    ).not.toThrow();
  });

  test('rejects a 5001-char message', () => {
    expect(() =>
      feedbackInputSchema.parse({ ...VALID, message: 'a'.repeat(5001) }),
    ).toThrow();
  });

  test('rejects malformed pageUrl', () => {
    expect(() =>
      feedbackInputSchema.parse({ ...VALID, pageUrl: 'not-a-url' }),
    ).toThrow();
  });

  test('rejects pageUrl over 2048 chars', () => {
    const url = 'https://example.com/' + 'x'.repeat(2048);
    expect(() => feedbackInputSchema.parse({ ...VALID, pageUrl: url })).toThrow();
  });
});
