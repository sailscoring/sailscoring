import type { Page } from '@playwright/test';

import { todayIsoDate } from '../lib/race-schedule';
import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createSeriesQuick, enableFeatures } from './helpers';

/**
 * Recording finishes by voice (ADR-017), from the Record finishes page to
 * the scorer's review: listening, the lines landing on the sheet, settling
 * the ones the app wasn't sure of, a reload and a spell with no signal, and
 * the recording going to the scorer with the sheet.
 *
 * The recogniser is the one thing not real here: the engine and its model
 * are 85 MB that CI doesn't fetch, so the page is handed a listener that
 * says what the test tells it to. The microphone is Chromium's fake one,
 * so sound really flows, is stored, sent and fetched back.
 *
 * Gated behind the operator-managed `voice-recording` feature.
 */

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['microphone'],
  // With no signal the page's own requests fail, and say so: the subject of
  // this spec, not a fault.
  allowedConsoleErrors: [/net::ERR_INTERNET_DISCONNECTED/, /Failed to fetch/i, /NetworkError/i],
});

/** A stand-in for the listening engine: `window.__voiceSay('one five')`
 *  makes it hear those words on the take's clock, leaving a breath after
 *  whatever it heard before, as a caller does between boats. */
async function installScriptedListener(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Batch = { words: { w: string; t: number }[]; closed: boolean; heard: number; cost: number; span: number };
    const w = window as unknown as {
      __sailscoringVoiceListener: () => unknown;
      __voiceSay: (text: string) => void;
      __voiceTake: () => { takes: number; heard: number };
    };
    let fed = 0;
    let takes = 0;
    let quietSince = 0;
    const waiting: string[] = [];
    const hear = () => {
      const heard = fed / 16000;
      if (waiting.length === 0 || heard - quietSince < 1.5) return;
      const said = waiting.shift()!.split(' ');
      const words = said.map((word, i) => ({ w: word, t: heard - 0.05 * (said.length - i) }));
      quietSince = heard;
      onWords?.({ words, closed: true, heard, cost: 1, span: 0 });
    };
    let onWords: ((batch: Batch) => void) | null = null;
    w.__sailscoringVoiceListener = () => ({
      get onWords() { return onWords; },
      set onWords(f: ((batch: Batch) => void) | null) { onWords = f; },
      onError: null,
      begin() { fed = 0; quietSince = -2; takes += 1; },
      feed(samples: Float32Array) {
        fed += samples.length;
        onWords?.({ words: [], closed: false, heard: fed / 16000, cost: 1, span: samples.length / 16000 });
        hear();
      },
      close() {},
    });
    w.__voiceTake = () => ({ takes, heard: fed / 16000 });
    w.__voiceSay = (text: string) => {
      waiting.push(text);
    };
  });
}

const say = (page: Page, text: string) => page.evaluate((t) => (window as unknown as { __voiceSay: (text: string) => void }).__voiceSay(t), text);

/** Wait until take number `n` since the page loaded is under way: sound is
 *  reaching the listener, so what it is told to hear lands in that take. */
const takeUnderWay = (page: Page, n: number) =>
  page.waitForFunction((want) => {
    const t = (window as unknown as { __voiceTake: () => { takes: number; heard: number } }).__voiceTake();
    return t.takes >= want && t.heard > 0.3;
  }, n);

test('finishes taken by voice reach the scorer with their recording', async ({ page, signedInEmail, context }) => {
  await enableFeatures(page, signedInEmail, ['finish-submissions', 'voice-recording']);
  await createSeriesQuick(page, { name: 'Voice League', date: todayIsoDate() });
  const seriesId = /\/series\/([0-9a-f-]{36})\//.exec(page.url())![1];
  for (const [sailNumber, helm] of [['15', 'Alice Pearson'], ['22', 'Bob Dickson'], ['254', 'Carol Walls']]) {
    await addCompetitor(page, { sailNumber, name: helm });
  }
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1', { exact: true })).toBeVisible();
  const [race] = (await (await page.request.get(`/api/v1/series/${seriesId}/races`)).json()) as { id: string }[];

  await installScriptedListener(page);
  await page.goto(`/workspace/record?race=${race.id}`);
  const voice = page.getByTestId('voice-finishes');
  await expect(voice).toContainText('Take finishes by voice');

  // Setting up: the microphone, then a trial call that says who was heard.
  await voice.getByTestId('voice-set-up').click();
  const setup = page.getByTestId('voice-setup');
  await expect(setup).toContainText('Entry list: 3 boats in this race');
  await setup.getByRole('button', { name: 'Turn on the microphone' }).click();
  await expect(setup).toContainText(/Microphone: \S/);
  await expect(setup.getByTestId('voice-setup-listen')).toBeEnabled();
  await takeUnderWay(page, 1);
  await say(page, 'two two');
  await expect(setup.getByTestId('voice-trial-heard')).toContainText('Bob Dickson');
  await setup.getByTestId('voice-setup-listen').click();

  // Listening: each call becomes a line, the last one large.
  const screen = page.getByTestId('voice-listening');
  await expect(screen.getByTestId('voice-state')).toHaveText('Listening');
  await takeUnderWay(page, 2);
  await say(page, 'fifteen');
  await expect(screen.getByTestId('voice-last')).toContainText('15');
  await expect(screen.getByTestId('voice-last')).toContainText('Alice Pearson');
  await say(page, 'two fifty four');
  await expect(screen.getByTestId('voice-last')).toContainText('254');
  // A number on no entry is an unknown boat; talk is nothing.
  await say(page, 'nine nine nine');
  await expect(screen.getByTestId('voice-last')).toContainText('Not on the entry list');
  await say(page, 'is that the last of them');
  // A press of Now just after a call is that boat's time. Another, with no
  // call, is a line of its own, and Undo takes it back.
  await screen.getByTestId('voice-now').click();
  await screen.getByTestId('voice-now').click();
  await expect(screen.getByTestId('voice-last')).toContainText('Crossed, not yet called');
  await screen.getByRole('button', { name: 'Undo' }).click();
  await expect(screen.getByTestId('voice-state')).toHaveText('Removed —');
  // Not a number on the list as heard, but it sounds like just one boat's.
  await say(page, 'twenty too');
  await expect(screen.getByTestId('voice-last')).toContainText('22');
  await expect(screen.getByTestId('voice-last')).toContainText('check');
  // A boat called twice gets no second line.
  await say(page, 'fifteen');
  await expect(screen.getByTestId('voice-lines').getByRole('listitem')).toHaveCount(3);

  // Lock keeps sleeves off it; a held press lets go.
  await screen.getByRole('button', { name: 'Lock' }).click();
  const lock = screen.getByTestId('voice-lock');
  await expect(lock).toContainText('Still listening');
  await lock.dispatchEvent('pointerdown');
  await expect(lock).toBeHidden();

  await screen.getByRole('button', { name: 'Stop' }).click();
  await expect(screen.getByTestId('voice-stop-confirm')).toContainText('Stop listening? 4 boats taken.');
  await screen.getByTestId('voice-stop-confirm').getByRole('button', { name: 'Stop' }).click();
  await expect(screen).toBeHidden();

  // The lines are in the ordinary finishing order, in the order called.
  const rows = page.locator('[data-entry-key]');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Alice Pearson');
  await expect(rows.nth(1)).toContainText('Carol Walls');
  await expect(rows.nth(2)).toContainText('999');
  await expect(rows.nth(3)).toContainText('Bob Dickson');
  await expect(rows.nth(3)).toContainText('check');
  const taken = voice.getByTestId('voice-taken');
  await expect(taken).toContainText('Taken by voice: 3 boats · 2 lines to check');

  // A reload loses neither the sheet nor the recording.
  await page.reload();
  await expect(rows).toHaveCount(4);
  await expect(taken).toContainText('2 lines to check');
  await taken.getByRole('button', { name: 'Yes, 22' }).click();
  await expect(taken).toContainText('1 line to check');
  await expect(rows.nth(3)).not.toContainText('check');
  // Every line taken by voice can be heard again.
  await rows.nth(0).getByRole('button', { name: /Play the call/ }).click();

  // No signal: the page still opens, and the sheet waits to be submitted.
  await context.setOffline(true);
  await page.reload();
  await expect(rows).toHaveCount(4);
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByTestId('record-waiting')).toContainText('will be submitted when there is one');
  await context.setOffline(false);
  await expect(page.getByTestId('submission-status')).toContainText('Waiting for the scorer');
  await expect(page.getByTestId('record-waiting')).toBeHidden();
  // The recording follows the sheet.
  await expect(voice.getByTestId('voice-send-status')).toContainText('The scorer has the recording');

  // The scorer's review plays each line's call and says what was in doubt.
  await page.goto(`/series/${seriesId}/races/${race.id}`);
  await page.getByTestId('finish-submissions-panel').getByRole('button', { name: 'Review' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('voice-review-note')).toContainText('Taken by voice');
  const diff = dialog.getByTestId('submission-diff');
  await expect(diff.getByTestId('voice-call')).toHaveCount(4);
  await expect(diff.getByRole('row').filter({ hasText: '999' })).toContainText('heard “nine nine nine”');
  // Settled by the recorder, so nothing is flagged on her line.
  const hers = diff.getByRole('row').filter({ has: page.getByRole('cell', { name: '22', exact: true }) });
  await expect(hers.getByTestId('voice-call')).toBeVisible();
  await expect(hers).not.toContainText('sounded like');
  const sound = page.waitForResponse((r) => /\/api\/v1\/voice\/recordings\/[^/]+\/audio/.test(r.url()) && r.ok());
  await diff.getByRole('button', { name: 'Play the call for 15' }).click();
  expect(((await (await sound).json()) as { segments: unknown[] }).segments.length).toBeGreaterThan(0);
  await dialog.getByRole('button', { name: 'Apply to the finish sheet' }).click();
  await expect(page.getByTestId('finish-submissions-panel')).toBeHidden();

  // Afterwards the recording stays beside the race, for as long as it is kept.
  const recordings = page.getByTestId('voice-recordings');
  await expect(recordings).toContainText('A recording of the finish');
  await recordings.getByRole('button', { name: 'Listen' }).click();
  const listen = page.getByTestId('voice-recording-dialog');
  await expect(listen.getByRole('listitem')).toHaveCount(4);
  await listen.getByRole('button', { name: 'Delete…' }).click();
  await listen.getByRole('button', { name: 'Delete the recording' }).click();
  await expect(recordings).toBeHidden();
});
