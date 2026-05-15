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
import type { NhcProfile } from '@/lib/types';
import { DEFAULT_NHC_PROFILE } from '@/lib/scoring';

/**
 * Edit the seven SWNHC2015 parameters for a single NHC fleet.
 *
 * Submitted value is `null` when the form matches `DEFAULT_NHC_PROFILE`
 * (the caller stores it as `nhcProfile: undefined` so unmodified fleets
 * stay clean and fall back to the engine default). The `name` field is
 * carried internally and held at the default `'NHC1 (Sailwave)'` — not
 * exposed in this cut; named profiles arrive with the future per-series
 * / per-workspace registry milestone.
 */
export type NhcProfileDialogProps = {
  open: boolean;
  fleetName: string;
  initial: NhcProfile | undefined;
  onClose: () => void;
  onSave: (next: NhcProfile | null) => void;
};

// Form state mirrors NhcProfile but as strings so partial edits don't
// re-derive across renders. Convert at submit time.
type FormState = {
  alphaP: string;
  alphaN: string;
  alphaPX: string;
  alphaNX: string;
  sdOver: string;
  sdUnder: string;
  minFin: string;
};

function toForm(p: NhcProfile): FormState {
  return {
    alphaP: String(p.alphaP),
    alphaN: String(p.alphaN),
    alphaPX: String(p.alphaPX),
    alphaNX: String(p.alphaNX),
    sdOver: String(p.sdOver),
    sdUnder: String(p.sdUnder),
    minFin: String(p.minFin),
  };
}

type ParseResult =
  | { ok: true; value: NhcProfile }
  | { ok: false; errors: Partial<Record<keyof FormState, string>> };

function parseForm(form: FormState, name: string): ParseResult {
  const errors: Partial<Record<keyof FormState, string>> = {};
  const inUnit = (k: keyof FormState, v: number) => {
    if (!Number.isFinite(v) || v <= 0 || v > 1) errors[k] = '0 < α ≤ 1';
    return v;
  };
  const positive = (k: keyof FormState, v: number) => {
    if (!Number.isFinite(v) || v <= 0) errors[k] = '> 0';
    return v;
  };
  const intGte1 = (k: keyof FormState, v: number) => {
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < 1) errors[k] = 'integer ≥ 1';
    return v;
  };

  const parsed: NhcProfile = {
    name,
    alphaP: inUnit('alphaP', Number(form.alphaP)),
    alphaN: inUnit('alphaN', Number(form.alphaN)),
    alphaPX: inUnit('alphaPX', Number(form.alphaPX)),
    alphaNX: inUnit('alphaNX', Number(form.alphaNX)),
    sdOver: positive('sdOver', Number(form.sdOver)),
    sdUnder: positive('sdUnder', Number(form.sdUnder)),
    minFin: intGte1('minFin', Number(form.minFin)),
  };
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: parsed };
}

function profilesEqual(a: NhcProfile, b: NhcProfile): boolean {
  return (
    a.alphaP === b.alphaP &&
    a.alphaN === b.alphaN &&
    a.alphaPX === b.alphaPX &&
    a.alphaNX === b.alphaNX &&
    a.sdOver === b.sdOver &&
    a.sdUnder === b.sdUnder &&
    a.minFin === b.minFin
  );
}

export function NhcProfileDialog({ open, fleetName, initial, onClose, onSave }: NhcProfileDialogProps) {
  // Mount the form body fresh on every open so each session starts from the
  // current `initial` value without a setState-in-effect reset (rule:
  // react-hooks/set-state-in-effect). The empty fragment when closed also
  // means we don't render seven inputs into a hidden dialog.
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        {open && (
          <NhcProfileForm
            fleetName={fleetName}
            initial={initial}
            onClose={onClose}
            onSave={onSave}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function NhcProfileForm({
  fleetName,
  initial,
  onClose,
  onSave,
}: {
  fleetName: string;
  initial: NhcProfile | undefined;
  onClose: () => void;
  onSave: (next: NhcProfile | null) => void;
}) {
  const seed = initial ?? DEFAULT_NHC_PROFILE;
  const [form, setForm] = useState<FormState>(() => toForm(seed));
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  function update(key: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function handleRestoreDefaults() {
    setForm(toForm(DEFAULT_NHC_PROFILE));
    setErrors({});
  }

  function handleSave() {
    // Preserve the original profile name if one was carried in; otherwise
    // adopt the default name. (`name` isn't surfaced in the UI yet.)
    const name = initial?.name ?? DEFAULT_NHC_PROFILE.name;
    const result = parseForm(form, name);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    // Store `null` when parameters match the engine default, so the caller can
    // clear `nhcProfile` on the fleet and keep unmodified fleets clean.
    const next = profilesEqual(result.value, { ...DEFAULT_NHC_PROFILE, name })
      ? null
      : result.value;
    onSave(next);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>NHC parameters — {fleetName}</DialogTitle>
        <DialogDescription>
          Override the SWNHC2015 blend rates and extreme thresholds for this fleet.
          Defaults reproduce Sailwave NHC1 to 3 dp. Editing recomputes the fleet&apos;s
          handicap history automatically.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2 text-sm">
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Blend rates</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="α non-extreme over" hint="α_p, default 0.300" id="alphaP" value={form.alphaP} onChange={update} error={errors.alphaP} />
            <Field label="α non-extreme under" hint="α_n, default 0.150" id="alphaN" value={form.alphaN} onChange={update} error={errors.alphaN} />
            <Field label="α extreme over" hint="α_px, default 0.150" id="alphaPX" value={form.alphaPX} onChange={update} error={errors.alphaPX} />
            <Field label="α extreme under" hint="α_nx, default 0.075" id="alphaNX" value={form.alphaNX} onChange={update} error={errors.alphaNX} />
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Extreme thresholds (SDs of S = Q/H)</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="σ over" hint="default 1.5" id="sdOver" value={form.sdOver} onChange={update} error={errors.sdOver} />
            <Field label="σ under" hint="default 1.0" id="sdUnder" value={form.sdUnder} onChange={update} error={errors.sdUnder} />
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Minimum finishers</p>
          <Field label="MinFin" hint="default 3 — skip update if fewer finish" id="minFin" value={form.minFin} onChange={update} error={errors.minFin} step="1" />
        </div>
      </div>

      <DialogFooter className="flex-row justify-between sm:justify-between">
        <Button type="button" variant="ghost" onClick={handleRestoreDefaults}>
          Restore defaults
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={handleSave}>Save</Button>
        </div>
      </DialogFooter>
    </>
  );
}

function Field({
  label,
  hint,
  id,
  value,
  onChange,
  error,
  step = '0.001',
}: {
  label: string;
  hint: string;
  id: keyof FormState;
  value: string;
  onChange: (id: keyof FormState, value: string) => void;
  error?: string;
  step?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs">{label}</span>
      <Input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(id, e.target.value)}
        className={`h-7 text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none${error ? ' border-destructive' : ''}`}
        title={hint}
        data-testid={`nhc-profile-${id}`}
      />
      <span className={`text-[10px] ${error ? 'text-destructive' : 'text-muted-foreground'}`}>
        {error ?? hint}
      </span>
    </label>
  );
}
