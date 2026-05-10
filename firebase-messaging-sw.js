// ============================================================
// firebase-messaging-sw.js
// NavPath — Firebase Cloud Messaging Service Worker
// Place this file in ROOT of project (same folder as index.html)
// ============================================================

importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            'AIzaSyAr7Tnoq0FrMEx8BZotdOTg7Du-2-wZ0fo',
  authDomain:        'navpath-19986.firebaseapp.com',
  projectId:         'navpath-19986',
  storageBucket:     'navpath-19986.appspot.com',
  messagingSenderId: '424012418705',
  appId:             '1:424012418705:web:ad5a50a10254edac357930'
});

const messaging = firebase.messaging();

// ── Background message handler ──────────────────────────────
// Fires when app is closed / in background
// FCM sends the notification automatically from payload.notification
// This handler lets us customize it further
messaging.onBackgroundMessage((payload) => {
  console.log('[NavPath FCM SW] Background message:', payload);

  const { title, body, icon } = payload.notification || {};

  self.registration.showNotification(title || '📚 NavPath Study Reminder', {
    body:    body || 'Time to study for your NEA exam!',
    icon:    icon || '/assets/icons/icon-192.png',
    badge:        '/assets/icons/icon-192.png',
    tag:          'navpath-study-reminder',
    renotify:     true,
    requireInteraction: true,
    vibrate: [300, 100, 300, 100, 500],
    data:    payload.data || {},
    actions: [
      { action: 'study',    title: '📖 Study Now' },
      { action: 'practice', title: '📝 Practice MCQs' },
    ]
  });
});

// ── Notification click handler ──────────────────────────────
self.addEventListener('notificationclick', (e) => {
  e.notification.close();

  const action = e.action; // 'study' | 'practice' | ''

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // If app already open — focus it and send action
      const openTab = clients.find(c => c.url.includes(self.location.origin));
      if (openTab) {
        openTab.focus();
        if (action) openTab.postMessage({ type: 'FCM_ACTION', action });
        return;
      }
      // Otherwise open app
      const url = action === 'practice' ? '/?tab=practice' : '/?tab=study';
      return self.clients.openWindow(url);
    })
  );
});

// ── Lifecycle ───────────────────────────────────────────────
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
