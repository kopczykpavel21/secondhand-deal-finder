import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Secondhand Deal Finder',
  description: 'Najdeme nejlepší secondhand nabídky napříč Bazoš, Vinted, Aukro a Fler. Řazeno podle skutečné hodnoty.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'Deal Finder',
    statusBarStyle: 'default',
  },
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
  openGraph: {
    title: 'Secondhand Deal Finder',
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
