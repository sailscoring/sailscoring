import type { Page } from '@playwright/test';

import { todayIsoDate } from '../lib/race-schedule';
import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createSeriesQuick, enableFeatures } from './helpers';

/**
 * Recording finishes by voice (ADR-017), from the Record finishes page to
 * the scorer's review: recording, the timeline building as it goes, the
 * suggested finishes on the sheet, accepting and checking them in the
 * timeline, a reload and a spell with no signal, the recording going to the
 * scorer with the sheet, and the scorer accepting what the recorder left.
 *
 * The recogniser is the one thing not real here: the engine and its model
 * are 85 MB that CI doesn't fetch, so the page is handed a listener that
 * says what the test tells it to. The microphone is Chromium's fake one,
 * so sound really flows, is stored, sent and fetched back.
 *
 * Gated behind the `voice-recording` feature.
 */

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['microphone'],
  // With no signal the page's own requests fail, and say so: the subject of
  // this spec, not a fault.
  allowedConsoleErrors: [/net::ERR_INTERNET_DISCONNECTED/, /Failed to fetch/i, /NetworkError/i],
});

/** A stand-in for the recogniser: `window.__voiceSay('one five')` makes it
 *  hear those words on the take's clock, leaving a pause after whatever it
 *  heard before, as a caller does between competitors. */
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

test('finishes recorded by voice reach the scorer with their recording', async ({ page, signedInEmail, context }) => {
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
  await expect(voice).toContainText('Record finishes by voice');

  // Setting up: the microphone, then a trial call that says who was heard.
  await voice.getByTestId('voice-set-up').click();
  const setup = page.getByTestId('voice-setup');
  await expect(setup).toContainText('Entry list: 3 competitors in this race');
  await setup.getByRole('button', { name: 'Turn on the microphone' }).click();
  await expect(setup).toContainText(/Microphone: \S/);
  await expect(setup.getByTestId('voice-setup-record')).toBeEnabled();
  await takeUnderWay(page, 1);
  await say(page, 'two two');
  await expect(setup.getByTestId('voice-trial-heard')).toContainText('Bob Dickson');
  await setup.getByTestId('voice-setup-record').click();

  // Recording: the timeline builds as it goes.
  const screen = page.getByTestId('voice-recording-screen');
  await expect(screen.getByTestId('voice-state')).toHaveText('Recording');
  await takeUnderWay(page, 2);
  const list = screen.getByTestId('voice-timeline-list');
  await say(page, 'fifteen');
  await expect(list.getByTestId('voice-chip').filter({ hasText: 'Alice Pearson' })).toBeVisible();
  // NOW draws a line; with a sail number before it, it suggests a finish.
  await screen.getByTestId('voice-now').click();
  await expect(list.getByTestId('voice-row-now')).toHaveCount(1);
  await expect(list.getByTestId('voice-row-now').getByTestId('voice-pill-suggested')).toContainText('Alice Pearson');
  await say(page, 'two fifty four');
  await expect(list.getByTestId('voice-chip').filter({ hasText: 'Carol Walls' })).toBeVisible();
  // A number on no entry is marked; talk is kept, and is only talk.
  await say(page, 'nine nine nine');
  await expect(list.getByTestId('voice-chip').filter({ hasText: '999' })).toContainText('not on the entry list');
  await say(page, 'is that the last of them');
  await expect(list).toContainText('is that the last of them');
  // Not a number on the list as heard, but it sounds like just one.
  await say(page, 'twenty too');
  await expect(list.getByTestId('voice-chip').filter({ hasText: 'Bob Dickson' })).toContainText('close match');
  // A spare pair of hands accepts a finish without stopping.
  await list.getByTestId('voice-row-now').click();
  const editor = screen.getByTestId('voice-editor');
  await expect(editor.getByLabel('Competitor')).toHaveValue(/Alice Pearson/);
  await editor.getByTestId('voice-editor-save').click();
  await expect(list.getByTestId('voice-row-now').getByTestId('voice-pill-finish')).toContainText('Alice Pearson');
  // Called out again, the same competitor.
  await say(page, 'fifteen');
  await expect(list).toContainText('called again');

  // Lock keeps sleeves off it; a held press lets go.
  await screen.getByRole('button', { name: 'Lock' }).click();
  const lock = screen.getByTestId('voice-lock');
  await expect(lock).toContainText('Still recording');
  await lock.dispatchEvent('pointerdown');
  await expect(lock).toBeHidden();

  await screen.getByTestId('voice-stop').click();
  await screen.getByTestId('voice-stop-confirmed').click();
  await expect(screen).toBeHidden();

  // The sheet: the accepted finish, and the suggestions, marked, in the
  // order they finished. This fleet is scored on finishing order, so a
  // sail number needs no NOW.
  const rows = page.locator('[data-entry-key]');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Alice Pearson');
  await expect(rows.nth(1)).toContainText('Carol Walls');
  await expect(rows.nth(1).getByTestId('voice-row-accept')).toBeVisible();
  await expect(rows.nth(2)).toContainText('999');
  await expect(rows.nth(2).getByTestId('voice-row-check')).toHaveText('not on the entry list');
  await expect(rows.nth(3)).toContainText('Bob Dickson');
  await expect(rows.nth(3).getByTestId('voice-row-check')).toHaveText('close match');
  const summary = voice.getByTestId('voice-summary');
  await expect(summary).toContainText('1 accepted · 1 suggested · 2 to check');

  // A reload loses neither the sheet nor the recording.
  await page.reload();
  await expect(rows).toHaveCount(4);
  await expect(summary).toContainText('2 to check');

  // A row to check opens the timeline at it, in the editor.
  await rows.nth(3).getByRole('button', { name: 'Show in the timeline' }).click();
  const timeline = page.getByTestId('voice-timeline');
  await expect(timeline.getByTestId('voice-strip')).toBeVisible();
  await expect(timeline.getByTestId('voice-editor')).toContainText('Close match: heard “twenty too”');
  await expect(timeline.getByLabel('Competitor')).toHaveValue(/Bob Dickson/);
  await timeline.getByTestId('voice-editor-save').click();
  await expect(timeline.getByTestId('voice-timeline-summary')).toContainText('2 accepted · 1 suggested · 1 to check');
  // Next to check: the number on no entry, which was talk.
  await timeline.getByTestId('voice-next').click();
  await expect(timeline.getByTestId('voice-editor')).toContainText('Heard “nine nine nine”: not on the entry list');
  // Typing a sail number finds the competitors it could be.
  await timeline.getByLabel('Competitor').fill('25');
  await expect(timeline.getByTestId('voice-editor-matches')).toContainText('Carol Walls');
  await timeline.getByTestId('voice-editor-dismiss').click();
  await expect(timeline.getByTestId('voice-timeline-summary')).toContainText('0 to check');
  await timeline.getByTestId('voice-timeline-close').click();
  await expect(rows).toHaveCount(3);

  // The recording goes with the sheet unless the recorder turns it off,
  // and what nobody accepted goes with it, not on the sheet.
  const sending = page.getByTestId('voice-sending');
  await expect(sending.getByTestId('voice-send')).toBeChecked();
  await expect(sending.getByTestId('voice-not-accepted')).toContainText(
    '1 suggested finish isn’t accepted and won’t be submitted. They go with the recording, for the scorer to accept.',
  );

  // No signal: the page still opens, and the sheet waits to be submitted.
  await context.setOffline(true);
  await page.reload();
  await expect(rows).toHaveCount(3);
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByTestId('record-waiting')).toContainText('will be submitted when there is one');
  await context.setOffline(false);
  await expect(page.getByTestId('submission-status')).toContainText('Waiting for the scorer');
  await expect(page.getByTestId('record-waiting')).toBeHidden();
  await expect(sending.getByTestId('voice-send-status')).toContainText('The scorer has the recording');

  // The scorer's review plays the recording around each finish, and the
  // scorer accepts what the recorder left, from the recording.
  await page.goto(`/series/${seriesId}/races/${race.id}`);
  await page.getByTestId('finish-submissions-panel').getByRole('button', { name: 'Review' }).click();
  const dialog = page.getByRole('dialog');
  const note = dialog.getByTestId('voice-review-note');
  await expect(note).toContainText('Recorded by voice');
  await expect(note.getByTestId('voice-review-left')).toContainText('1 suggested finish wasn’t accepted on the water');
  const diff = dialog.getByTestId('submission-diff');
  await expect(diff.getByTestId('voice-call')).toHaveCount(2);
  const sound = page.waitForResponse((r) => /\/api\/v1\/voice\/recordings\/[^/]+\/audio/.test(r.url()) && r.ok());
  await diff.getByRole('button', { name: 'Play the finish of 15' }).click();
  expect(((await (await sound).json()) as { segments: unknown[] }).segments.length).toBeGreaterThan(0);
  await note.getByTestId('voice-review-open').click();
  const scorerView = page.getByTestId('voice-timeline');
  await scorerView.getByTestId('voice-accept-all').click();
  await expect(scorerView.getByTestId('voice-timeline-summary')).toContainText('3 accepted · 0 suggested · 0 to check');
  await scorerView.getByTestId('voice-timeline-close').click();
  await expect(diff.getByTestId('voice-call')).toHaveCount(3);
  await expect(diff.getByRole('row').filter({ has: page.getByRole('cell', { name: '254', exact: true }) })).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply to the finish sheet' }).click();
  await expect(page.getByTestId('finish-submissions-panel')).toBeHidden();

  // Afterwards the recording stays beside the race, for a scoring inquiry,
  // for as long as it is kept.
  const recordings = page.getByTestId('voice-recordings');
  await expect(recordings).toContainText('A recording of the finish');
  await recordings.getByTestId('voice-recording-open').click();
  const listen = page.getByTestId('voice-timeline');
  await expect(listen.getByTestId('voice-row-now')).toHaveCount(1);
  await listen.getByTestId('voice-timeline-close').click();
  await recordings.getByRole('button', { name: 'Delete…' }).click();
  await recordings.getByRole('button', { name: 'Delete the recording' }).click();
  await expect(recordings).toBeHidden();
});
