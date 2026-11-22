import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { todayIsoDate } from '../lib/race-schedule';
import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createSeriesQuick, enableFeatures } from './helpers';

/**
 * Recording finishes by voice with the real recogniser (ADR-017): the
 * engine's download, the worker, the model and the reading of its words,
 * all inside the app, hearing a synthetic caller through Chromium's fake
 * microphone.
 *
 * Runs only on a machine that has both the engine (`pnpm voice:sync`, which
 * every build runs) and `flite` to speak the calls, which CI lacks; elsewhere
 * it is skipped, and `voice-recording.spec.ts` covers the flow with a scripted
 * recogniser. A text-to-speech voice in a quiet room says nothing about a
 * caller in a breeze: this shows the plumbing works, not that recognition
 * is good enough.
 */

const ENGINE = join(__dirname, '..', 'public', 'voice', 'engine', 'manifest.json');
const CALLS = ['sixteen thirteen', 'four oh seven eight', 'eight three three eight'];

function speak(text: string, dir: string, name: string): Int16Array {
  const file = join(dir, `${name}.wav`);
  execFileSync('flite', ['-voice', 'slt', '-t', text, '-o', file]);
  const wav = readFileSync(file);
  const rate = wav.readUInt32LE(24);
  if (rate !== 16000) throw new Error(`flite spoke at ${rate} Hz, expected 16000`);
  const data = wav.indexOf('data') + 8;
  return new Int16Array(wav.buffer, wav.byteOffset + data, Math.floor((wav.length - data) / 2)).slice();
}

/** A caller on a loop: each number, a breath, "now", and a longer pause. */
function callerAudio(): string | null {
  if (!existsSync(ENGINE)) return null;
  const dir = mkdtempSync(join(tmpdir(), 'voice-e2e-'));
  const quiet = (seconds: number) => new Int16Array(16000 * seconds);
  let now: Int16Array;
  try {
    now = speak('now', dir, 'now');
  } catch {
    // No flite on this machine.
    return null;
  }
  const parts: Int16Array[] = [quiet(2)];
  CALLS.forEach((call, i) => parts.push(speak(call, dir, `call-${i}`), quiet(1.2), now, quiet(3)));
  const samples = parts.reduce((n, p) => n + p.length, 0);
  const out = Buffer.alloc(44 + samples * 2);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + samples * 2, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(16000, 24);
  out.writeUInt32LE(32000, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(samples * 2, 40);
  let at = 44;
  for (const p of parts) {
    Buffer.from(p.buffer, p.byteOffset, p.byteLength).copy(out, at);
    at += p.byteLength;
  }
  const file = join(dir, 'caller.wav');
  writeFileSync(file, out);
  return file;
}

const audio = callerAudio();

test.use({
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      ...(audio ? [`--use-file-for-fake-audio-capture=${audio}`] : []),
    ],
  },
  permissions: ['microphone'],
});

test('the real recogniser hears a synthetic caller’s finishes', async ({ page, signedInEmail }) => {
  test.skip(audio === null, 'needs the voice engine (pnpm voice:sync) and flite');
  await enableFeatures(page, signedInEmail, ['finish-submissions', 'voice-recording']);
  await createSeriesQuick(page, { name: 'Real Engine', date: todayIsoDate() });
  const seriesId = /\/series\/([0-9a-f-]{36})\//.exec(page.url())![1];
  for (const [sailNumber, helm] of [['1613', 'Kestrel Crew'], ['4078', 'Dunlin Crew'], ['8338', 'Gannet Crew'], ['1631', 'Fulmar Crew']]) {
    await addCompetitor(page, { sailNumber, name: helm });
  }
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1', { exact: true })).toBeVisible();
  const [race] = (await (await page.request.get(`/api/v1/series/${seriesId}/races`)).json()) as { id: string }[];

  await page.goto(`/workspace/record?race=${race.id}`);
  await page.getByTestId('voice-set-up').click();
  const setup = page.getByTestId('voice-setup');
  // The one download, then the engine starts by itself.
  await setup.getByRole('button', { name: /^Download/ }).click();
  await expect(setup).toContainText('Downloaded. Sail numbers are recognised on the phone', { timeout: 30_000 });
  await setup.getByRole('button', { name: 'Turn on the microphone' }).click();
  // The trial call hears the caller too.
  await expect(setup.getByTestId('voice-trial-heard')).toBeVisible({ timeout: 30_000 });
  await setup.getByTestId('voice-setup-record').click();

  // A full turn of the caller's loop, and every competitor is on the timeline.
  const screen = page.getByTestId('voice-recording-screen');
  await expect(screen.getByTestId('voice-state')).toHaveText('Recording');
  const list = screen.getByTestId('voice-timeline-list');
  for (const name of ['Kestrel Crew', 'Dunlin Crew', 'Gannet Crew']) {
    await expect(list.getByTestId('voice-chip').filter({ hasText: name }).first()).toBeVisible({ timeout: 40_000 });
  }
  await screen.getByTestId('voice-stop').click();
  await screen.getByTestId('voice-stop-confirmed').click();
  // Each is on the sheet once: suggested with the "now" said after it, or
  // to check where the recogniser wasn't sure of the sail number. Which, is
  // the recogniser's business and a synthetic voice's, not this test's.
  const rows = page.locator('[data-entry-key]');
  for (const name of ['Kestrel Crew', 'Dunlin Crew', 'Gannet Crew']) {
    await expect(rows.filter({ hasText: name })).toHaveCount(1);
  }
  await expect(page.getByTestId('voice-summary')).toContainText('0 accepted');
});
