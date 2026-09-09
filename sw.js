// Minimal service worker — just enough to satisfy Chrome/Android's
// installability requirement. The app is only useful online anyway (every
// entry has to reach Power Automate), so real offline caching is a later
// upgrade, not day-one scope. See pwa-architecture-context.md.

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Pass everything straight through to the network.
});
