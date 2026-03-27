import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sail Scoring',
  description: 'Sail race scoring',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <header className="border-b px-6 py-2 flex items-center gap-4">
          <Link href="/" aria-label="Sail Scoring home">
            <Image
              src="/logo.png"
              alt="Sail Scoring"
              width={154}
              height={35}
              priority
            />
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
