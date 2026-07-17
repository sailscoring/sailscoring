'use client';

import { useState } from 'react';

import type { ProtestTimeLimit, Series } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type ProtestTimeLimitValues = Pick<Series, 'protestTimeLimit'>;

/** RRS 60.3(b): two hours after the last boat in the race finishes. */
const RRS_DEFAULT_MINUTES = 120;

/**
 * Series-settings card for the protest / request-for-redress time limit.
 * Feeds the last-finisher displays and the finalise checklist: with a limit
 * configured, each race's limit end is computed from its (or its day's) last
 * finisher. "Not tracked" is the default — many club series state no limit,
 * and finality is then scorer judgement.
 */
export function ProtestTimeLimitCard({
  value,
  onChange,
}: {
  value: ProtestTimeLimitValues;
  onChange: (patch: Partial<ProtestTimeLimitValues>) => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<ProtestTimeLimit | undefined>(value.protestTimeLimit);
  const [minutesText, setMinutesText] = useState(
    value.protestTimeLimit ? String(value.protestTimeLimit.minutes) : '',
  );
  const [changed, setChanged] = useState(false);

  // Re-sync the draft when the persisted value changes identity (e.g. another
  // tab saved). Render-time compare, not an effect — see ScoringCard.
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setDraft(value.protestTimeLimit);
    setMinutesText(value.protestTimeLimit ? String(value.protestTimeLimit.minutes) : '');
    setChanged(false);
  }

  function updateDraft(next: ProtestTimeLimit | undefined) {
    setDraft(next);
    setChanged(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    await onChange({ protestTimeLimit: draft });
    setChanged(false);
    setExpanded(false);
  }

  const summary = value.protestTimeLimit
    ? `${value.protestTimeLimit.minutes} minutes after the last finisher ${
        value.protestTimeLimit.basis === 'day' ? 'of the race day' : 'of each race'
      }`
    : 'Not tracked — finality is scorer judgement';

  return (
    <div className="bg-card border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Protest time limit</h2>
        {!expanded && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            Edit ▸
          </Button>
        )}
      </div>
      {!expanded ? (
        <p className="text-sm text-muted-foreground">{summary}</p>
      ) : (
        <form onSubmit={handleSave} className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Set this to match the sailing instructions. It drives the protest
            time limit shown beside each race&apos;s last finisher and the
            checks when marking results final. Where the SIs are silent, the
            RRS 60.3(b) default is 120 minutes after each race&apos;s last
            finisher.
          </p>
          <div className="space-y-2">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="protestTimeLimitMode"
                checked={draft === undefined}
                onChange={() => updateDraft(undefined)}
                className="mt-0.5"
              />
              <div>
                <span className="text-sm font-medium">Not tracked</span>
                <p className="text-xs text-muted-foreground">
                  No stated limit; results are finalised on the scorer&apos;s
                  judgement once the protest committee is silent.
                </p>
              </div>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="protestTimeLimitMode"
                checked={draft !== undefined}
                onChange={() => {
                  const minutes = parseInt(minutesText) || RRS_DEFAULT_MINUTES;
                  setMinutesText(String(minutes));
                  updateDraft({ minutes, basis: draft?.basis ?? 'race' });
                }}
                className="mt-0.5"
              />
              <div>
                <span className="text-sm font-medium">Time limit after the last finisher</span>
                <p className="text-xs text-muted-foreground">
                  A fixed window from the last boat&apos;s finish, per the SIs.
                </p>
              </div>
            </label>
          </div>
          {draft !== undefined && (
            <div className="space-y-3 pl-7">
              <div className="space-y-1">
                <Label htmlFor="protest-limit-minutes">Minutes</Label>
                <Input
                  id="protest-limit-minutes"
                  type="number"
                  min={1}
                  max={24 * 60}
                  placeholder={String(RRS_DEFAULT_MINUTES)}
                  value={minutesText}
                  onChange={(e) => {
                    setMinutesText(e.target.value);
                    const minutes = parseInt(e.target.value);
                    if (Number.isInteger(minutes) && minutes >= 1) {
                      updateDraft({ minutes, basis: draft.basis });
                    }
                  }}
                  className="h-8 w-28 text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label>Measured from</Label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="protestTimeLimitBasis"
                    checked={draft.basis === 'race'}
                    onChange={() => updateDraft({ ...draft, basis: 'race' })}
                    className="mt-0.5"
                  />
                  <div>
                    <span className="text-sm font-medium">Each race&apos;s last finisher</span>
                    <p className="text-xs text-muted-foreground">The RRS 60.3(b) default.</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="protestTimeLimitBasis"
                    checked={draft.basis === 'day'}
                    onChange={() => updateDraft({ ...draft, basis: 'day' })}
                    className="mt-0.5"
                  />
                  <div>
                    <span className="text-sm font-medium">The last finisher of the race day</span>
                    <p className="text-xs text-muted-foreground">
                      The common club SI: &ldquo;after the last boat finishes
                      the last race of the day&rdquo;.
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Button type="submit" variant="outline" size="sm" disabled={!changed}>
              {changed ? 'Save' : 'Saved'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(false)}>
              Done
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
