import type { Metadata, Viewport } from 'next';
import './globals.css';

/*
 * One app, two audiences: the office on a desk and the crew on a phone.
 *
 * Which means one manifest, and it has to suit the half that actually gets
 * installed. `start_url` is "/" rather than any particular screen, because
 * the root routes by role — a crew member tapping the icon lands on their
 * jobs, a manager lands on the calendar, and neither has to be told a URL.
 */
export const metadata: Metadata = {
  title: 'Promold',
  description: 'Jobs, the calendar, the crew, and what each one cost.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Promold' },
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/apple-touch-icon.png',
  },
};

// viewportFit=cover so the crew's tab bar can sit in the home-indicator area
// and use env(safe-area-inset-bottom) rather than floating above a white
// strip. Harmless on a desktop, where there is no inset to speak of.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFFFFF' },
    { media: '(prefers-color-scheme: dark)', color: '#18211F' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@500;600&family=IBM+Plex+Mono:wght@500;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
