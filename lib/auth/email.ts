import { promises as fs } from 'node:fs';
import path from 'node:path';

const FROM_DEFAULT = 'Sail Scoring <noreply@sailscoring.ie>';

/**
 * Send a magic-link email via Resend in production. In dev/CI when
 * RESEND_API_KEY is unset, log to the console *and* append to
 * `tests/.magic-links.log` so e2e tests can read the most recent link
 * without needing to scrape stdout.
 */
const STEALTH_BETA_TEXT = `
A note before you dive in: Sail Scoring is in stealth beta, running trials
with sailing clubs in Ireland. You're very welcome to try it out — feedback
to mark@hyc.ie is appreciated.

While we're still iterating, accounts created outside our trial cohort may
be deleted (with a copy of your data emailed back) after a couple of weeks.
`;

const STEALTH_BETA_HTML = `
<hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb">
<p style="color:#6b7280;font-size:14px;margin:0 0 8px">
  A note before you dive in: Sail Scoring is in stealth beta, running trials
  with sailing clubs in Ireland. You're very welcome to try it out — feedback
  to <a href="mailto:mark@hyc.ie">mark@hyc.ie</a> is appreciated.
</p>
<p style="color:#6b7280;font-size:14px;margin:0">
  While we're still iterating, accounts created outside our trial cohort may
  be deleted (with a copy of your data emailed back) after a couple of weeks.
</p>
`;

export async function sendMagicLinkEmail(args: {
  to: string;
  url: string;
  isNewUser?: boolean;
}): Promise<void> {
  const { to, url, isNewUser = false } = args;
  const from = process.env.RESEND_FROM || FROM_DEFAULT;

  // RFC 6761 reserves the `.test` TLD for testing; route every such
  // address through the file logger so the @auth Playwright suite
  // works the same locally (where RESEND_API_KEY may be set from
  // `vercel env pull`) and in CI (where it isn't). This also catches
  // the case where Resend is configured but unavailable.
  const isTestAddress = /\.test$/i.test(to);

  if (isTestAddress || !process.env.RESEND_API_KEY) {
    console.log(`[magic-link] to=${to} url=${url}`);
    try {
      const file = path.join(process.cwd(), 'tests', '.magic-links.log');
      await fs.mkdir(path.dirname(file), { recursive: true });
      const line = `${new Date().toISOString()}\t${to}\t${url}\n`;
      await fs.appendFile(file, line, 'utf8');
    } catch {
      // best-effort; do not fail sign-in if the log file cannot be written
    }
    return;
  }

  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from,
    to,
    subject: 'Sign in to Sail Scoring',
    text: `Click to sign in: ${url}\n\nThis link is single-use and expires in 5 minutes.${isNewUser ? STEALTH_BETA_TEXT : ''}`,
    html: `<p><a href="${url}">Sign in to Sail Scoring</a></p>
<p>This link is single-use and expires in 5 minutes.</p>${isNewUser ? STEALTH_BETA_HTML : ''}`,
  });
}
