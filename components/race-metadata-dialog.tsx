'use client';

import { useState } from 'react';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { OfficialsEditor } from '@/components/officials-editor';
import {
  COMPASS_POINTS,
  RACE_NOTES_MAX_LENGTH,
  WIND_SPEED_MAX,
  windRangeError,
} from '@/lib/race-conditions';
import { namedOfficials } from '@/lib/race-officials';
import type { CompassPoint, Race, RaceConditions, RaceOfficial } from '@/lib/types';

/** The value the dialog hands back: both blocks, already normalised to the
 *  sparse shape the record is stored in. */
export interface RaceMetadataValue {
  conditions: RaceConditions | undefined;
  officials: RaceOfficial[] | undefined;
}

/** Sentinel for "no direction recorded" — Radix Select has no empty value. */
const NO_DIRECTION = 'none';

/**
 * The race record (#338/#339): what a race was sailed in, and who ran it.
 *
 * Separate from the scoring-options dialog even though both hang off a race,
 * because they answer to different feature gates and one has to be able to
 * appear without the other.
 *
 * Wind is a range because a race officer stipulates a minimum and a maximum,
 * and because ORC's triple-number scheme picks a rating band from the average
 * of the two — so this is a scoring input in waiting, not only a note.
 */
export function RaceMetadataDialog({
  race,
  open,
  onOpenChange,
  onSave,
}: {
  race: Pick<Race, 'raceNumber' | 'name' | 'conditions' | 'officials'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (value: RaceMetadataValue) => Promise<void> | void;
}) {
  if (!open) return null;
  return <RaceMetadataDialogInner race={race} onOpenChange={onOpenChange} onSave={onSave} />;
}

function RaceMetadataDialogInner({
  race,
  onOpenChange,
  onSave,
}: {
  race: Pick<Race, 'raceNumber' | 'name' | 'conditions' | 'officials'>;
  onOpenChange: (open: boolean) => void;
  onSave: (value: RaceMetadataValue) => Promise<void> | void;
}) {
  // Speeds are held as typed strings so a half-finished entry doesn't snap
  // back under the cursor; parsed on save, as the weighting field does.
  const [minText, setMinText] = useState(numberText(race.conditions?.windSpeedMin));
  const [maxText, setMaxText] = useState(numberText(race.conditions?.windSpeedMax));
  const [direction, setDirection] = useState<string>(race.conditions?.windDirection ?? NO_DIRECTION);
  const [notes, setNotes] = useState(race.conditions?.notes ?? '');
  const [officials, setOfficials] = useState<RaceOfficial[]>(race.officials ?? []);
  const [saving, setSaving] = useState(false);

  const min = parseSpeed(minText);
  const max = parseSpeed(maxText);
  const speedsValid = min !== 'invalid' && max !== 'invalid';
  const conditions = speedsValid
    ? buildConditions(min, max, direction, notes)
    : undefined;
  const rangeError = speedsValid ? windRangeError(conditions) : null;
  const canSave = speedsValid && rangeError === null;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      // Half-filled rows are dropped here rather than stored: a row with no
      // name is an editing artefact, and keeping it would publish a bare role.
      const named = namedOfficials(officials).map((o) => ({ ...o, name: o.name.trim() }));
      await onSave({
        conditions: hasAny(conditions) ? conditions : undefined,
        officials: named.length > 0 ? named : undefined,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  const title = race.name
    ? `Race ${race.raceNumber} — ${race.name}`
    : `Race ${race.raceNumber}`;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="race-metadata-dialog">
        <DialogHeader>
          <DialogTitle>{title} — race record</DialogTitle>
          <DialogDescription>
            The conditions this race was sailed in, and who ran it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Wind</span>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Input
                id="race-wind-min"
                type="text"
                inputMode="decimal"
                className="h-8 w-20"
                value={minText}
                aria-label="Minimum wind speed in knots"
                aria-invalid={min === 'invalid'}
                onChange={(e) => setMinText(e.target.value)}
              />
              <span>to</span>
              <Input
                id="race-wind-max"
                type="text"
                inputMode="decimal"
                className="h-8 w-20"
                value={maxText}
                aria-label="Maximum wind speed in knots"
                aria-invalid={max === 'invalid'}
                onChange={(e) => setMaxText(e.target.value)}
              />
              <span>kt from</span>
              <Select value={direction} onValueChange={setDirection}>
                <SelectTrigger id="race-wind-direction" className="h-8 w-28" aria-label="Wind direction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DIRECTION}>—</SelectItem>
                  {COMPASS_POINTS.map((point) => (
                    <SelectItem key={point} value={point}>{point}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {rangeError ??
                (speedsValid
                  ? 'The range the race officer stipulated. Leave blank if it wasn’t recorded.'
                  : `Enter wind speeds in knots, up to ${WIND_SPEED_MAX}.`)}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="race-conditions-notes">
              Course and notes
            </label>
            <textarea
              id="race-conditions-notes"
              data-testid="race-conditions-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={RACE_NOTES_MAX_LENGTH}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="The course sailed, the tide, anything else worth the record"
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-sm font-medium">Race management team</span>
            <p className="text-xs text-muted-foreground">
              Who ran this race. The event’s standing team is set on series
              settings; neither list replaces the other.
            </p>
            <OfficialsEditor value={officials} onChange={setOfficials} idPrefix="race" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!canSave || saving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function numberText(value: number | undefined): string {
  return value == null ? '' : String(value);
}

/** A typed speed: the number, `undefined` for blank, or 'invalid'. */
function parseSpeed(text: string): number | undefined | 'invalid' {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > WIND_SPEED_MAX) return 'invalid';
  return parsed;
}

function buildConditions(
  min: number | undefined,
  max: number | undefined,
  direction: string,
  notes: string,
): RaceConditions {
  const trimmedNotes = notes.trim();
  return {
    ...(min != null ? { windSpeedMin: min } : {}),
    ...(max != null ? { windSpeedMax: max } : {}),
    ...(direction !== NO_DIRECTION ? { windDirection: direction as CompassPoint } : {}),
    ...(trimmedNotes ? { notes: trimmedNotes } : {}),
  };
}

function hasAny(conditions: RaceConditions | undefined): boolean {
  return conditions != null && Object.keys(conditions).length > 0;
}
