
const CACHE_NAME = 'vdjv-sampler-cache-v2';
const urlsToCache = [
  './',
  './index.html',
  './site.webmanifest',
  './assets/logo.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isNavigation = event.request.mode === 'navigate';
  
  // For navigation requests, always try to return cached index.html when offline
  if (isNavigation) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('./index.html') || caches.match('/index.html') || caches.match('./');
      })
    );
    return;
  }
  
  // Skip Vite dev server files (only in development)
  // These files don't exist in production builds
  const isDevServerFile = url.pathname.startsWith('/@vite/') || 
      url.pathname.startsWith('/@react-refresh') ||
      (url.pathname.includes('?t=') && (url.pathname.includes('/src/') || url.pathname.includes('/node_modules/')));
  
  if (isDevServerFile) {
    // In development, try to fetch but don't cache
    // If offline, return proper ES module exports to prevent breaking the app
    event.respondWith(
      fetch(event.request).catch(() => {
        // Return proper ES module exports to prevent "does not provide an export" errors
        if (url.pathname.includes('@react-refresh')) {
          // React Refresh module needs default export
          return new Response('export default function() {}', { 
            status: 200,
            headers: { 'Content-Type': 'application/javascript' }
          });
        } else if (url.pathname.includes('@vite')) {
          // Vite client module - return minimal module
          return new Response('export {};', { 
            status: 200,
            headers: { 'Content-Type': 'application/javascript' }
          });
        }
        return new Response('export {};', { 
          status: 200,
          headers: { 'Content-Type': 'application/javascript' }
        });
      })
    );
    return;
  }
  
  // For production assets, use cache-first strategy
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          return response;
        }
        // Try to fetch and cache
        return fetch(event.request).then((response) => {
          // Only cache successful GET requests for same-origin
          if (response.status === 200 && event.request.method === 'GET' && 
              url.origin === self.location.origin) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        }).catch(() => {
          // If offline and not in cache, return index.html for navigation requests
          if (isNavigation) {
            return caches.match('./index.html') || caches.match('/index.html') || caches.match('./');
          }
          // For other requests, return a generic offline response
          return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
        });
      })
  );
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});
