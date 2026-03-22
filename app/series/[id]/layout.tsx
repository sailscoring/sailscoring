'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { seriesRepo } from '@/lib/dexie-repository';
import { cn } from '@/lib/utils';
import { useGlobalKeyDown, useChordShortcut } from '@/hooks/use-keyboard-shortcut';
import { KeyboardHelp } from '@/components/keyboard-help';

const tabs = [
  { label: 'Competitors', href: (id: string) => `/series/${id}/competitors` },
  { label: 'Races', href: (id: string) => `/series/${id}/races` },
  { label: 'Standings', href: (id: string) => `/series/${id}/standings` },
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
  const series = useLiveQuery(async () => (await seriesRepo.get(id)) ?? null, [id]);
  const [showHelp, setShowHelp] = useState(false);

  useChordShortcut({
    c: () => router.push(tabs[0].href(id)),
    r: () => router.push(tabs[1].href(id)),
    s: () => router.push(tabs[2].href(id)),
  });

  useGlobalKeyDown((e) => {
    if (e.key === '?' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(
      (document.activeElement?.tagName ?? '')
    )) {
      e.preventDefault();
      setShowHelp(true);
    }
  });

  if (series === undefined) {
    return <p className="text-muted-foreground">Loading…</p>;
  }

  if (series === null) {
    return <p className="text-muted-foreground">Series not found.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{series.name}</h1>
        {(series.venue || series.date) && (
          <p className="text-sm text-muted-foreground mt-0.5">
            {[series.venue, series.date].filter(Boolean).join(' · ')}
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
