import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { Providers } from './providers';
import { USE_SERVER_DATA } from '@/lib/flags';

export const metadata: Metadata = {
  title: 'Sail Scoring',
  description: 'Sail race scoring',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers useServerData={USE_SERVER_DATA}>
          <header className="border-b px-6 py-3 flex items-baseline gap-3">
            <Link href="/" className="font-semibold hover:underline">
              Sail Scoring
            </Link>
            <Link href="/settings" className="text-sm text-muted-foreground hover:underline">
              Settings
            </Link>
            <Link href="/help" className="text-sm text-muted-foreground hover:underline">
              Help
            </Link>
          </header>
          <main className="px-6 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
