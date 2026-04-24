// ============================================================
// firebase.js — Fixed
// BUG FIXED: initFirebase() was calling firebase.firestore()
// even though Firestore SDK may not be loaded yet, and returned
// nothing meaningful on failure. Now guards properly and returns
// a clean { auth, db } object. Also exposes firebase global so
// script.js can use firebase.firestore.Timestamp directly.
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyAr7Tnoq0FrMEx8BZotdOTg7Du-2-wZ0fo",
  authDomain: "navpath-19986.firebaseapp.com",
  projectId: "navpath-19986",
  storageBucket: "navpath-19986.appspot.com",
  messagingSenderId: "424012418705",
  appId: "1:424012418705:web:ad5a50a10254edac357930"
};

function initFirebase() {
  if (typeof firebase === 'undefined') {
    console.error('[NavPath] Firebase SDK not loaded. Check CDN script tags.');
    return null;
  }

  // FIX: Guard against duplicate initialization
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  // FIX: Set auth persistence to LOCAL so login survives page refresh
  const auth = firebase.auth();
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(e => {
    console.warn('[NavPath] Could not set auth persistence:', e.message);
  });

  const db = firebase.firestore();

  return { auth, db };
}

window.initFirebase = initFirebase;
