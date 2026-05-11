// ============================================================
// netlify/functions/send-reminders.js
// NavPath — FCM Reminder Sender (HTTP v1 API)
// Triggered by cron-job.org every minute
// ==========================================================

const https = require('https');

// ── Google OAuth2 token from Service Account ────────────────
async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header  = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
  };

  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64(header)}.${b64(payload)}`;

  // Sign with RS256 using Node crypto
  const crypto = require('crypto');
  const privateKey = serviceAccount.private_key.replace(/\\n/g, '\n');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const signature = sign.sign(privateKey, 'base64url');
  const jwt = `${unsigned}.${signature}`;

  // Exchange JWT for access token
  return new Promise((resolve, reject) => {
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
    const req  = https.request({
      hostname: 'oauth2.googleapis.com',
      path:     '/token',
      method:   'POST',
      headers:  { 'Content-Type': 'application/x-www-form-urlencoded' },
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) resolve(parsed.access_token);
          else reject(new Error('No access_token: ' + data));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Send FCM notification to one token ─────────────────────
async function sendFCM(accessToken, projectId, fcmToken, title, body) {
  const message = {
    message: {
      token: fcmToken,
      notification: { title, body },
      android: {
        priority: 'high',
        notification: {
          channel_id: 'navpath_reminders',
          sound:      'default',
          tag:        'navpath-study-reminder',
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      webpush: {
        headers:     { Urgency: 'high' },
        notification: {
          title, body,
          icon:               '/assets/icons/icon-192.png',
          badge:              '/assets/icons/icon-192.png',
          requireInteraction: true,
          vibrate:            [300, 100, 300, 100, 500],
          tag:                'navpath-study-reminder',
          renotify:           true,
          actions: [
            { action: 'study',    title: '📖 Study Now'    },
            { action: 'practice', title: '📝 Practice MCQs' },
          ],
        },
        fcm_options: { link: 'https://navalpath.netlify.app' },
      },
      data: { type: 'STUDY_REMINDER' },
    },
  };

  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(message);
    const req = https.request({
      hostname: 'fcm.googleapis.com',
      path:     `/v1/projects/${projectId}/messages:send`,
      method:   'POST',
      headers:  {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ── Firestore REST API helpers ──────────────────────────────
async function firestoreGet(accessToken, projectId, path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'firestore.googleapis.com',
      path:     `/v1/projects/${projectId}/databases/(default)/documents/${path}`,
      method:   'GET',
      headers:  { 'Authorization': `Bearer ${accessToken}` },
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Parse Firestore field value
function fsVal(field) {
  if (!field) return null;
  if (field.stringValue  !== undefined) return field.stringValue;
  if (field.integerValue !== undefined) return parseInt(field.integerValue);
  if (field.booleanValue !== undefined) return field.booleanValue;
  if (field.mapValue     !== undefined) return fsMap(field.mapValue.fields || {});
  return null;
}
function fsMap(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields)) obj[k] = fsVal(v);
  return obj;
}

// ── Quotes ──────────────────────────────────────────────────
const QUOTES = [
  { text: "Success is the sum of small efforts repeated day in and day out.", author: "Robert Collier" },
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Discipline is the bridge between goals and accomplishment.", author: "Jim Rohn" },
  { text: "A ship in harbour is safe, but that's not what ships are for.", author: "John A. Shedd" },
  { text: "Push yourself, because no one else is going to do it for you.", author: "Unknown" },
  { text: "Great things never come from comfort zones.", author: "Unknown" },
  { text: "Kal ki chinta mat kar, aaj ki mehnat kar — result khud aa jayega.", author: "NavPath" },
  { text: "Mehnat karo aaj, uniform pahno kal — ye wada hai NEA ka.", author: "NavPath" },
  { text: "Thoda aur padhlo yaar — Navy ka sapna door nahi hai!", author: "NavPath" },
  { text: "Neend baad mein lena — pehle Navy mein select ho jao!", author: "NavPath" },
  { text: "Haar mat — abhi toh khel shuru hua hai, aur tu jeetne ke liye bana hai.", author: "NavPath" },
  { text: "NEA is not just an exam — it's the door to your destiny. Open it.", author: "NavPath" },
  { text: "The ocean doesn't care how tired you are. Train harder.", author: "NavPath" },
  { text: "One day you'll wear that white uniform with pride — today, earn it.", author: "NavPath" },
  { text: "Operation Padhai: Mission Active. Target: NEA Selection. Go!", author: "NavPath" },
];

const GREETINGS = [
  (n) => `Hey ${n}, padhai ka waqt aa gaya! 📚`,
  (n) => `${n} bhai, uth! Study time! 💪`,
  (n) => `Aye ${n}! Navy ka sapna hai toh padhai karo! ⚓`,
  (n) => `${n}, ab phone rakh aur book uthao! 📗`,
  (n) => `Hey ${n}! NEA won't crack itself. Let's go! 💥`,
  (n) => `Rise and study, ${n}! Navy awaits! 🛳️`,
];

function getRand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ── Main handler ─────────────────────────────────────────────
exports.handler = async (event) => {

  // Security — only allow cron-job.org calls with secret header
  const secret = event.headers['x-cron-secret'] || event.headers['X-Cron-Secret'];
  if (secret !== process.env.CRON_SECRET) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  // Load service account from env
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FCM_SERVICE_ACCOUNT);
  } catch (e) {
    return { statusCode: 500, body: 'Invalid FCM_SERVICE_ACCOUNT env var' };
  }

  const projectId = serviceAccount.project_id;

  // Get current UTC time — convert to IST (UTC+5:30)
  const nowUTC  = new Date();
  const nowIST  = new Date(nowUTC.getTime() + (5.5 * 60 * 60 * 1000));
  const curHour = nowIST.getUTCHours();
  const curMin  = nowIST.getUTCMinutes();

  console.log(`[NavPath Cron] IST time: ${curHour}:${String(curMin).padStart(2,'0')}`);

  // Get OAuth token
  let accessToken;
  try {
    accessToken = await getAccessToken(serviceAccount);
  } catch (e) {
    return { statusCode: 500, body: 'OAuth failed: ' + e.message };
  }

  // Fetch all users from Firestore
  let usersDoc;
  try {
    usersDoc = await firestoreGet(accessToken, projectId, 'users');
  } catch (e) {
    return { statusCode: 500, body: 'Firestore fetch failed: ' + e.message };
  }

  const users = usersDoc.documents || [];
  console.log(`[NavPath Cron] Total users: ${users.length}`);

  let sent = 0, skipped = 0, errors = 0;

  for (const userDoc of users) {
    try {
      const fields   = userDoc.fields || {};
      const fcmToken = fsVal(fields.fcmToken);
      const reminder = fsVal(fields.reminder);

      // Skip if no FCM token or reminder not enabled
      if (!fcmToken || !reminder || !reminder.enabled) { skipped++; continue; }

      const rHour = parseInt(reminder.hour);
      const rMin  = parseInt(reminder.minute);

      // Check if current IST time matches reminder time
      if (rHour !== curHour || rMin !== curMin) { skipped++; continue; }

      // Get student name
      const displayName = fsVal(fields.displayName) || 'Sailor';
      const firstName   = displayName.split(/[\s@]/)[0] || 'Sailor';

      // Pick random quote and greeting
      const quote    = getRand(QUOTES);
      const greeting = getRand(GREETINGS)(firstName);
      const body     = `"${quote.text}" — ${quote.author}`;

      // Send FCM
      const result = await sendFCM(accessToken, projectId, fcmToken, greeting, body);
      if (result.status === 200) {
        console.log(`[NavPath Cron] ✓ Sent to ${firstName}`);
        sent++;
      } else {
        console.warn(`[NavPath Cron] ✗ Failed for ${firstName}:`, result.body);
        errors++;
      }
    } catch (e) {
      console.error('[NavPath Cron] Error for user:', e.message);
      errors++;
    }
  }

  const summary = `Sent: ${sent}, Skipped: ${skipped}, Errors: ${errors}`;
  console.log('[NavPath Cron] Done —', summary);
  return { statusCode: 200, body: summary };
};
    
