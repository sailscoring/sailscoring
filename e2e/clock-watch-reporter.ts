/**
 * Clock-watch reporter: record any interval where the machine stopped running.
 *
 * A laptop suspend in the middle of a suite is indistinguishable from load in
 * the Playwright report — the tests that were in flight across the workers all
 * time out on hung I/O (suspend leaves the browser↔server and server↔Postgres
 * keep-alive sockets dead, so the first requests after resume hang), then pass
 * on retry. They land in the report as `flaky` and get filed as load-sensitive
 * tests, which invites the wrong fix: marking a healthy test `test.slow()`.
 *
 * Detection needs no privileges and no system log. The wall clock (`Date.now`,
 * CLOCK_REALTIME) keeps advancing while the machine is suspended; the monotonic
 * clock (`process.hrtime`, CLOCK_MONOTONIC on Linux and macOS) does not. Sample
 * both on a timer: the offset between them is constant while the machine is
 * awake and jumps by the suspend duration on resume.
 *
 * Writes `test-results/clock-gaps.json`, which scripts/flake-triage.ts reads to
 * decide whether a flaky test's failed attempt is honest or merely slept
 * through. The file is rewritten the moment a gap is detected, so a run killed
 * mid-suspend still leaves the evidence behind.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { FullConfig, Reporter } from '@playwright/test/reporter';

/** How often to compare the two clocks. Cheap — a few hundred samples a run. */
const SAMPLE_INTERVAL_MS = 2_000;

/**
 * Divergence below this is noise, not a suspend: an NTP step is sub-second and
 * ordinary scheduling jitter is milliseconds. Nothing short of the machine
 * actually stopping moves the two clocks tens of seconds apart.
 */
const GAP_THRESHOLD_MS = 20_000;

export interface ClockGap {
  /** Last sample taken while the machine was demonstrably awake. */
  suspectFrom: string;
  /** First sample taken after it came back. */
  resumedAt: string;
  sleptSeconds: number;
}

export interface ClockWatchReport {
  runStartedAt: string;
  runEndedAt?: string;
  sampleIntervalMs: number;
  gapThresholdMs: number;
  gaps: ClockGap[];
}

const monotonicMs = (): number => {
  const [seconds, nanoseconds] = process.hrtime();
  return seconds * 1_000 + nanoseconds / 1e6;
};

export default class ClockWatchReporter implements Reporter {
  private readonly outputFile: string;
  private timer: NodeJS.Timeout | undefined;
  private lastWall = 0;
  private lastMono = 0;
  private runStartedAt = '';
  private gaps: ClockGap[] = [];

  constructor(options: { outputFile?: string } = {}) {
    this.outputFile = resolve(process.cwd(), options.outputFile ?? 'test-results/clock-gaps.json');
  }

  /** `list` owns the terminal; this one only writes a file (plus one warning). */
  printsToStdio(): boolean {
    return false;
  }

  onBegin(_config: FullConfig): void {
    this.runStartedAt = new Date().toISOString();
    this.lastWall = Date.now();
    this.lastMono = monotonicMs();
    this.gaps = [];
    // Written up front so a stale file from an earlier run is never mistaken
    // for this one's — the triage cross-checks runStartedAt against the report.
    this.write();
    this.timer = setInterval(() => this.sample(), SAMPLE_INTERVAL_MS);
    this.timer.unref();
  }

  onEnd(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.sample();
    this.write(new Date().toISOString());
  }

  private sample(): void {
    const wall = Date.now();
    const mono = monotonicMs();
    const slept = wall - this.lastWall - (mono - this.lastMono);
    if (slept >= GAP_THRESHOLD_MS) {
      const gap: ClockGap = {
        suspectFrom: new Date(this.lastWall).toISOString(),
        resumedAt: new Date(wall).toISOString(),
        sleptSeconds: Math.round(slept / 1000),
      };
      this.gaps.push(gap);
      this.write();
      console.warn(
        `\n⚠  clock-watch: the machine stopped for ${Math.round(gap.sleptSeconds / 60)} min ` +
          `(${gap.suspectFrom} → ${gap.resumedAt}). Tests in flight across that window will fail ` +
          `on hung I/O; flake triage will not file them.\n`,
      );
    }
    this.lastWall = wall;
    this.lastMono = mono;
  }

  private write(runEndedAt?: string): void {
    const report: ClockWatchReport = {
      runStartedAt: this.runStartedAt,
      ...(runEndedAt ? { runEndedAt } : {}),
      sampleIntervalMs: SAMPLE_INTERVAL_MS,
      gapThresholdMs: GAP_THRESHOLD_MS,
      gaps: this.gaps,
    };
    mkdirSync(dirname(this.outputFile), { recursive: true });
    writeFileSync(this.outputFile, `${JSON.stringify(report, null, 2)}\n`);
  }
}
