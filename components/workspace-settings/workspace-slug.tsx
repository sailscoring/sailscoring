'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * The workspace's public identity, under the settings heading: the slug
 * itself, and the `/p/` path it is the first segment of. The name at the
 * top of the page is a label; this is what published URLs carry and what
 * the operator commands take as their workspace argument, and it had no
 * home in the UI before — it was only ever readable as a substring of a
 * published link.
 *
 * The path is only a link once the workspace has published something: the
 * public index 404s on a workspace with nothing on it, since it refuses to
 * reveal that the workspace exists. Unlinked, it still shows — as the
 * address results will have once they are published.
 */
export function WorkspaceSlug({
  slug,
  publicPath,
  published,
}: {
  slug: string;
  publicPath: string;
  published: boolean;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(slug);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      data-testid="workspace-slug"
      className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground"
    >
      <span>
        Slug{' '}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
          {slug}
        </code>
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={copy}
        aria-label="Copy workspace slug"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
      <span aria-hidden="true">·</span>
      {published ? (
        <a
          className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
          href={publicPath}
          target="_blank"
          rel="noreferrer"
        >
          {publicPath}
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : (
        <span>
          published results will appear at <span className="font-mono">{publicPath}</span>
        </span>
      )}
    </div>
  );
}
