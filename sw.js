/*
 * Quiz Sheets service worker — app-shell cache so live scanning survives a flaky
 * or absent network on the phone.
 *
 * Scope is deliberately narrow: only SAME-ORIGIN GETs are intercepted. Every
 * call that matters for data — the JSONP <script> hits to the Apps Script
 * /exec bridge, the Google Identity token client, and the Drive upload/download
 * endpoints — is cross-origin and passes straight through to the network,
 * untouched by this worker. No student data or images ever enter this cache.
 *
 * Strategy is stale-while-revalidate: the cached shell paints instantly (and
 * offline), while a fresh copy is fetched in the background for next launch.
 * That keeps the redeploy-and-repaste workflow honest — a new index.html on
 * GitHub Pages reaches the installed PWA on its second open, not never.
 */
const CACHE = 'quizsheets-shell-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      // Individual misses (an icon not yet deployed) must not fail the whole
      // install, or the worker never activates.
      .then(cache => Promise.allSettled(SHELL.map(u => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // bridge, GIS, Drive → network only

  event.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(req).then(cached => {
        const network = fetch(req)
          .then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; })
          .catch(() => cached); // offline → fall back to whatever we have
        return cached || network;
      })
    )
  );
});
