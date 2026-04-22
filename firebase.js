// ============================================================
// firebase.js – Firebase Configuration for NavPath
// ============================================================
// SETUP INSTRUCTIONS:
// 1. Go to https://console.firebase.google.com
// 2. Create a new project named "NavPath"
// 3. Enable Authentication → Email/Password
// 4. Create Firestore Database (start in test mode initially)
// 5. Copy your Firebase config object and paste it below
// 6. Replace the placeholder values with your actual config
// ============================================================

// 🔥 REPLACE THIS WITH YOUR ACTUAL FIREBASE CONFIG
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// ============================================================
// Firestore Data Structure (Reference)
// ============================================================
/*
  Collection: users/{userId}
  Fields:
    - email: string
    - displayName: string
    - createdAt: timestamp
    - trialStartDate: timestamp
    - isPremium: boolean
    - premiumExpiry: timestamp | null
    - planType: "trial" | "monthly" | "yearly" | null
    - streak: number
    - lastStudiedDate: string (YYYY-MM-DD)

  Collection: users/{userId}/progress/{topicId}
  Fields:
    - completed: boolean
    - completedAt: timestamp

  Collection: users/{userId}/payments/{paymentId}
  Fields:
    - razorpay_order_id: string
    - razorpay_payment_id: string
    - amount: number
    - plan: string
    - createdAt: timestamp
*/

// ============================================================
// Firestore Security Rules (paste in Firebase Console)
// ============================================================
/*
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;

      match /progress/{topicId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }

      match /payments/{paymentId} {
        allow read: if request.auth != null && request.auth.uid == userId;
        allow write: if false; // Only allow writes from backend/cloud function
      }
    }
  }
}
*/

// Initialize Firebase (loaded via CDN in index.html)
// This function is called after Firebase SDKs are loaded
function initFirebase() {
  if (typeof firebase === 'undefined') {
    console.error('Firebase SDK not loaded. Check your internet connection.');
    return null;
  }

  // Initialize app (check if already initialized)
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  return {
    auth: firebase.auth(),
    db: firebase.firestore()
  };
}

// Export for use in script.js
window.initFirebase = initFirebase;
window.firebaseConfig = firebaseConfig;
