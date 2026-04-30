'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSeries } from '@/hooks/use-series';
import { cn } from '@/lib/utils';
import { useGlobalKeyDown, useChordShortcut } from '@/hooks/use-keyboard-shortcut';
import { KeyboardHelp } from '@/components/keyboard-help';
import { saveSeriesFile } from '@/lib/series-file';

const tabs = [
  { label: 'Competitors', href: (id: string) => `/series/${id}/competitors` },
  { label: 'Races', href: (id: string) => `/series/${id}/races` },
  { label: 'Standings', href: (id: string) => `/series/${id}/standings` },
  { label: 'Settings', href: (id: string) => `/series/${id}/settings` },
];

export default function SeriesLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const pathname = usePathname();
  const router = useRouter();
  const { data: series, isLoading } = useSeries(id);
  const [showHelp, setShowHelp] = useState(false);

  useChordShortcut({
    c: () => router.push(tabs[0].href(id)),
    r: () => router.push(tabs[1].href(id)),
    s: () => router.push(tabs[2].href(id)),
    t: () => router.push(tabs[3].href(id)),
  });

  useGlobalKeyDown((e) => {
    if (e.key === '?' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(
      (document.activeElement?.tagName ?? '')
    )) {
      e.preventDefault();
      setShowHelp(true);
    } else if (e.ctrlKey && !e.metaKey && e.key === 's' && !/\/races\/[^/]+/.test(pathname)) {
      // Ctrl+S saves to file from any series page except finish entry (which owns Ctrl+S itself)
      e.preventDefault();
      saveSeriesFile(id).catch(console.error);
    }
  });

  if (isLoading || series === undefined) {
    return <p className="text-muted-foreground">Loading…</p>;
  }

  if (series === null) {
    return <p className="text-muted-foreground">Series not found.</p>;
  }

  return (
    <div className="space-y-6 max-w-screen-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold">{series.name}</h1>
        {(series.venue || series.startDate) && (
          <p className="text-sm text-muted-foreground mt-0.5">
            {[series.venue, series.startDate].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      <nav className="flex gap-1 border-b">
        {tabs.map((tab) => {
          const href = tab.href(id);
          const active = pathname.startsWith(href);
          return (
            <Link
              key={tab.label}
              href={href}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                active
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {children}

      <KeyboardHelp open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}
