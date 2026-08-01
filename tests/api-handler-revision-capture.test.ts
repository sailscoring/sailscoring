/**
 * Guard: a series-scoped mutation must capture a revision, not just log
 * activity.
 *
 * Handlers that change a series are meant to go through `trackChange`
 * (`lib/revision-log.ts`), which keeps the lastModifiedAt touch, the activity
 * entry, and the revision snapshot together. Reaching for `recordActivity`
 * directly instead leaves the change with no snapshot — the state it produced
 * is unrecoverable — and strands its activity entry until some later,
 * unrelated edit creates a revision that swallows it.
 *
 * This is a source scan rather than a behavioural test because the failure
 * mode is a handler that simply forgot: nothing at runtime distinguishes
 * "logged activity, deliberately no revision" from "logged activity, should
 * have captured one". The allowlist below is where that distinction is
 * written down, so a new handler has to state its reason rather than drift.
 */
import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const HANDLER_DIR = path.join(__dirname, '..', 'lib', 'api-handlers');

/**
 * Series-scoped `recordActivity` calls that deliberately capture no revision,
 * keyed `file:action`. Each needs a reason that survives review.
 */
const NO_REVISION_BY_DESIGN: Record<string, string> = {
  // `archived` and `categoryId` are workspace-local and absent from the
  // `.sailscoring` format by design, so a revision would store a snapshot
  // byte-identical to its predecessor — noise in the history for no
  // recoverable state.
  'series.ts:series.archived': 'archived is workspace-local, not in the file format',
  'series.ts:series.unarchived': 'archived is workspace-local, not in the file format',
  'series.ts:series.recategorized': 'categoryId is workspace-local, not in the file format',

  // As-published archives (ADR-010) are display-only ingests that are never
  // re-scored or edited, so they have no revision history to contribute to.
  'archive.ts:series.archive-ingested': 'as-published series are display-only',
  'archive.ts:series.archive-removed': 'as-published series are display-only',

  // Captures its revision explicitly on the next line, with kind 'revert' —
  // `trackChange` would file it as an ordinary coalescing auto revision.
  'revisions.ts:series.reverted': 'captures a revert revision directly',

  // The tombstone embeds the series' whole revision history and
  // `restoreTombstone` re-imports it, so a recovered series arrives already
  // restorable; a capture here would duplicate its newest revision.
  'trash.ts:series.restored': 'tombstone restores the embedded revision history',
};

interface Call {
  file: string;
  action: string;
  seriesScoped: boolean;
}

/** Every `recordActivity` call site in a handler source, with the action(s) it
 *  records and whether it names a series. A branching action
 *  (`action: archived ? 'series.archived' : 'series.unarchived'`) contributes
 *  every branch, since each is a distinct thing to allow or reject. */
function findRecordActivityCalls(file: string, source: string): Call[] {
  const calls: Call[] = [];
  const re = /recordActivity\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    // The argument object is short and self-contained; a fixed window covers
    // it without needing to balance braces.
    const window = source.slice(m.index, m.index + 600);
    // `seriesId: null` is an explicit workspace-level entry; so is omitting it
    // entirely. Anything else (including the `seriesId` shorthand) names a
    // series.
    const seriesScoped =
      /\bseriesId\b/.test(window) && !/\bseriesId:\s*null\b/.test(window);
    // The action expression runs to the end of its line, whether it's a
    // literal or a ternary over literals.
    const expr = /action:\s*(.+)/.exec(window)?.[1] ?? '';
    const actions = [...expr.matchAll(/'([^']+)'/g)].map((a) => a[1]);
    if (actions.length === 0) {
      calls.push({ file, action: '<unparsed>', seriesScoped: true });
      continue;
    }
    for (const action of actions) calls.push({ file, action, seriesScoped });
  }
  return calls;
}

describe('api handlers capture revisions for series mutations', () => {
  const calls = readdirSync(HANDLER_DIR)
    .filter((f) => f.endsWith('.ts'))
    .flatMap((f) =>
      findRecordActivityCalls(f, readFileSync(path.join(HANDLER_DIR, f), 'utf8')),
    );

  test('the scan finds the call sites it is meant to police', () => {
    // A rename or refactor that makes the regex miss everything must fail
    // loudly rather than silently pass.
    expect(calls.length).toBeGreaterThan(5);
    expect(calls.every((c) => c.action !== '<unparsed>')).toBe(true);
  });

  test('every series-scoped recordActivity call is allowlisted or uses trackChange', () => {
    const offenders = calls
      .filter((c) => c.seriesScoped)
      .map((c) => `${c.file}:${c.action}`)
      .filter((key) => !(key in NO_REVISION_BY_DESIGN));

    expect(
      offenders,
      'These handlers change a series but only log activity — they leave no ' +
        'restorable snapshot and their activity entry is stranded until a ' +
        'later unrelated edit. Use trackChange, or add an entry to ' +
        'NO_REVISION_BY_DESIGN with the reason.',
    ).toEqual([]);
  });

  test('the allowlist has no stale entries', () => {
    const present = new Set(
      calls.filter((c) => c.seriesScoped).map((c) => `${c.file}:${c.action}`),
    );
    const stale = Object.keys(NO_REVISION_BY_DESIGN).filter((k) => !present.has(k));
    expect(stale).toEqual([]);
  });
});
