'use client';

import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DEFAULT_OFFICIAL_ROLE,
  OFFICIAL_CUSTOM_ROLE_MAX_LENGTH,
  OFFICIAL_NAME_MAX_LENGTH,
  OFFICIAL_ROLE_LABEL,
  OFFICIAL_ROLE_OPTIONS,
} from '@/lib/race-officials';
import type { OfficialRole, RaceOfficial } from '@/lib/types';

/**
 * The race management team editor — a list of role-and-name rows, shared by
 * the per-race dialog and the series settings card so the two levels are
 * authored identically.
 *
 * Roles come from the World Sailing vocabulary, with `Other…` last for a job
 * the manual doesn't name — picking it opens a text box for the role itself,
 * which then reads exactly as typed everywhere the team is shown. Nothing
 * stops the same role appearing twice: a big event really does run several
 * assistant race officers, and rejecting the second would be wrong more often
 * than right.
 *
 * Rows are kept in the order the scorer adds them rather than sorted by
 * seniority — a club series that puts the week's duty officer first should
 * stay that way, and every read path preserves the order too.
 */
export function OfficialsEditor({
  value,
  onChange,
  idPrefix,
  disabled,
}: {
  value: RaceOfficial[];
  onChange: (next: RaceOfficial[]) => void;
  /** Distinguishes this editor's control ids when two are on one page. */
  idPrefix: string;
  disabled?: boolean;
}) {
  function update(index: number, patch: Partial<RaceOfficial>) {
    onChange(value.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  }

  return (
    <div className="space-y-2" data-testid={`${idPrefix}-officials`}>
      {value.map((official, index) => (
        <div key={official.id} className="flex flex-wrap items-center gap-2">
          <Select
            value={official.role}
            onValueChange={(role) => update(index, { role: role as OfficialRole })}
            disabled={disabled}
          >
            <SelectTrigger
              id={`${idPrefix}-official-role-${index}`}
              // Narrows when the role is written out, so the picker, the role
              // and the name still sit on one line inside the race dialog.
              className={official.role === 'other' ? 'h-8 w-36' : 'h-8 w-56'}
              aria-label={`Role for team member ${index + 1}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OFFICIAL_ROLE_OPTIONS.map((role) => (
                <SelectItem key={role} value={role}>
                  {OFFICIAL_ROLE_LABEL[role]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {official.role === 'other' && (
            <Input
              id={`${idPrefix}-official-custom-role-${index}`}
              className="h-8 min-w-28 flex-1"
              value={official.customRole ?? ''}
              maxLength={OFFICIAL_CUSTOM_ROLE_MAX_LENGTH}
              placeholder="Role"
              aria-label={`Written-out role for team member ${index + 1}`}
              disabled={disabled}
              onChange={(e) => update(index, { customRole: e.target.value })}
            />
          )}
          <Input
            id={`${idPrefix}-official-name-${index}`}
            className="h-8 min-w-28 flex-1"
            value={official.name}
            maxLength={OFFICIAL_NAME_MAX_LENGTH}
            placeholder="Name"
            aria-label={`Name for team member ${index + 1}`}
            disabled={disabled}
            onChange={(e) => update(index, { name: e.target.value })}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label={`Remove team member ${index + 1}`}
            disabled={disabled}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        data-testid={`${idPrefix}-add-official`}
        onClick={() =>
          onChange([
            ...value,
            { id: crypto.randomUUID(), role: DEFAULT_OFFICIAL_ROLE, name: '' },
          ])
        }
      >
        Add person
      </Button>
    </div>
  );
}
