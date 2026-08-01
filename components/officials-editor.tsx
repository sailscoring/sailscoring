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
  OFFICIAL_NAME_MAX_LENGTH,
  OFFICIAL_ROLES,
  OFFICIAL_ROLE_LABEL,
} from '@/lib/race-officials';
import type { OfficialRole, RaceOfficial } from '@/lib/types';

/**
 * The race management team editor — a list of role-and-name rows, shared by
 * the per-race dialog and the series settings card so the two levels are
 * authored identically.
 *
 * Roles come from the fixed World Sailing vocabulary. Nothing stops the same
 * role appearing twice: a big event really does run several assistant race
 * officers, and rejecting the second would be wrong more often than right.
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
        <div key={official.id} className="flex items-center gap-2">
          <Select
            value={official.role}
            onValueChange={(role) => update(index, { role: role as OfficialRole })}
            disabled={disabled}
          >
            <SelectTrigger
              id={`${idPrefix}-official-role-${index}`}
              className="h-8 w-56"
              aria-label={`Role for team member ${index + 1}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OFFICIAL_ROLES.map((role) => (
                <SelectItem key={role} value={role}>
                  {OFFICIAL_ROLE_LABEL[role]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            id={`${idPrefix}-official-name-${index}`}
            className="h-8 flex-1"
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
