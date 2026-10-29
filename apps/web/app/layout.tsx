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
    { media: '(prefers-color-scheme: dark)', color: '#111A2B' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
        />
        {/*
         * The theme, before the first paint.
         *
         * Settings writes one of 'light', 'dark' or 'system' to
         * localStorage; the stylesheet reads it off <html data-theme>. Doing
         * it here rather than in a component is the whole point: a React
         * effect runs after the browser has already painted, so a dark-theme
         * user gets a white flash on every navigation. Wrapped in try/catch
         * because storage throws in a private window, and the catch is the
         * correct behaviour anyway — fall back to the system setting.
         */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('promold.theme');" +
              "if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
