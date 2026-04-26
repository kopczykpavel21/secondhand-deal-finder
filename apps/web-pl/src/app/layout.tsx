import type { Metadata, Viewport } from 'next';
import { getMarketConfig } from '@sdf/types';
import './globals.css';

const market = getMarketConfig('pl');

export const metadata: Metadata = {
  title: market.texts.title,
  description: market.texts.description,
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: market.texts.appName,
    statusBarStyle: 'default',
  },
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
  openGraph: {
    title: market.texts.title,
    description: market.texts.description,
    type: 'website',
    locale: 'pl_PL',
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
    <html lang="pl">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
