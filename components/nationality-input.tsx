'use client';

import { useId, useMemo } from 'react';

import { NATIONAL_CODES, lookupAlias, lookupCode, normalizeCodeInput } from '@/lib/nationality';
import { Input } from '@/components/ui/input';

interface Props {
  /** Always uppercase canonical code (or '' for empty). Parent owns the state. */
  value: string;
  /** Fired on every keystroke with the normalized (uppercased, trimmed) value.
   *  On blur the parent receives the alias-resolved canonical, if any. */
  onChange: (next: string) => void;
  /** Optional input id — auto-generated when omitted so multiple inputs on a
   *  page get distinct datalists. */
  id?: string;
}

/** 3-letter national-letters input with a datalist of every canonical code
 *  (RRS Appendix G + sailing-extended). Free text is permitted at the input
 *  layer for forward-compat with future dataset bumps; the inline hint
 *  flags codes that aren't in the current dataset so the scorer can spot a
 *  typo without being blocked. */
export function NationalityInput({ value, onChange, id }: Props) {
  const autoId = useId();
  const inputId = id ?? `nationality-${autoId}`;
  const listId = `${inputId}-codes`;

  const hint = useMemo(() => {
    if (!value) return null;
    const known = lookupCode(value);
    if (known) return `${known.name}`;
    if (!/^[A-Z]{3}$/.test(value)) return 'Use a 3-letter code, e.g. IRL.';
    return 'Not in the national-letters dataset — saved as entered.';
  }, [value]);

  return (
    <>
      <Input
        id={inputId}
        list={listId}
        value={value}
        maxLength={3}
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="e.g. IRL"
        className="font-mono uppercase"
        onChange={(e) => onChange(normalizeCodeInput(e.target.value))}
        onBlur={(e) => {
          // Resolve Sailwave-style aliases on blur so the form persists the
          // canonical code (BVI → IVB) even when the scorer typed an alias.
          const norm = normalizeCodeInput(e.target.value);
          const alias = lookupAlias(norm);
          if (alias && alias.canonical !== norm) onChange(alias.canonical);
        }}
      />
      <datalist id={listId}>
        {NATIONAL_CODES.map((c) => (
          <option key={c.code} value={c.code} label={c.name} />
        ))}
      </datalist>
      {hint && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </>
  );
}
