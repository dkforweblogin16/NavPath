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
    console.error('Firebase SDK not loaded');
    return null;
  }

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  return {
    auth: firebase.auth(),
    db: firebase.firestore()
  };
}

window.initFirebase = initFirebase;
