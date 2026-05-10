// ============================================================
// NavPath Study Reminder — Service Worker
// File: sw-reminder.js
// Place this file in the ROOT of your project (same folder as index.html)
// ============================================================

const QUOTES = [
  // English
  { text: "Success is the sum of small efforts repeated day in and day out.", author: "Robert Collier" },
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Don't wish it were easier. Wish you were better.", author: "Jim Rohn" },
  { text: "Discipline is the bridge between goals and accomplishment.", author: "Jim Rohn" },
  { text: "A ship in harbour is safe, but that's not what ships are for.", author: "John A. Shedd" },
  { text: "Small daily improvements over time lead to stunning results.", author: "Robin Sharma" },
  { text: "The harder you work for something, the greater you'll feel when you achieve it.", author: "Unknown" },
  { text: "Push yourself, because no one else is going to do it for you.", author: "Unknown" },
  { text: "Great things never come from comfort zones.", author: "Unknown" },
  { text: "Dream it. Believe it. Achieve it.", author: "Unknown" },
  { text: "Your only limit is your mind.", author: "Unknown" },
  { text: "Work hard in silence; let your success make the noise.", author: "Frank Ocean" },
  { text: "Opportunities don't happen. You create them.", author: "Chris Grosser" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "Strive for progress, not perfection.", author: "Unknown" },
  { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
  { text: "Every expert was once a beginner.", author: "Helen Hayes" },
  { text: "You don't have to be great to start, but you have to start to be great.", author: "Zig Ziglar" },
  { text: "Winners are not people who never fail, but people who never quit.", author: "Unknown" },
  { text: "Study now so you can live the life others only dream of.", author: "Unknown" },
  // Hinglish
  { text: "Kal ki chinta mat kar, aaj ki mehnat kar — result khud aa jayega.", author: "NavPath" },
  { text: "Sapne dekhna band mat karo, unhe pura karne ke liye padhai shuru karo.", author: "NavPath" },
  { text: "Thoda aur padhlo yaar — Navy ka sapna door nahi hai!", author: "NavPath" },
  { text: "Mehnat karo aaj, uniform pahno kal — ye wada hai NEA ka.", author: "NavPath" },
  { text: "Har question ek step hai — apni uniform ki taraf.", author: "NavPath" },
  { text: "Mushkil lagta hai? Theek hai. Mushkil kaam hi bade log karte hain.", author: "NavPath" },
  { text: "Neend baad mein lena — pehle Navy mein select ho jao!", author: "NavPath" },
  { text: "Ek din aisa aayega jab ye sab struggle kaam aayega. Tab muskurana yaad rakhna.", author: "NavPath" },
  { text: "Jo aaj thak kar padh raha hai, kal wahi uniform mein chamkeyga.", author: "NavPath" },
  { text: "Distraction bahut hai — focus sirf ek cheez pe: NEA crack karna.", author: "NavPath" },
  { text: "Haar mat — abhi toh khel shuru hua hai, aur tu jeetne ke liye bana hai.", author: "NavPath" },
  { text: "Padhai bore lagti hai? Soch — selection letter milne par kaisi feeling hogi!", author: "NavPath" },
  { text: "Log bolenge 'naseeb tha' — par tu janega kitni mehnat thi. Carry on.", author: "NavPath" },
  { text: "Uth, padh, practice kar — repeat. Yahi formula hai Navy ka.", author: "NavPath" },
  { text: "Tera competition sirf kal wala tu hai — aaj usse better ban.", author: "NavPath" },
  { text: "Darr mat — Navy ke sabse bade sapne, sabse zyada mehnat se pure hote hain.", author: "NavPath" },
  { text: "Time barbad mat kar yaar — ye pal dobara nahi aayega.", author: "NavPath" },
  { text: "Uniform ka sapna hai toh mobile rakh aur book uthao — simple hai.", author: "NavPath" },
  { text: "Mehnat ka koi shortcut nahi hota — par hard work ka reward zaroor hota hai.", author: "NavPath" },
  { text: "Thoda aur — ek aur chapter, ek aur question. Tu kar sakta hai!", author: "NavPath" },
  // NavPath / NEA Special
  { text: "The Navy doesn't just build ships — it builds sailors. Keep going.", author: "NavPath" },
  { text: "NEA is not just an exam — it's the door to your destiny. Open it.", author: "NavPath" },
  { text: "Every page you read today is a step closer to the deck of a warship.", author: "NavPath" },
  { text: "The ocean doesn't care how tired you are. Train harder.", author: "NavPath" },
  { text: "One day you'll wear that white uniform with pride — today, earn it.", author: "NavPath" },
  { text: "Sailors are not born — they are made through discipline and study.", author: "NavPath" },
  { text: "Your rank in the Navy starts with your rank in the exam. Study well.", author: "NavPath" },
  { text: "The sea is calling. Answer it with your best score.", author: "NavPath" },
  { text: "Math, Science, English — these three subjects are your ticket to the Navy.", author: "NavPath" },
  { text: "Every great officer once sat where you sit — studying, struggling, succeeding.", author: "NavPath" },
  { text: "INS Vikrant was built by engineers. You could be one — start studying.", author: "NavPath" },
  { text: "Sam No Varuna — May the sea be kind to you. But first, clear NEA.", author: "NavPath" },
  { text: "You didn't come this far to only come this far. Push harder today.", author: "NavPath" },
  { text: "The exam is tough because the Navy is tougher. You're tougher still.", author: "NavPath" },
  { text: "Operation Padhai: Mission Active. Target: NEA Selection. Go!", author: "NavPath" },
];

const GREETINGS = [
  (n) => `Hey ${n}, time to study! 📚`,
  (n) => `Hey ${n}, chalo padhai karte hain! 📖`,
  (n) => `Hey ${n}, chalo padne ka time ho gaya! ⏰`,
  (n) => `Hey ${n}, chalo chalo padne ka time ho gaya! 🚀`,
  (n) => `${n} bhai, uth! Padhai ka waqt aa gaya! 💪`,
  (n) => `Aye ${n}! Navy ka sapna hai toh padhai karo! ⚓`,
  (n) => `${n}, ab phone rakh aur book uthao! 📗`,
  (n) => `Oye ${n}! Ek aur chapter? Chalo! 🎯`,
  (n) => `${n}, your future self is waiting — go study! 🏆`,
  (n) => `Hey ${n}! NEA won't crack itself. Let's go! 💥`,
  (n) => `${n} — padh lo yaar, kal ke liye! 🌟`,
  (n) => `Rise and study, ${n}! Navy awaits! 🛳️`,
];

function getRand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ── State ────────────────────────────────────────────────────
let _alarmTimeout = null;
let _schedule = null; // { hour, minute, name }

// ── Message handler (called by main page) ───────────────────
self.addEventListener('message', e => {
  if (!e.data) return;
  if (e.data.type === 'SCHEDULE_REMINDER') {
    _schedule = { hour: e.data.hour, minute: e.data.minute, name: e.data.name || 'Sailor' };
    scheduleNext(_schedule);
  }
  if (e.data.type === 'CANCEL_REMINDER') {
    if (_alarmTimeout) { clearTimeout(_alarmTimeout); _alarmTimeout = null; }
    _schedule = null;
  }
  // Ping: reply with current schedule so page can verify
  if (e.data.type === 'PING') {
    e.source && e.source.postMessage({ type: 'PONG', schedule: _schedule });
  }
});

// ── Schedule next alarm ─────────────────────────────────────
function scheduleNext(s) {
  if (_alarmTimeout) { clearTimeout(_alarmTimeout); _alarmTimeout = null; }

  const now    = new Date();
  const target = new Date();
  target.setHours(s.hour, s.minute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);

  const delay = target.getTime() - now.getTime();
  console.log(`[NavPath SW] Alarm in ${Math.round(delay / 60000)} min`);

  _alarmTimeout = setTimeout(() => {
    fireAlarm(s);
    // Auto-reschedule for tomorrow
    scheduleNext(s);
  }, delay);
}

// ── Fire the alarm notification ─────────────────────────────
function fireAlarm(s) {
  const quote    = getRand(QUOTES);
  const greeting = getRand(GREETINGS)(s.name);

  self.registration.showNotification(greeting, {
    body: `"${quote.text}" — ${quote.author}`,
    icon:  '/assets/icons/icon-192.png',
    badge: '/assets/icons/icon-192.png',
    tag:   'navpath-study-reminder',
    renotify:        true,
    requireInteraction: true,
    vibrate: [300, 100, 300, 100, 500],
    data: { url: '/' }
  });

  // Also post to open tabs so they show the in-app banner
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    clients.forEach(c => c.postMessage({ type: 'REMINDER_FIRED', quote, greeting, name: s.name }));
  });
}

// ── Notification click — open the app ──────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const openTab = clients.find(c => c.url.includes(self.location.origin));
      if (openTab) return openTab.focus();
      return self.clients.openWindow('/');
    })
  );
});

// ── Lifecycle ───────────────────────────────────────────────
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(self.clients.claim()));
