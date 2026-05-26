// @vitest-environment node

/**
 * Render-time properties of the workspace-invitation email (#153). The send
 * path is exercised end-to-end by the e2e suite; these pin the rendered
 * content and the HTML-injection escaping (org name and inviter label are
 * user-controlled).
 */

import { describe, expect, test } from 'vitest';

import { renderInvitationHtml, renderInvitationText } from '@/lib/auth/email';

const ARGS = {
  organizationName: 'HYC Scoring Panel',
  inviterLabel: 'mark',
  role: 'admin',
  acceptUrl: 'https://app.sailscoring.ie/accept-invitation/inv_123',
};

describe('renderInvitationText', () => {
  test('includes inviter, org, role, accept URL, and signature', () => {
    const text = renderInvitationText(ARGS);
    expect(text).toContain('mark');
    expect(text).toContain('HYC Scoring Panel');
    expect(text).toContain('admin');
    expect(text).toContain(ARGS.acceptUrl);
    expect(text).toContain('mark@hyc.ie');
  });
});

describe('renderInvitationHtml', () => {
  test('is a complete HTML document with the accept CTA', () => {
    const html = renderInvitationHtml(ARGS);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('</html>');
    expect(html).toContain(`href="${ARGS.acceptUrl}"`);
    expect(html).toContain('Accept invitation');
    expect(html).toContain('HYC Scoring Panel');
  });

  test('escapes HTML in the org name and inviter label', () => {
    const html = renderInvitationHtml({
      ...ARGS,
      organizationName: '<script>alert(1)</script>',
      inviterLabel: 'a"<b>',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;');
  });
});
