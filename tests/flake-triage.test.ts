import { describe, expect, it } from 'vitest';
import {
  budgetAdvice,
  describeErrors,
  isNetworkChange,
  readSuspendWindows,
  spansSuspend,
  type SuspendWindow,
} from '../scripts/flake-triage';

/**
 * A laptop suspend mid-suite fails whatever was in flight with hung I/O, which
 * the Playwright report records as `flaky`. These are the guards that keep the
 * triage from filing those as load-sensitive tests — the misdiagnosis that
 * invites marking a healthy test `test.slow()`.
 */

const RUN_START = '2026-07-31T13:00:00.000Z';
const at = (iso: string): number => Date.parse(iso);

/** A gaps file as the clock-watch reporter would write it. */
function gapsFile(gaps: { suspectFrom: string; resumedAt: string; sleptSeconds: number }[], runStartedAt = RUN_START) {
  return JSON.stringify({ runStartedAt, sampleIntervalMs: 2000, gapThresholdMs: 20000, gaps });
}

const THE_GAP = {
  suspectFrom: '2026-07-31T13:25:46.000Z',
  resumedAt: '2026-07-31T14:05:21.000Z',
  sleptSeconds: 2375,
};

function windows(raw: string | undefined, reportStart: string | undefined = RUN_START): SuspendWindow[] {
  return readSuspendWindows('/unused/clock-gaps.json', reportStart, () => raw);
}

describe('readSuspendWindows', () => {
  it('returns nothing when no gaps file was written', () => {
    expect(windows(undefined)).toEqual([]);
  });

  it('returns nothing for a clean run', () => {
    expect(windows(gapsFile([]))).toEqual([]);
  });

  it('reads a recorded gap and extends it past the resume to cover socket recovery', () => {
    const [w] = windows(gapsFile([THE_GAP]));
    expect(w.from).toBe(at(THE_GAP.suspectFrom));
    // The dead keep-alive sockets only surface on the next request, so the
    // untrustworthy window runs two minutes past the resume itself.
    expect(w.to).toBe(at(THE_GAP.resumedAt) + 120_000);
    expect(w.sleptSeconds).toBe(2375);
  });

  it('ignores a gaps file left behind by a different run', () => {
    const stale = gapsFile([THE_GAP], '2026-07-30T09:00:00.000Z');
    expect(windows(stale)).toEqual([]);
  });

  it('accepts a gaps file whose start merely differs by reporter startup slack', () => {
    const close = gapsFile([THE_GAP], '2026-07-31T13:00:31.000Z');
    expect(windows(close)).toHaveLength(1);
  });

  it('ignores an unparseable gaps file rather than throwing', () => {
    expect(windows('{ not json')).toEqual([]);
  });

  it('skips a gap with unreadable timestamps', () => {
    expect(windows(gapsFile([{ suspectFrom: 'nonsense', resumedAt: 'also nonsense', sleptSeconds: 60 }]))).toEqual([]);
  });
});

describe('spansSuspend', () => {
  const suspends = windows(gapsFile([THE_GAP]));

  it('flags an attempt that was running when the machine stopped', () => {
    const attempt = { from: at('2026-07-31T13:25:30.000Z'), to: at('2026-07-31T14:05:30.000Z') };
    expect(spansSuspend(attempt, suspends)).toBe(true);
  });

  it('flags an attempt that started just after the resume, while sockets were still dead', () => {
    const attempt = { from: at('2026-07-31T14:05:40.000Z'), to: at('2026-07-31T14:06:00.000Z') };
    expect(spansSuspend(attempt, suspends)).toBe(true);
  });

  it('leaves an attempt that finished well before the suspend alone', () => {
    const attempt = { from: at('2026-07-31T13:20:00.000Z'), to: at('2026-07-31T13:20:30.000Z') };
    expect(spansSuspend(attempt, suspends)).toBe(false);
  });

  it('leaves an attempt that started after the grace period alone', () => {
    const attempt = { from: at('2026-07-31T14:10:00.000Z'), to: at('2026-07-31T14:10:20.000Z') };
    expect(spansSuspend(attempt, suspends)).toBe(false);
  });

  it('treats an attempt with no recorded window as honest', () => {
    // Better to file a suspend-caused flake than to silently drop a real one.
    expect(spansSuspend({}, suspends)).toBe(false);
  });

  it('never suppresses when no suspend was recorded', () => {
    const attempt = { from: at('2026-07-31T13:30:00.000Z'), to: at('2026-07-31T13:30:20.000Z') };
    expect(spansSuspend(attempt, [])).toBe(false);
  });
});

/**
 * The audit that prompted this: eight tests had been marked `test.slow()` while
 * using 24–53% of their budget. A bare timeout gives no sense of scale, so the
 * issue has to supply one or the reflex wins.
 */
describe('budgetAdvice', () => {
  it('argues against a budget raise when the test was nowhere near its cap', () => {
    const advice = budgetAdvice({ usedMs: 11_200, capMs: 60_000, markedSlow: false });
    expect(advice).toContain('11.2s of its 60s');
    expect(advice).toContain('19%');
    expect(advice).toContain('did **not** run out of time');
    expect(advice).toContain('hung on something');
  });

  it('concedes the point when the test really is close to the cap', () => {
    const advice = budgetAdvice({ usedMs: 27_800, capMs: 30_000, markedSlow: false });
    expect(advice).toContain('93%');
    expect(advice).toContain('little headroom');
    expect(advice).not.toContain('did **not** run out of time');
  });

  it('says so when the test already carries the marker', () => {
    expect(budgetAdvice({ usedMs: 20_000, capMs: 90_000, markedSlow: true })).toContain('already `test.slow()`');
  });

  it('falls back to a plain warning when the report carried no timings', () => {
    expect(budgetAdvice({ markedSlow: true })).toContain('raising the budget again is not the fix');
  });

  it('says nothing rather than guess when there is no data at all', () => {
    expect(budgetAdvice({ markedSlow: false })).toBe('');
  });
});

/**
 * An attempt that times out on one thing and trips the console-error check on
 * another says far more than either error alone — and the second is often the
 * one naming the app-side cause.
 */
describe('describeErrors', () => {
  it('carries every error the attempt collected, in order', () => {
    const text = describeErrors({
      status: 'failed',
      retry: 0,
      error: { message: 'TimeoutError: page.waitForEvent: Timeout 20000ms exceeded' },
      errors: [
        { message: 'TimeoutError: page.waitForEvent: Timeout 20000ms exceeded' },
        { message: 'Browser errors detected:\n[console.error] save failed' },
      ],
    });
    expect(text).toContain('waitForEvent');
    expect(text).toContain('[console.error] save failed');
    // `error` repeats `errors[0]`; the excerpt shouldn't say it twice.
    expect(text.match(/waitForEvent/g)).toHaveLength(1);
  });

  it('strips ANSI and says so when the report captured nothing', () => {
    expect(describeErrors({ status: 'failed', retry: 0, error: { message: '\x1b[31mred\x1b[0m' } })).toBe('red');
    expect(describeErrors(undefined)).toBe('(no error captured)');
  });
});

/**
 * A host network change fails whatever is in flight across every worker, so it
 * reads as a suite-wide load problem. Filing those as load-sensitive tests
 * sends the reader hunting a stall that never happened.
 */
describe('isNetworkChange', () => {
  it('recognises the Chromium network-change codes', () => {
    expect(isNetworkChange('Error: page.reload: net::ERR_NETWORK_CHANGED')).toBe(true);
    expect(isNetworkChange('net::ERR_INTERNET_DISCONNECTED at /series/1')).toBe(true);
  });

  it('leaves an ordinary timeout alone', () => {
    expect(isNetworkChange('TimeoutError: locator.click: Timeout 20000ms exceeded')).toBe(false);
    // An aborted navigation is the App Router settling, not the network moving.
    expect(isNetworkChange('page.reload: net::ERR_ABORTED')).toBe(false);
  });
});
