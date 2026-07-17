'use client';

import { useState } from 'react';
import { useIsMutating } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { seriesRowMutationKey, useUpdateSeries } from '@/hooks/use-series';
import {
  ALL_COMPETITOR_FIELDS,
  COMPETITOR_FIELD_LABELS,
  DEFAULT_PRIMARY_PERSON_LABEL,
  DEFAULT_SUBDIVISION_LABEL,
  PRIMARY_PERSON_LABELS,
  PRIMARY_PERSON_LABEL_HINTS,
  PRIMARY_PERSON_LABEL_TEXT,
  SUBDIVISION_LABEL_MAX_LENGTH,
  defaultEnabledCompetitorFields,
  isFieldDisabledByPrimary,
  newSubdivisionAxis,
  subdivisionAxes,
  subdivisionAxisLabel,
} from '@/lib/competitor-fields';
import type {
  CompetitorFieldKey,
  PrimaryPersonLabel,
  Series,
  SubdivisionAxis,
} from '@/lib/types';

export function CompetitorFieldsCard({ seriesId, series }: { seriesId: string; series: Series }) {
  const updateSeries = useUpdateSeries();
  const [expanded, setExpanded] = useState(false);
  // Mirror the persisted array into local state so the checkbox updates
  // instantly on click — the async save that follows would otherwise leave
  // the controlled <input> at the old value until the query refetches.
  const persisted = series.enabledCompetitorFields ?? defaultEnabledCompetitorFields();
  const primaryLabel: PrimaryPersonLabel = series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL;
  const [localEnabled, setLocalEnabled] = useState<CompetitorFieldKey[]>(persisted);
  // While a series-row save is pending or queued, the cached row can lag the
  // local edits — an earlier save's onSuccess lands a row that predates a
  // later toggle, and re-syncing from it would visibly revert the toggle
  // until its own save lands. Defer the re-sync until the queue drains;
  // useIsMutating re-renders this card when the count changes, so the
  // deferred compare below fires against the final row.
  const savesInFlight = useIsMutating({ mutationKey: seriesRowMutationKey }) > 0;
  // Re-sync when the persisted fields actually change. Render-time compare
  // (not an effect) so this works cleanly with the React Compiler. See
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const persistedKey = persisted.join(',');
  const [prevPersistedKey, setPrevPersistedKey] = useState(persistedKey);
  if (prevPersistedKey !== persistedKey && !savesInFlight) {
    setPrevPersistedKey(persistedKey);
    setLocalEnabled(persisted);
  }
  const enabledSet = new Set<CompetitorFieldKey>(localEnabled);

  // Subdivision axes, mirrored locally so the text inputs stay responsive
  // while the controlled value catches up to the async save (same pattern as
  // the enabled-fields array above).
  const persistedAxes = subdivisionAxes(series);
  const [localAxes, setLocalAxes] = useState<SubdivisionAxis[]>(persistedAxes);
  // Re-sync only when the *set of axes* changes (add/remove), keyed on ids — not
  // on labels. Keying on labels would let the refetch after an add clobber a
  // rename the scorer is mid-typing on a sibling axis.
  const axesKey = persistedAxes.map((a) => a.id).join(',');
  const [prevAxesKey, setPrevAxesKey] = useState(axesKey);
  if (prevAxesKey !== axesKey && !savesInFlight) {
    setPrevAxesKey(axesKey);
    setLocalAxes(persistedAxes);
  }

  async function persistAxes(next: SubdivisionAxis[]) {
    setLocalAxes(next);
    await updateSeries.mutateAsync({
      id: seriesId,
      patch: {
        subdivisionAxes: next,
        // eslint-disable-next-line react-hooks/purity -- Date.now() runs inside an async event handler, not render.
        lastModifiedAt: Date.now(),
      },
    });
  }

  async function addAxis() {
    await persistAxes([...localAxes, newSubdivisionAxis(DEFAULT_SUBDIVISION_LABEL)]);
  }

  async function removeAxis(id: string) {
    await persistAxes(localAxes.filter((a) => a.id !== id));
  }

  // Commit an axis label. Empty/whitespace falls back to the default so the
  // column always has a usable heading. Compares against the *persisted* label
  // (not local, which the controlled input has already updated) so a real edit
  // isn't mistaken for a no-op; an unchanged label just normalises locally.
  async function commitAxisLabel(id: string, raw: string) {
    const trimmed = raw.trim().slice(0, SUBDIVISION_LABEL_MAX_LENGTH) || DEFAULT_SUBDIVISION_LABEL;
    const next = localAxes.map((a) => (a.id === id ? { ...a, label: trimmed } : a));
    const persisted = persistedAxes.find((a) => a.id === id);
    if (persisted && trimmed === persisted.label) {
      setLocalAxes(next);
      return;
    }
    await persistAxes(next);
  }

  async function toggle(field: CompetitorFieldKey, checked: boolean) {
    const next = new Set(enabledSet);
    if (checked) next.add(field); else next.delete(field);
    setLocalEnabled(ALL_COMPETITOR_FIELDS.filter((f) => next.has(f)));
    // Functional patch: derive the new list from the row the save actually
    // lands on, not from the prop this card was rendered with — a stale prop
    // here can resurrect a field another in-flight save just removed.
    await updateSeries.mutateAsync({
      id: seriesId,
      patch: (current) => {
        const fields = new Set(current.enabledCompetitorFields ?? defaultEnabledCompetitorFields());
        if (checked) fields.add(field); else fields.delete(field);
        return {
          enabledCompetitorFields: ALL_COMPETITOR_FIELDS.filter((f) => fields.has(f)),
          lastModifiedAt: Date.now(),
        };
      },
    });
    // Enabling the subdivision field with no axes yet seeds a first axis so the
    // column is immediately usable.
    if (checked && field === 'subdivision' && localAxes.length === 0) {
      await addAxis();
    }
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

  const primaryFieldLabel = PRIMARY_PERSON_LABEL_TEXT[primaryLabel];
  // The subdivision field heads its own axes editor below. In the field list it
  // shows the single axis label when there's exactly one, the static default
  // ("Division") when none is configured yet, and a generic plural for several.
  const subdivisionListLabel =
    localAxes.length === 1
      ? subdivisionAxisLabel(localAxes[0])
      : localAxes.length === 0
        ? COMPETITOR_FIELD_LABELS.subdivision
        : 'Subdivisions';
  const fieldDisplayLabel = (f: CompetitorFieldKey) =>
    f === 'subdivision' ? subdivisionListLabel : COMPETITOR_FIELD_LABELS[f];
  const shownLabels = ALL_COMPETITOR_FIELDS
    .filter((f) => enabledSet.has(f) && !isFieldDisabledByPrimary(f, primaryLabel))
    .map((f) => fieldDisplayLabel(f));
  const summary = shownLabels.length === 0
    ? `Only sail number and ${primaryFieldLabel.toLowerCase()}`
    : `Sail, ${primaryFieldLabel}, ${shownLabels.join(', ')}`;

  const fieldHints: Partial<Record<CompetitorFieldKey, string>> = {
    boatClass: 'Enable for PY fleets with mixed classes (Laser, Firefly, Mirror).',
    crewName: 'Enable for classes that sail with crew — a single dinghy crew or a full keelboat crew.',
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
              <div className="ml-6 mt-1 space-y-2 border-l pl-3">
                <Label className="text-sm font-medium">Subdivision axes</Label>
                <p className="text-xs text-muted-foreground">
                  Each axis is an independent prize-giving grouping (e.g. a Division of
                  Gold/Silver and an age Category of Youth/Master). Each becomes a column in
                  the competitor list, standings, and results.
                </p>
                {localAxes.map((axis, i) => (
                  <div key={axis.id} className="flex items-center gap-2">
                    {/* Uncontrolled (defaultValue + key): a re-sync from the
                        refetch after add/remove can't clobber a label the scorer
                        is mid-typing on a sibling axis. */}
                    <Input
                      key={axis.id}
                      aria-label={`Axis ${i + 1} label`}
                      defaultValue={axis.label}
                      maxLength={SUBDIVISION_LABEL_MAX_LENGTH}
                      onBlur={(e) => commitAxisLabel(axis.id, e.target.value)}
                      placeholder="e.g. Division"
                      className="max-w-xs"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs text-muted-foreground"
                      onClick={() => removeAxis(axis.id)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={addAxis}
                >
                  Add axis
                </Button>
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
