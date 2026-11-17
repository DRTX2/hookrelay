import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = { title: 'Hookrelay', description: 'Reliable webhook delivery' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <Link href="/" className="brand"><span className="logo" aria-hidden>⟿</span> hookrelay</Link>
          <Link href="/">Overview</Link>
          <Link href="/endpoints">Endpoints</Link>
          <Link href="/dead-letters">Dead letters</Link>
        </nav>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
