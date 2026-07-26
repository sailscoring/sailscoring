'use client';

// Format chooser for enabling split fleets on a series: pick the class's
// standard sailing-instructions format, the qualifying fleet count, and the
// medal race, with an explanation that restates the chosen configuration in
// plain words. Shared by the Settings enable path and the setup wizard.

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useSaveSplitFleetConfig } from '@/hooks/use-split-fleets';
import {
  defaultSplitFleetConfig,
  iodaSplitFleetConfig,
  type SplitFleetConfig,
} from '@/lib/split-fleets';

type FormatKey = 'ilca' | 'ioda';

const FORMATS: Record<
  FormatKey,
  {
    label: string;
    build: (fleetCount: number) => SplitFleetConfig;
    medalDefault: { on: boolean; size: number };
    discardsSentence: string;
  }
> = {
  ilca: {
    label: 'ILCA World/European Championship',
    build: defaultSplitFleetConfig,
    medalDefault: { on: true, size: 10 },
    discardsSentence:
      'One discard after 4 races, a second after 10 — at most one from the final series, and a lone final race is never discarded.',
  },
  ioda: {
    label: 'IODA Championship',
    build: iodaSplitFleetConfig,
    medalDefault: { on: false, size: 10 },
    discardsSentence:
      'One discard after 5 races — at most one from the final series, and a lone final race is never discarded.',
  },
};

const FLEET_LABELS = ['Yellow', 'Blue', 'Red', 'Green'];
const FINAL_LABELS = ['Gold', 'Silver', 'Bronze', 'Emerald'];

export function SplitFleetSetup({
  seriesId,
  canManage,
  onEnabled,
}: {
  seriesId: string;
  canManage: boolean;
  /** Called after the config is saved (e.g. to navigate to the tab). */
  onEnabled?: () => void;
}) {
  const saveConfig = useSaveSplitFleetConfig(seriesId);
  const [format, setFormat] = useState<FormatKey>('ilca');
  const [fleetCount, setFleetCount] = useState(3);
  const [medalOn, setMedalOn] = useState(FORMATS.ilca.medalDefault.on);
  const [medalSize, setMedalSize] = useState(FORMATS.ilca.medalDefault.size);

  const def = FORMATS[format];

  function pickFormat(next: FormatKey) {
    setFormat(next);
    setMedalOn(FORMATS[next].medalDefault.on);
    setMedalSize(FORMATS[next].medalDefault.size);
  }

  async function enable() {
    const config = def.build(fleetCount);
    config.medal = medalOn
      ? { size: medalSize, raceCount: 1, multiplier: 2 }
      : undefined;
    await saveConfig.mutateAsync(config);
    onEnabled?.();
  }

  const qualifying = FLEET_LABELS.slice(0, fleetCount).join(', ');
  const finals = FINAL_LABELS.slice(0, fleetCount).join('/');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="text-sm" htmlFor="sf-format">Format</label>
        <select
          id="sf-format"
          className="max-w-full rounded-md border bg-background px-2 py-1 text-sm"
          value={format}
          onChange={(e) => pickFormat(e.target.value as FormatKey)}
        >
          {(Object.keys(FORMATS) as FormatKey[]).map((k) => (
            <option key={k} value={k}>{FORMATS[k].label}</option>
          ))}
        </select>
        <label className="text-sm" htmlFor="sf-fleet-count">Qualifying fleets</label>
        <select
          id="sf-fleet-count"
          className="max-w-full rounded-md border bg-background px-2 py-1 text-sm"
          value={fleetCount}
          onChange={(e) => setFleetCount(Number(e.target.value))}
        >
          {[2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n} — {FLEET_LABELS.slice(0, n).join(', ')}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={medalOn}
            onChange={(e) => setMedalOn(e.target.checked)}
          />
          Medal race
        </label>
        {medalOn && (
          <>
            <span className="text-sm text-muted-foreground">for the top</span>
            <input
              type="number"
              aria-label="Medal fleet size"
              min={2}
              className="w-16 rounded-md border bg-background px-2 py-1 text-sm"
              value={medalSize}
              onChange={(e) => setMedalSize(Math.max(2, parseInt(e.target.value) || 2))}
            />
          </>
        )}
        <span className="text-xs text-muted-foreground">— changeable later in Settings</span>
      </div>
      <p className="text-sm text-muted-foreground">
        Competitors race in {fleetCount} qualifying fleets ({qualifying}),
        reassigned by series rank after each day of racing, then split by
        qualifying rank into {finals} for the final series. DNC/DNS/DNF in
        qualifying score on the largest qualifying fleet.{' '}
        {def.discardsSentence}
        {medalOn &&
          ` Medal race for the top ${medalSize}: double points, never discarded; the rest of ${FINAL_LABELS[0]} sail a companion last race.`}
      </p>
      <div className="flex items-center gap-2">
        <Button disabled={!canManage || saveConfig.isPending} onClick={enable}>
          {saveConfig.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Enable split fleets
        </Button>
      </div>
      {saveConfig.isError && (
        <p className="text-destructive text-sm">{String(saveConfig.error)}</p>
      )}
    </div>
  );
}
