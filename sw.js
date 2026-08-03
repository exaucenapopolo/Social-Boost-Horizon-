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

// Installation : mise en cache des fichiers essentiels (Rien ne change ici)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

// Activation : suppression des anciens caches (Rien ne change ici)
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

// Fetch : stratégie hybride améliorée pour éviter les "Routes non trouvées"
self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  // 1. GESTION DU HTML (Pages web) : Réseau d'abord
  if (request.mode === 'navigate' || (request.headers.get('accept') && request.headers.get('accept').includes('text/html'))) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Si la page demandée n'existe pas (Erreur 404 - Route non trouvée)
          if (response.status === 404) {
            // On renvoie la page d'accueil en cache au lieu d'une page d'erreur
            return caches.match(`${GITHUB_BASE}/index.html`);
          }
          
          // Si tout va bien, on met à jour le cache
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // Si on est complètement hors ligne, on cherche dans le cache
          return caches.match(request).then((cached) => {
            return cached || caches.match(`${GITHUB_BASE}/index.html`);
          });
        })
    );
    return;
  }

  // 2. GESTION DES FICHIERS STATIQUES (CSS, JS, Images) : Cache d'abord
  event.respondWith(
    caches.match(request).then((cached) => {
      // S'il est dans le cache, on le donne tout de suite
      if (cached) return cached;

      // Sinon on va le chercher sur le réseau
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
        // En cas d'échec pour une image ou un style, on ne renvoie PAS index.html 
        // pour ne pas créer de bugs de lecture, on laisse simplement échouer silencieusement.
        .catch(() => new Response('', { status: 404, statusText: 'Not Found' }));
    })
  );
});
