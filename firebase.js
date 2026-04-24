// ============================================================
// firebase.js – NavPath Firebase Configuration
// Using Firebase Compat SDK (works with CDN script tags)
// ============================================================

// ✅ Your actual Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAr7Tnoq0FrMEx8BZotdOTg7Du-2-wZ0fo",
  authDomain: "navpath-19986.firebaseapp.com",
  projectId: "navpath-19986",
  storageBucket: "navpath-19986.firebasestorage.app",
  messagingSenderId: "424012418705",
  appId: "1:424012418705:web:ad5a50a10254edac357930"
};

// ============================================================
// Initialize Firebase (Compat mode — works with CDN)
// ============================================================
function initFirebase() {
  if (typeof firebase === 'undefined') {
    console.error('Firebase SDK not loaded. Check internet connection.');
    return null;
  }

  // Prevent re-initialization
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  return {
    auth: firebase.auth(),
    db: firebase.firestore()
  };
}

// Make available globally
window.initFirebase = initFirebase;
window.firebaseConfig = firebaseConfig;

// ============================================================
// Firestore Security Rules — Paste in Firebase Console
// Firestore → Rules tab → Publish
// ============================================================
/*
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null
                         && request.auth.uid == userId;

      match /progress/{topicId} {
        allow read, write: if request.auth != null
                           && request.auth.uid == userId;
      }

      match /payments/{paymentId} {
        allow read: if request.auth != null
                    && request.auth.uid == userId;
        allow write: if false;
      }
    }
  }
}
*/
