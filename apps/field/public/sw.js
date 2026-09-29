/*
 * The smallest service worker that makes the app installable.
 *
 * Deliberately no caching of app code or data. A crew member looking at a job
 * needs today's truth, not yesterday's cached copy, and a stale shell serving
 * old JavaScript against a changed database is worse than a spinner. Offline
 * support is a real feature and needs a real design — a queue of writes that
 * replays and resolves conflicts — not a cache-first fetch handler.
 *
 * What this does buy: Chrome and Android treat the app as installable, so the
 * crew get a home-screen icon and a full-screen window. iOS installs from
 * Share → Add to Home Screen with or without this.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  // Fall through to the network. Registering any fetch handler at all is what
  // some browsers look for before offering to install.
});
