// Ledger service worker.
//
// Two jobs:
//
//   1. Keep the app openable with no signal. Entries are written to
//      localStorage before they are ever sent, so being offline is a normal
//      working state for this app rather than an error — but that is only
//      true if the shell actually loads without a network.
//
//   2. Notice a new deploy and tell the page about it, instead of leaving the
//      user on an old build until the browser's HTTP cache happens to expire.
//
// Nothing here touches the Make webhook: those are POSTs, and the fetch
// handler ignores every method except GET.

const SHELL_CACHE = 'ledger-shell-v1';
const FONT_CACHE  = 'ledger-fonts-v1';

// The page is always cached and served under one key, whatever URL the
// navigation actually used ("/", "/index.html", "/index.html?x=1").
const PAGE = new URL('./index.html', self.location).href;

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// ---------- install ----------
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // addAll rejects the whole install if any single file 404s. Added one at
    // a time instead, so a missing icon costs only that icon and the app
    // still ends up installable and offline-capable.
    await Promise.all(SHELL.map(url => cache.add(url).catch(() => {})));
  })());
  // Deliberately no skipWaiting() here. On a first install there is no
  // controller to replace, so this worker activates immediately anyway. On an
  // update it waits, so the page currently on screen is never swapped out
  // from under someone mid-entry — the user accepts the update instead.
});

// ---------- activate ----------
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== SHELL_CACHE && k !== FONT_CACHE).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// The page asks for this once the user has tapped Reload.
self.addEventListener('message', (event) => {
  if(event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ---------- fetch ----------
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if(req.method !== 'GET') return;   // webhook POSTs go straight to the network

  const url = new URL(req.url);

  if(url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'){
    event.respondWith(cacheFirst(req, FONT_CACHE));
    return;
  }
  if(url.origin !== self.location.origin) return;

  event.respondWith(shell(event));
});

// Fonts never change at a given URL, so the first copy is the only copy that
// is ever needed. Without this the app falls back to a system font the moment
// it opens offline.
async function cacheFirst(req, cacheName){
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if(hit) return hit;
  try{
    const res = await fetch(req);
    if(res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }catch(e){
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

// Shell files are served from the cache first, so the app opens instantly and
// works with no signal, and refreshed in the background afterwards. If the
// page that comes back differs from the page on disk, a new build has been
// deployed — the cache is updated now and the open tabs are told, so they can
// offer a reload rather than changing under the user without warning.
async function shell(event){
  const req = event.request;
  const isPage = req.mode === 'navigate';
  const key = isPage ? PAGE : req;

  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(key, { ignoreSearch: isPage });

  if(!cached){
    try{
      const res = await fetch(req);
      if(res && res.ok) await cache.put(key, res.clone());
      return res;
    }catch(e){
      return new Response('', { status: 503, statusText: 'Offline' });
    }
  }

  // Read the cached page now, before the browser starts consuming the copy
  // that is about to be returned.
  const cachedText = isPage ? await cached.clone().text() : null;

  event.waitUntil((async () => {
    try{
      const res = await fetch(req);
      if(!res || !res.ok) return;
      await cache.put(key, res.clone());
      if(isPage && (await res.clone().text()) !== cachedText) await announceUpdate();
    }catch(e){
      // Offline. The cached copy was already returned, which is the point.
    }
  })());

  return cached;
}

async function announceUpdate(){
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(c => c.postMessage({ type: 'UPDATE_READY' }));
}
