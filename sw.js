/* PhishGuard offline cache. Only active when the site is served over http(s);
   opening index.html directly from the file system already works offline. */
const CACHE = 'phishguard-v16';
const ASSETS = [
  './', './index.html', './css/styles.css',
  './js/data.js', './js/data-service.js',
  './js/auth-service.js', './js/participant-service.js',
  './js/quiz-service.js', './js/monitoring-service.js',
  './js/cinematic-intro.js', './js/app.js', './js/portal.js',
  './manifest.webmanifest', './assets/icon.svg'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).pathname.includes('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
