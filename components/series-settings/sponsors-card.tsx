'use client';

import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DragHandle, SortableList } from '@/components/ui/sortable-list';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AutosaveNote } from '@/components/series-settings/autosave-note';
import { LogoField } from '@/components/series-settings/logo-field';
import { useSettingsAutosave } from '@/hooks/use-settings-autosave';
import { useUpdateSeries } from '@/hooks/use-series';
import {
  SPONSOR_KIND_LABEL,
  SPONSOR_KINDS,
  SPONSOR_NAME_MAX_LENGTH,
  SPONSOR_URL_MAX_LENGTH,
  SPONSORS_MAX,
  sponsorsSummary,
  tidySponsors,
} from '@/lib/series-sponsors';
import type { Series, SeriesSponsor, SeriesSponsorKind } from '@/lib/types';

/** A row being edited: the entry plus a key that keeps it stable while the
 *  list is reordered. The key is never stored. */
type Row = SeriesSponsor & { id: string };

function toRows(sponsors: SeriesSponsor[] | undefined): Row[] {
  return (sponsors ?? []).map((s) => ({ ...s, id: crypto.randomUUID() }));
}

/**
 * The series' sponsors and trophy donors, named under the header of every
 * published page. Each entry is a name, a kind, and optionally a logo and a
 * website. Rows drag, since the order is the order they are shown in.
 *
 * Saved as the scorer types, like the other cards; a row with no name yet is
 * kept in the draft but left out of what is written.
 */
export function SponsorsCard({ seriesId, series }: { seriesId: string; series: Series }) {
  const updateSeries = useUpdateSeries();
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<Row[]>(() => toRows(series.sponsors));
  // The rows as last changed, read by `update` so two changes in one event —
  // picking a library logo sets the logo and defaults the website — compose
  // rather than the second overwriting the first from a stale render.
  const latest = useRef(rows);
  const autosave = useSettingsAutosave<{ sponsors: SeriesSponsor[] }>({
    save: (patch) =>
      updateSeries.mutateAsync({
        id: seriesId,
        patch: { ...patch, lastModifiedAt: Date.now() },
      }),
  });

  // Re-sync when the stored list changes identity, but only while the card is
  // closed: open, the draft is authoritative, and an echo of our own write
  // would reset it backward mid-typing.
  const [prevSponsors, setPrevSponsors] = useState(series.sponsors);
  if (prevSponsors !== series.sponsors) {
    setPrevSponsors(series.sponsors);
    if (!expanded) setRows(toRows(series.sponsors));
  }
  // A re-sync replaces the rows from outside an event; the ref follows.
  useEffect(() => {
    latest.current = rows;
  }, [rows]);

  function change(next: Row[], opts?: { defer?: boolean }) {
    latest.current = next;
    setRows(next);
    autosave.commit(
      { sponsors: tidySponsors(next.map(({ id: _id, ...s }) => s)) },
      { defer: opts?.defer ?? true },
    );
  }

  function update(index: number, patch: Partial<SeriesSponsor>, opts?: { defer?: boolean }) {
    change(latest.current.map((r, i) => (i === index ? { ...r, ...patch } : r)), opts);
  }

  return (
    <div className="bg-card border rounded-lg p-5 space-y-4" data-testid="sponsors-card">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Sponsors</h2>
        {!expanded && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            Edit ▸
          </Button>
        )}
      </div>
      {!expanded ? (
        <p className="text-sm text-muted-foreground">{sponsorsSummary(series.sponsors)}</p>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Named under the title of every published page: &ldquo;Sponsored by
            …&rdquo;, then &ldquo;Trophy presented by …&rdquo; for trophy
            donors. An entry with a logo shows the logo instead of its name.
          </p>

          <SortableList
            items={rows}
            onReorder={(orderedIds) =>
              change(orderedIds.map((id) => rows.find((r) => r.id === id)!), { defer: false })
            }
          >
            {(row, { ref, style, handleProps }) => {
              const index = rows.indexOf(row);
              const n = index + 1;
              return (
                <div
                  key={row.id}
                  ref={ref as React.Ref<HTMLDivElement>}
                  style={style}
                  className="rounded-md border p-3 space-y-3 bg-card"
                  data-testid={`sponsor-row-${index}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <DragHandle
                      {...handleProps}
                      aria-label={`Reorder sponsor ${n}`}
                      data-testid={`sponsor-drag-${index}`}
                    />
                    <Input
                      id={`sponsor-name-${index}`}
                      className="h-8 min-w-36 flex-1"
                      value={row.name}
                      maxLength={SPONSOR_NAME_MAX_LENGTH}
                      placeholder="Name, as it should appear"
                      aria-label={`Name of sponsor ${n}`}
                      onChange={(e) => update(index, { name: e.target.value })}
                    />
                    <Select
                      value={row.kind}
                      onValueChange={(kind) =>
                        update(index, { kind: kind as SeriesSponsorKind }, { defer: false })
                      }
                    >
                      <SelectTrigger
                        id={`sponsor-kind-${index}`}
                        className="h-8 w-36"
                        aria-label={`Kind of sponsor ${n}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SPONSOR_KINDS.map((kind) => (
                          <SelectItem key={kind} value={kind}>
                            {SPONSOR_KIND_LABEL[kind]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      aria-label={`Remove sponsor ${n}`}
                      onClick={() => change(rows.filter((_, i) => i !== index), { defer: false })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <LogoField
                    id={`sponsor-logo-${index}`}
                    label="Logo"
                    value={row.logoUrl ?? ''}
                    onChange={(logoUrl) => update(index, { logoUrl })}
                    onPickHomepage={(homepage) => {
                      if (!latest.current[index]?.url?.trim()) update(index, { url: homepage });
                    }}
                  />
                  <div className="space-y-1.5">
                    <Label htmlFor={`sponsor-url-${index}`}>Website</Label>
                    <Input
                      id={`sponsor-url-${index}`}
                      type="url"
                      value={row.url ?? ''}
                      maxLength={SPONSOR_URL_MAX_LENGTH}
                      placeholder="https://…"
                      onChange={(e) => update(index, { url: e.target.value })}
                    />
                  </div>
                </div>
              );
            }}
          </SortableList>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={rows.length >= SPONSORS_MAX}
              data-testid="add-sponsor"
              onClick={() => {
                const next: Row[] = [...latest.current, { id: crypto.randomUUID(), name: '', kind: 'sponsor' }];
                latest.current = next;
                setRows(next);
              }}
            >
              Add sponsor
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                autosave.flush();
                setExpanded(false);
              }}
            >
              Done
            </Button>
            <AutosaveNote status={autosave.status} />
          </div>
        </div>
      )}
    </div>
  );
}
