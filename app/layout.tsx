import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sail Scoring',
  description: 'Sail race scoring',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
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
        <main className="px-6 py-8 max-w-5xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
