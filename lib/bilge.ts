const BILGE_URL = (process.env.NEXT_PUBLIC_BILGE_URL ?? '').replace(/\/$/, '');
const BILGE_API_KEY = process.env.NEXT_PUBLIC_BILGE_API_KEY ?? '';

function log(...args: unknown[]): void {
  try {
    if (localStorage.getItem('bilge:debug') !== '1') return;
  } catch {
    return;
  }
  console.debug('[bilge]', ...args);
}

export type UploadResult =
  | { status: 'published'; url: string }
  | { status: 'pending' }
  | { status: 'error'; code: string; message?: string };

export async function uploadToBilge(params: {
  uuid: string;
  slug: string;
  email?: string;
  html: string;
}): Promise<UploadResult> {
  log('upload', { uuid: params.uuid, slug: params.slug, htmlBytes: params.html.length });
  let res: Response;
  try {
    res = await fetch(`${BILGE_URL}/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BILGE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });
  } catch (e) {
    log('upload error', String(e));
    return { status: 'error', code: 'network_error', message: String(e) };
  }

  if (res.status === 200) {
    const body = await res.json() as { url: string };
    const result: UploadResult = { status: 'published', url: body.url };
    log('upload result', result);
    return result;
  }
  if (res.status === 202) {
    log('upload result', { status: 'pending' });
    return { status: 'pending' };
  }
  const body = await res.json().catch(() => ({})) as { error?: string };
  const result: UploadResult = { status: 'error', code: body.error ?? String(res.status) };
  log('upload result', result);
  return result;
}

export interface Policy {
  retentionDays: number | null;
}

export async function fetchPolicy(): Promise<Policy> {
  log('fetchPolicy');
  try {
    const res = await fetch(`${BILGE_URL}/policy`);
    log('fetchPolicy status', res.status);
    if (!res.ok) return { retentionDays: null };
    const body = await res.json() as Policy;
    log('fetchPolicy result', body);
    return body;
  } catch (e) {
    log('fetchPolicy error', String(e));
    return { retentionDays: null };
  }
}

export type PrefixLookupResult = { found: boolean };

/**
 * Check whether any results have been published under a prefix.
 * Used during bundle creation to warn the scorer if the prefix is already in use.
 */
export async function lookupPrefix(prefix: string, signal?: AbortSignal): Promise<PrefixLookupResult> {
  const cleanPrefix = prefix.replace(/\/+$/, '');
  log('lookupPrefix', { prefix: cleanPrefix });
  try {
    const res = await fetch(`${BILGE_URL}/l/${cleanPrefix}?check`, { signal });
    log('lookupPrefix status', res.status);
    if (!res.ok) return { found: false };
    const body = await res.json() as { exists: boolean };
    log('lookupPrefix result', body);
    return { found: body.exists };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return { found: false };
    log('lookupPrefix error', String(e));
    return { found: false };
  }
}

export async function checkPublishStatus(slug: string): Promise<boolean> {
  log('checkPublishStatus', { slug });
  try {
    const res = await fetch(`${BILGE_URL}/r/${slug}`, { method: 'HEAD' });
    log('checkPublishStatus status', res.status);
    return res.ok;
  } catch (e) {
    log('checkPublishStatus error', String(e));
    return false;
  }
}

export function publishedUrl(slug: string): string {
  return `${BILGE_URL}/r/${slug}`;
}
