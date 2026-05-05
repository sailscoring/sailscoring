import { promises as fs } from 'node:fs';
import path from 'node:path';

const FROM_DEFAULT = 'Sail Scoring <noreply@sailscoring.ie>';

export interface FeedbackEmailArgs {
  to: string;
  userEmail: string;
  workspaceName: string;
  workspaceSlug: string;
  pageUrl: string;
  userAgent: string | null;
  message: string;
}

/**
 * Send a feedback email via Resend in production. Mirrors `sendMagicLinkEmail`
 * in `lib/auth/email.ts`: in dev/CI when `RESEND_API_KEY` is unset (or `to`
 * uses the RFC 6761 `.test` TLD), log to stdout and append a JSON line to
 * `tests/.feedback.log` so e2e tests can assert without scraping stdout.
 */
export async function sendFeedbackEmail(args: FeedbackEmailArgs): Promise<void> {
  const from = process.env.RESEND_FROM || FROM_DEFAULT;
  const isTestAddress = /\.test$/i.test(args.to);
  const subject = `Feedback from ${args.userEmail} (${args.workspaceSlug})`;
  const text = [
    `From: ${args.userEmail}`,
    `Workspace: ${args.workspaceName} (${args.workspaceSlug})`,
    `Page: ${args.pageUrl}`,
    `User-Agent: ${args.userAgent ?? '(unknown)'}`,
    '',
    args.message,
  ].join('\n');

  if (isTestAddress || !process.env.RESEND_API_KEY) {
    console.log(`[feedback] to=${args.to} from=${args.userEmail}`);
    try {
      const file = path.join(process.cwd(), 'tests', '.feedback.log');
      await fs.mkdir(path.dirname(file), { recursive: true });
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        to: args.to,
        userEmail: args.userEmail,
        workspaceSlug: args.workspaceSlug,
        pageUrl: args.pageUrl,
        userAgent: args.userAgent,
        message: args.message,
      });
      await fs.appendFile(file, line + '\n', 'utf8');
    } catch {
      // best-effort; do not fail submission if the log file cannot be written
    }
    return;
  }

  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from,
    to: args.to,
    replyTo: args.userEmail,
    subject,
    text,
  });
}
