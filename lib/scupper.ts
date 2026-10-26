import 'server-only';

import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { FtpServer } from './types';

/**
 * Uploads to a club's own web server, through the scupper FTP relay.
 *
 * Server-side only: the publish handler uploads a page right after publishing
 * it, with the server credentials the workspace stores, so the password never
 * travels to a browser — which is what lets anyone who can publish send the
 * pages without being shown it.
 */

export type FtpUploadResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      /** Whether trying again could help: the relay or the FTP server fell
       *  over, rather than refused what it was sent. */
      retryable: boolean;
    };

export type FtpUploader = (
  server: Pick<FtpServer, 'host' | 'port' | 'username' | 'password' | 'ftps'>,
  ftpPath: string,
  html: string,
) => Promise<FtpUploadResult>;

/**
 * A host on the RFC 6761 `.test` TLD can never resolve, so instead of calling
 * the relay the upload is appended to `tests/.ftp-uploads.log` — how e2e
 * tests see what went where, the way feedback email works. A host starting
 * `fail.` fails, for the error path.
 */
async function testUpload(
  server: Parameters<FtpUploader>[0],
  ftpPath: string,
  html: string,
): Promise<FtpUploadResult> {
  if (/^fail\./i.test(server.host)) {
    return { ok: false, error: `FTP error: 530 Login incorrect (${server.host})`, retryable: true };
  }
  try {
    const file = path.join(process.cwd(), 'tests', '.ftp-uploads.log');
    await fs.mkdir(path.dirname(file), { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      host: server.host,
      path: ftpPath,
      html,
    });
    await fs.appendFile(file, line + '\n', 'utf8');
  } catch {
    // best-effort, like the feedback log
  }
  return { ok: true };
}

export const uploadViaScupper: FtpUploader = async (server, ftpPath, html) => {
  if (/\.test$/i.test(server.host)) return testUpload(server, ftpPath, html);

  // The relay used to be called from the browser, under public names; those
  // are still read until the deployment carries the server-side ones.
  const baseUrl = process.env.SCUPPER_URL ?? process.env.NEXT_PUBLIC_SCUPPER_URL ?? '';
  const apiKey = process.env.SCUPPER_API_KEY ?? process.env.NEXT_PUBLIC_SCUPPER_API_KEY ?? '';
  if (!baseUrl) {
    return { ok: false, error: 'The FTP relay is not configured.', retryable: false };
  }

  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, '')}/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        ftpHost: server.host,
        ftpPort: server.port,
        ftpUsername: server.username,
        ftpPassword: server.password,
        ftpPath,
        ftps: server.ftps,
        html,
      }),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Network error',
      retryable: true,
    };
  }
  if (res.ok) return { ok: true };

  let error = `HTTP ${res.status}`;
  try {
    const body = await res.json();
    if (typeof body.error === 'string') error = body.error;
  } catch { /* not JSON */ }
  // The relay answers 400 for what it was sent and 401 for its key, neither
  // of which a second attempt changes; an FTP failure comes back 502.
  return { ok: false, error, retryable: res.status >= 500 };
};

/** Pauses between attempts at one page: a dropped connection or a busy FTP
 *  server usually clears within seconds, and a publish is waiting. */
export const FTP_RETRY_DELAYS_MS = [500, 2000];

/**
 * Upload one page, trying again a couple of times when the failure is the
 * kind that passes. What the scorer would otherwise do by hand is publish
 * again; this saves them doing it for a blip.
 */
export async function uploadWithRetry(
  upload: FtpUploader,
  server: Parameters<FtpUploader>[0],
  ftpPath: string,
  html: string,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<FtpUploadResult> {
  let result = await upload(server, ftpPath, html);
  for (const delay of FTP_RETRY_DELAYS_MS) {
    if (result.ok || !result.retryable) return result;
    await sleep(delay);
    result = await upload(server, ftpPath, html);
  }
  return result;
}
