import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Secondhand Schnäppchen Finder',
  description: 'Finde die besten Secondhand-Angebote auf Vinted, willhaben und Kleinanzeigen. Sortiert nach echtem Wert.',
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
  openGraph: {
    title: 'Secondhand Schnäppchen Finder',
    description: 'Durchsuche Vinted, willhaben und Kleinanzeigen gleichzeitig – sortiert nach echtem Wert.',
    type: 'website',
    locale: 'de_DE',
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
    <html lang="de">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
