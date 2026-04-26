import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Výhodník',
  description: 'Prohledáme Bazoš, Vinted, Aukro a Fler najednou a seřadíme výsledky podle skutečné hodnoty.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'Výhodník',
    statusBarStyle: 'default',
  },
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
  openGraph: {
    title: 'Výhodník',
    description: 'Prohledáme Bazoš, Vinted, Aukro a Fler najednou a seřadíme výsledky podle skutečné hodnoty.',
    type: 'website',
    locale: 'cs_CZ',
  },
};

export const viewport: Viewport = {
  themeColor: '#0284c7',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
