import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Secondhand Deal Finder',
  description: 'Find the best secondhand deals across Bazoš, Sbazar, Vinted, and Facebook Marketplace.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
