// ============================================================
// firebase.js — NavPath
// Updated: Added Firebase Messaging (FCM) support
// ============================================================

const firebaseConfig = {
  apiKey:            'AIzaSyAr7Tnoq0FrMEx8BZotdOTg7Du-2-wZ0fo',
  authDomain:        'navpath-19986.firebaseapp.com',
  projectId:         'navpath-19986',
  storageBucket:     'navpath-19986.appspot.com',
  messagingSenderId: '424012418705',
  appId:             '1:424012418705:web:ad5a50a10254edac357930'
};

function initFirebase() {
  if (typeof firebase === 'undefined') {
    console.error('[NavPath] Firebase SDK not loaded. Check CDN script tags.');
    return null;
  }

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  // Auth persistence
  const auth = firebase.auth();
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(e => {
    console.warn('[NavPath] Could not set auth persistence:', e.message);
  });

  const db = firebase.firestore();

  // ── Listen for FCM actions posted from firebase-messaging-sw.js ──
  // When user taps Study Now / Practice MCQs on notification
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (!e.data) return;
      if (e.data.type === 'FCM_ACTION') {
        const tab = e.data.action === 'practice' ? 'practice' : 'study';
        window.switchTab && window.switchTab(tab);
      }
    });
  }

  return { auth, db };
}

window.initFirebase = initFirebase;
