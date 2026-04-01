export interface ScupperUploadParams {
  ftpHost: string;
  ftpPort: number;
  ftpUsername: string;
  ftpPassword: string;
  ftpPath: string;
  ftps: boolean;
  html: string;
}

export type ScupperResult = { ok: true } | { ok: false; error: string };

function isDebug(): boolean {
  try {
    return localStorage.getItem('scupper:debug') === '1';
  } catch {
    return false;
  }
}

export async function uploadViaScupper(params: ScupperUploadParams): Promise<ScupperResult> {
  const apiKey = process.env.NEXT_PUBLIC_SCUPPER_API_KEY ?? '';
  const baseUrl = process.env.NEXT_PUBLIC_SCUPPER_URL ?? '';

  if (isDebug()) {
    console.debug('[scupper] upload', { ftpHost: params.ftpHost, ftpPath: params.ftpPath });
  }

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(params),
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Network error';
    if (isDebug()) console.debug('[scupper] fetch error', error);
    return { ok: false, error };
  }

  if (res.ok) {
    if (isDebug()) console.debug('[scupper] upload success');
    return { ok: true };
  }

  let error = `HTTP ${res.status}`;
  try {
    const body = await res.json();
    if (typeof body.error === 'string') error = body.error;
  } catch { /* ignore */ }

  if (isDebug()) console.debug('[scupper] upload error', error);
  return { ok: false, error };
}
