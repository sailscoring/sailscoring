'use client';

import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  orcChoiceOf,
  orcChoiceRows,
  orcNumbersLabel,
  orcSettleChoice,
  type OrcChoiceSelection,
  type OrcKind,
  type OrcOptionChoice,
} from '@/lib/orc-option-choices';

const KIND_LABEL: Record<OrcKind, string> = {
  tot: 'Time-on-time',
  tod: 'Time-on-distance',
  pcs: 'Performance curves',
};

function officeHeading(office: string): string {
  if (office === 'ORC') return 'International';
  return office ? `Custom scoring options for ${office}` : 'Other certificate options';
}

/** The row a selection still needs, as the hint and the save refusal name it. */
function pendingRow(selection: OrcChoiceSelection): string {
  if (!selection.kind) return 'how the rating is applied';
  if (!selection.course) return 'the course';
  if (selection.numbers == null) return 'how many numbers';
  return 'the wind band';
}

/**
 * The race-start dialog's scoring option, chosen in rows: how the rating is
 * applied, the course, how many numbers, and the band. A race day's change
 * — another band, a round-the-cans course after a windward/leeward one, a
 * switch to curves — is one row, and the rows below it keep their values
 * where the certificates allow. Time-on-time against time-on-distance is a
 * row of its own, so it is changed on purpose, not picked by mistake from a
 * list where the two kinds of one option sit side by side.
 *
 * `onChange` reports the option, or '' for the fleet default, and the row
 * still to choose when "This start" is incomplete — saving then has
 * something to refuse by name rather than quietly saving the fleet default.
 */
export function OrcOptionPicker({
  choices,
  value,
  fleetDefaultOption,
  fleetDefaultLabel,
  onChange,
}: {
  choices: ReadonlyArray<OrcOptionChoice>;
  /** The start's option, '' when it uses the fleet default. */
  value: string;
  /** Where "This start" begins when the start had no option of its own. */
  fleetDefaultOption: string;
  /** What the fleet default is, named. */
  fleetDefaultLabel: string;
  onChange: (option: string, pending: string | null) => void;
}) {
  const id = useId();
  const [ownOption, setOwnOption] = useState(Boolean(value));
  const [selection, setSelection] = useState<OrcChoiceSelection>(
    () => orcChoiceOf(choices, value || fleetDefaultOption) ?? { kind: 'tot' },
  );
  const rows = orcChoiceRows(choices, selection);

  function choose(wanted: OrcChoiceSelection) {
    const settled = orcSettleChoice(choices, wanted);
    setSelection(settled.selection);
    onChange(settled.option ?? '', settled.option ? null : pendingRow(settled.selection));
  }

  function chooseOwnOption(own: boolean) {
    setOwnOption(own);
    if (own) choose(selection);
    else onChange('', null);
  }

  const pending = ownOption && !orcSettleChoice(choices, selection).option ? pendingRow(selection) : null;
  const officeGroups = [...new Set(rows.courses.map((c) => c.office))];

  return (
    <div className="space-y-2">
      <div className="space-y-1" role="radiogroup" aria-labelledby={`${id}-mode`}>
        <span id={`${id}-mode`} className="sr-only">Scoring option</span>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            className="mt-0.5"
            checked={!ownOption}
            onChange={() => chooseOwnOption(false)}
          />
          <span>
            Fleet default <span className="text-muted-foreground">— {fleetDefaultLabel}</span>
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={ownOption}
            onChange={() => chooseOwnOption(true)}
          />
          This start
        </label>
      </div>

      {ownOption && (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 pl-5" data-testid="start-orc-rows">
          <ChoiceRow
            label="Applied"
            values={rows.kinds.map((k) => ({ key: k, label: KIND_LABEL[k] }))}
            selected={selection.kind}
            onSelect={(kind) => choose({ ...selection, kind: kind as OrcKind })}
          />

          <span className="text-xs text-muted-foreground" id={`${id}-course`}>Course</span>
          <Select
            value={selection.course ?? ''}
            onValueChange={(course) => choose({ ...selection, course })}
          >
            <SelectTrigger
              className={`w-full h-8 text-sm ${selection.course ? '' : 'border-amber-500'}`}
              aria-labelledby={`${id}-course`}
              data-testid="start-orc-course"
            >
              <SelectValue placeholder="Choose the course" />
            </SelectTrigger>
            <SelectContent>
              {officeGroups.map((office) => (
                <SelectGroup key={office}>
                  <SelectLabel>{officeHeading(office)}</SelectLabel>
                  {rows.courses.filter((c) => c.office === office).map((c) => (
                    <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>

          {rows.numbers.length > 1 && (
            <ChoiceRow
              label="Numbers"
              values={rows.numbers.map((n) => ({ key: String(n), label: orcNumbersLabel(n) }))}
              selected={selection.numbers != null ? String(selection.numbers) : undefined}
              onSelect={(n) => choose({ ...selection, numbers: Number(n) })}
            />
          )}

          {rows.bands.length > 0 && (
            <ChoiceRow
              label="Band"
              values={rows.bands}
              selected={selection.band}
              onSelect={(band) => choose({ ...selection, band })}
            />
          )}
        </div>
      )}

      {pending && (
        <p className="text-xs text-amber-600 dark:text-amber-500">Choose {pending} for this start.</p>
      )}
    </div>
  );
}

/** One row of buttons, exactly one of which is chosen — or none, flagged,
 *  while the scorer has still to choose. */
function ChoiceRow({
  label,
  values,
  selected,
  onSelect,
}: {
  label: string;
  values: Array<{ key: string; label: string }>;
  selected: string | undefined;
  onSelect: (key: string) => void;
}) {
  const id = useId();
  return (
    <>
      <span className="text-xs text-muted-foreground" id={id}>{label}</span>
      <div
        role="radiogroup"
        aria-labelledby={id}
        className={`flex flex-wrap gap-1 rounded-md ${selected ? '' : 'ring-1 ring-amber-500 ring-offset-1'}`}
      >
        {values.map((v) => (
          <Button
            key={v.key}
            type="button"
            size="xs"
            role="radio"
            aria-checked={v.key === selected}
            variant={v.key === selected ? 'default' : 'outline'}
            onClick={() => onSelect(v.key)}
          >
            {v.label}
          </Button>
        ))}
      </div>
    </>
  );
}
