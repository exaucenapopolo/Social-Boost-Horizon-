const CACHE_NAME = 'sbh-v2';
const GITHUB_BASE = 'https://raw.githubusercontent.com/exaucenapopolo/Social-Boost-Horizon-/refs/heads/main';

const APP_SHELL = [
  `${GITHUB_BASE}/`,
  `${GITHUB_BASE}/index.html`,
  `${GITHUB_BASE}/dashboard.html`,
  `${GITHUB_BASE}/commander.html`,
  `${GITHUB_BASE}/fonds.html`,
  `${GITHUB_BASE}/paid.html`,
  `${GITHUB_BASE}/manifest.json`,
  `${GITHUB_BASE}/assets/logos/android-chrome-192x192.png`,
  `${GITHUB_BASE}/assets/logos/android-chrome-512x512.png`
];

// Installation : mise en cache des fichiers essentiels
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

// Activation : suppression des anciens caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch : stratégie hybride adaptée aux liens distants
self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  // HTML : réseau d'abord
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match(`${GITHUB_BASE}/index.html`)))
    );
    return;
  }

  // Fichiers statiques : cache d'abord
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => caches.match(`${GITHUB_BASE}/index.html`));
    })
  );
});
