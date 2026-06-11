'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUpdateSeries } from '@/hooks/use-series';
import {
  ALL_COMPETITOR_FIELDS,
  COMPETITOR_FIELD_LABELS,
  DEFAULT_PRIMARY_PERSON_LABEL,
  DEFAULT_SUBDIVISION_LABEL,
  PRIMARY_PERSON_LABELS,
  PRIMARY_PERSON_LABEL_HINTS,
  PRIMARY_PERSON_LABEL_TEXT,
  SUBDIVISION_LABEL_MAX_LENGTH,
  SUBDIVISION_LABEL_PRESETS,
  defaultEnabledCompetitorFields,
  isFieldDisabledByPrimary,
} from '@/lib/competitor-fields';
import type { CompetitorFieldKey, PrimaryPersonLabel, Series } from '@/lib/types';

export function CompetitorFieldsCard({ seriesId, series }: { seriesId: string; series: Series }) {
  const updateSeries = useUpdateSeries();
  const [expanded, setExpanded] = useState(false);
  // Mirror the persisted array into local state so the checkbox updates
  // instantly on click — the async save that follows would otherwise leave
  // the controlled <input> at the old value until the query refetches.
  const persisted = series.enabledCompetitorFields ?? defaultEnabledCompetitorFields();
  const primaryLabel: PrimaryPersonLabel = series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL;
  const [localEnabled, setLocalEnabled] = useState<CompetitorFieldKey[]>(persisted);
  // Re-sync when the persisted fields actually change. Render-time compare
  // (not an effect) so this works cleanly with the React Compiler. See
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const persistedKey = persisted.join(',');
  const [prevPersistedKey, setPrevPersistedKey] = useState(persistedKey);
  if (prevPersistedKey !== persistedKey) {
    setPrevPersistedKey(persistedKey);
    setLocalEnabled(persisted);
  }
  const enabledSet = new Set<CompetitorFieldKey>(localEnabled);

  // Subdivision label, mirrored locally so the text input stays responsive
  // while the controlled value catches up to the async save (same pattern as
  // the enabled-fields array above).
  const persistedSubdivisionLabel = series.subdivisionLabel ?? DEFAULT_SUBDIVISION_LABEL;
  const [localSubdivisionLabel, setLocalSubdivisionLabel] = useState(persistedSubdivisionLabel);
  const [prevSubdivisionLabel, setPrevSubdivisionLabel] = useState(persistedSubdivisionLabel);
  if (prevSubdivisionLabel !== persistedSubdivisionLabel) {
    setPrevSubdivisionLabel(persistedSubdivisionLabel);
    setLocalSubdivisionLabel(persistedSubdivisionLabel);
  }

  async function toggle(field: CompetitorFieldKey, checked: boolean) {
    const next = new Set(enabledSet);
    if (checked) next.add(field); else next.delete(field);
    const nextArray = ALL_COMPETITOR_FIELDS.filter((f) => next.has(f));
    setLocalEnabled(nextArray);
    await updateSeries.mutateAsync({
      id: seriesId,
      patch: {
        enabledCompetitorFields: nextArray,
        // eslint-disable-next-line react-hooks/purity -- Date.now() runs inside an async event handler, not render.
        lastModifiedAt: Date.now(),
      },
    });
  }

  async function changePrimary(label: PrimaryPersonLabel) {
    await updateSeries.mutateAsync({
      id: seriesId,
      patch: {
        primaryPersonLabel: label,
        // eslint-disable-next-line react-hooks/purity -- Date.now() runs inside an async event handler, not render.
        lastModifiedAt: Date.now(),
      },
    });
  }

  // Commit a subdivision label. Empty/whitespace falls back to the default so
  // the field always has a usable heading. No-op when nothing changed.
  async function commitSubdivisionLabel(raw: string) {
    const trimmed = raw.trim().slice(0, SUBDIVISION_LABEL_MAX_LENGTH) || DEFAULT_SUBDIVISION_LABEL;
    setLocalSubdivisionLabel(trimmed);
    if (trimmed === persistedSubdivisionLabel) return;
    await updateSeries.mutateAsync({
      id: seriesId,
      patch: {
        subdivisionLabel: trimmed,
        lastModifiedAt: Date.now(),
      },
    });
  }

  const primaryFieldLabel = PRIMARY_PERSON_LABEL_TEXT[primaryLabel];
  // The subdivision field's heading is the scorer-chosen label; every other
  // field uses its static label.
  const fieldDisplayLabel = (f: CompetitorFieldKey) =>
    f === 'subdivision' ? localSubdivisionLabel : COMPETITOR_FIELD_LABELS[f];
  const shownLabels = ALL_COMPETITOR_FIELDS
    .filter((f) => enabledSet.has(f) && !isFieldDisabledByPrimary(f, primaryLabel))
    .map((f) => fieldDisplayLabel(f));
  const summary = shownLabels.length === 0
    ? `Only sail number and ${primaryFieldLabel.toLowerCase()}`
    : `Sail, ${primaryFieldLabel}, ${shownLabels.join(', ')}`;

  const fieldHints: Partial<Record<CompetitorFieldKey, string>> = {
    boatClass: 'Enable for PY fleets with mixed classes (Laser, Firefly, Mirror).',
    crewName: 'Enable for two-person classes (420, Fireball, GP14).',
    helm: 'Record the helm separately when the primary identifier is not the helm.',
    owner: 'Record the owner separately when the primary identifier is not the owner.',
    subdivision: 'A prize-giving subdivision within a fleet (e.g. Gold/Silver/Bronze, or age categories). Not used for scoring.',
  };

  return (
    <div className="bg-card border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Competitor fields</h2>
        {!expanded && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            Edit ▸
          </Button>
        )}
      </div>
      {!expanded ? (
        <p className="text-sm text-muted-foreground">{summary}</p>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Tip: when you import a CSV, the wizard proposes these settings automatically.
            Most scorers won’t need to configure this by hand.
          </p>
          <div className="space-y-2">
            <p className="text-sm font-medium">Primary identifier</p>
            <p className="text-xs text-muted-foreground">
              The required name on every competitor. Shown as a column heading throughout results.
            </p>
            <div className="space-y-1.5">
              {PRIMARY_PERSON_LABELS.map((label) => (
                <label key={label} className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="radio"
                    name="primaryPersonLabel"
                    value={label}
                    checked={primaryLabel === label}
                    onChange={() => changePrimary(label)}
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                  <div>
                    <span className="text-sm font-medium">{PRIMARY_PERSON_LABEL_TEXT[label]}</span>
                    <p className="text-xs text-muted-foreground mt-0.5">{PRIMARY_PERSON_LABEL_HINTS[label]}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2 pt-2 border-t">
            <p className="text-sm font-medium">Optional fields</p>
            <p className="text-xs text-muted-foreground">
              Toggle the optional fields you want displayed in the competitor list, standings, and exported results.
            </p>
            {ALL_COMPETITOR_FIELDS.map((field) => {
              const disabledByPrimary = isFieldDisabledByPrimary(field, primaryLabel);
              return (
                <div
                  key={field}
                  className={`flex items-start gap-2.5 ${disabledByPrimary ? 'opacity-50' : ''}`}
                >
                  <input
                    id={`field-${field}`}
                    type="checkbox"
                    checked={enabledSet.has(field) && !disabledByPrimary}
                    onChange={(e) => toggle(field, e.target.checked)}
                    disabled={disabledByPrimary}
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                  <div>
                    <label htmlFor={`field-${field}`} className="text-sm font-medium cursor-pointer">
                      {fieldDisplayLabel(field)}
                    </label>
                    {disabledByPrimary ? (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Already the primary identifier.
                      </p>
                    ) : fieldHints[field] ? (
                      <p className="text-xs text-muted-foreground mt-0.5">{fieldHints[field]}</p>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {enabledSet.has('subdivision') && (
              <div className="ml-6 mt-1 space-y-1.5 border-l pl-3">
                <Label htmlFor="subdivision-label" className="text-sm font-medium">
                  Subdivision label
                </Label>
                <p className="text-xs text-muted-foreground">
                  What to call this field in the competitor list, standings, and results.
                </p>
                <Input
                  id="subdivision-label"
                  value={localSubdivisionLabel}
                  maxLength={SUBDIVISION_LABEL_MAX_LENGTH}
                  onChange={(e) => setLocalSubdivisionLabel(e.target.value)}
                  onBlur={(e) => commitSubdivisionLabel(e.target.value)}
                  className="max-w-xs"
                />
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {SUBDIVISION_LABEL_PRESETS.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      variant={localSubdivisionLabel === preset ? 'secondary' : 'outline'}
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => commitSubdivisionLabel(preset)}
                    >
                      {preset}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => setExpanded(false)}>
            Done
          </Button>
        </div>
      )}
    </div>
  );
}
