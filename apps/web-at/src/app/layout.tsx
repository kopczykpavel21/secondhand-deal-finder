import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Secondhand Schnäppchen Finder Österreich',
  description: 'Finde die besten Secondhand-Angebote auf willhaben, Shpock und Vinted. Sortiert nach echtem Wert.',
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
  openGraph: {
    title: 'Secondhand Schnäppchen Finder Österreich',
    description: 'Durchsuche willhaben, Shpock und Vinted gleichzeitig – sortiert nach echtem Wert.',
    type: 'website',
    locale: 'de_AT',
  },
};

export const viewport: Viewport = {
  themeColor: '#c0392b',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
