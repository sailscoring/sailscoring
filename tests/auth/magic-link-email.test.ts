// @vitest-environment node

/**
 * Render-time properties of the magic-link email. The actual send path
 * is exercised by the @auth Playwright suite via the `.magic-links.log`
 * stub; these tests pin the rendered content so the deliverability work
 * (#137) doesn't quietly regress — both the trust-signal content and the
 * HTML-injection escaping.
 */

import { describe, expect, test } from 'vitest';

import { renderMagicLinkHtml, renderMagicLinkText } from '@/lib/auth/email';

const URL = 'https://app.sailscoring.ie/api/auth/magic-link/verify?token=abc123';
const TO = 'kieran@example.com';

describe('renderMagicLinkText', () => {
  test('includes the URL, recipient, expiry note, and signature', () => {
    const text = renderMagicLinkText({ to: TO, url: URL, isNewUser: false });
    expect(text).toContain(URL);
    expect(text).toContain(TO);
    expect(text).toContain('single-use');
    expect(text).toContain('5 minutes');
    expect(text).toContain("didn't request");
    expect(text).toContain('Sail Scoring');
    expect(text).toContain('mark@hyc.ie');
  });

  test('does not lead with the phishing-pattern "Click to sign in:" wording', () => {
    const text = renderMagicLinkText({ to: TO, url: URL, isNewUser: false });
    expect(text).not.toMatch(/Click to sign in:/i);
  });

  test('appends the stealth-beta blurb only for new users', () => {
    const newUser = renderMagicLinkText({ to: TO, url: URL, isNewUser: true });
    const returning = renderMagicLinkText({ to: TO, url: URL, isNewUser: false });
    expect(newUser).toContain('stealth beta');
    expect(returning).not.toContain('stealth beta');
  });
});

describe('renderMagicLinkHtml', () => {
  test('is a complete HTML document with envelope and viewport meta', () => {
    const html = renderMagicLinkHtml({ to: TO, url: URL, isNewUser: false });
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('charset="utf-8"');
    expect(html).toContain('viewport');
    expect(html).toContain('</html>');
  });

  test('renders the CTA button linking to the magic-link URL', () => {
    const html = renderMagicLinkHtml({ to: TO, url: URL, isNewUser: false });
    expect(html).toContain(`href="${URL}"`);
    expect(html).toContain('Sign in to Sail Scoring');
  });

  test('includes the recipient address, expiry note, and footer contact', () => {
    const html = renderMagicLinkHtml({ to: TO, url: URL, isNewUser: false });
    expect(html).toContain(TO);
    expect(html).toContain('5 minutes');
    expect(html).toContain("didn't request");
    expect(html).toContain('mark@hyc.ie');
  });

  test('shows the stealth-beta blurb only for new users', () => {
    const newUser = renderMagicLinkHtml({ to: TO, url: URL, isNewUser: true });
    const returning = renderMagicLinkHtml({ to: TO, url: URL, isNewUser: false });
    expect(newUser).toContain('stealth beta');
    expect(returning).not.toContain('stealth beta');
  });

  test('escapes HTML in the recipient address', () => {
    const html = renderMagicLinkHtml({
      to: 'a"<script>alert(1)</script>@example.com',
      url: URL,
      isNewUser: false,
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;');
  });

  test('escapes ampersands in the URL so query strings survive parsing', () => {
    const messyUrl = 'https://app.sailscoring.ie/verify?token=abc&next=/foo';
    const html = renderMagicLinkHtml({ to: TO, url: messyUrl, isNewUser: false });
    expect(html).toContain('token=abc&amp;next=/foo');
    expect(html).not.toContain('token=abc&next');
  });
});
