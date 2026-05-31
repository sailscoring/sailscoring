// @vitest-environment node

/**
 * The send-path guard on `sendOrgRequestEmail`. Mirrors the guard on
 * `sendMagicLinkEmail`/`sendFeedbackEmail`: when `to` uses the RFC 6761
 * `.test` TLD (as the e2e suite's FEEDBACK_TO does) or RESEND_API_KEY is
 * unset, log instead of sending. Without this, e2e runs with a live key
 * fired real, undeliverable sends to `feedback@sailscoring.test` that
 * bounced and eroded the sending domain's reputation.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const sendMock = vi.fn();
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import { sendOrgRequestEmail } from '@/lib/auth/email';

const baseArgs = {
  requesterEmail: 'kieran@example.com',
  requestedName: 'My Club Panel',
  note: null,
};

const original = process.env.RESEND_API_KEY;

beforeEach(() => {
  sendMock.mockReset();
});

afterEach(() => {
  if (original === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = original;
});

describe('sendOrgRequestEmail', () => {
  test('does not send to a .test recipient even when RESEND_API_KEY is set', async () => {
    process.env.RESEND_API_KEY = 're_fake';
    await sendOrgRequestEmail({ to: 'feedback@sailscoring.test', ...baseArgs });
    expect(sendMock).not.toHaveBeenCalled();
  });

  test('does not send when RESEND_API_KEY is unset', async () => {
    delete process.env.RESEND_API_KEY;
    await sendOrgRequestEmail({ to: 'feedback@sailscoring.ie', ...baseArgs });
    expect(sendMock).not.toHaveBeenCalled();
  });

  test('sends to a real recipient when RESEND_API_KEY is set', async () => {
    process.env.RESEND_API_KEY = 're_fake';
    await sendOrgRequestEmail({ to: 'mark@hyc.ie', ...baseArgs });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const payload = sendMock.mock.calls[0][0];
    expect(payload.to).toBe('mark@hyc.ie');
    expect(payload.replyTo).toBe('kieran@example.com');
    expect(payload.subject).toBe('Workspace request: My Club Panel');
  });
});
