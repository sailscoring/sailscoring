'use client';

import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFinishesBySeries, useSaveFinishes } from '@/hooks/use-finishes';
import { useRacesBySeries } from '@/hooks/use-races';
import { useUpdateSeries } from '@/hooks/use-series';
import { CHANGEABLE_BUILT_IN_CODES, getCodeDefinition, seriesCodeProblems } from '@/lib/scoring-codes';
import {
  codeRows,
  DECIDED_PER_BOAT,
  rrsCode,
  ruleSentence,
  sameScoring,
  ruleShortText,
  type CodeRow,
} from '@/lib/scoring-codes-text';
import type { DnfScoring, Finish, PlaceBase, SeriesScoringCode } from '@/lib/types';
import { describeWriteFailure } from '@/lib/write-failure';

/**
 * The Scoring codes dialog: the escape hatch from the RRS codes
 * (docs/design/ux/flows/scoring-codes.md). It opens on a screen that says
 * what it is for; past that, a table of the codes the series can change and
 * its own codes, each opening an editor that restates its rule in words.
 * Each Save writes the series' whole table.
 */
export type ScoringCodesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seriesId: string;
  dnfScoring: DnfScoring;
  scoringCodes: readonly SeriesScoringCode[];
};

type Editing = { code: string | null } | null;

const selectClass = 'rounded-md border bg-background px-2 py-1 text-sm';
const hint = 'text-xs text-muted-foreground';

/** Results that use each code, by the races they are in. */
function usageByCode(finishes: readonly Finish[], raceNumberById: Map<string, number>) {
  const usage = new Map<string, { count: number; races: Set<number> }>();
  for (const f of finishes) {
    for (const code of [f.resultCode, f.penaltyCode]) {
      if (!code) continue;
      const u = usage.get(code) ?? { count: 0, races: new Set<number>() };
      u.count++;
      const n = raceNumberById.get(f.raceId);
      if (n !== undefined) u.races.add(n);
      usage.set(code, u);
    }
  }
  return usage;
}

function listRaces(races: Set<number>): string {
  const names = [...races].sort((a, b) => a - b).map((n) => `R${n}`);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function resultsUsing(u: { count: number; races: Set<number> }): string {
  return `${u.count} ${u.count === 1 ? 'result' : 'results'} in ${listRaces(u.races)}`;
}

export function ScoringCodesDialog({ open, onOpenChange, seriesId, dnfScoring, scoringCodes }: ScoringCodesDialogProps) {
  // Past the opening screen. A series that already has codes skips it; one
  // that doesn't sees it every time, until a code is changed or added.
  const [pastIntro, setPastIntro] = useState(scoringCodes.length > 0);
  const [editing, setEditing] = useState<Editing>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateSeries();
  const { data: finishes } = useFinishesBySeries(seriesId, { enabled: open });
  const { data: races } = useRacesBySeries(seriesId);
  const usage = useMemo(
    () => usageByCode(finishes ?? [], new Map((races ?? []).map((r) => [r.id, r.raceNumber]))),
    [finishes, races],
  );

  function close(next: boolean) {
    if (!next) {
      setEditing(null);
      setConfirmReset(false);
      setError(null);
      setPastIntro(scoringCodes.length > 0);
    }
    onOpenChange(next);
  }

  async function saveCodes(next: SeriesScoringCode[]): Promise<boolean> {
    setError(null);
    try {
      await update.mutateAsync({ id: seriesId, patch: { scoringCodes: next, lastModifiedAt: Date.now() } });
      return true;
    } catch (err) {
      setError(describeWriteFailure(err));
      return false;
    }
  }

  const rows = codeRows(dnfScoring, scoringCodes);
  const ownInUse = scoringCodes.filter((c) => !CHANGEABLE_BUILT_IN_CODES.includes(c.code) && usage.has(c.code));

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-2xl" data-testid="scoring-codes-dialog">
        <DialogHeader>
          <DialogTitle>Scoring codes</DialogTitle>
          {editing === null && pastIntro && (
            <DialogDescription>
              The codes this series can change, and its own. Open a code to change how it scores.
            </DialogDescription>
          )}
        </DialogHeader>

        {!pastIntro ? (
          <Intro dnfScoring={dnfScoring} onCancel={() => close(false)} onGo={() => setPastIntro(true)} />
        ) : editing !== null ? (
          <CodeEditor
            key={editing.code ?? 'new'}
            code={editing.code}
            dnfScoring={dnfScoring}
            scoringCodes={scoringCodes}
            usage={usage}
            finishes={finishes ?? []}
            saving={update.isPending}
            error={error}
            onBack={() => { setEditing(null); setError(null); }}
            onSave={async (next) => {
              if (await saveCodes(next)) setEditing(null);
            }}
          />
        ) : (
          <>
            <CodeTable title="Replace the boat’s result" rows={rows.replace} usage={usage} onOpen={(code) => setEditing({ code })} />
            <CodeTable title="Add to the boat’s finishing place" rows={rows.add} usage={usage} onOpen={(code) => setEditing({ code })} />
            <p className={hint}>
              {DECIDED_PER_BOAT.join(', ').replace(/, ([^,]*)$/, ' and $1')} are decided for each boat, in the
              penalty and redress dialogs. A penalty your instructions apply at one amount every time can be a code
              of its own.
            </p>
            <div>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing({ code: null })}>
                Add a code
              </Button>
            </div>
            {confirmReset && (
              <ResetAll
                scoringCodes={scoringCodes}
                ownInUse={ownInUse.map((c) => `${c.code} (${resultsUsing(usage.get(c.code)!)})`)}
                saving={update.isPending}
                onCancel={() => setConfirmReset(false)}
                onReset={async () => {
                  if (await saveCodes([])) setConfirmReset(false);
                }}
              />
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter className="sm:justify-between">
              {scoringCodes.length > 0 && !confirmReset ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmReset(true)}>
                  Reset all to the RRS
                </Button>
              ) : <span />}
              <Button type="button" onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Intro({ dnfScoring, onCancel, onGo }: { dnfScoring: DnfScoring; onCancel: () => void; onGo: () => void }) {
  const base = dnfScoring === 'startingArea'
    ? 'the boats that came to the starting area (A5.3)'
    : 'the boats entered in the series (A5.2)';
  return (
    <div className="space-y-3 text-sm" data-testid="scoring-codes-intro">
      <p>
        This series scores every code as RRS Appendix A sets out, with DNF and the codes scored like it based on{' '}
        {base}.
      </p>
      <p>
        Change this only when your notice of race or sailing instructions do: a code the RRS doesn’t have, such as
        TLE, or a standard code scored differently. Every published results page will list what you change, so
        readers can check it against the instructions.
      </p>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="button" onClick={onGo}>Change scoring codes</Button>
      </DialogFooter>
    </div>
  );
}

const STATUS_LABEL = { rrs: 'RRS', changed: 'Changed', series: 'Series' } as const;

function CodeTable({
  title,
  rows,
  usage,
  onOpen,
}: {
  title: string;
  rows: CodeRow[];
  usage: Map<string, { count: number }>;
  onOpen: (code: string) => void;
}) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <ul className="divide-y rounded-md border">
        {rows.map((row) => (
          <li key={row.code}>
            <button
              type="button"
              className="grid w-full grid-cols-[4rem_1fr_auto] items-baseline gap-x-3 px-3 py-1.5 text-left text-sm hover:bg-muted/50"
              onClick={() => onOpen(row.code)}
              data-testid={`code-row-${row.code}`}
            >
              <span className="font-mono font-medium">{row.code}</span>
              <span className="min-w-0">
                <span className="block truncate">{row.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {ruleShortText(row.scored)}
                  {row.status === 'changed' && row.rrs ? ` (RRS: ${ruleShortText(row.rrs)})` : ''}
                  {usage.has(row.code) && row.status === 'series' ? ` · used ${usage.get(row.code)!.count}×` : ''}
                </span>
              </span>
              <span
                className={
                  row.status === 'rrs'
                    ? 'text-xs text-muted-foreground'
                    : 'rounded bg-amber-100 px-1.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100'
                }
              >
                {STATUS_LABEL[row.status]}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ResetAll({
  scoringCodes,
  ownInUse,
  saving,
  onCancel,
  onReset,
}: {
  scoringCodes: readonly SeriesScoringCode[];
  ownInUse: string[];
  saving: boolean;
  onCancel: () => void;
  onReset: () => void;
}) {
  if (ownInUse.length > 0) {
    return (
      <div className="rounded-md border p-3 text-sm" data-testid="reset-all-refused">
        <p>
          Results still use this series’ own codes: {ownInUse.join('; ')}. Open each and replace it before resetting.
        </p>
        <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={onCancel}>OK</Button>
      </div>
    );
  }
  return (
    <div className="rounded-md border p-3 text-sm" data-testid="reset-all-confirm">
      <p>
        Every code will score as the RRS sets out again. This undoes {scoringCodes.map((c) => c.code).join(', ')},
        and rescores the races that use them.
      </p>
      <div className="mt-2 flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="button" size="sm" disabled={saving} onClick={onReset}>Reset all to the RRS</Button>
      </div>
    </div>
  );
}

// ─── The editor ──────────────────────────────────────────────────────────────

type Method = 'placeAfter' | 'sameAs' | 'fixedPoints' | 'addPoints' | 'addPercent';

type Draft = {
  code: string;
  description: string;
  kind: 'replace' | 'add';
  method: Method;
  base: PlaceBase;
  plus: string;
  sameAs: string;
  fixedPoints: string;
  addPoints: string;
  addPercent: string;
  capAtDnf: boolean;
  discardable: boolean;
};

function draftOf(sc: SeriesScoringCode): Draft {
  const r = sc.rule;
  return {
    code: sc.code,
    description: sc.description ?? '',
    kind: sc.kind,
    method: r.type,
    base: r.type === 'placeAfter' ? r.base : 'finishers',
    plus: r.type === 'placeAfter' ? String(r.plus) : '1',
    sameAs: r.type === 'sameAs' ? r.code : 'DNF',
    fixedPoints: r.type === 'fixedPoints' ? String(r.points) : '',
    addPoints: r.type === 'addPoints' ? String(r.points) : '',
    addPercent: r.type === 'addPercent' ? String(r.percent) : '',
    capAtDnf: !!sc.capAtDnf,
    discardable: sc.discardable,
  };
}

const NEW_CODE: SeriesScoringCode = {
  code: '',
  description: '',
  kind: 'replace',
  rule: { type: 'placeAfter', base: 'finishers', plus: 1 },
  capAtDnf: true,
  discardable: true,
};

/** The draft as a stored code, or the message for the field that isn't one. */
function codeOf(d: Draft, builtIn: boolean): SeriesScoringCode | string {
  const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
  let rule: SeriesScoringCode['rule'];
  switch (d.method) {
    case 'placeAfter': {
      const plus = num(d.plus);
      if (!Number.isInteger(plus) || plus < 1) return 'Enter the places to add as a whole number, 1 or more.';
      rule = { type: 'placeAfter', base: d.base, plus };
      break;
    }
    case 'sameAs':
      rule = { type: 'sameAs', code: d.sameAs };
      break;
    case 'fixedPoints': {
      const points = num(d.fixedPoints);
      if (!Number.isFinite(points) || points < 0) return 'Enter the points as a number, e.g. 5.';
      rule = { type: 'fixedPoints', points };
      break;
    }
    case 'addPoints': {
      const points = num(d.addPoints);
      if (!Number.isFinite(points) || points <= 0) return 'Enter the points to add as a number above 0, e.g. 2.';
      rule = { type: 'addPoints', points };
      break;
    }
    case 'addPercent': {
      const percent = num(d.addPercent);
      if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return 'Enter the percentage as a number from 1 to 100, e.g. 20.';
      rule = { type: 'addPercent', percent };
      break;
    }
  }
  return {
    code: d.code.trim(),
    ...(builtIn ? {} : { description: d.description.trim() }),
    kind: d.kind,
    rule,
    ...(d.kind === 'replace' && d.method !== 'sameAs' && d.capAtDnf ? { capAtDnf: true } : {}),
    discardable: d.discardable,
  };
}

function CodeEditor({
  code,
  dnfScoring,
  scoringCodes,
  usage,
  finishes,
  saving,
  error,
  onBack,
  onSave,
}: {
  /** The code being edited; null for a new one. */
  code: string | null;
  dnfScoring: DnfScoring;
  scoringCodes: readonly SeriesScoringCode[];
  usage: Map<string, { count: number; races: Set<number> }>;
  finishes: readonly Finish[];
  saving: boolean;
  error: string | null;
  onBack: () => void;
  onSave: (next: SeriesScoringCode[]) => void | Promise<void>;
}) {
  const builtIn = code !== null && CHANGEABLE_BUILT_IN_CODES.includes(code);
  const rrs = builtIn ? rrsCode(code, dnfScoring) : null;
  const stored = code === null ? undefined : scoringCodes.find((c) => c.code === code);
  const [draft, setDraft] = useState<Draft>(() => draftOf(stored ?? rrs ?? NEW_CODE));
  const [problem, setProblem] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [replaceWith, setReplaceWith] = useState('DNF');
  const saveFinishes = useSaveFinishes();
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setProblem(null);
  };

  const candidate = codeOf(draft, builtIn);
  const preview = typeof candidate === 'string' || !candidate.code ? null : ruleSentence(candidate);
  const inUse = code !== null ? usage.get(code) : undefined;
  // Codes this one can score the same as: any other that replaces the result.
  const sameAsChoices = [
    ...['DNF', 'DNS', 'OCS', 'NSC', 'RET', 'DSQ', 'DNE', 'UFD', 'BFD', 'DNC'],
    ...scoringCodes.filter((c) => c.kind === 'replace' && !getCodeDefinition(c.code)).map((c) => c.code),
  ].filter((c) => c !== draft.code.trim());
  const isZfp = code === 'ZFP';

  function save() {
    if (typeof candidate === 'string') {
      setProblem(candidate);
      return;
    }
    if (!builtIn && !candidate.code) {
      setProblem('Code is required.');
      return;
    }
    if (code === null && getCodeDefinition(candidate.code)) {
      setProblem(`${candidate.code} is an RRS code. To change how it scores, open it from the list.`);
      return;
    }
    const others = scoringCodes.filter((c) => c.code !== code);
    // A built-in set back to its RRS rule is no change at all, not a copy.
    const next = rrs && sameScoring(candidate, rrs) ? others : [...others, candidate];
    const problems = seriesCodeProblems(next);
    if (problems.length > 0) {
      setProblem(problems[0].message);
      return;
    }
    void onSave(next);
  }

  async function replaceAndDelete() {
    if (code === null) return;
    const slot = draft.kind === 'add' ? 'penaltyCode' : 'resultCode';
    const changed = finishes.filter((f) => f[slot] === code).map((f) => ({ ...f, [slot]: replaceWith }));
    try {
      if (changed.length > 0) await saveFinishes.mutateAsync(changed);
      await onSave(scoringCodes.filter((c) => c.code !== code));
    } catch (err) {
      setProblem(describeWriteFailure(err));
    }
  }

  const replaceChoices = draft.kind === 'add'
    ? ['ZFP', 'SCP', ...scoringCodes.filter((c) => c.kind === 'add' && c.code !== code && !getCodeDefinition(c.code)).map((c) => c.code)]
    : sameAsChoices.filter((c) => c !== code);

  return (
    <div className="space-y-4 text-sm" data-testid="scoring-code-editor">
      <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={onBack}>
        ← All codes
      </button>

      {builtIn && rrs ? (
        <div>
          <p className="font-medium">
            <span className="font-mono">{code}</span> {getCodeDefinition(code)!.name}
          </p>
          <p className={hint}>RRS: {ruleSentence(rrs)}</p>
        </div>
      ) : (
        <>
          <label className="block space-y-1">
            <span className="block font-medium">Code</span>
            <Input
              value={draft.code}
              onChange={(e) => set('code', e.target.value)}
              maxLength={6}
              className="w-28 font-mono"
              disabled={code !== null}
              aria-label="Code"
            />
          </label>
          <label className="block space-y-1">
            <span className="block font-medium">Description</span>
            <Input
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="e.g. Time limit expired (SI 16.1)"
              aria-label="Description"
            />
            <span className={hint}>Printed under the results. Name the clause of your instructions that defines the code.</span>
          </label>
          <fieldset className="space-y-1">
            <legend className="font-medium">The code</legend>
            {(['replace', 'add'] as const).map((kind) => (
              <label key={kind} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="code-kind"
                  checked={draft.kind === kind}
                  disabled={code !== null}
                  onChange={() => {
                    set('kind', kind);
                    set('method', kind === 'replace' ? 'placeAfter' : 'addPoints');
                  }}
                />
                {kind === 'replace' ? 'Replaces the boat’s result' : 'Adds points to her finishing place'}
              </label>
            ))}
          </fieldset>
        </>
      )}

      <fieldset className="space-y-2">
        <legend className="font-medium">Points</legend>
        {draft.kind === 'replace' ? (
          <>
            <label className="flex flex-wrap items-center gap-2">
              <input type="radio" name="code-method" checked={draft.method === 'placeAfter'} onChange={() => set('method', 'placeAfter')} />
              One place after
              <select
                className={selectClass}
                value={draft.base}
                onChange={(e) => { set('method', 'placeAfter'); set('base', e.target.value as PlaceBase); }}
                aria-label="Counted from"
              >
                <option value="entries">the series entries</option>
                <option value="startingArea">the boats that came to the starting area</option>
                <option value="finishers">the finishers</option>
              </select>
              +
              <Input
                className="w-16"
                inputMode="numeric"
                value={draft.plus}
                onChange={(e) => { set('method', 'placeAfter'); set('plus', e.target.value); }}
                aria-label="Places to add"
              />
            </label>
            <label className="flex flex-wrap items-center gap-2">
              <input type="radio" name="code-method" checked={draft.method === 'sameAs'} onChange={() => set('method', 'sameAs')} />
              The same as
              <select
                className={selectClass}
                value={draft.sameAs}
                onChange={(e) => { set('method', 'sameAs'); set('sameAs', e.target.value); }}
                aria-label="Scores the same as"
              >
                {sameAsChoices.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="flex flex-wrap items-center gap-2">
              <input type="radio" name="code-method" checked={draft.method === 'fixedPoints'} onChange={() => set('method', 'fixedPoints')} />
              A fixed
              <Input
                className="w-20"
                inputMode="decimal"
                value={draft.fixedPoints}
                onChange={(e) => { set('method', 'fixedPoints'); set('fixedPoints', e.target.value); }}
                aria-label="Fixed points"
              />
              points
            </label>
            {draft.method !== 'sameAs' && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.capAtDnf} onChange={(e) => set('capAtDnf', e.target.checked)} />
                No more than DNF scores
              </label>
            )}
          </>
        ) : (
          <>
            {!isZfp && (
              <label className="flex flex-wrap items-center gap-2">
                <input type="radio" name="code-method" checked={draft.method === 'addPoints'} onChange={() => set('method', 'addPoints')} />
                A stated number of points
                <Input
                  className="w-20"
                  inputMode="decimal"
                  value={draft.addPoints}
                  onChange={(e) => { set('method', 'addPoints'); set('addPoints', e.target.value); }}
                  aria-label="Points to add"
                />
              </label>
            )}
            <label className="flex flex-wrap items-center gap-2">
              {!isZfp && (
                <input type="radio" name="code-method" checked={draft.method === 'addPercent'} onChange={() => set('method', 'addPercent')} />
              )}
              A percentage of DNF
              <Input
                className="w-16"
                inputMode="decimal"
                value={draft.addPercent}
                onChange={(e) => { set('method', 'addPercent'); set('addPercent', e.target.value); }}
                aria-label="Percentage of DNF"
              />
              %
            </label>
            <p className={hint}>Never more than DNF scores, as RRS 44.3(c) caps a scoring penalty.</p>
          </>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.discardable} onChange={(e) => set('discardable', e.target.checked)} />
          Can be discarded
        </label>
      </fieldset>

      {preview && (
        <p className="rounded-md border bg-muted/40 p-3" data-testid="code-sentence">{preview}</p>
      )}

      {inUse && (
        <p className={hint} data-testid="code-usage">
          Used by {resultsUsing(inUse)}. Saving rescores them.
        </p>
      )}

      {replacing && inUse && (
        <div className="space-y-2 rounded-md border p-3" data-testid="replace-and-delete">
          <p>{code} is used by {resultsUsing(inUse)}.</p>
          <div className="flex flex-wrap items-center gap-2">
            Replace it with
            <select className={selectClass} value={replaceWith} onChange={(e) => setReplaceWith(e.target.value)} aria-label="Replace with">
              {replaceChoices.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <Button type="button" size="sm" disabled={saving || saveFinishes.isPending} onClick={replaceAndDelete}>
              Replace and delete
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setReplacing(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {(problem || error) && <p className="text-sm text-destructive" role="alert">{problem ?? error}</p>}

      <DialogFooter className="sm:justify-between">
        {builtIn ? (
          stored ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => void onSave(scoringCodes.filter((c) => c.code !== code))}
            >
              Reset to the RRS
            </Button>
          ) : <span />
        ) : code !== null ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => {
              if (inUse) {
                setReplaceWith(replaceChoices[0] ?? 'DNF');
                setReplacing(true);
              } else {
                void onSave(scoringCodes.filter((c) => c.code !== code));
              }
            }}
          >
            Delete code
          </Button>
        ) : <span />}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onBack}>Cancel</Button>
          <Button type="button" disabled={saving} onClick={save}>Save</Button>
        </div>
      </DialogFooter>
    </div>
  );
}
