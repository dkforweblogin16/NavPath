# NavPath – Complete Setup & Deployment Guide

> **NEA Exam Prep PWA** | Firebase + Razorpay + Netlify

---

## 📁 Project Structure

```
navpath/
├── index.html          ← Main app shell (all screens)
├── style.css           ← Complete Navy-themed styles
├── script.js           ← App logic, auth, progress, quiz
├── firebase.js         ← Firebase config + Firestore schema
├── manifest.json       ← PWA manifest
├── service-worker.js   ← Offline caching
├── data/
│   ├── syllabus.json   ← Full NEA syllabus (3 papers, 80+ topics)
│   └── questions.json  ← MCQ practice questions
└── assets/
    └── icons/
        ├── icon-512.png
        ├── icon-192.png
        ├── favicon.png
        └── logo.svg
```

---

## 🔥 STEP 1: Firebase Setup (15 minutes)

### 1.1 Create Firebase Project
1. Go to **https://console.firebase.google.com**
2. Click **"Add project"**
3. Name it: `navpath-nea`
4. Disable Google Analytics (optional)
5. Click **Create project**

### 1.2 Enable Authentication
1. Sidebar → **Authentication** → **Get started**
2. Click **Email/Password** → Enable → Save

### 1.3 Create Firestore Database
1. Sidebar → **Firestore Database** → **Create database**
2. Start in **test mode** initially
3. Choose a region (e.g., `asia-south1` for India)
4. Click **Done**

### 1.4 Add Security Rules (After testing)
Go to Firestore → **Rules** tab and paste:

```javascript
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
        allow write: if false; // Only via backend
      }
    }
  }
}
```

### 1.5 Get Your Firebase Config
1. Project Settings (⚙️) → **General** tab
2. Scroll to "Your apps" → Click **Web** (`</>`)
3. Register app name: `NavPath Web`
4. Copy the `firebaseConfig` object

### 1.6 Paste Config into firebase.js
Open `firebase.js` and replace:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",           // ← YOUR KEY
  authDomain: "navpath-nea.firebaseapp.com",
  projectId: "navpath-nea",
  storageBucket: "navpath-nea.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

---

## 💳 STEP 2: Razorpay Integration (10 minutes)

### 2.1 Create Razorpay Account
1. Go to **https://razorpay.com**
2. Sign up with your business details
3. Complete KYC (for live payments)

### 2.2 Get API Keys
1. Dashboard → Settings → **API Keys**
2. Generate **Test Key** (for testing)
3. Generate **Live Key** (after KYC approval)

### 2.3 Update script.js
Open `script.js`, find this line and replace:

```javascript
// LINE ~215 in script.js:
const RAZORPAY_KEY = 'rzp_test_YOUR_KEY_HERE';

// Replace with your actual test key:
const RAZORPAY_KEY = 'rzp_test_xxxxxxxxxxxxxxxxxxxx';

// For production, use live key:
const RAZORPAY_KEY = 'rzp_live_xxxxxxxxxxxxxxxxxxxx';
```

### 2.4 Backend Payment Verification (IMPORTANT for production)
For secure payment verification, create a backend endpoint using:

**Option A: Firebase Cloud Functions**
```javascript
// functions/index.js
const functions = require('firebase-functions');
const Razorpay = require('razorpay');
const crypto = require('crypto');

exports.verifyPayment = functions.https.onCall(async (data, context) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, uid, plan } = data;

  // Verify signature
  const body = razorpay_order_id + '|' + razorpay_payment_id;
  const expectedSig = crypto
    .createHmac('sha256', process.env.RAZORPAY_SECRET)
    .update(body)
    .digest('hex');

  if (expectedSig !== razorpay_signature) {
    throw new functions.https.HttpsError('invalid-argument', 'Payment verification failed');
  }

  // Update user premium status
  const admin = require('firebase-admin');
  const db = admin.firestore();
  const expiry = new Date();
  if (plan === 'monthly') expiry.setMonth(expiry.getMonth() + 3);
  else expiry.setFullYear(expiry.getFullYear() + 1);

  await db.collection('users').doc(uid).update({
    isPremium: true,
    premiumExpiry: admin.firestore.Timestamp.fromDate(expiry),
    planType: plan
  });

  return { success: true };
});
```

**Option B: Simple backend (Node.js/Express)**
```javascript
// server.js
const express = require('express');
const crypto = require('crypto');
const app = express();

app.post('/verify-payment', express.json(), (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  const body = razorpay_order_id + '|' + razorpay_payment_id;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');

  if (expected === razorpay_signature) {
    // Update Firebase Firestore here
    res.json({ verified: true });
  } else {
    res.status(400).json({ verified: false });
  }
});
```

---

## 🌐 STEP 3: Deploy to Netlify (5 minutes)

### Option A: Drag & Drop (Easiest)
1. Go to **https://netlify.com** → Sign up free
2. Click **"Add new site"** → **"Deploy manually"**
3. Drag your entire `navpath/` folder onto the upload area
4. Netlify auto-deploys → Get a live URL instantly!

### Option B: Via GitHub (Recommended for updates)
1. Push your code to a GitHub repository:
```bash
git init
git add .
git commit -m "Initial NavPath release"
git remote add origin https://github.com/yourusername/navpath.git
git push -u origin main
```

2. Go to **Netlify** → **"Import from Git"**
3. Select your GitHub repo → Deploy

### Option C: Netlify CLI
```bash
npm install -g netlify-cli
netlify login
cd navpath/
netlify deploy --prod
```

### 3.1 Custom Domain (Optional)
1. Netlify → Site settings → Domain management
2. Add custom domain: e.g., `navpath.in`
3. Enable HTTPS (auto with Netlify)

### 3.2 Add Redirects for PWA
Create `_redirects` file in navpath/ folder:
```
/*    /index.html   200
```

---

## 📱 STEP 4: PWA Installation Guide

### On Android (Chrome)
1. Open the app URL in Chrome
2. A banner appears: **"Add NavPath to home screen"**
3. Tap Install → App appears on home screen

### On iOS (Safari)
1. Open URL in Safari
2. Tap Share button (□↑)
3. Scroll down → **"Add to Home Screen"**
4. Tap Add → App icon appears

### Manual Install Trigger
The app has a built-in install banner that appears automatically via `beforeinstallprompt` event.

---

## 📦 STEP 5: Convert to APK / Play Store

### Option A: Trusted Web Activity (TWA) – Recommended
TWA wraps your PWA in a native Android app shell.

**Requirements:**
- Your PWA must be HTTPS
- Score 100 on Lighthouse PWA audit

**Steps:**
1. Install Android Studio
2. Use **bubblewrap** tool:
```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://yoursite.netlify.app/manifest.json
bubblewrap build
```
3. This generates an `.aab` file for Play Store submission

### Option B: WebView APK (Quick)
1. Create Android project in Android Studio
2. Replace activity with:
```java
WebView webView = new WebView(this);
webView.getSettings().setJavaScriptEnabled(true);
webView.loadUrl("https://your-navpath-site.netlify.app");
setContentView(webView);
```
3. Build APK → Upload to Play Store

### Play Store Requirements:
- Google Developer Account: $25 one-time
- App icon 512×512 PNG ✓ (already included)
- Screenshots: Take on phone + Chrome DevTools
- Privacy Policy (required)
- Content rating questionnaire

---

## 🧪 STEP 6: Local Development & Testing

### Run Locally (Python)
```bash
cd navpath/
python3 -m http.server 8080
# Open: http://localhost:8080
```

### Run Locally (Node)
```bash
npx serve navpath/
# Open: http://localhost:3000
```

### Test PWA Install
1. Open Chrome DevTools → Application tab
2. Check Manifest, Service Workers, Cache Storage
3. Lighthouse → Run PWA audit (aim for 90+)

### Test Firebase Auth
- Use Chrome Incognito to test fresh signup
- Check Firebase Console → Authentication → Users

---

## 🏗️ Customization Guide

### Add More Questions
Edit `data/questions.json`:
```json
{
  "questions": {
    "chapter_id": [
      {
        "id": "unique_id",
        "question": "Your question here?",
        "options": ["Option A", "Option B", "Option C", "Option D"],
        "answer": 0,
        "explanation": "Because..."
      }
    ]
  }
}
```

The `answer` field is the **0-based index** of the correct option.

### Add More Formulas
Edit `script.js` → `FORMULAS` object:
```javascript
const FORMULAS = {
  math: [
    { title: 'Formula Name', content: 'Formula expression' },
    // ...
  ],
  physics: [...]
};
```

### Change Colors
Edit `style.css` → `:root` block:
```css
:root {
  --gold: #c9a84c;     /* Change gold accent */
  --navy-deep: #0a192f; /* Change background */
  --success: #22c55e;   /* Change success color */
}
```

---

## 🔒 Security Checklist

- [ ] Firebase config is in `firebase.js` (client-side, safe for web)
- [ ] Firestore Security Rules restrict users to their own data only
- [ ] Razorpay secret key is **NEVER** in frontend code
- [ ] Payment verification happens on backend / Cloud Function
- [ ] `isPremium` status is updated only by verified backend
- [ ] Use HTTPS in production (Netlify provides this free)

---

## 📊 Monitoring & Analytics

### Firebase Analytics (Free)
Add to `firebase.js`:
```javascript
import { getAnalytics } from "firebase/analytics";
const analytics = getAnalytics(app);
```

### Check User Stats
Firebase Console → Authentication → Users

### Check Firestore Data
Firebase Console → Firestore → Browse collections

---

## ❓ Troubleshooting

| Issue | Solution |
|-------|----------|
| Firebase not connecting | Check API keys in firebase.js |
| Login not working | Enable Email/Password auth in Firebase Console |
| Progress not saving | Check Firestore security rules |
| PWA not installable | Must be served over HTTPS |
| Payment failing | Check Razorpay key (test vs live) |
| App not loading offline | Clear cache, re-register service worker |

---

## 📞 Support

For technical issues with NavPath setup:
- GitHub Issues: Create an issue on your repo
- Firebase Docs: https://firebase.google.com/docs
- Razorpay Docs: https://razorpay.com/docs/
- Netlify Docs: https://docs.netlify.com/

---

*NavPath – Built for Indian Navy NEA aspirants 🇮🇳⚓*
