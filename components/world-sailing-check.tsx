'use client';

import { forwardRef, useImperativeHandle, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSaveCompetitors } from '@/hooks/use-competitors';
import { checkWorldSailingIds } from '@/lib/api-repository';
import { formatPrimaryNames } from '@/lib/competitor-fields';
import type { Competitor } from '@/lib/types';
import { worldSailingProfileUrl } from '@/lib/world-sailing';
import type {
  DatafeedCheck,
  DatafeedPerson,
  WorldSailingCheckResult,
} from '@/lib/world-sailing-datafeed';

export interface WorldSailingCheckHandle {
  open: () => void;
}

type State =
  | { step: 'idle' }
  | { step: 'checking' }
  | { step: 'error'; message: string }
  | { step: 'results'; result: WorldSailingCheckResult };

/** Outcomes that need no attention — the ID is the sailor's, however the two
 *  lists spell them. */
function checksOut(check: DatafeedCheck): boolean {
  return check.outcome.status === 'valid' || check.outcome.status === 'spelling';
}

function outcomeLabel(check: DatafeedCheck): string {
  switch (check.outcome.status) {
    case 'valid':
      return 'Valid';
    case 'spelling':
      return 'Valid, spelled differently';
    case 'mismatch':
      return `Doesn't match on ${check.outcome.on.join(' and ')}`;
    case 'unknown':
      return 'World Sailing has no such ID';
    case 'malformed':
      return "Doesn't look like a Sailor ID";
    case 'unavailable':
      return "Couldn't check";
  }
}

/** Least to most reassuring, so the rows worth reading come first and the
 *  spelling differences sit together above the clean ones. */
function attentionRank(check: DatafeedCheck): number {
  if (check.outcome.status === 'valid') return 2;
  if (check.outcome.status === 'spelling') return 1;
  return 0;
}

/** The record's name and nation, as one readable phrase. */
function describe(name: string, nationality: string | undefined): string {
  return nationality ? `${name} (${nationality})` : name;
}

/** The person a resolved check found, if it found one. */
function personOf(check: DatafeedCheck): DatafeedPerson | undefined {
  const { outcome } = check;
  return 'person' in outcome ? outcome.person : undefined;
}

/**
 * Check every Sailor ID in the series against World Sailing's datafeed.
 *
 * Reports; it does not correct. A World Sailing record can be years out of
 * date and the entry list is what the event runs on, so the one fix offered
 * is filling in a nationality the scorer doesn't hold at all.
 */
export const WorldSailingCheck = forwardRef<WorldSailingCheckHandle, {
  seriesId: string;
  competitors: Competitor[];
}>(function WorldSailingCheck({ seriesId, competitors }, ref) {
  const [state, setState] = useState<State>({ step: 'idle' });
  const saveCompetitors = useSaveCompetitors();

  const byId = new Map(competitors.map((c) => [c.id, c]));

  async function run() {
    setState({ step: 'checking' });
    try {
      setState({ step: 'results', result: await checkWorldSailingIds(seriesId) });
    } catch (err) {
      setState({ step: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  useImperativeHandle(ref, () => ({ open: () => void run() }));

  /** Competitors whose nationality is blank where World Sailing holds one. */
  const fillableNationalities = (result: WorldSailingCheckResult) =>
    result.checks.flatMap((check) => {
      const nation = personOf(check)?.nationality;
      const c = byId.get(check.competitorId);
      if (!nation || !c || c.nationality) return [];
      return [{ competitor: c, nation }];
    });

  async function fillNationalities(result: WorldSailingCheckResult) {
    const fills = fillableNationalities(result);
    if (fills.length === 0) return;
    await saveCompetitors.mutateAsync(
      fills.map(({ competitor, nation }) => ({ ...competitor, nationality: nation })),
    );
    setState({ step: 'idle' });
  }

  const label = (id: string) => {
    const c = byId.get(id);
    return c ? `${formatPrimaryNames(c.names)} (${c.sailNumber})` : id;
  };

  /** What World Sailing holds, where that differs from what we hold. A row
   *  that agrees outright has nothing to compare. */
  const theirRecord = (check: DatafeedCheck) => {
    if (check.outcome.status === 'valid') return undefined;
    const person = personOf(check);
    if (!person) return undefined;
    const name = [person.givenName, person.familyName].filter(Boolean).join(' ');
    return name ? describe(name, person.nationality) : undefined;
  };

  /** What the entry list holds — worth spelling out beside a mismatch, since
   *  the nationality that differs isn't otherwise on screen. */
  const ourRecord = (id: string) => {
    const c = byId.get(id);
    return c ? describe(formatPrimaryNames(c.names), c.nationality) : id;
  };

  return (
    <>
      <Button variant="outline" disabled={state.step === 'checking'} onClick={() => void run()}>
        {state.step === 'checking' ? 'Checking…' : 'Check Sailor IDs'}
      </Button>

      {state.step === 'error' && (
        <Dialog open onOpenChange={() => setState({ step: 'idle' })}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Couldn&apos;t reach World Sailing</DialogTitle>
              <DialogDescription>{state.message}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => setState({ step: 'idle' })}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {state.step === 'results' && (
        <Dialog open onOpenChange={() => setState({ step: 'idle' })}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Sailor ID check</DialogTitle>
              <DialogDescription>
                {state.result.checks.filter(checksOut).length} of {state.result.checks.length}{' '}
                checked out.
                {state.result.withoutId.length > 0 &&
                  ` ${state.result.withoutId.length} competitor${state.result.withoutId.length === 1 ? ' has' : 's have'} no Sailor ID recorded.`}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[50vh] overflow-y-auto text-sm">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="pb-1">Competitor</th>
                    <th className="pb-1">Sailor ID</th>
                    <th className="pb-1">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {state.result.checks
                    // Problems first: a clean row needs no attention.
                    .slice()
                    .sort((a, b) => attentionRank(a) - attentionRank(b))
                    .map((check) => (
                      <tr key={check.competitorId} className="border-t">
                        <td className="py-1">{label(check.competitorId)}</td>
                        <td className="py-1 font-mono">
                          <a
                            href={worldSailingProfileUrl(check.worldSailingId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline underline-offset-2"
                          >
                            {check.worldSailingId}
                          </a>
                        </td>
                        <td className="py-1">
                          {outcomeLabel(check)}
                          {theirRecord(check) && (
                            <span className="block text-muted-foreground">
                              World Sailing has {theirRecord(check)}
                              {check.outcome.status === 'mismatch' &&
                                `, this entry has ${ourRecord(check.competitorId)}`}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <DialogFooter className="sm:justify-between">
              {fillableNationalities(state.result).length > 0 ? (
                <Button
                  variant="outline"
                  disabled={saveCompetitors.isPending}
                  onClick={() => void fillNationalities(state.result)}
                >
                  Fill {fillableNationalities(state.result).length} blank nationalit
                  {fillableNationalities(state.result).length === 1 ? 'y' : 'ies'}
                </Button>
              ) : (
                <span />
              )}
              <Button onClick={() => setState({ step: 'idle' })}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
});
