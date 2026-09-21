'use client';

import { Fragment } from 'react';

import { SelectGroup, SelectItem, SelectLabel } from '@/components/ui/select';
import { orcOptionLabel } from '@/lib/orc-certificate';
import type { OrcProfile, OrcScoringOptionCatalog } from '@/lib/types';

/** The heading one group of certificate options sits under. The printed
 *  certificate heads its own national block "Custom scoring options for
 *  Ireland"; this is the same idea with the country code we have. */
function groupHeading(countryId: string | undefined): string {
  if (!countryId) return 'Other certificate options';
  return countryId === 'ORC'
    ? 'International scoring options'
    : `Custom scoring options for ${countryId}`;
}

/**
 * The certificate scoring options a series offers, named as the certificate
 * names them and grouped by the office that issues them (#602).
 *
 * Both pickers — the fleet's default on the Fleets card, and a start's
 * override in the race-start dialog — render this, so a scorer meets one list
 * in one order wherever they choose an option.
 */
export function OrcOptionItems({
  options,
  catalog,
}: {
  options: ReadonlyArray<OrcProfile>;
  catalog?: OrcScoringOptionCatalog;
}) {
  if (options.length === 0) return null;

  // Grouped in the order the options arrive, which `orcSelectableOptions`
  // has already sorted by office and then by name.
  const groups: Array<{ countryId?: string; items: OrcProfile[] }> = [];
  for (const option of options) {
    const countryId = catalog?.[option.option]?.countryId;
    const last = groups[groups.length - 1];
    if (last && last.countryId === countryId) last.items.push(option);
    else groups.push({ countryId, items: [option] });
  }

  return (
    <>
      {groups.map((group, i) => (
        <SelectGroup key={group.countryId ?? `ungrouped-${i}`}>
          {/* Nothing to head a list of bare field names with — a series whose
              certificates predate the stored catalog gets the flat list it
              always had. */}
          {catalog && <SelectLabel>{groupHeading(group.countryId)}</SelectLabel>}
          {group.items.map((o) => (
            <SelectItem key={o.option} value={o.option}>
              {catalog?.[o.option] ? (
                orcOptionLabel(o.option, catalog)
              ) : (
                <span className="font-mono text-xs">{o.option}</span>
              )}
            </SelectItem>
          ))}
        </SelectGroup>
      ))}
    </>
  );
}

/** The same naming for a value shown outside a picker — a stored option the
 *  certificates no longer carry, kept selectable so the control isn't broken. */
export function OrcOptionValue({
  option,
  catalog,
}: {
  option: string;
  catalog?: OrcScoringOptionCatalog;
}) {
  const named = catalog?.[option];
  return named ? (
    <Fragment>{orcOptionLabel(option, catalog)}</Fragment>
  ) : (
    <span className="font-mono text-xs">{option}</span>
  );
}
