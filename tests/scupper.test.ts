// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { FTP_RETRY_DELAYS_MS, uploadWithRetry, type FtpUploader } from '@/lib/scupper';

const server = { host: 'ftp.club.ie', port: 21, username: 'scorer', password: 's3cret', ftps: false };
const noPause = () => Promise.resolve();

describe('uploadWithRetry', () => {
  it('uploads once when the first attempt goes through', async () => {
    const upload = vi.fn<FtpUploader>().mockResolvedValue({ ok: true });
    expect(await uploadWithRetry(upload, server, '/r.html', '<html>', noPause)).toEqual({ ok: true });
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('tries again after a failure that can pass, pausing between attempts', async () => {
    const upload = vi
      .fn<FtpUploader>()
      .mockResolvedValueOnce({ ok: false, error: 'FTP error: 421 busy', retryable: true })
      .mockResolvedValueOnce({ ok: true });
    const sleep = vi.fn(noPause);
    expect(await uploadWithRetry(upload, server, '/r.html', '<html>', sleep)).toEqual({ ok: true });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(FTP_RETRY_DELAYS_MS[0]);
  });

  it('gives up after the last retry, with the last error', async () => {
    const upload = vi
      .fn<FtpUploader>()
      .mockResolvedValue({ ok: false, error: 'FTP error: timeout', retryable: true });
    const result = await uploadWithRetry(upload, server, '/r.html', '<html>', noPause);
    expect(result).toEqual({ ok: false, error: 'FTP error: timeout', retryable: true });
    expect(upload).toHaveBeenCalledTimes(FTP_RETRY_DELAYS_MS.length + 1);
  });

  it('does not try again after a refusal', async () => {
    // The relay saying the path or the page is wrong: a second go sends the
    // same thing.
    const upload = vi.fn<FtpUploader>().mockResolvedValue({
      ok: false,
      error: 'ftpPath must be an absolute path starting with /',
      retryable: false,
    });
    await uploadWithRetry(upload, server, 'r.html', '<html>', noPause);
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
