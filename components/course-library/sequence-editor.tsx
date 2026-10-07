'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Variation } from '@/lib/bearings';
import type { SeriesCourseMark, SeriesMark } from '@/lib/types';

import { LineFacts } from './line-facts';

const NEW_MARK = '__new__';
const START_LINE = '__start_line__';
const ONE_POINT = '__one_point__';

/**
 * A course's sequence as rows: the mark, the side it is left on, whether it
 * is a passing mark, and a remove button; with the gestures that cover the
 * rest of the scenarios — add a mark from the library (or a new one), repeat
 * the lap, shorten at a mark (the rows after it drop and the course finishes
 * there). Arrow keys move between rows.
 *
 * The first row is the start and the last the finish, and either may be a
 * line recorded as its two ends: the row's mark is the starboard end (the
 * committee boat, as a rule) and a pin is picked beside it, and legs are
 * measured from the middle. A course finishes on the start line (the Add
 * menu repeats it), on a line of its own, at a mark, or at the last rounding
 * mark, by adding nothing after it.
 */
export function SequenceEditor({
  sequence,
  marks,
  onChange,
  onNewMark,
  variation,
}: {
  sequence: SeriesCourseMark[];
  marks: SeriesMark[];
  onChange: (next: SeriesCourseMark[]) => void;
  /** Open the New mark dialog; the new mark is appended once saved. */
  onNewMark?: () => void;
  /** Labels a line's bearing in magnetic, as the legs are. */
  variation?: Variation;
}) {
  const byId = new Map(marks.map((m) => [m.id, m]));
  const [shortenOpen, setShortenOpen] = useState(false);

  function update(i: number, patch: Partial<SeriesCourseMark>) {
    onChange(sequence.map((cm, j) => (j === i ? { ...cm, ...patch } : cm)));
  }

  function moveFocus(from: HTMLElement, delta: number) {
    const rows = [...(from.closest('[data-sequence]')?.querySelectorAll<HTMLElement>('[data-sequence-row]') ?? [])];
    const i = rows.findIndex((r) => r.contains(from));
    const target = rows[i + delta];
    target?.querySelector<HTMLElement>('button, [role="combobox"], input')?.focus();
  }

  // Repeating the lap: the marks between the line and the finish, sailed
  // again before the finish.
  const canRepeat = sequence.length >= 3;

  return (
    <div className="space-y-2" data-sequence>
      {sequence.length === 0 && (
        <p className="text-sm text-muted-foreground">No marks yet — add the start line first, then the marks in sailing order.</p>
      )}
      {sequence.map((cm, i) => {
        const mark = byId.get(cm.markId);
        const port = cm.portEndMarkId ? byId.get(cm.portEndMarkId) : undefined;
        // Only the start and the finish can be a line.
        const canBeLine = mark && (i === 0 || i === sequence.length - 1);
        return (
          <div key={`${cm.markId}-${i}`} className="space-y-1">
          <div
            data-sequence-row
            className="grid grid-cols-[1.5rem_1fr_auto_auto_auto] items-center gap-2 text-sm"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const target = e.target as HTMLElement;
                if (target.getAttribute('role') === 'combobox' && (target.getAttribute('aria-expanded') === 'true')) return;
                e.preventDefault();
                moveFocus(target, e.key === 'ArrowDown' ? 1 : -1);
              }
            }}
          >
            <span className="text-muted-foreground font-mono text-xs">{i + 1}</span>
            <span className={mark && (!cm.portEndMarkId || port) ? '' : 'text-destructive'}>
              {mark?.name ?? 'Missing mark'}
              {cm.portEndMarkId && !port && ' — pin missing'}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              leave
              <Select value={cm.side ?? 'none'} onValueChange={(v) => update(i, { side: v === 'none' ? undefined : (v as 'port' | 'starboard') })}>
                <SelectTrigger className="h-7 w-20 text-xs" aria-label={`Row ${i + 1} side`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="port">port</SelectItem>
                  <SelectItem value="starboard">stbd</SelectItem>
                  <SelectItem value="none">—</SelectItem>
                </SelectContent>
              </Select>
            </span>
            <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={Boolean(cm.passing)}
                onChange={(e) => update(i, { passing: e.target.checked || undefined })}
                aria-label={`Row ${i + 1} passing`}
              />
              passing
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={`Remove row ${i + 1}`}
              onClick={() => onChange(sequence.filter((_, j) => j !== i))}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          {canBeLine && (
            <div className="ml-8 space-y-1">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                {cm.portEndMarkId ? 'line to pin' : 'one point, or a line to a pin'}
                <Select
                  value={cm.portEndMarkId ?? ONE_POINT}
                  onValueChange={(v) => update(i, { portEndMarkId: v === ONE_POINT ? undefined : v })}
                >
                  <SelectTrigger className="h-7 w-48 min-w-0 text-xs" aria-label={`Row ${i + 1} pin`} data-testid={`sequence-pin-${i + 1}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ONE_POINT}>— one point —</SelectItem>
                    {marks.filter((m) => m.id !== cm.markId).map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {port && mark && <LineFacts starboard={mark} port={port} library={marks} variation={variation} testId={`sequence-line-${i + 1}`} />}
            </div>
          )}
          </div>
        );
      })}
      {sequence.length >= 2 && (
        <p className="text-xs text-muted-foreground">
          The last row is the finish: the start line again, a line of its own (the committee boat with a pin), a
          single mark, or the last rounding mark itself.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Select
          value=""
          onValueChange={(v) => {
            if (v === NEW_MARK) onNewMark?.();
            else if (v === START_LINE) {
              const { markId, portEndMarkId } = sequence[0];
              onChange([...sequence, { markId, ...(portEndMarkId ? { portEndMarkId } : {}) }]);
            } else onChange([...sequence, { markId: v, side: 'port' }]);
          }}
        >
          <SelectTrigger className="h-8 w-44 text-xs" aria-label="Add mark" data-testid="sequence-add-mark">
            <span className="flex items-center gap-1"><Plus className="h-3.5 w-3.5" />Add mark</span>
          </SelectTrigger>
          {/* Positioned off the trigger, not off a selected item: this select
              is an action menu that holds no value, so the default
              item-aligned placement has nothing to align to and never places
              the menu at all. Same for "Shorten at…" below. */}
          <SelectContent position="popper">
            {sequence.length >= 2 && <SelectItem value={START_LINE}>Finish on the start line</SelectItem>}
            {marks.map((m) => (
              <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
            ))}
            {onNewMark && <SelectItem value={NEW_MARK}>New mark…</SelectItem>}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          disabled={!canRepeat}
          title="Sail the marks between the line and the finish again"
          onClick={() => {
            const lap = sequence.slice(1, -1);
            onChange([...sequence.slice(0, -1), ...lap, sequence[sequence.length - 1]]);
          }}
        >
          Repeat marks 2–{Math.max(sequence.length - 1, 2)}
        </Button>
        {!shortenOpen ? (
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={sequence.length < 2} onClick={() => setShortenOpen(true)}>
            Shorten at…
          </Button>
        ) : (
          <Select
            value=""
            onValueChange={(v) => {
              const at = Number(v);
              onChange(sequence.slice(0, at + 1));
              setShortenOpen(false);
            }}
          >
            <SelectTrigger className="h-8 w-44 text-xs" aria-label="Shorten at mark" autoFocus data-testid="sequence-shorten-at">
              <SelectValue placeholder="Shorten at…" />
            </SelectTrigger>
            <SelectContent position="popper">
              {sequence.slice(1).map((cm, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {i + 2}. {byId.get(cm.markId)?.name ?? '?'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}
