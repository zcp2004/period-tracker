const CACHE_NAME = 'period-tracker-v1';
const ASSETS = [
  'index.html',
  'app.css',
  'app.js',
  'manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('chart.js') || event.request.url.includes('cdn.jsdelivr.net')) {
    event.respondWith(
      caches.open('cdn-cache').then((cache) => {
        return cache.match(event.request).then((response) => {
          return response || fetch(event.request).then((res) => {
            cache.put(event.request, res.clone());
            return res;
          });
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request).catch(() => {
        return caches.match('index.html');
      });
    })
  );
});
