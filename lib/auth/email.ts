import { promises as fs } from 'node:fs';
import path from 'node:path';

const FROM_DEFAULT = 'Sail Scoring <noreply@mail.sailscoring.ie>';

/**
 * Send a magic-link email via Resend in production. In dev/CI when
 * RESEND_API_KEY is unset, log to the console *and* append to
 * `tests/.magic-links.log` so e2e tests can read the most recent link
 * without needing to scrape stdout.
 */
export async function sendMagicLinkEmail(args: {
  to: string;
  url: string;
}): Promise<void> {
  const { to, url } = args;
  const from = process.env.EMAIL_FROM || FROM_DEFAULT;

  if (!process.env.RESEND_API_KEY) {
    console.log(`[magic-link] to=${to} url=${url}`);
    if (process.env.NODE_ENV !== 'production') {
      try {
        const file = path.join(process.cwd(), 'tests', '.magic-links.log');
        await fs.mkdir(path.dirname(file), { recursive: true });
        const line = `${new Date().toISOString()}\t${to}\t${url}\n`;
        await fs.appendFile(file, line, 'utf8');
      } catch {
        // best-effort; do not fail sign-in if the log file cannot be written
      }
    }
    return;
  }

  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from,
    to,
    subject: 'Sign in to Sail Scoring',
    text: `Click to sign in: ${url}\n\nThis link is single-use and expires in 5 minutes.`,
    html: `<p><a href="${url}">Sign in to Sail Scoring</a></p>
<p>This link is single-use and expires in 5 minutes.</p>`,
  });
}
