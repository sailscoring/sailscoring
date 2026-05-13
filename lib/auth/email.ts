import { promises as fs } from 'node:fs';
import path from 'node:path';

const FROM_DEFAULT = 'Sail Scoring <noreply@sailscoring.ie>';
const REPLY_TO = 'mark@hyc.ie';

const STEALTH_BETA_TEXT = `

A note before you dive in: Sail Scoring is in stealth beta, running trials with sailing clubs in Ireland. You're very welcome to try it out — feedback to mark@hyc.ie is appreciated. While we're still iterating, accounts created outside our trial cohort may be deleted (with a copy of your data emailed back) after a couple of weeks.`;

const STEALTH_BETA_HTML = `
<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#64748b;">
  A note before you dive in: Sail Scoring is in stealth beta, running trials
  with sailing clubs in Ireland. You're very welcome to try it out — feedback
  to <a href="mailto:mark@hyc.ie" style="color:#475569;">mark@hyc.ie</a> is
  appreciated.
</p>
<p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#64748b;">
  While we're still iterating, accounts created outside our trial cohort may
  be deleted (with a copy of your data emailed back) after a couple of weeks.
</p>`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderMagicLinkText(args: { to: string; url: string; isNewUser: boolean }): string {
  return `Hi,

You asked to sign in to Sail Scoring as ${args.to}. Open this link in the same browser you used to request it to finish signing in:

${args.url}

This link is single-use and expires in 5 minutes. If you didn't request it, you can safely ignore this email — no one can sign in to your account without the link above.${args.isNewUser ? STEALTH_BETA_TEXT : ''}

— Sail Scoring
mark@hyc.ie
`;
}

export function renderMagicLinkHtml(args: { to: string; url: string; isNewUser: boolean }): string {
  const toSafe = escapeHtml(args.to);
  const urlSafe = escapeHtml(args.url);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in to Sail Scoring</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border-radius:8px;padding:32px;">
          <tr>
            <td>
              <p style="margin:0 0 24px;font-size:14px;font-weight:600;color:#0f172a;letter-spacing:0.02em;">Sail Scoring</p>
              <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Hi,</p>
              <p style="margin:0 0 24px;font-size:16px;line-height:1.6;">You asked to sign in to Sail Scoring as <strong>${toSafe}</strong>. Use the button below to finish signing in — open it in the same browser you used to request the link.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
                <tr>
                  <td style="border-radius:6px;background:#0f172a;">
                    <a href="${urlSafe}" style="display:inline-block;padding:12px 24px;font-size:16px;color:#ffffff;text-decoration:none;font-weight:500;border-radius:6px;">Sign in to Sail Scoring</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#475569;">Or copy and paste this link into your browser:</p>
              <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#475569;word-break:break-all;"><a href="${urlSafe}" style="color:#475569;">${urlSafe}</a></p>
              <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#475569;">This link is single-use and expires in 5 minutes. If you didn't request it, you can safely ignore this email — no one can sign in to your account without the link above.</p>
              ${args.isNewUser ? STEALTH_BETA_HTML : ''}
              <hr style="margin:24px 0 16px;border:none;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:13px;line-height:1.5;color:#94a3b8;">Sail Scoring · <a href="mailto:mark@hyc.ie" style="color:#475569;">mark@hyc.ie</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Send a magic-link email via Resend in production. In dev/CI when
 * RESEND_API_KEY is unset, log to the console *and* append to
 * `tests/.magic-links.log` so e2e tests can read the most recent link
 * without needing to scrape stdout.
 */
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
    replyTo: REPLY_TO,
    subject: 'Sign in to Sail Scoring',
    text: renderMagicLinkText({ to, url, isNewUser }),
    html: renderMagicLinkHtml({ to, url, isNewUser }),
  });
}
