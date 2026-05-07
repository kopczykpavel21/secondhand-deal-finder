import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Secondhand Finder Ελλάδα',
  description: 'Βρες τις καλύτερες μεταχειρισμένες προσφορές σε Vinted, Facebook και Shpock. Ταξινομημένες κατά πραγματική αξία.',
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
  openGraph: {
    title: 'Secondhand Finder Ελλάδα',
    description: 'Ψάξε σε Vinted, Facebook και Shpock ταυτόχρονα – ταξινομημένα κατά πραγματική αξία.',
    type: 'website',
    locale: 'el_GR',
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
    <html lang="el">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
