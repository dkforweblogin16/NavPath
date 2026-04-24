// NavPath Service Worker v1.0
// Handles caching and offline support

const CACHE_NAME = 'navpath-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/firebase.js',
  '/manifest.json',
  '/data/syllabus.json',
  '/data/questions.json',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/logo.svg'
];

// Install event – cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing NavPath Service Worker...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    }).catch((err) => {
      console.warn('[SW] Cache failed for some assets:', err);
    })
  );
  self.skipWaiting();
});

// Activate event – clean old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating NavPath Service Worker...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  self.clients.claim();
});

// Fetch event – network first, fallback to cache
self.addEventListener('fetch', (event) => {
  // Skip non-GET and Firebase/external requests
  if (
    event.request.method !== 'GET' ||
    event.request.url.includes('firebase') ||
    event.request.url.includes('googleapis') ||
    event.request.url.includes('razorpay')
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache fresh responses
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Network failed – serve from cache
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // Return offline page for HTML navigation
          if (event.request.headers.get('accept').includes('text/html')) {
            return caches.match('/index.html');
          }
        });
      })
  );
});
