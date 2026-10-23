'use client';

import { useEffect } from 'react';

/** Registers the service worker so the browser offers "install". */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Blocked, unsupported, or a private window. The app works regardless;
      // only the install prompt is lost.
    });
  }, []);
  return null;
}
