'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Globe, Plus } from 'lucide-react';

import { useCreateRanking, useRankings } from '@/hooks/use-rankings';
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { RankingDto } from '@/lib/api-handlers/rankings';

function bucketSummary(ranking: RankingDto): string {
  const buckets = ranking.config.buckets;
  const seriesCount = new Set(buckets.flatMap((b) => b.seriesIds)).size;
  return `${seriesCount} series in ${buckets.length} bucket${buckets.length === 1 ? '' : 's'}`;
}

export function RankingsList() {
  const { data: rankings, isError, refetch } = useRankings();
  const create = useCreateRanking();
  const { can } = useWorkspacePermissions();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  if (rankings === undefined) {
    if (isError) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Couldn&rsquo;t load rankings. Check your connection and try again.
          </p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      );
    }
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const canManage = can('manage-series');

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New ranking
          </Button>
        </div>
      )}

      {rankings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No rankings yet.
          {canManage &&
            ' Create one, pick the series that count, and the ladder computes itself.'}
        </p>
      ) : (
        <div className="space-y-2">
          {rankings.map((ranking) => (
            <Link
              key={ranking.id}
              href={`/workspace/rankings/${ranking.id}`}
              className="flex items-center justify-between gap-3 bg-card border rounded-lg px-5 py-4 shadow-sm transition-all hover:bg-accent/50 hover:shadow-md"
              data-testid="ranking-row"
            >
              <div className="min-w-0">
                <div className="font-medium">{ranking.name}</div>
                <div className="text-sm text-muted-foreground mt-0.5">
                  {bucketSummary(ranking)}
                </div>
              </div>
              {ranking.published && (
                <span
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0"
                  title="Has a public page"
                >
                  <Globe className="h-3.5 w-3.5" />
                  Public
                </span>
              )}
            </Link>
          ))}
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New ranking</DialogTitle>
            <DialogDescription>
              Name the ladder — the season and class it covers, e.g.
              &ldquo;National Ranking 2026&rdquo;.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              create.mutate(name.trim(), {
                onSuccess: (created) => {
                  setCreating(false);
                  setName('');
                  router.push(`/workspace/rankings/${created.id}`);
                },
              });
            }}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ranking name"
              aria-label="Ranking name"
              autoFocus
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending || !name.trim()}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
