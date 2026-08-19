import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { siteConfig } from '@/lib/config';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'], display: 'swap' });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: {
    default: `${siteConfig.name} — ${siteConfig.rewardTicker} every 5 minutes`,
    template: `%s · ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  keywords: ['Moderna', 'MRNA', 'MRNAx', 'Solana', 'airdrop', 'pump.fun', 'creator fees'],
  openGraph: {
    title: `${siteConfig.name} — ${siteConfig.rewardTicker} every 5 minutes`,
    description: siteConfig.description,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${siteConfig.name} — ${siteConfig.rewardTicker} every 5 minutes`,
    description: siteConfig.description,
  },
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#0a0a0b',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
