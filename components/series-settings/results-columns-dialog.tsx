'use client';

import { useState, type KeyboardEvent } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useFleetsBySeries } from '@/hooks/use-fleets';
import { useShortcutHelp } from '@/hooks/use-keyboard-shortcut';
import { useUpdateSeries } from '@/hooks/use-series';
import { DEFAULT_PRIMARY_PERSON_LABEL, PRIMARY_PERSON_LABEL_TEXT } from '@/lib/competitor-fields';
import {
  addableColumns,
  applicableScoringColumns,
  columnAvailable,
  columnName,
  COLUMN_TITLE_MAX_LENGTH,
  customFieldId,
  defaultColumnHeader,
  isCompetitorColumnKey,
  isPersonColumn,
  REQUIRED_COLUMNS,
  RESULTS_TABLES,
  resultsColumnsProblems,
  SCORING_COLUMN_NAMES,
  scoringColumnShown,
  startingColumns,
  titleLines,
  UNHIDEABLE_SCORING_COLUMNS,
  type CompetitorColumnKey,
  type RaceScoringColumnKey,
  type StandingsScoringColumnKey,
} from '@/lib/results-columns';
import { standingsRatingLabel } from '@/lib/competitor-ratings';
import type { MultiPersonFieldKey, ResultsColumn, ResultsTable, Series } from '@/lib/types';
import { describeWriteFailure } from '@/lib/write-failure';

/**
 * The Results columns dialog: the escape hatch from automatic columns
 * (docs/design/ux/flows/results-columns.md). It opens on a screen that says
 * what it is for and what it costs; past that, the series' own list —
 * competitor columns in order with the tables each is on, then the scoring
 * columns in their fixed places — each row opening an editor. Every change
 * writes the series' whole list; the first one is what gives the series its
 * own columns.
 */
export type ResultsColumnsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  series: Series;
};

const TABLE_LABELS: Record<ResultsTable, string> = {
  standings: 'Standings',
  races: 'Races',
  entries: 'Entry list',
};

const hint = 'text-xs text-muted-foreground';

/** Competitor columns that print on every table they are on, empty or not. */
function alwaysShown(key: string): boolean {
  return key === 'rank' || key === 'fleet' || (REQUIRED_COLUMNS as readonly string[]).includes(key);
}

/** The tables a competitor column can be ticked for. */
function tickableTables(key: string): ResultsTable[] {
  if (key === 'rank') return ['standings', 'races'];
  if (key === 'fleet') return ['entries'];
  return [...RESULTS_TABLES];
}

/** The multi-person setting a person column's names follow. */
function multiKey(key: 'primary' | 'helm' | 'owner' | 'crewName'): MultiPersonFieldKey {
  return key;
}

export function ResultsColumnsDialog({ open, onOpenChange, series }: ResultsColumnsDialogProps) {
  // Past the opening screen. A series with its own columns skips it; one
  // without sees it every time, until a column is changed.
  const [pastIntro, setPastIntro] = useState(series.resultsColumns != null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmAutomatic, setConfirmAutomatic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const update = useUpdateSeries();
  const { data: fleets } = useFleetsBySeries(series.id);
  // Bound on each column row: Alt+↑/↓ moves the row the focus is on.
  useShortcutHelp([
    {
      key: 'ArrowUp',
      displayKeys: ['Alt+↑', 'Alt+↓'],
      description: 'Move the focused column up or down (Results columns dialog)',
      section: 'Settings',
    },
  ]);

  const list = series.resultsColumns ?? startingColumns(series);
  const scoring = applicableScoringColumns({
    handicap: (fleets ?? []).some((f) => f.scoringSystem !== 'scratch'),
    fixedRating: (fleets ?? []).some((f) => standingsRatingLabel(f) != null),
    progressive: (fleets ?? []).some((f) => f.scoringSystem === 'nhc' || f.scoringSystem === 'echo'),
    orc: (fleets ?? []).some((f) => f.scoringSystem === 'orc'),
    irc: (fleets ?? []).some((f) => f.scoringSystem === 'irc'),
    trackData: series.publishTrackData === true,
  });
  // The rows the list shows: competitor columns whose field is still on.
  const competitorRows = list.filter(
    (c) =>
      isCompetitorColumnKey(c.key) &&
      tickableTables(c.key).some((t) => columnAvailable(c.key as CompetitorColumnKey, series, t, { multiFleet: true })),
  );
  const addable = addableColumns(series, list);

  function close(next: boolean) {
    if (!next) {
      setEditing(null);
      setConfirmAutomatic(false);
      setError(null);
      setPastIntro(series.resultsColumns != null);
    }
    onOpenChange(next);
  }

  async function save(next: ResultsColumn[] | undefined): Promise<boolean> {
    if (next) {
      const problem = resultsColumnsProblems(next, series)[0];
      if (problem) {
        setError(problem);
        return false;
      }
    }
    setError(null);
    try {
      await update.mutateAsync({
        id: series.id,
        // eslint-disable-next-line react-hooks/purity -- Date.now() runs inside an async event handler, not render.
        patch: { resultsColumns: next, lastModifiedAt: Date.now() },
      });
      return true;
    } catch (err) {
      setError(describeWriteFailure(err));
      return false;
    }
  }

  function replace(key: string, column: ResultsColumn | null): ResultsColumn[] {
    return column ? list.map((c) => (c.key === key ? column : c)) : list.filter((c) => c.key !== key);
  }

  /** Move a competitor column one place among the visible competitor rows. */
  async function move(key: string, by: -1 | 1) {
    const at = competitorRows.findIndex((c) => c.key === key);
    const other = competitorRows[at + by];
    if (at < 0 || !other) return;
    await moveBefore(key, by < 0 ? other.key : null, by > 0 ? other.key : null);
  }

  /** Move a column to just before `before`, or just after `after`. */
  async function moveBefore(key: string, before: string | null, after: string | null) {
    const column = list.find((c) => c.key === key);
    if (!column) return;
    const rest = list.filter((c) => c.key !== key);
    const target = before ?? after;
    const index = rest.findIndex((c) => c.key === target);
    if (index < 0) return;
    const at = before ? index : index + 1;
    await save([...rest.slice(0, at), column, ...rest.slice(at)]);
  }

  async function toggleTable(column: ResultsColumn, table: ResultsTable, checked: boolean) {
    const tickable = tickableTables(column.key);
    const current = new Set(column.tables ?? tickable);
    if (checked) current.add(table);
    else current.delete(table);
    const tables = tickable.filter((t) => current.has(t));
    if (tables.length === 0) {
      setError('Tick at least one table, or remove the column.');
      return;
    }
    const { tables: _old, ...rest } = column;
    await save(replace(column.key, tables.length === tickable.length ? rest : { ...rest, tables }));
  }

  async function toggleScoring(key: string, shown: boolean) {
    const existing = list.find((c) => c.key === key);
    const column: ResultsColumn = { ...(existing ?? { key }) };
    if (shown) delete column.hidden;
    else column.hidden = true;
    await save(existing ? replace(key, column) : [...list, column]);
  }

  function onRowKeyDown(e: KeyboardEvent, key: string) {
    if (!e.altKey) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      void move(key, e.key === 'ArrowUp' ? -1 : 1);
    }
  }

  const editingColumn = editing ? list.find((c) => c.key === editing) ?? { key: editing } : null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-2xl" data-testid="results-columns-dialog">
        <DialogHeader>
          <DialogTitle>Results columns</DialogTitle>
          {editing === null && pastIntro && (
            <DialogDescription>
              The columns of this series’ results tables. Open a column to retitle it or say where it shows.
            </DialogDescription>
          )}
        </DialogHeader>

        {!pastIntro ? (
          <Intro onCancel={() => close(false)} onGo={() => setPastIntro(true)} />
        ) : editingColumn ? (
          isCompetitorColumnKey(editingColumn.key) ? (
            <CompetitorColumnEditor
              key={editingColumn.key}
              column={editingColumn}
              list={list}
              series={series}
              saving={update.isPending}
              error={error}
              onBack={() => {
                setEditing(null);
                setError(null);
              }}
              onSave={async (next) => {
                if (await save(next)) setEditing(null);
              }}
            />
          ) : (
            <ScoringColumnEditor
              key={editingColumn.key}
              column={editingColumn}
              list={list}
              saving={update.isPending}
              error={error}
              onBack={() => {
                setEditing(null);
                setError(null);
              }}
              onSave={async (next) => {
                if (await save(next)) setEditing(null);
              }}
            />
          )
        ) : (
          <>
            <section className="space-y-1">
              <div className="grid grid-cols-[1fr_repeat(3,4.5rem)] items-end gap-x-2 px-3">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Competitor columns</h3>
                {RESULTS_TABLES.map((t) => (
                  <span key={t} className="text-center text-xs text-muted-foreground">{TABLE_LABELS[t]}</span>
                ))}
              </div>
              <ul className="divide-y rounded-md border" data-testid="competitor-columns">
                {competitorRows.map((column, i) => (
                  <li
                    key={column.key}
                    draggable
                    onDragStart={() => setDragKey(column.key)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragKey && dragKey !== column.key) {
                        const from = competitorRows.findIndex((c) => c.key === dragKey);
                        void moveBefore(dragKey, from > i ? column.key : null, from < i ? column.key : null);
                      }
                      setDragKey(null);
                    }}
                    className="grid grid-cols-[1fr_repeat(3,4.5rem)] items-center gap-x-2 px-3 py-1.5 text-sm"
                    data-testid={`column-row-${column.key}`}
                  >
                    <div className="flex min-w-0 items-center gap-1">
                      <span className="cursor-grab select-none text-muted-foreground" aria-hidden title="Drag to move">⠿</span>
                      <div className="flex flex-col">
                        <button
                          type="button"
                          className="h-3 text-[0.6rem] leading-none text-muted-foreground hover:text-foreground disabled:opacity-30"
                          aria-label={`Move ${rowName(column, series)} up`}
                          disabled={i === 0}
                          onClick={() => void move(column.key, -1)}
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          className="h-3 text-[0.6rem] leading-none text-muted-foreground hover:text-foreground disabled:opacity-30"
                          aria-label={`Move ${rowName(column, series)} down`}
                          disabled={i === competitorRows.length - 1}
                          onClick={() => void move(column.key, 1)}
                        >
                          ▼
                        </button>
                      </div>
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left hover:underline"
                        onClick={() => setEditing(column.key)}
                        onKeyDown={(e) => onRowKeyDown(e, column.key)}
                        data-testid={`open-column-${column.key}`}
                      >
                        <span className="block truncate">{rowName(column, series)}</span>
                        <RowNote column={column} series={series} />
                      </button>
                    </div>
                    {RESULTS_TABLES.map((table) => {
                      const tickable =
                        tickableTables(column.key).includes(table) && !(column.key === 'crewName' && column.inPrimary);
                      const checked = tickable && (column.tables ?? tickableTables(column.key)).includes(table);
                      return (
                        <span key={table} className="text-center">
                          {tickable ? (
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              aria-label={`${rowName(column, series)} on ${TABLE_LABELS[table]}`}
                              checked={checked}
                              onChange={(e) => void toggleTable(column, table, e.target.checked)}
                            />
                          ) : (
                            <span className="text-muted-foreground">–</span>
                          )}
                        </span>
                      );
                    })}
                  </li>
                ))}
              </ul>
              {addable.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="mt-1">
                      Add a column ▾
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {addable.map((key) => (
                      <DropdownMenuItem key={key} onSelect={() => void save(withAdded(list, key))}>
                        {columnName(key, series)}
                        {key === 'country' && <span className="ml-2 text-xs text-muted-foreground">nationality, as a name</span>}
                        {customFieldId(key) != null && <span className="ml-2 text-xs text-muted-foreground">custom field</span>}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <p className={hint}>
                A field switched off in the Competitor fields card isn’t offered. Custom fields are added there too.
              </p>
            </section>

            <ScoringSection
              title="Standings"
              note="The ratings before the races, Total and Nett after."
              keys={scoring.standings}
              list={list}
              onOpen={setEditing}
              onToggle={toggleScoring}
            />
            <ScoringSection
              title="Race results"
              note="In this order, after the competitor columns."
              keys={scoring.races}
              list={list}
              onOpen={setEditing}
              onToggle={toggleScoring}
            />

            {confirmAutomatic && (
              <div className="rounded-md border p-3 text-sm" data-testid="automatic-confirm">
                <p>
                  Sail Scoring will choose this series’ columns again. This undoes the order, the titles and the
                  columns you removed or hid. Custom fields keep their values.
                </p>
                <div className="mt-2 flex gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmAutomatic(false)}>Cancel</Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={update.isPending}
                    onClick={async () => {
                      if (await save(undefined)) close(false);
                    }}
                  >
                    Use automatic columns
                  </Button>
                </div>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter className="sm:justify-between">
              {series.resultsColumns && !confirmAutomatic ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmAutomatic(true)}>
                  Use automatic columns
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

/** The list with a competitor column added at the end of the competitor
 *  columns — or, for Rank, at the start, where a reader looks for it. */
function withAdded(list: readonly ResultsColumn[], key: CompetitorColumnKey): ResultsColumn[] {
  if (key === 'rank') return [{ key }, ...list];
  let at = -1;
  list.forEach((c, i) => {
    if (isCompetitorColumnKey(c.key)) at = i;
  });
  return [...list.slice(0, at + 1), { key }, ...list.slice(at + 1)];
}

/** A row's name: its own title where it has one. */
function rowName(column: ResultsColumn, series: Series): string {
  const lines = column.title ? titleLines(column.title) : [];
  return lines.length > 0 ? lines.join(' / ') : columnName(column.key as CompetitorColumnKey, series);
}

/** The grey note under a row's name: what a retitled column shows, and how
 *  a person column shows its names. */
function RowNote({ column, series }: { column: ResultsColumn; series: Series }) {
  const key = column.key as CompetitorColumnKey;
  const primaryText = PRIMARY_PERSON_LABEL_TEXT[series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL];
  const notes = [
    column.title && titleLines(column.title).length > 0 ? columnName(key, series) : '',
    customFieldId(key) != null ? 'custom field' : '',
    key === 'country' ? 'nationality, as a name' : '',
    key === 'crewName' && column.inPrimary ? `in the ${primaryText} column` : '',
    column.joinNames ? 'on one line' : '',
    column.showWhenEmpty ? 'printed when empty' : '',
  ].filter(Boolean);
  if (notes.length === 0) return null;
  return <span className="block truncate text-xs text-muted-foreground">{notes.join(' · ')}</span>;
}

function Intro({ onCancel, onGo }: { onCancel: () => void; onGo: () => void }) {
  return (
    <div className="space-y-3 text-sm" data-testid="results-columns-intro">
      <p>
        Sail Scoring chooses this series’ columns from the fields switched on, and leaves out a column no boat has a
        value in. When you turn a field on or a fleet changes, the columns follow.
      </p>
      <p>
        Set your own when the organisers expect a particular layout: another order, other titles, or a column only on
        some tables. From then on the columns change only when you change them. You can go back to automatic columns
        at any time.
      </p>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="button" onClick={onGo}>Set this series’ columns</Button>
      </DialogFooter>
    </div>
  );
}

function ScoringSection({
  title,
  note,
  keys,
  list,
  onOpen,
  onToggle,
}: {
  title: string;
  note: string;
  keys: readonly (StandingsScoringColumnKey | RaceScoringColumnKey)[];
  list: readonly ResultsColumn[];
  onOpen: (key: string) => void;
  onToggle: (key: string, shown: boolean) => void;
}) {
  if (keys.length === 0) return null;
  return (
    <section className="space-y-1">
      <div className="flex items-baseline justify-between px-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
        <span className={hint}>{note}</span>
      </div>
      <ul className="divide-y rounded-md border">
        {keys.map((key) => {
          const column = list.find((c) => c.key === key);
          const shown = scoringColumnShown({ resultsColumns: list }, key);
          const { name, detail, titled } = SCORING_COLUMN_NAMES[key];
          const own = column?.title ? titleLines(column.title).join(' / ') : '';
          return (
            <li key={key} className="flex items-center gap-2 px-3 py-1.5 text-sm" data-testid={`scoring-row-${key}`}>
              {titled ? (
                <button type="button" className="min-w-0 flex-1 text-left hover:underline" onClick={() => onOpen(key)}>
                  <span className="block truncate">{own || name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[own ? name : '', detail ?? ''].filter(Boolean).join(' · ')}
                  </span>
                </button>
              ) : (
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{name}</span>
                  {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
                </span>
              )}
              {UNHIDEABLE_SCORING_COLUMNS.includes(key) ? (
                <span className={hint}>Shown</span>
              ) : (
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={shown}
                    aria-label={`Show ${name}`}
                    onChange={(e) => onToggle(key, e.target.checked)}
                  />
                  Shown
                </label>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The title input, shared by both editors: plain text, up to two lines. */
function TitleField({
  value,
  onChange,
  fallback,
}: {
  value: string;
  onChange: (v: string) => void;
  fallback: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor="column-title" className="text-sm font-medium">Title</label>
      <textarea
        id="column-title"
        rows={2}
        className="w-full max-w-sm rounded-md border bg-background px-2 py-1 text-sm"
        value={value}
        maxLength={(COLUMN_TITLE_MAX_LENGTH + 1) * 2}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className={hint}>
        Leave blank to use “{fallback}”. Press Enter for a second line, e.g. for a title in two languages.
      </p>
    </div>
  );
}

function CompetitorColumnEditor({
  column,
  list,
  series,
  saving,
  error,
  onBack,
  onSave,
}: {
  column: ResultsColumn;
  list: readonly ResultsColumn[];
  series: Series;
  saving: boolean;
  error: string | null;
  onBack: () => void;
  onSave: (next: ResultsColumn[]) => void;
}) {
  const key = column.key as CompetitorColumnKey;
  const [title, setTitle] = useState(column.title ?? '');
  const [tables, setTables] = useState<ResultsTable[]>(column.tables ?? tickableTables(key));
  const [showWhenEmpty, setShowWhenEmpty] = useState(column.showWhenEmpty === true);
  const [joinNames, setJoinNames] = useState(column.joinNames === true);
  const [inPrimary, setInPrimary] = useState(column.inPrimary === true);
  const primaryText = PRIMARY_PERSON_LABEL_TEXT[series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL];
  const multiple = isPersonColumn(key) && (series.multiPersonFields ?? []).includes(multiKey(key));
  const tickable = tickableTables(key);

  function build(): ResultsColumn {
    const lines = titleLines(title);
    return {
      key,
      ...(lines.length > 0 ? { title: lines.join('\n') } : {}),
      ...(tables.length !== tickable.length ? { tables } : {}),
      ...(showWhenEmpty && !alwaysShown(key) ? { showWhenEmpty: true } : {}),
      ...(joinNames && multiple ? { joinNames: true } : {}),
      ...(inPrimary && key === 'crewName' ? { inPrimary: true } : {}),
    };
  }

  const titleProblem = (() => {
    const lines = title.split('\n');
    if (lines.length > 2) return 'A title can have at most two lines.';
    if (lines.some((l) => l.trim().length > COLUMN_TITLE_MAX_LENGTH)) {
      return `Keep the title to ${COLUMN_TITLE_MAX_LENGTH} characters or fewer.`;
    }
    if (tables.length === 0) return 'Tick at least one table, or remove the column.';
    return null;
  })();

  return (
    <div className="space-y-4 text-sm" data-testid="column-editor">
      <div className="flex items-center justify-between">
        <p className="font-medium">{columnName(key, series)}</p>
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>← All columns</Button>
      </div>
      <TitleField value={title} onChange={setTitle} fallback={defaultColumnHeader(key, series)} />
      {!(key === 'crewName' && inPrimary) && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Shown on</legend>
          <div className="flex flex-wrap gap-4">
            {tickable.map((t) => (
              <label key={t} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={tables.includes(t)}
                  onChange={(e) =>
                    setTables(tickable.filter((x) => (x === t ? e.target.checked : tables.includes(x))))
                  }
                />
                {t === 'races' ? 'Race results' : TABLE_LABELS[t]}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {!alwaysShown(key) && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={!showWhenEmpty}
            onChange={(e) => setShowWhenEmpty(!e.target.checked)}
          />
          Leave it off a table where no boat has one
        </label>
      )}
      {key === 'crewName' && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Show crew</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="crew-place" checked={!inPrimary} onChange={() => setInPrimary(false)} />
            In a column of their own
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="crew-place" checked={inPrimary} onChange={() => setInPrimary(true)} />
            In the {primaryText} column, after the name ({primaryText} / Crew)
          </label>
        </fieldset>
      )}
      {multiple && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Several names</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="names" checked={!joinNames} onChange={() => setJoinNames(false)} />
            One per line
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="names" checked={joinNames} onChange={() => setJoinNames(true)} />
            On one line, joined with “&amp;”
          </label>
        </fieldset>
      )}
      {(titleProblem || error) && <p className="text-sm text-destructive">{titleProblem ?? error}</p>}
      <DialogFooter className="sm:justify-between">
        {(REQUIRED_COLUMNS as readonly string[]).includes(key) ? (
          <span className={hint}>Every row has to say whose it is, so this column stays.</span>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => onSave(list.filter((c) => c.key !== key))}
          >
            Remove column
          </Button>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onBack}>Cancel</Button>
          <Button
            type="button"
            disabled={saving || titleProblem != null}
            onClick={() => onSave(list.map((c) => (c.key === key ? build() : c)))}
          >
            Save
          </Button>
        </div>
      </DialogFooter>
    </div>
  );
}

function ScoringColumnEditor({
  column,
  list,
  saving,
  error,
  onBack,
  onSave,
}: {
  column: ResultsColumn;
  list: readonly ResultsColumn[];
  saving: boolean;
  error: string | null;
  onBack: () => void;
  onSave: (next: ResultsColumn[]) => void;
}) {
  const key = column.key as StandingsScoringColumnKey | RaceScoringColumnKey;
  const [title, setTitle] = useState(column.title ?? '');
  const [shown, setShown] = useState(column.hidden !== true);
  const { name } = SCORING_COLUMN_NAMES[key];
  const hideable = !UNHIDEABLE_SCORING_COLUMNS.includes(key);

  function build(): ResultsColumn {
    const lines = titleLines(title);
    return {
      key,
      ...(lines.length > 0 ? { title: lines.join('\n') } : {}),
      ...(!shown && hideable ? { hidden: true } : {}),
    };
  }
  const titleProblem =
    title.split('\n').length > 2
      ? 'A title can have at most two lines.'
      : title.split('\n').some((l) => l.trim().length > COLUMN_TITLE_MAX_LENGTH)
        ? `Keep the title to ${COLUMN_TITLE_MAX_LENGTH} characters or fewer.`
        : null;

  return (
    <div className="space-y-4 text-sm" data-testid="column-editor">
      <div className="flex items-center justify-between">
        <p className="font-medium">{name}</p>
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>← All columns</Button>
      </div>
      <TitleField value={title} onChange={setTitle} fallback={name} />
      {hideable && (
        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4" checked={shown} onChange={(e) => setShown(e.target.checked)} />
          Shown
        </label>
      )}
      {(titleProblem || error) && <p className="text-sm text-destructive">{titleProblem ?? error}</p>}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onBack}>Cancel</Button>
        <Button
          type="button"
          disabled={saving || titleProblem != null}
          onClick={() =>
            onSave(list.some((c) => c.key === key) ? list.map((c) => (c.key === key ? build() : c)) : [...list, build()])
          }
        >
          Save
        </Button>
      </DialogFooter>
    </div>
  );
}
