'use client';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { PerFleetPointsValue } from '@/lib/per-fleet-points';

export interface PerFleetPointsProps {
  /** Field label, e.g. "Points" or "Points to add". */
  label: string;
  /** The fleets the boat is entered in. One fleet renders a plain input with
   *  no per-fleet chrome; two or more enable the progressive disclosure. */
  fleets: { id: string; name: string }[];
  value: PerFleetPointsValue;
  onChange: (v: PerFleetPointsValue) => void;
  min?: number;
  placeholder?: string;
  autoFocus?: boolean;
  /** Called when Enter is pressed in the single (uniform) input. */
  onSubmit?: () => void;
}

/**
 * Editor for a scorer-stated point value that may differ per fleet (per-fleet
 * RDG stated points / DPI points). Collapses to a single input for a one-fleet
 * boat; for multi-fleet boats it defaults to one value applied to all fleets,
 * with a toggle to set each fleet individually.
 */
export function PerFleetPoints({
  label,
  fleets,
  value,
  onChange,
  min = 0,
  placeholder,
  autoFocus,
  onSubmit,
}: PerFleetPointsProps) {
  const multiFleet = fleets.length > 1;

  // Single fleet (or none): plain input, no per-fleet affordance at all.
  if (!multiFleet) {
    const v = value.mode === 'uniform' ? value.value : Object.values(value.values)[0] ?? '';
    return (
      <div className="space-y-1.5">
        <label className="text-sm font-medium">{label}</label>
        <Input
          type="number"
          min={min}
          step="0.1"
          placeholder={placeholder}
          value={v}
          onChange={(e) => onChange({ mode: 'uniform', value: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter' && onSubmit) { e.preventDefault(); onSubmit(); } }}
          autoFocus={autoFocus}
        />
      </div>
    );
  }

  if (value.mode === 'uniform') {
    const expand = () => {
      // Prefill every fleet with the current uniform value, so editing one
      // fleet's exception is a single change rather than retyping all of them.
      const values: Record<string, string> = {};
      for (const f of fleets) values[f.id] = value.value;
      onChange({ mode: 'perFleet', values });
    };
    return (
      <div className="space-y-1.5">
        <label className="text-sm font-medium">{label}</label>
        <Input
          type="number"
          min={min}
          step="0.1"
          placeholder={placeholder}
          value={value.value}
          onChange={(e) => onChange({ mode: 'uniform', value: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter' && onSubmit) { e.preventDefault(); onSubmit(); } }}
          autoFocus={autoFocus}
        />
        <p className="text-xs text-muted-foreground">
          Applies to all {fleets.length} fleets ·{' '}
          <button type="button" className="text-primary hover:underline" onClick={expand}>
            Set points per fleet
          </button>
        </p>
      </div>
    );
  }

  // Per-fleet mode: one row per fleet, capped height so the dialog never grows
  // unbounded for boats in many fleets.
  const collapse = () => {
    const first = fleets.map((f) => value.values[f.id]).find((v) => v?.trim()) ?? '';
    onChange({ mode: 'uniform', value: first });
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">{label} per fleet</label>
        <button type="button" className="text-xs text-primary hover:underline" onClick={collapse}>
          Same for all
        </button>
      </div>
      <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
        {fleets.map((f) => (
          <div key={f.id} className="flex items-center gap-2">
            <span className="flex-1 truncate text-sm" title={f.name}>{f.name}</span>
            <Input
              type="number"
              min={min}
              step="0.1"
              placeholder={placeholder}
              className={cn('w-24')}
              value={value.values[f.id] ?? ''}
              onChange={(e) => onChange({ mode: 'perFleet', values: { ...value.values, [f.id]: e.target.value } })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
