// ============================================================
// NavPath – NEA Exam Prep App
// script.js – FULLY DEBUGGED & FIXED (v2)
// ============================================================
//
// BUGS FIXED (v1 — original):
//  1. App object not exposed to window  → window.App = App
//  2. login/signup btn never re-enabled on success → added reset in finally/success
//  3. firebase.firestore.Timestamp used directly → guarded with App.firebase ref
//  4. renderQuestion() references DOM nodes that don't exist until
//     renderLiveQuiz() is called → moved quiz DOM render inside startQuiz()
//  5. window.renderQuestion not exported → added to window exports
//  6. Demo mode showScreen called before loadResources resolves → await fixed
//  7. onAuthStateChanged triggers showScreen before renderDashboard finishes
//     → awaits are correct, but screen flash fix added with loading state
//  8. switchAuthTab ID collision: tab buttons have id="tab-login" / "tab-signup"
//     which conflicts with switchAuthTab() calling $(`#tab-${tab}`) — this
//     matched the TAB CONTENT divs too — FIXED by renaming tab button IDs
//     to "authtab-login" / "authtab-signup" (matching fix in index.html)
//
// BUGS FIXED (v2 — this version):
//  9. questions.json monolithic file replaced with 3 separate files:
//     english.json + math.json + science.json
//     loadResources() now fetches all 3 in parallel and merges topics/mockTests
//     into App.questions so all downstream code works unchanged.
// 10. Login/signup page not showing on load → initApp() and onAuthStateChanged
//     logout branch now call switchAuthTab('login') after showScreen('auth-screen')
//     so the login form is always visible by default.
// 11. switchAuthTab() now supports BOTH old (tab-login) and new (authtab-login)
//     button IDs so it works regardless of which index.html version is deployed.
// 12. openTopicModal() crashed when App.questions.topics[chapterId] was undefined
//     (happens for topics not yet loaded) — replaced with safe qBank lookup.
// 13. auth/invalid-credential error code added (newer Firebase SDK v9+ compat).
// 14. Demo mode loadResources() double-call removed — skips if already loaded.
//
// ============================================================

'use strict';

// ============================================================
// APP STATE
// ============================================================
const App = {
  user: null,
  userDoc: null,
  syllabus: null,
  questions: null,
  progress: {},
  currentScreen: null,
  currentPaper: null,
  currentQuiz: { chapterId: null, questions: [], idx: 0, score: 0, answered: false },
  firebase: null,
  selectedPlan: 'yearly',
  darkMode: true,
  content: {},
};

// FIX #1: App must be on window so the inline quiz override script in
// index.html can access window.App — previously it was a module-scoped const
window.App = App;

// ============================================================
// SAFE FIREBASE HELPERS — prevent crash if SDK loads late
// ============================================================
function fbTimestampNow() {
  try { return firebase.firestore.FieldValue.serverTimestamp(); }
  catch(e) { return new Date(); }
}
function fbTimestampFromDate(d) {
  try { return firebase.firestore.Timestamp.fromDate(d); }
  catch(e) { return d; }
}

// ============================================================
// DOM HELPERS
// ============================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function show(el) { if (typeof el === 'string') el = $(el); el?.classList.add('active'); }
function hide(el) { if (typeof el === 'string') el = $(el); el?.classList.remove('active'); }

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
function toast(msg, type = '') {
  const container = $('#toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ============================================================
// SCREEN NAVIGATION
// ============================================================
function showScreen(id) {
  // Deactivate all screens — position:absolute layers, only one shown at a time
  $$('.screen').forEach(s => {
    s.classList.remove('active');
    s.scrollTop = 0; // reset scroll position of hidden screens
  });
  const s = document.getElementById(id);
  if (s) {
    s.classList.add('active');
    s.scrollTop = 0; // always start at top when switching screens
    App.currentScreen = id;
  }
}

// ============================================================
// FIREBASE INIT
// ============================================================
function initApp() {
  App.firebase = window.initFirebase?.();

  if (!App.firebase) {
    console.warn('[NavPath] Firebase not configured. Running in demo mode.');
    loadResources().then(() => {
      showScreen('auth-screen');
      switchAuthTab('login'); // FIX: ensure login tab is shown by default
    });
    return;
  }

  const { auth } = App.firebase;

  // This is the SINGLE SOURCE OF TRUTH for UI state.
  // All screen switching must live here — never in .then() of signIn calls.
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      App.user = user;
      try {
        await loadUserData();
        await loadResources();
        renderDashboard();
        showScreen('main-screen');
        switchTab('dashboard');
      } catch (e) {
        console.error('[NavPath] Post-login setup failed:', e);
        showScreen('main-screen');
        switchTab('dashboard');
      }
    } else {
      App.user = null;
      App.userDoc = null;
      App.progress = {};
      // Reset buttons so they're never stuck disabled after logout
      const loginBtn = $('#login-btn');
      const signupBtn = $('#signup-btn');
      if (loginBtn) { loginBtn.textContent = 'Sign In →'; loginBtn.disabled = false; }
      if (signupBtn) { signupBtn.textContent = 'Start Free Trial 🚀'; signupBtn.disabled = false; }
      // Load resources BEFORE showing screen — prevents async blocking the auth UI
      await loadResources();
      showScreen('auth-screen');
      switchAuthTab('login');
    }
  });
}

// ============================================================
// LOAD JSON RESOURCES
// ============================================================

// ============================================================
// LOAD RESOURCES — loads syllabus + english.json + math.json + science.json
// All three question files are merged into App.questions so the
// rest of the app (quiz, mock test, practice browse) works unchanged.
// ============================================================
async function loadResources() {
  // Guard: skip if already loaded — prevents double-fetch race from onAuthStateChanged
  if (App.syllabus && App.questions) {
    console.log('[NavPath] Resources already loaded — skipping.');
    return;
  }
  try {
    // Load syllabus first (required)
    const sylRes = await fetch('syllabus.json');
    if (!sylRes.ok) throw new Error('syllabus.json not found');
    App.syllabus = await sylRes.json();
    console.log('[NavPath] syllabus.json loaded ✓');
  } catch (e) {
    console.error('[NavPath] Failed to load syllabus.json:', e.message);
  }

  // Load the three separate question files in parallel
  // Any file that fails is silently skipped so the app still works
  const questionFiles = [
    { file: 'english.json',  label: 'english'  },
    { file: 'math.json',     label: 'math'      },
    { file: 'science.json',  label: 'science'   },
  ];

  // Merged App.questions structure that the rest of the app expects:
  // { topics: { topicId: [...questions] }, mockTests: [...] }
  const merged = { topics: {}, mockTests: [] };

  await Promise.all(questionFiles.map(async ({ file, label }) => {
    try {
      const res = await fetch(file);
      if (!res.ok) {
        console.warn(`[NavPath] ${file} not found — skipping.`);
        return;
      }
      const data = await res.json();

      // Merge topics
      if (data.topics && typeof data.topics === 'object') {
        Object.assign(merged.topics, data.topics);
      }

      // Merge mockTests (avoid duplicates by id)
      if (Array.isArray(data.mockTests)) {
        data.mockTests.forEach(mt => {
          if (!merged.mockTests.find(m => m.id === mt.id)) {
            merged.mockTests.push(mt);
          }
        });
      }

      const qCount = data.topics ? Object.values(data.topics).reduce((s, a) => s + (a?.length || 0), 0) : 0;
      console.log(`[NavPath] ${file} loaded ✓ — ${qCount} questions (${label})`);
    } catch (e) {
      console.error(`[NavPath] Failed to load ${file}:`, e.message);
    }
  }));

  App.questions = merged;
  const total = Object.values(merged.topics).reduce((s, a) => s + (a?.length || 0), 0);
  console.log(`[NavPath] All question files merged ✓ — ${total} total questions, ${merged.mockTests.length} mock tests`);

  await loadContent();
  console.log('[NavPath] All resources loaded ✓');
}

// ============================================================
// LOAD USER DATA FROM FIRESTORE
// ============================================================
async function loadUserData() {
  if (!App.firebase || !App.user) return;
  const { db } = App.firebase;
  const uid = App.user.uid;

  try {
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();

    if (userSnap.exists) {
      App.userDoc = userSnap.data();
    } else {
      // Use real Date locally — serverTimestamp() is write-only and can't be read back
      const now = new Date();
      App.userDoc = {
        email: App.user.email,
        displayName: App.user.displayName || App.user.email.split('@')[0],
        createdAt: fbTimestampNow(),
        trialStartDate: now.toISOString(), // ISO string — safely readable by getTrialStatus()
        isPremium: false,
        premiumExpiry: null,
        planType: 'trial',
        streak: 0,
        lastStudiedDate: null,
      };
      // Write to Firestore with real Firestore timestamps
      await userRef.set({
        ...App.userDoc,
        createdAt: fbTimestampNow(),
        trialStartDate: fbTimestampNow(),
      });
    }

    // Load progress
    const progressSnap = await userRef.collection('progress').get();
    App.progress = {};
    progressSnap.forEach(doc => {
      App.progress[doc.id] = doc.data().completed;
    });

    await updateStreak();

  } catch (e) {
    console.error('[NavPath] Failed to load user data:', e);
    toast('Could not load your progress. Check connection.', 'error');
  }
}

// ============================================================
// TRIAL & PREMIUM CHECKS
// ============================================================
function getTrialStatus() {
  // Admin always gets full premium access — no payment needed
  if (isAdmin()) return { active: false, isPremium: true, isAdmin: true, daysLeft: 999 };

  if (!App.userDoc) return { active: true, daysLeft: 3 };
  if (App.userDoc.isPremium) return { active: false, isPremium: true, daysLeft: 999 };

  const start = App.userDoc.trialStartDate?.toDate?.()
    || (typeof App.userDoc.trialStartDate === 'string' ? new Date(App.userDoc.trialStartDate) : null)
    || new Date(App.userDoc.trialStartDate || Date.now());
  const now = new Date();
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysElapsed = Math.floor((now - start) / msPerDay);
  const daysLeft = Math.max(0, 3 - daysElapsed);

  return { active: daysLeft > 0, daysLeft, isPremium: false };
}

function canAccessTopic(topicId) {
  // Admin has full access to every topic
  if (isAdmin()) return true;
  const trial = getTrialStatus();
  if (trial.isPremium || trial.active) return true;
  return App.progress[topicId] === true;
}

// ============================================================
// SAVE PROGRESS TO FIRESTORE
// ============================================================
async function saveTopicProgress(topicId, completed) {
  App.progress[topicId] = completed;

  if (!App.firebase || !App.user) {
    updateSyllabusUI();
    return;
  }

  const { db } = App.firebase;
  const uid = App.user.uid;

  try {
    await db.collection('users').doc(uid)
      .collection('progress').doc(topicId)
      .set({ completed, completedAt: fbTimestampNow() });
    updateSyllabusUI();
    updateProgressStats();
  } catch (e) {
    console.error('[NavPath] Failed to save progress:', e);
    updateSyllabusUI();   // still update UI locally
    updateProgressStats();
    toast('Saved locally — sync failed, check connection.', 'error');
  }
}

// ============================================================
// STREAK TRACKING
// ============================================================
async function updateStreak() {
  if (!App.userDoc || !App.firebase || !App.user) return;

  const today = new Date().toISOString().split('T')[0];
  const lastDate = App.userDoc.lastStudiedDate;

  if (lastDate === today) return;

  let newStreak = App.userDoc.streak || 0;
  if (lastDate) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().split('T')[0];
    if (lastDate === yStr) {
      newStreak += 1;
    } else if (lastDate !== today) {
      newStreak = 1;
    }
  } else {
    newStreak = 1;
  }

  App.userDoc.streak = newStreak;
  App.userDoc.lastStudiedDate = today;

  await App.firebase.db.collection('users').doc(App.user.uid).update({
    streak: newStreak,
    lastStudiedDate: today
  }).catch(e => console.warn('[NavPath] Streak update failed:', e));
}

// ============================================================
// AUTH – SIGN UP
// ============================================================
async function handleSignup() {
  const name = $('#signup-name').value.trim();
  const email = $('#signup-email').value.trim();
  const pass = $('#signup-password').value;

  if (!name || !email || !pass) {
    toast('Please fill in all fields.', 'error');
    return;
  }
  if (pass.length < 6) {
    toast('Password must be at least 6 characters.', 'error');
    return;
  }

  const btn = $('#signup-btn');
  if (btn) { btn.textContent = 'Creating account...'; btn.disabled = true; }

  // Demo mode
  if (!App.firebase) {
    App.user = { uid: 'demo', email, displayName: name };
    App.userDoc = { displayName: name, email, trialStartDate: { toDate: () => new Date() }, isPremium: false, streak: 1, planType: 'trial' };
    // Only reload resources if not already loaded
    if (!App.syllabus || !App.questions) await loadResources();
    renderDashboard();
    showScreen('main-screen');
    switchTab('dashboard');
    toast('Welcome to NavPath! (Demo Mode)', 'success');
    btn.textContent = 'Start Free Trial 🚀';
    btn.disabled = false;
    return;
  }

  try {
    const { auth } = App.firebase;
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    await cred.user.updateProfile({ displayName: name });
    toast('Account created! Welcome aboard 🎉', 'success');
    // FIX #2: Do NOT reset button here — onAuthStateChanged fires next
    // and switches screen. If we reset, we risk a flash. The logout handler
    // in onAuthStateChanged resets buttons when returning to auth screen.
  } catch (e) {
    // FIX #2: Always reset button on error so user isn't stuck
    let msg = 'Signup failed. Please try again.';
    if (e.code === 'auth/email-already-in-use') msg = 'Email already registered. Please sign in.';
    else if (e.code === 'auth/invalid-email') msg = 'Invalid email address.';
    else if (e.code === 'auth/weak-password') msg = 'Password is too weak.';
    toast(msg, 'error');
    btn.textContent = 'Start Free Trial 🚀';
    btn.disabled = false;
  }
}

// ============================================================
// AUTH – LOGIN
// ============================================================
async function handleLogin() {
  const email = $('#login-email').value.trim();
  const pass = $('#login-password').value;

  if (!email || !pass) {
    toast('Please enter email and password.', 'error');
    return;
  }

  const btn = $('#login-btn');
  if (btn) { btn.textContent = 'Signing in...'; btn.disabled = true; }

  // Demo mode
  if (!App.firebase) {
    App.user = { uid: 'demo', email, displayName: email.split('@')[0] };
    App.userDoc = { displayName: email.split('@')[0], email, trialStartDate: { toDate: () => new Date() }, isPremium: false, streak: 3, planType: 'trial' };
    // Only reload resources if not already loaded
    if (!App.syllabus || !App.questions) await loadResources();
    renderDashboard();
    showScreen('main-screen');
    switchTab('dashboard');
    toast('Logged in! (Demo Mode)', 'success');
    btn.textContent = 'Sign In →';
    btn.disabled = false;
    return;
  }

  try {
    await App.firebase.auth.signInWithEmailAndPassword(email, pass);
    // FIX #2: onAuthStateChanged handles the screen switch.
    // DO NOT reset button here — it causes a race condition flash.
    // Button is reset by the onAuthStateChanged logout branch if sign-out happens.
  } catch (e) {
    // FIX #2: Always show specific, honest error and reset button
    let msg = 'Invalid email or password.';
    if (e.code === 'auth/user-not-found')        msg = 'No account found with this email.';
    else if (e.code === 'auth/wrong-password')   msg = 'Incorrect password.';
    else if (e.code === 'auth/invalid-credential') msg = 'Invalid email or password.'; // newer Firebase SDK
    else if (e.code === 'auth/invalid-email')    msg = 'Invalid email address.';
    else if (e.code === 'auth/too-many-requests') msg = 'Too many attempts. Please try again later.';
    else if (e.code === 'auth/network-request-failed') msg = 'Network error. Check your connection.';
    toast(msg, 'error');
    // FIX #2: Reset button on error
    btn.textContent = 'Sign In →';
    btn.disabled = false;
  }
}

// ============================================================
// AUTH – LOGOUT
// ============================================================
async function handleLogout() {
  if (App.firebase) {
    try {
      await App.firebase.auth.signOut();
      // onAuthStateChanged will fire and call showScreen('auth-screen')
    } catch (e) {
      toast('Logout failed. Try again.', 'error');
    }
  } else {
    App.user = null;
    App.userDoc = null;
    App.progress = {};
    showScreen('auth-screen');
    switchAuthTab('login');
  }
}

// ============================================================
// DASHBOARD RENDER
// ============================================================
function renderDashboard() {
  const name = App.userDoc?.displayName || App.user?.displayName || 'Sailor';
  const firstName = name.split(' ')[0];

  const welcomeEl = $('#welcome-name');
  if (welcomeEl) welcomeEl.innerHTML = `Welcome back, <span>${firstName}</span>`;

  renderTrialBanner();

  const streak = App.userDoc?.streak || 1;
  const streakEl = $('#streak-count');
  if (streakEl) streakEl.textContent = streak;

  updateProgressStats();
  renderProgressChart();
}

function renderTrialBanner() {
  const trial = getTrialStatus();
  const banner = $('#trial-banner');
  const premBadge = $('#premium-badge');

  // Admin: show special ADMIN badge, hide trial banner
  if (trial.isAdmin) {
    banner?.classList.add('hidden');
    if (premBadge) {
      premBadge.classList.remove('hidden');
      premBadge.innerHTML = '🛡️ ADMIN';
      premBadge.style.background = 'linear-gradient(135deg,rgba(56,189,248,0.3),rgba(56,189,248,0.6))';
      premBadge.style.color = '#e2effd';
    }
    return;
  }

  if (trial.isPremium) {
    banner?.classList.add('hidden');
    premBadge?.classList.remove('hidden');
  } else if (trial.active) {
    banner?.classList.remove('hidden');
    premBadge?.classList.add('hidden');
    const daysEl = $('#trial-days');
    if (daysEl) daysEl.textContent = trial.daysLeft;
    const msgEl = $('#trial-message');
    if (msgEl) msgEl.textContent = `${trial.daysLeft} day${trial.daysLeft !== 1 ? 's' : ''} left in your free trial`;
  } else {
    if (banner) {
      banner.classList.remove('hidden');
      banner.style.borderColor = 'rgba(239,68,68,0.4)';
      banner.style.background = 'rgba(239,68,68,0.07)';
      const daysEl = $('#trial-days');
      if (daysEl) { daysEl.style.color = '#ef4444'; daysEl.textContent = '0'; }
      const msgEl = $('#trial-message');
      if (msgEl) msgEl.textContent = 'Trial expired – Upgrade to continue';
    }
  }
}

function updateProgressStats() {
  if (!App.syllabus) return;

  let total = 0, completed = 0;
  App.syllabus.papers.forEach(paper => {
    paper.subjects.forEach(subject => {
      subject.chapters.forEach(chapter => {
 chapter.topics.forEach(topic => {
          total++;
          if (App.progress[topic.id]) completed++;
        });
      });
    });
  });

  const remaining = total - completed;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  if ($('#stat-total')) $('#stat-total').textContent = total;
  if ($('#stat-completed')) $('#stat-completed').textContent = completed;
  if ($('#stat-remaining')) $('#stat-remaining').textContent = remaining;
  if ($('#stat-pct')) $('#stat-pct').textContent = pct + '%';

  const bar = $('#main-progress-bar');
  if (bar) bar.style.width = pct + '%';
  if ($('#main-progress-pct')) $('#main-progress-pct').textContent = pct + '%';
}

// ============================================================
// PROGRESS CHART (Chart.js)
// ============================================================
let progressChart = null;

function renderProgressChart() {
  const ctx = $('#progress-chart');
  if (!ctx || !App.syllabus) return;

  const paperData = App.syllabus.papers.map(paper => {
    let total = 0, done = 0;
    paper.subjects.forEach(s => s.chapters.forEach(c => c.topics.forEach(t => {
      total++;
      if (App.progress[t.id]) done++;
    })));
    return { label: paper.name.split('–')[1]?.trim() || paper.name, pct: total ? Math.round(done / total * 100) : 0 };
  });

  if (progressChart) progressChart.destroy();

  progressChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: paperData.map(d => d.label),
      datasets: [{
        label: 'Completion %',
        data: paperData.map(d => d.pct),
        backgroundColor: ['rgba(42, 82, 152, 0.7)', 'rgba(201, 168, 76, 0.7)', 'rgba(34, 197, 94, 0.7)'],
        borderColor: ['#2a5298', '#c9a84c', '#22c55e'],
        borderWidth: 2,
        borderRadius: 8,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.raw}% complete` } }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          grid: { color: 'rgba(74, 111, 165, 0.15)' },
          ticks: { color: '#7a9cc0', callback: v => v + '%' }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#7a9cc0', font: { size: 11 } }
        }
      }
    }
  });
}

// ============================================================
// SYLLABUS SCREEN RENDER
// ============================================================
function renderSyllabus() {
  const container = $('#syllabus-container');
  if (!container || !App.syllabus) return;

  container.innerHTML = '';

  App.syllabus.papers.forEach(paper => {
    const paperEl = document.createElement('div');
    paperEl.className = 'paper-card';
    paperEl.dataset.paperId = paper.id;

    let pTotal = 0, pDone = 0;
    paper.subjects.forEach(s => s.chapters.forEach(c => c.topics.forEach(t => {
      pTotal++; if (App.progress[t.id]) pDone++;
    })));
    const pPct = pTotal ? Math.round(pDone / pTotal * 100) : 0;
    const subjectIcon = paper.subjects[0]?.icon || '📚';

    paperEl.innerHTML = `
      <div class="paper-header" onclick="togglePaper('${paper.id}')">
        <div class="paper-icon">${subjectIcon}</div>
        <div class="paper-meta">
          <h3>${paper.name}</h3>
          <p>${pDone}/${pTotal} topics • ${paper.totalMarks} marks • ${pPct}% done</p>
        </div>
        <span class="paper-chevron">▶</span>
      </div>
      <div class="chapter-list" id="paper-chapters-${paper.id}">
        ${renderChapters(paper)}
      </div>
    `;

    container.appendChild(paperEl);
  });
}

function renderChapters(paper) {
  let html = '';
  paper.subjects.forEach(subject => {
    subject.chapters.forEach(chapter => {
      let cTotal = chapter.topics.length;
      let cDone = chapter.topics.filter(t => App.progress[t.id]).length;
      const cPct = cTotal ? Math.round(cDone / cTotal * 100) : 0;
      const radius = 14;
      const circ = 2 * Math.PI * radius;
      const offset = circ - (cPct / 100) * circ;

      html += `
        <div class="chapter-item" id="chapter-${chapter.id}">
          <div class="chapter-header" onclick="toggleChapter('${chapter.id}')">
            <div class="chapter-progress-ring">
              <svg viewBox="0 0 36 36">
                <circle class="ring-bg" cx="18" cy="18" r="${radius}"/>
                <circle class="ring-fill" cx="18" cy="18" r="${radius}"
                  stroke-dasharray="${circ}"
                  stroke-dashoffset="${offset}"/>
              </svg>
            </div>
            <div class="chapter-meta">
              <h4>${chapter.name}</h4>
              <p>${cDone}/${cTotal} done • ${chapter.marks} marks</p>
            </div>
            <div style="display:flex;gap:0.4rem;align-items:center;">
              <button class="btn btn-sm btn-outline" style="font-size:0.7rem;padding:0.2rem 0.5rem;" onclick="event.stopPropagation();startChapterPractice('${chapter.id}','${chapter.name}')">📝</button>
              <span style="color:var(--text-muted);font-size:0.8rem;">▼</span>
            </div>
          </div>
          <div class="topic-list" id="topics-${chapter.id}">
            ${renderTopics(chapter)}
          </div>
        </div>
      `;
    });
  });
  return html;
}

function renderTopics(chapter) {
  let html = '';
  chapter.topics.forEach(topic => {
    const done = App.progress[topic.id] || false;
    const accessible = canAccessTopic(topic.id);
    const isLocked = !accessible;

    html += `
      <div class="topic-item ${done ? 'completed' : ''} ${isLocked ? 'locked' : ''}"
           onclick="${isLocked ? 'openPremiumModal()' : `openTopicModal('${topic.id}','${topic.name.replace(/'/g,"\\'")}','${chapter.id}','${chapter.name.replace(/'/g,"\\'")}')` }">
        <div class="topic-check">${done ? '✓' : ''}</div>
        <span class="topic-name">${topic.name}</span>
        <div class="topic-right-actions">
          ${isLocked ? '<span class="lock-icon">🔒</span>' : '<span class="topic-chevron">›</span>'}
        </div>
      </div>
    `;
  });
  return html;
}

function togglePaper(paperId) {
  const card = document.querySelector(`[data-paper-id="${paperId}"]`);
  card?.classList.toggle('open');
}

function toggleChapter(chapterId) {
  const item = $(`#chapter-${chapterId}`);
  item?.classList.toggle('open');
}

async function toggleTopic(topicId) {
  const current = App.progress[topicId] || false;
  await saveTopicProgress(topicId, !current);
  if (!current) {
    toast('Topic marked complete! 🎯', 'success');
    await updateStreak();
  }
}
function updateSyllabusUI() {
  const syllabusTab = document.getElementById('tab-syllabus');
  if (App.currentScreen === 'main-screen' && syllabusTab?.classList.contains('active-tab')) {
    renderSyllabus();
  }
  updateProgressStats();
}

// ============================================================
// QUIZ SYSTEM
// FIX #4: renderQuestion() expects DOM nodes (#quiz-q-number, etc.)
// that only exist AFTER renderLiveQuiz() injects them.
// Previously startQuiz() called renderQuestion() immediately — these
// nodes were null so the quiz silently broke.
// FIX: startQuiz() now builds the quiz shell itself before calling
// renderQuestion(), removing the dependency on the fragile
// index.html override script timing.
// ============================================================
function startQuiz(chapterId) {
  const qBank = App.questions?.topics || App.questions?.questions;
  if (!qBank || !qBank[chapterId] || qBank[chapterId].length === 0) {
    toast('No questions available for this chapter yet.', 'info');
    return;
  }

  const questions = [...qBank[chapterId]].sort(() => Math.random() - 0.5);

  App.currentQuiz = { chapterId, questions, idx: 0, score: 0, answered: false, wrongIdx: [] };

  switchTab('practice');

  // Hide browse, show quiz
  const browseEl = $('#practice-browse-area');
  const area = $('#quiz-question-area');
  const result = $('#quiz-result-area');
  if (browseEl) browseEl.classList.add('hidden');
  if (result) result.classList.add('hidden');
  // Find chapter/topic name for display
  let chapterLabel = chapterId;
  if (App.syllabus) {
    for (const paper of App.syllabus.papers) {
      for (const subj of paper.subjects) {
        const ch = subj.chapters.find(c => c.id === chapterId);
        if (ch) { chapterLabel = ch.name; break; }
      }
    }
  }

  if (area) {
    area.classList.remove('hidden');
    area.innerHTML = `
      <div class="practice-container">

        <div class="practice-top-bar">
          <button class="practice-back-btn" onclick="practiceGoBack()">← Back</button>
          <div class="practice-chapter-label">${chapterLabel}</div>
          <div class="practice-score-badge">🎯 <span id="quiz-score-live">0</span>/${questions.length}</div>
        </div>

        <div class="practice-progress-wrap">
          <div class="practice-progress-bar" id="quiz-prog-bar" style="width:0%"></div>
        </div>

        <div class="practice-q-counter" id="quiz-progress-text">Question 1 of ${questions.length}</div>

        <div class="practice-question-card">
          <div class="practice-q-number" id="quiz-q-number">Q1</div>
          <div class="practice-q-text" id="quiz-q-text">Loading…</div>
        </div>

        <div class="practice-options" id="quiz-options"></div>

        <div class="practice-explanation hidden" id="quiz-explanation">
          <div class="practice-exp-label">💡 Explanation</div>
          <div class="practice-exp-text" id="quiz-exp-text"></div>
        </div>

        <button class="btn btn-primary btn-block practice-next-btn hidden" id="quiz-next-btn"
                onclick="nextQuestion()">
          Next →
        </button>

      </div>
    `;
  }

  renderQuestion();
}

function renderQuestion() {
  const { questions, idx } = App.currentQuiz;
  const q = questions[idx];
  if (!q) { showQuizResults(); return; }

  App.currentQuiz.answered = false;

  const qNum     = document.getElementById('quiz-q-number');
  const qText    = document.getElementById('quiz-q-text');
  const qProg    = document.getElementById('quiz-progress-text');
  const qExp     = document.getElementById('quiz-explanation');
  const qNext    = document.getElementById('quiz-next-btn');
  const qBar     = document.getElementById('quiz-prog-bar');
  const scoreLive= document.getElementById('quiz-score-live');

  const total = questions.length;
  const pct   = Math.round((idx / total) * 100);

  if (qNum)      qNum.textContent  = `Q${idx + 1}`;
  if (qText)     qText.textContent = q.q || q.question || '';
  if (qProg)     qProg.textContent = `Question ${idx + 1} of ${total}`;
  if (qBar)      qBar.style.width  = `${pct}%`;
  if (scoreLive) scoreLive.textContent = App.currentQuiz.score;

  // Hide explanation and Next button until answer is selected
  if (qExp)  { qExp.classList.add('hidden'); qExp.classList.remove('show'); }
  if (qNext) { qNext.classList.add('hidden'); qNext.textContent = idx === total - 1 ? 'Finish ✓' : 'Next →'; }

  const optionsEl = document.getElementById('quiz-options');
  if (!optionsEl) return;
  optionsEl.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D'];
  q.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'practice-option';
    btn.innerHTML = `<span class="practice-option-letter">${letters[i]}</span><span class="practice-option-text">${opt}</span>`;
    btn.onclick = () => selectAnswer(i, q.answer);
    optionsEl.appendChild(btn);
  });
}

function selectAnswer(selected, correct) {
  if (App.currentQuiz.answered) return;
  App.currentQuiz.answered = true;

  const isCorrect = selected === correct;
  if (isCorrect) {
    App.currentQuiz.score++;
  } else {
    if (!App.currentQuiz.wrongIdx) App.currentQuiz.wrongIdx = [];
    App.currentQuiz.wrongIdx.push(App.currentQuiz.idx);
  }

  // Update score display
  const scoreEl = document.getElementById('quiz-score-live');
  if (scoreEl) scoreEl.textContent = App.currentQuiz.score;

  // Style option buttons — correct green, wrong red, others dimmed
  const options = document.querySelectorAll('.practice-option');
  options.forEach((opt, i) => {
    opt.onclick = null; // disable further clicks
    opt.classList.add('answered');
    if (i === correct) {
      opt.classList.add('practice-correct');
    } else if (i === selected && !isCorrect) {
      opt.classList.add('practice-wrong');
    } else {
      opt.classList.add('practice-dimmed');
    }
  });

  // Show result toast
  if (isCorrect) {
    toast('✅ Correct!', 'success');
  } else {
    toast('❌ Incorrect — read the explanation.', 'error');
  }

  // Show explanation block
  const q = App.currentQuiz.questions[App.currentQuiz.idx];
  const expEl  = document.getElementById('quiz-explanation');
  const expTxt = document.getElementById('quiz-exp-text');
  if (expEl && expTxt) {
    expTxt.textContent = q.explanation || q.exp || '';
    expEl.classList.remove('hidden');
    expEl.classList.add('show');
  }

  // Show Next / Finish button
  const qNext = document.getElementById('quiz-next-btn');
  if (qNext) qNext.classList.remove('hidden');
}

function nextQuestion() {
  App.currentQuiz.idx++;
  if (App.currentQuiz.idx >= App.currentQuiz.questions.length) {
    showQuizResults();
  } else {
    renderQuestion();
  }
}

function showQuizResults() {
  const { score, questions, chapterId } = App.currentQuiz;
  const total = questions.length;
  const pct   = Math.round(score / total * 100);
  const wrong = total - score;

  let grade, emoji, msg, gradeCls;
  if (pct >= 90)      { grade='A+'; emoji='🏆'; msg='Outstanding, Sailor!';              gradeCls='grade-aplus'; }
  else if (pct >= 80) { grade='A';  emoji='🥇'; msg='Excellent work! Keep it up.';        gradeCls='grade-a'; }
  else if (pct >= 60) { grade='B';  emoji='👍'; msg='Good progress. Review the misses.';  gradeCls='grade-b'; }
  else if (pct >= 40) { grade='C';  emoji='📖'; msg='Needs improvement. Study first.';    gradeCls='grade-c'; }
  else                { grade='D';  emoji='⚓'; msg='Read Study notes, then retry.';      gradeCls='grade-d'; }

  const resultArea = document.getElementById('quiz-result-area');
  if (resultArea) {
    resultArea.innerHTML = `
      <div class="practice-results">
        <div class="result-hero">
          <div class="result-emoji">${emoji}</div>
          <div class="result-grade ${gradeCls}">${grade}</div>
          <div class="result-score">${score} / ${total}</div>
          <div class="result-pct-text">${pct}%</div>
          <div class="result-msg">${msg}</div>
        </div>
        <div class="result-stats-row">
          <div class="result-stat result-stat-correct">
            <div class="result-stat-num">${score}</div>
            <div class="result-stat-lbl">Correct</div>
          </div>
          <div class="result-stat result-stat-wrong">
            <div class="result-stat-num">${wrong}</div>
            <div class="result-stat-lbl">Wrong</div>
          </div>
          <div class="result-stat result-stat-pct">
            <div class="result-stat-num">${pct}%</div>
            <div class="result-stat-lbl">Score</div>
          </div>
        </div>
        <div class="result-actions">
          <button class="btn btn-primary btn-block" onclick="resetQuiz()">🔄 Try Again</button>
          <button class="btn btn-outline btn-block" style="margin-top:0.75rem;"
                  onclick="_handleStudyAfterResult('${chapterId}')">📖 Study This Topic</button>
          <button class="btn btn-outline btn-block" style="margin-top:0.75rem;"
                  onclick="practiceGoBack()">← Back to Practice</button>
        </div>
      </div>
    `;
    resultArea.classList.remove('hidden');
  }

  const questionArea = document.getElementById('quiz-question-area');
  if (questionArea) questionArea.classList.add('hidden');
}

function _handleStudyAfterResult(chapterId) {
  if (App.syllabus) {
    for (const paper of App.syllabus.papers) {
      for (const subj of paper.subjects) {
        const ch = subj.chapters.find(c => c.id === chapterId);
        if (ch && ch.topics.length > 0) {
          _activeTopicId   = ch.topics[0].id;
          _activeChapterId = chapterId;
          switchTab('study');
          studyOpenTopic(_activeTopicId, ch.topics[0].name, chapterId, ch.name);
          return;
        }
      }
    }
  }
  switchTab('study');
}

function practiceGoBack() {
  App.currentQuiz = { chapterId: null, questions: [], idx: 0, score: 0, answered: false };
  const browseEl  = $('#practice-browse-area');
  const quizArea  = $('#quiz-question-area');
  const resultArea= $('#quiz-result-area');
  const mockArea  = document.getElementById('mock-test-area');
  if (quizArea)   quizArea.classList.add('hidden');
  if (resultArea) resultArea.classList.add('hidden');
  if (mockArea)   mockArea.classList.add('hidden');
  if (browseEl)   browseEl.classList.remove('hidden');
  renderPracticeBrowse();
}

function resetQuiz() {
  const questionArea = $('#quiz-question-area');
  const resultArea = $('#quiz-result-area');
  if (questionArea) questionArea.classList.remove('hidden');
  if (resultArea) resultArea.classList.add('hidden');
  if (App.currentQuiz.chapterId) {
    startQuiz(App.currentQuiz.chapterId);
  }
}

// ============================================================
// TAB SWITCHING
// ============================================================
function switchTab(tabName) {
  $$('.tab-content').forEach(el => el.classList.remove('active-tab'));
  $$('.nav-item').forEach(el => el.classList.remove('active'));

  const content = document.getElementById(`tab-${tabName}`);
  const navItem = document.getElementById(`nav-${tabName}`);

  content?.classList.add('active-tab');
  navItem?.classList.add('active');

  switch (tabName) {
    case 'dashboard': renderDashboard(); break;
    case 'syllabus':  renderSyllabus();  break;
    case 'practice':  renderPracticeBrowse(); break;
    case 'study':     renderStudyBrowse();    break;
    case 'profile':   renderProfile();        break;
  }
}

function updateNavHighlight(tab) {
  switchTab(tab);
}

// ============================================================
// STUDY BROWSE — Independent subject → chapter → topic flow
// ============================================================
function renderStudyBrowse() {
  // Hide content view, show browse
  const browseEl  = $('#study-browse-area');
  const contentEl = $('#study-content-area');
  if (!browseEl || !App.syllabus) return;
  if (contentEl) contentEl.classList.add('hidden');
  browseEl.classList.remove('hidden');

  let html = `
    <div class="section-header mb-2">
      <h2 class="section-title">📖 Study Notes</h2>
      <span style="font-size:0.75rem;color:var(--text-muted);">Select a topic to start reading</span>
    </div>
  `;

  App.syllabus.papers.forEach(paper => {
    html += `<div class="paper-card" style="margin-bottom:1rem;">
      <div class="paper-header" onclick="this.parentElement.classList.toggle('open')">
        <div class="paper-icon">${paper.subjects[0]?.icon || '📚'}</div>
        <div class="paper-meta">
          <h3>${paper.name}</h3>
          <p>${paper.totalMarks} marks</p>
        </div>
        <span class="paper-chevron">▶</span>
      </div>
      <div class="chapter-list">`;

    paper.subjects.forEach(subject => {
      subject.chapters.forEach(chapter => {
        const topicCount = chapter.topics.length;
        html += `
          <div class="chapter-item" id="study-chapter-${chapter.id}">
            <div class="chapter-header" onclick="document.getElementById('study-chapter-${chapter.id}').classList.toggle('open')">
              <div class="chapter-progress-ring">
                <svg viewBox="0 0 36 36">
                  <circle class="ring-bg" cx="18" cy="18" r="14"/>
                  <circle class="ring-fill" cx="18" cy="18" r="14" stroke-dasharray="87.96" stroke-dashoffset="87.96"/>
                </svg>
              </div>
              <div class="chapter-meta">
                <h4>${chapter.name}</h4>
                <p>${topicCount} topics • ${chapter.marks} marks</p>
              </div>
              <span style="color:var(--text-muted);font-size:0.8rem;">▼</span>
            </div>
            <div class="topic-list" id="study-topics-${chapter.id}">`;

        chapter.topics.forEach(topic => {
          const hasContent = App.content && App.content[topic.id];
          const accessible = canAccessTopic(topic.id);
          html += `
              <div class="topic-item ${accessible ? '' : 'locked'}"
                   onclick="${accessible ? `studyOpenTopic('${topic.id}','${topic.name.replace(/'/g,"\\'")}','${chapter.id}','${chapter.name.replace(/'/g,"\\'")}')` : 'openPremiumModal()'}">
                <div class="topic-check" style="background:${hasContent ? 'rgba(34,197,94,0.15)' : 'transparent'};border-color:${hasContent ? '#22c55e' : 'var(--card-border)'};color:${hasContent ? '#22c55e' : 'transparent'};">
                  ${hasContent ? '📖' : ''}
                </div>
                <span class="topic-name">${topic.name}</span>
                <div class="topic-right-actions">
                  ${accessible ? '<span class="topic-chevron">›</span>' : '<span class="lock-icon">🔒</span>'}
                </div>
              </div>`;
        });

        html += `</div></div>`;
      });
    });

    html += `</div></div>`;
  });

  html += `<div style="padding-bottom:5rem;"></div>`;
  browseEl.innerHTML = html;
}
function studyOpenTopic(topicId, topicName, chapterId, chapterName) {
  _activeTopicId   = topicId;
  _activeChapterId = chapterId;

  const browseEl  = $('#study-browse-area');
  const contentEl = $('#study-content-area');
  if (!browseEl || !contentEl) return;

  browseEl.classList.add('hidden');
  contentEl.classList.remove('hidden');

  const content = App.content && App.content[topicId];

  if (!content) {
    contentEl.innerHTML = `
      <div style="padding:1rem;">
        <button class="study-back-btn" style="margin-bottom:1rem;background:var(--card-bg);border:1px solid var(--card-border);color:var(--text-primary);padding:0.5rem 1rem;border-radius:var(--radius-sm);cursor:pointer;font-size:0.85rem;" onclick="renderStudyBrowse()">← Back to Study</button>
        <div class="empty-state">
          <div class="empty-icon">📖</div>
          <h3>${topicName}</h3>
          <p style="color:var(--text-muted);font-size:0.85rem;margin-top:0.5rem;">Detailed study notes for this topic are being prepared. Check back soon!</p>
          <button class="btn btn-outline mt-2" onclick="studyStartPractice('${chapterId}')">📝 Practice MCQs Instead</button>
        </div>
      </div>`;
    return;
  }

  contentEl.innerHTML = `
    <div class="study-header">
      <button class="study-back-btn" onclick="renderStudyBrowse()">← Study</button>
      <h2 class="study-title">${content.title}</h2>
    </div>
    <div class="study-body">
      <div class="study-notes-block">
        <div class="study-section-label">📘 Study Notes</div>
        <div class="study-notes-text">${content.notes.split('\n\n').map(p => '<p>' + p + '</p>').join('')}</div>
      </div>

      ${content.points?.length ? `
      <div class="study-card">
        <div class="study-section-label">📌 Key Points</div>
        <ul class="study-points-list">
          ${content.points.map(p => `<li>${p}</li>`).join('')}
        </ul>
      </div>` : ''}

      ${content.examples?.length ? `
      <div class="study-card">
        <div class="study-section-label">💡 Examples</div>
        <div class="study-examples">
          ${content.examples.map((e, i) => `
            <div class="study-example-item">
              <span class="example-num">${i + 1}</span>
              <span>${e}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}

      ${content.summary ? `
      <div class="study-card study-summary-card">
        <div class="study-section-label">⚡ Quick Summary</div>
        <p class="study-summary-text">${content.summary}</p>
      </div>` : ''}

      <div style="padding-bottom:6rem;text-align:center;margin-top:1.5rem;">
        <button class="btn btn-primary" style="margin-right:0.5rem;"
          onclick="studyStartPractice('${chapterId}')">
          📝 Practice This Topic
        </button>
        <button class="btn btn-outline" onclick="renderStudyBrowse()">
          ← Back
        </button>
      </div>
    </div>
  `;
}

function studyStartPractice(chapterId) {
  _activeChapterId = chapterId;
  switchTab('practice');
  startQuiz(chapterId);
}

// ============================================================
// PRACTICE BROWSE — Independent subject → chapter → topic flow
// ============================================================
function renderPracticeBrowse() {
  // Only show browse if no active quiz
  const quizArea   = $('#quiz-question-area');
  const resultArea = $('#quiz-result-area');
  const browseEl   = $('#practice-browse-area');

  if (!browseEl || !App.syllabus) return;

  // If a quiz is actively running (has questions and not just results), keep quiz view
  if (App.currentQuiz.questions.length > 0 && quizArea && !quizArea.classList.contains('hidden')) {
    return;
  }

  // Show browse, hide quiz/results
  browseEl.classList.remove('hidden');
  if (quizArea)  quizArea.classList.add('hidden');
  if (resultArea) resultArea.classList.add('hidden');

  // ── Total questions count ──
  const qBank = App.questions?.topics || App.questions?.questions || {};
  const totalQs = Object.values(qBank).reduce((s, arr) => s + (arr?.length || 0), 0);

  let html = `
    <div class="section-header mb-2">
      <h2 class="section-title">📝 Practice MCQs</h2>
      <span style="font-size:0.75rem;color:var(--text-muted);">${totalQs}+ questions loaded</span>
    </div>

    <div class="mock-test-banner card mb-2" style="background:linear-gradient(135deg,rgba(42,82,152,0.3),rgba(201,168,76,0.15));border:1px solid rgba(201,168,76,0.3);cursor:pointer;" onclick="openMockTestModal()">
      <div class="card-body" style="display:flex;align-items:center;gap:1rem;padding:1rem;">
        <div style="font-size:2rem;">🎯</div>
        <div style="flex:1;">
          <div style="font-weight:700;font-size:0.95rem;color:var(--text-primary);">Timed Mock Tests</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.15rem;">Simulate real NEA exam conditions with timer</div>
        </div>
        <div style="background:var(--gold);color:var(--navy-deepest);border-radius:100px;padding:0.3rem 0.75rem;font-size:0.72rem;font-weight:700;">START →</div>
      </div>
    </div>

    <div style="font-size:0.8rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:0.75rem;">Chapter-wise Practice</div>
  `;

  App.syllabus.papers.forEach(paper => {
    html += `<div class="paper-card" style="margin-bottom:1rem;">
      <div class="paper-header" onclick="this.parentElement.classList.toggle('open')">
        <div class="paper-icon">${paper.subjects[0]?.icon || '📚'}</div>
        <div class="paper-meta">
          <h3>${paper.name}</h3>
          <p>${paper.totalMarks} marks</p>
        </div>
        <span class="paper-chevron">▶</span>
      </div>
      <div class="chapter-list">`;

    paper.subjects.forEach(subject => {
      subject.chapters.forEach(chapter => {
        const qCount = qBank[chapter.id] ? qBank[chapter.id].length : 0;
        const hasQ = qCount > 0;

        html += `
          <div class="chapter-item" id="prac-chapter-${chapter.id}">
            <div class="chapter-header" style="cursor:${hasQ ? 'pointer' : 'default'};"
                 onclick="${hasQ ? `practiceStartChapter('${chapter.id}','${chapter.name.replace(/'/g,"\\'")}')` : ''}">
              <div class="chapter-progress-ring">
                <svg viewBox="0 0 36 36">
                  <circle class="ring-bg" cx="18" cy="18" r="14"/>
                  ${hasQ ? `<circle class="ring-fill" cx="18" cy="18" r="14" stroke-dasharray="87.96" stroke-dashoffset="44"/>` : ''}
                </svg>
              </div>
              <div class="chapter-meta">
                <h4>${chapter.name}</h4>
                <p>${hasQ ? `${qCount} questions` : 'Questions coming soon'} • ${chapter.marks} marks</p>
              </div>
              <div style="display:flex;gap:0.4rem;align-items:center;">
                ${hasQ
                  ? `<button class="btn btn-sm btn-outline" style="font-size:0.7rem;padding:0.3rem 0.75rem;background:rgba(201,168,76,0.1);border-color:var(--gold);color:var(--gold);"
                         onclick="event.stopPropagation();practiceStartChapter('${chapter.id}','${chapter.name.replace(/'/g,"\\'")}')">▶ Start</button>`
                  : `<span style="font-size:0.7rem;color:var(--text-muted);padding:0.3rem 0.5rem;">Soon</span>`
                }
              </div>
            </div>
          </div>`;
      });
    });

    html += `</div></div>`;
  });

  html += `<div style="padding-bottom:5rem;"></div>`;
  browseEl.innerHTML = html;
}



function practiceStartChapter(chapterId, chapterName) {
  _activeChapterId = chapterId;
  startQuiz(chapterId);
}

// ============================================================
// PROFILE SCREEN
// ============================================================
function renderProfile() {
  const el = $('#tab-profile');
  if (!el) return;

  const name = App.userDoc?.displayName || App.user?.displayName || 'User';
  const email = App.user?.email || '';
  const trial = getTrialStatus();
  const streak = App.userDoc?.streak || 0;

  let statusBadge = trial.isAdmin
    ? `<span style="color:#38bdf8">🛡️ Administrator (Full Access)</span>`
    : trial.isPremium
      ? `<span style="color:var(--gold)">⭐ Premium Member</span>`
      : trial.active
        ? `<span style="color:var(--success)">🟢 Free Trial (${trial.daysLeft} days left)</span>`
        : `<span style="color:var(--danger)">⚠️ Trial Expired</span>`;

  el.innerHTML = `
    <div class="main-content">
      <div class="card mb-2">
        <div class="card-body">
          <div class="profile-avatar">👤</div>
          <div class="profile-name">${name}</div>
          <div class="profile-email">${email}</div>
          <div style="text-align:center;margin-bottom:1rem;font-size:0.85rem;">${statusBadge}</div>
          <div style="display:flex;justify-content:center;gap:1rem;flex-wrap:wrap;">
            <div class="streak-badge">🔥 ${streak} day streak</div>
          </div>
        </div>
      </div>

      <div class="card mb-2">
        <div class="card-header"><span>Subscription</span></div>
        <div class="card-body">
          ${trial.isAdmin
            ? `<p style="color:#38bdf8">🛡️ Admin account — full access enabled</p>
               <a href="admin.html" style="display:block;margin-top:0.75rem;padding:0.6rem;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.3);border-radius:var(--radius);color:#38bdf8;text-align:center;font-size:0.85rem;font-weight:600;text-decoration:none;">⚙️ Open Admin Panel</a>`
            : trial.isPremium
              ? `<p style="color:var(--success)">✓ Active premium subscription</p>`
              : `<button class="btn btn-gold btn-block" onclick="openPremiumModal()">⭐ Upgrade to Premium</button>
                 <p style="text-align:center;font-size:0.75rem;margin-top:0.5rem;color:var(--text-muted)">Plans from ₹99 only</p>`
          }
        </div>
      </div>

      <div class="settings-list card mb-2">
        <div class="settings-item" onclick="toggleDarkMode()">
          <div class="settings-item-left">
            <div class="settings-item-icon">🌙</div>
            <span>Dark Mode</span>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="dark-mode-toggle" ${App.darkMode ? 'checked' : ''} onchange="toggleDarkMode()">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="settings-item" onclick="toggleStudyReminder()" style="cursor:pointer;">
          <div class="settings-item-left">
            <div class="settings-item-icon">🔔</div>
            <div>
              <span>Study Reminders</span>
              ${StudyReminder.load().enabled
                ? `<div style="font-size:0.7rem;color:var(--gold,#c9a84c);margin-top:0.1rem;">⏰ ${StudyReminder.formatTime(StudyReminder.load().hour, StudyReminder.load().minute)} daily</div>`
                : `<div style="font-size:0.7rem;color:var(--text-muted,#6b92bc);margin-top:0.1rem;">Tap to set a daily alarm</div>`
              }
            </div>
          </div>
          <label class="toggle-switch" onclick="event.stopPropagation();toggleStudyReminder();">
            <input type="checkbox" ${StudyReminder.load().enabled ? 'checked' : ''} readonly>
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="settings-item" onclick="handleLogout()">
          <div class="settings-item-left">
            <div class="settings-item-icon">🚪</div>
            <span style="color:var(--danger)">Logout</span>
          </div>
          <span style="color:var(--text-muted)">›</span>
        </div>
      </div>

      <p style="text-align:center;font-size:0.7rem;color:var(--text-muted);padding:1rem 0;">
        NavPath v1.0 · NEA Exam Prep<br>
        For support: navpath@support.com
      </p>
    </div>
  `;
}

// ============================================================
// STUDY REMINDER SYSTEM — FCM (Firebase Cloud Messaging)
// Primary: FCM push — works even when app/phone is closed
// Fallback: In-page interval — shows banner when app is open
// ============================================================

const VAPID_KEY = 'BCGcIcacPjzNtk06UlqdP6F1hPubzCrrgkHTyIDM6-33bXp2SZWnQ280alwhh0a7pzaFa0v_Vaqcp3lqbiPsZ9w';
const FCM_PROJECT_ID  = 'navpath-19986';
const FCM_SENDER_ID   = '424012418705';
const FCM_API_KEY     = 'AIzaSyAr7Tnoq0FrMEx8BZotdOTg7Du-2-wZ0fo';

const StudyReminder = {
  _interval: null,

  // ── Persistence ────────────────────────────────────────────
  load() {
    try {
      const raw = localStorage.getItem('navpath-reminder');
      if (!raw) return { enabled: false, hour: 18, minute: 0 };
      return JSON.parse(raw);
    } catch (e) { return { enabled: false, hour: 18, minute: 0 }; }
  },

  save(settings) {
    localStorage.setItem('navpath-reminder', JSON.stringify(settings));
  },

  formatTime(hour, minute) {
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const h = hour % 12 || 12;
    const m = String(minute).padStart(2, '0');
    return `${h}:${m} ${ampm}`;
  },

  // ── Notification permission ─────────────────────────────────
  async requestPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied')  return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
  },

  // ── Quotes pool ─────────────────────────────────────────────
  _quotes: [
    { text: "Success is the sum of small efforts repeated day in and day out.", author: "Robert Collier", color: "#1a3a5c", accent: "#38bdf8" },
    { text: "The secret of getting ahead is getting started.", author: "Mark Twain", color: "#1a3320", accent: "#22c55e" },
    { text: "Don't wish it were easier. Wish you were better.", author: "Jim Rohn", color: "#2a1a3a", accent: "#a78bfa" },
    { text: "Discipline is the bridge between goals and accomplishment.", author: "Jim Rohn", color: "#3a1a1a", accent: "#f87171" },
    { text: "A ship in harbour is safe, but that's not what ships are for.", author: "John A. Shedd", color: "#1a2a3a", accent: "#c9a84c" },
    { text: "Small daily improvements over time lead to stunning results.", author: "Robin Sharma", color: "#1a3326", accent: "#34d399" },
    { text: "The harder you work for something, the greater you'll feel when you achieve it.", author: "Unknown", color: "#2a2a1a", accent: "#fbbf24" },
    { text: "Push yourself, because no one else is going to do it for you.", author: "Unknown", color: "#1a1a3a", accent: "#818cf8" },
    { text: "Great things never come from comfort zones.", author: "Unknown", color: "#3a1a2a", accent: "#f472b6" },
    { text: "Dream it. Believe it. Achieve it.", author: "Unknown", color: "#1a3a30", accent: "#2dd4bf" },
    { text: "Your only limit is your mind.", author: "Unknown", color: "#2a1a10", accent: "#fb923c" },
    { text: "Work hard in silence; let your success make the noise.", author: "Frank Ocean", color: "#1a2a1a", accent: "#86efac" },
    { text: "Opportunities don't happen. You create them.", author: "Chris Grosser", color: "#1a1a2a", accent: "#93c5fd" },
    { text: "It always seems impossible until it's done.", author: "Nelson Mandela", color: "#2a1a1a", accent: "#fca5a5" },
    { text: "Strive for progress, not perfection.", author: "Unknown", color: "#1a2a3a", accent: "#c9a84c" },
    { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt", color: "#1a2a1a", accent: "#4ade80" },
    { text: "Every expert was once a beginner.", author: "Helen Hayes", color: "#2a1a3a", accent: "#c084fc" },
    { text: "You don't have to be great to start, but you have to start to be great.", author: "Zig Ziglar", color: "#1a3a1a", accent: "#86efac" },
    { text: "Winners are not people who never fail, but people who never quit.", author: "Unknown", color: "#1a2030", accent: "#60a5fa" },
    { text: "Study now so you can live the life others only dream of.", author: "Unknown", color: "#1a1f10", accent: "#a3e635" },
    { text: "Kal ki chinta mat kar, aaj ki mehnat kar — result khud aa jayega.", author: "NavPath", color: "#1a2a1a", accent: "#4ade80" },
    { text: "Sapne dekhna band mat karo, unhe pura karne ke liye padhai shuru karo.", author: "NavPath", color: "#2a1a3a", accent: "#c084fc" },
    { text: "Thoda aur padhlo yaar — Navy ka sapna door nahi hai!", author: "NavPath", color: "#0a1e3a", accent: "#38bdf8" },
    { text: "Mehnat karo aaj, uniform pahno kal — ye wada hai NEA ka.", author: "NavPath", color: "#1a2a10", accent: "#86efac" },
    { text: "Har question ek step hai — apni uniform ki taraf.", author: "NavPath", color: "#1a1a3a", accent: "#818cf8" },
    { text: "Mushkil lagta hai? Theek hai. Mushkil kaam hi bade log karte hain.", author: "NavPath", color: "#3a1a1a", accent: "#fca5a5" },
    { text: "Neend baad mein lena — pehle Navy mein select ho jao!", author: "NavPath", color: "#1a2a3a", accent: "#c9a84c" },
    { text: "Ek din aisa aayega jab ye sab struggle kaam aayega.", author: "NavPath", color: "#1a3326", accent: "#34d399" },
    { text: "Jo aaj thak kar padh raha hai, kal wahi uniform mein chamkeyga.", author: "NavPath", color: "#2a1a10", accent: "#fb923c" },
    { text: "Distraction bahut hai — focus sirf ek cheez pe: NEA crack karna.", author: "NavPath", color: "#2a1a3a", accent: "#a78bfa" },
    { text: "Haar mat — abhi toh khel shuru hua hai, aur tu jeetne ke liye bana hai.", author: "NavPath", color: "#1a3a30", accent: "#2dd4bf" },
    { text: "Padhai bore lagti hai? Soch — selection letter milne par kaisi feeling hogi!", author: "NavPath", color: "#3a1a2a", accent: "#f472b6" },
    { text: "Log bolenge 'naseeb tha' — par tu janega kitni mehnat thi.", author: "NavPath", color: "#2a2a1a", accent: "#fbbf24" },
    { text: "Uth, padh, practice kar — repeat. Yahi formula hai Navy ka.", author: "NavPath", color: "#1a1a2a", accent: "#93c5fd" },
    { text: "Tera competition sirf kal wala tu hai — aaj usse better ban.", author: "NavPath", color: "#1a2a1a", accent: "#22c55e" },
    { text: "Darr mat — Navy ke sabse bade sapne, sabse zyada mehnat se pure hote hain.", author: "NavPath", color: "#1a3a5c", accent: "#60a5fa" },
    { text: "Time barbad mat kar yaar — ye pal dobara nahi aayega.", author: "NavPath", color: "#2a1a1a", accent: "#f87171" },
    { text: "Uniform ka sapna hai toh mobile rakh aur book uthao — simple hai.", author: "NavPath", color: "#1a2030", accent: "#38bdf8" },
    { text: "Mehnat ka koi shortcut nahi hota — par reward zaroor hota hai.", author: "NavPath", color: "#1a1f10", accent: "#a3e635" },
    { text: "Thoda aur — ek aur chapter, ek aur question. Tu kar sakta hai!", author: "NavPath", color: "#0d1f35", accent: "#c9a84c" },
    { text: "The Navy doesn't just build ships — it builds sailors. Keep going.", author: "NavPath", color: "#0a1e3a", accent: "#38bdf8" },
    { text: "NEA is not just an exam — it's the door to your destiny. Open it.", author: "NavPath", color: "#0d1f35", accent: "#c9a84c" },
    { text: "Every page you read today is a step closer to the deck of a warship.", author: "NavPath", color: "#0a1e2a", accent: "#2dd4bf" },
    { text: "The ocean doesn't care how tired you are. Train harder.", author: "NavPath", color: "#0a1628", accent: "#60a5fa" },
    { text: "One day you'll wear that white uniform with pride — today, earn it.", author: "NavPath", color: "#1a2a3a", accent: "#e2effd" },
    { text: "Sailors are not born — they are made through discipline and study.", author: "NavPath", color: "#0f1e30", accent: "#38bdf8" },
    { text: "Your rank in the Navy starts with your rank in the exam. Study well.", author: "NavPath", color: "#1a1a2a", accent: "#c9a84c" },
    { text: "The sea is calling. Answer it with your best score.", author: "NavPath", color: "#0a2030", accent: "#34d399" },
    { text: "Math, Science, English — these three subjects are your ticket to the Navy.", author: "NavPath", color: "#1a2010", accent: "#86efac" },
    { text: "Every great officer once sat where you sit — studying, struggling, succeeding.", author: "NavPath", color: "#1e1a2a", accent: "#a78bfa" },
    { text: "INS Vikrant was built by engineers. You could be one — start studying.", author: "NavPath", color: "#0a1e1a", accent: "#2dd4bf" },
    { text: "Sam No Varuna — May the sea be kind to you. But first, clear NEA.", author: "NavPath", color: "#0a1830", accent: "#38bdf8" },
    { text: "You didn't come this far to only come this far. Push harder today.", author: "NavPath", color: "#1a0a2a", accent: "#c084fc" },
    { text: "The exam is tough because the Navy is tougher. You're tougher still.", author: "NavPath", color: "#1a2a1a", accent: "#4ade80" },
    { text: "Operation Padhai: Mission Active. Target: NEA Selection. Go!", author: "NavPath", color: "#0d1f35", accent: "#fbbf24" },
  ],

  _greetings: [
    (n) => `Hey ${n}, time to study! 📚`,
    (n) => `Hey ${n}, chalo padhai karte hain! 📖`,
    (n) => `Hey ${n}, padne ka time ho gaya! ⏰`,
    (n) => `${n} bhai, uth! Padhai ka waqt aa gaya! 💪`,
    (n) => `Aye ${n}! Navy ka sapna hai toh padhai karo! ⚓`,
    (n) => `${n}, ab phone rakh aur book uthao! 📗`,
    (n) => `Oye ${n}! Ek aur chapter? Chalo! 🎯`,
    (n) => `${n}, your future self is waiting — go study! 🏆`,
    (n) => `Hey ${n}! NEA won't crack itself. Let's go! 💥`,
    (n) => `${n} — padh lo yaar, kal ke liye! 🌟`,
    (n) => `Rise and study, ${n}! Navy awaits! 🛳️`,
  ],

  _randomGreeting(name) {
    return this._greetings[Math.floor(Math.random() * this._greetings.length)](name);
  },

  _randomQuote() {
    return this._quotes[Math.floor(Math.random() * this._quotes.length)];
  },

  _studentName() {
    try {
      const name = window.App?.userDoc?.displayName || window.App?.user?.displayName || window.App?.user?.email || '';
      return name.split(/[\s@]/)[0] || 'Sailor';
    } catch (e) { return 'Sailor'; }
  },

  // ── FCM Token ───────────────────────────────────────────────
  async getFCMToken() {
    try {
      if (typeof firebase === 'undefined') return null;
      if (!firebase.messaging) return null;
      const messaging = firebase.messaging();
      const token = await messaging.getToken({ vapidKey: VAPID_KEY });
      if (token) {
        // Save token to Firestore so server can target this device
        const uid = window.App?.user?.uid;
        if (uid && window.App?.firebase?.db) {
          await window.App.firebase.db.collection('users').doc(uid).update({
            fcmToken: token,
            fcmUpdatedAt: fbTimestampNow()
          });
        }
        localStorage.setItem('navpath-fcm-token', token);
        console.log('[NavPath FCM] Token saved:', token.substring(0, 20) + '...');
      }
      return token;
    } catch (e) {
      console.warn('[NavPath FCM] getToken failed:', e.message);
      return null;
    }
  },

  // ── Schedule alarm via Firestore (Cloud Function triggers FCM) ──
  async scheduleInFirestore(hour, minute) {
    try {
      const uid = window.App?.user?.uid;
      const db  = window.App?.firebase?.db;
      if (!uid || !db) return false;
      await db.collection('users').doc(uid).update({
        reminder: {
          enabled: true,
          hour,
          minute,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
          updatedAt: fbTimestampNow()
        }
      });
      console.log('[NavPath FCM] Reminder scheduled in Firestore');
      return true;
    } catch (e) {
      console.warn('[NavPath FCM] Firestore schedule failed:', e.message);
      return false;
    }
  },

  // ── Cancel alarm in Firestore ───────────────────────────────
  async cancelInFirestore() {
    try {
      const uid = window.App?.user?.uid;
      const db  = window.App?.firebase?.db;
      if (!uid || !db) return;
      await db.collection('users').doc(uid).update({
        'reminder.enabled': false
      });
    } catch (e) { console.warn('[NavPath FCM] Cancel failed:', e); }
  },

  // ── Listen for FCM foreground messages ─────────────────────
  listenForeground() {
    try {
      if (typeof firebase === 'undefined' || !firebase.messaging) return;
      const messaging = firebase.messaging();
      messaging.onMessage((payload) => {
        console.log('[NavPath FCM] Foreground message:', payload);
        // Show in-app banner when app is open
        const data    = payload.data || {};
        const quoteIdx = parseInt(data.quoteIdx) || 0;
        const quote   = this._quotes[quoteIdx % this._quotes.length];
        const name    = this._studentName();
        const greeting = this._randomGreeting(name);
        this._showBanner(name, quote, greeting);
      });
    } catch (e) { console.warn('[NavPath FCM] onMessage failed:', e); }
  },

  // ── In-page interval fallback (banner when app open + no FCM) ──
  _startFallbackInterval() {
    if (this._interval) clearInterval(this._interval);
    this._interval = setInterval(() => {
      const cfg = this.load();
      if (!cfg.enabled) return;
      const now = new Date();
      if (now.getHours() === cfg.hour && now.getMinutes() === cfg.minute) {
        const todayKey  = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
        const lastFired = parseInt(localStorage.getItem('navpath-reminder-last') || '0');
        if (lastFired !== todayKey) {
          localStorage.setItem('navpath-reminder-last', String(todayKey));
          const name    = this._studentName();
          const quote   = this._randomQuote();
          const greeting = this._randomGreeting(name);
          // Show in-app banner
          this._showBanner(name, quote, greeting);
          // Also fire browser notification if permission granted
          if (Notification.permission === 'granted') {
            new Notification(greeting, {
              body: `"${quote.text}" — ${quote.author}`,
              icon:  'assets/icons/icon-192.png',
              badge: 'assets/icons/icon-192.png',
              tag:   'navpath-study-reminder',
              renotify: true,
              requireInteraction: true,
            });
          }
        }
      }
    }, 30000);
  },

  // ── Enable ──────────────────────────────────────────────────
  async enable(hour, minute) {
    // 1. Request notification permission
    const granted = await this.requestPermission();
    if (!granted) {
      toast('Please allow notifications in your browser to use reminders.', 'error');
      return false;
    }

    // 2. Save locally
    this.save({ enabled: true, hour, minute });

    // 3. Get FCM token — registers firebase-messaging-sw.js
    //    This token is saved to Firestore so Netlify cron can target this device
    await this.getFCMToken();

    // 4. Save reminder schedule to Firestore
    //    Netlify cron reads this every minute to know who to notify
    await this.scheduleInFirestore(hour, minute);

    // 5. Listen for foreground FCM messages (when app is open)
    this.listenForeground();

    // 6. Fallback interval — extra safety when app is open
    this._startFallbackInterval();

    return true;
  },

  // ── Disable ─────────────────────────────────────────────────
  async disable() {
    const s = this.load();
    s.enabled = false;
    this.save(s);
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
    await this.cancelInFirestore();
  },

  // ── Show in-app banner ─────────────────────────────────────
  fireNotification() {
    const name     = this._studentName();
    const quote    = this._randomQuote();
    const greeting = this._randomGreeting(name);
    if (Notification.permission === 'granted') {
      const n = new Notification(greeting, {
        body: `"${quote.text}" — ${quote.author}`,
        icon: 'assets/icons/icon-192.png',
        badge: 'assets/icons/icon-192.png',
        tag: 'navpath-study-reminder',
        renotify: true,
        requireInteraction: true,
      });
      n.onclick = () => { window.focus(); n.close(); };
    }
    this._showBanner(name, quote, greeting);
  },

  _showBanner(name, quote, greeting) {
    document.getElementById('study-reminder-banner')?.remove();
    const banner = document.createElement('div');
    banner.id = 'study-reminder-banner';
    banner.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:9999;animation:reminderSlideDown 0.4s cubic-bezier(.4,0,.2,1);`;
    banner.innerHTML = `
      <style>
        @keyframes reminderSlideDown{from{opacity:0;transform:translateY(-100%)}to{opacity:1;transform:none}}
        @keyframes reminderFadeOut{from{opacity:1;transform:none}to{opacity:0;transform:translateY(-100%)}}
        #study-reminder-banner .rb-quote-box{background:${quote.color};border-bottom:3px solid ${quote.accent};position:relative;overflow:hidden;}
        #study-reminder-banner .rb-quote-box::before{content:'\\u275D';position:absolute;top:-10px;left:12px;font-size:5rem;color:${quote.accent};opacity:0.12;font-family:Georgia,serif;line-height:1;pointer-events:none;}
      </style>
      <div style="background:#0d1f35;border-bottom:1px solid rgba(201,168,76,0.3);padding:0.75rem 1rem 0;display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <span style="font-size:1.1rem;">📚</span>
          <div>
            <div style="font-size:0.85rem;font-weight:700;color:#e2effd;">${greeting}</div>
            <div style="font-size:0.65rem;color:#6b92bc;font-family:monospace;">NavPath Daily Reminder</div>
          </div>
        </div>
        <button onclick="document.getElementById('study-reminder-banner').remove()"
          style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:50%;width:28px;height:28px;color:#6b92bc;cursor:pointer;font-size:0.85rem;display:flex;align-items:center;justify-content:center;flex-shrink:0;">✕</button>
      </div>
      <div class="rb-quote-box" style="padding:1rem 1rem 1rem 1.25rem;">
        <div style="font-size:0.88rem;font-style:italic;color:#e2effd;line-height:1.55;position:relative;z-index:1;">"${quote.text}"</div>
        <div style="margin-top:0.5rem;font-size:0.7rem;font-weight:600;color:${quote.accent};font-family:monospace;position:relative;z-index:1;">— ${quote.author}</div>
      </div>
      <div style="background:#0a1628;border-bottom:2px solid ${quote.accent};padding:0.5rem 1rem;display:flex;gap:0.5rem;align-items:center;">
        <button onclick="window.switchTab&&window.switchTab('study');document.getElementById('study-reminder-banner').remove();"
          style="flex:1;padding:0.45rem;background:${quote.accent};color:#0a1628;border:none;border-radius:0.5rem;font-size:0.78rem;font-weight:700;cursor:pointer;">📖 Start Studying</button>
        <button onclick="window.switchTab&&window.switchTab('practice');document.getElementById('study-reminder-banner').remove();"
          style="flex:1;padding:0.45rem;background:rgba(255,255,255,0.06);color:#e2effd;border:1px solid rgba(255,255,255,0.12);border-radius:0.5rem;font-size:0.78rem;font-weight:600;cursor:pointer;">📝 Practice MCQs</button>
      </div>`;
    document.body.appendChild(banner);
    setTimeout(() => {
      const el = document.getElementById('study-reminder-banner');
      if (el) { el.style.animation = 'reminderFadeOut 0.4s ease forwards'; setTimeout(() => el.remove(), 400); }
    }, 12000);
  },
};

// Auto-init on load
(function initReminderOnLoad() {
  const s = StudyReminder.load();
  if (!s.enabled) return;

  // Re-register firebase-messaging-sw.js and refresh FCM token
  // This ensures the token in Firestore is always fresh
  StudyReminder.getFCMToken();

  // Listen for foreground FCM messages (banner when app open)
  StudyReminder.listenForeground();

  // Fallback interval
  StudyReminder._startFallbackInterval();
})();

// ── REMINDER MODAL ──────────────────────────────────────────
function openReminderModal() {
  document.getElementById('reminder-modal')?.remove();
  const s      = StudyReminder.load();
  const hour   = s.hour   ?? 18;
  const minute = s.minute ?? 0;

  // Convert 24hr to 12hr for display
  const isPM    = hour >= 12;
  const h12     = hour % 12 || 12;

  // Build hour options 1-12
  const hourOpts = Array.from({length:12},(_,i)=>i+1).map(h =>
    `<option value="${h}" ${h===h12?'selected':''}>${String(h).padStart(2,'0')}</option>`
  ).join('');

  // Build minute options 00,05,10...55
  const minOpts = Array.from({length:12},(_,i)=>i*5).map(m =>
    `<option value="${m}" ${m===Math.round(minute/5)*5?'selected':''}>${String(m).padStart(2,'0')}</option>`
  ).join('');

  const selStyle = `flex:1;padding:0.75rem 0.5rem;background:#060d1a;border:1.5px solid rgba(201,168,76,0.35);border-radius:0.625rem;color:#e2effd;font-size:1.3rem;font-weight:700;text-align:center;outline:none;cursor:pointer;font-family:inherit;appearance:none;-webkit-appearance:none;`;

  const overlay = document.createElement('div');
  overlay.id = 'reminder-modal';
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(6,16,30,0.85);backdrop-filter:blur(6px);z-index:999;display:flex;align-items:flex-end;justify-content:center;`;
  overlay.onclick = (e) => { if (e.target === overlay) closeReminderModal(); };

overlay.innerHTML = `
    <div style="background:var(--card-bg,#112240);border:1px solid var(--card-border,rgba(201,168,76,0.25));border-radius:1.25rem 1.25rem 0 0;padding:1.5rem 1.25rem 2.5rem;width:100%;max-width:480px;box-shadow:0 -8px 40px rgba(0,0,0,0.5);animation:slideUpModal 0.28s cubic-bezier(.4,0,.2,1);">
      <div style="width:40px;height:4px;background:rgba(255,255,255,0.15);border-radius:99px;margin:0 auto 1.25rem;"></div>
      <h2 style="text-align:center;font-size:1.1rem;font-weight:700;color:#e2effd;margin-bottom:0.35rem;">🔔 Study Reminder</h2>
      <p style="text-align:center;font-size:0.8rem;color:#6b92bc;margin-bottom:1.5rem;">Get a daily notification at your chosen study time.</p>

      <div style="background:rgba(201,168,76,0.07);border:1px solid rgba(201,168,76,0.2);border-radius:0.875rem;padding:1.25rem;margin-bottom:1.25rem;">
        <label style="display:block;font-size:0.72rem;font-weight:600;color:#6b92bc;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:0.875rem;text-align:center;">Choose Reminder Time</label>

        <!-- Custom AM/PM Picker -->
        <div style="display:flex;gap:0.5rem;align-items:center;justify-content:center;">

          <!-- Hour -->
          <select id="rm-hour" style="${selStyle}">
            ${hourOpts}
          </select>

          <span style="font-size:1.6rem;font-weight:700;color:#c9a84c;">:</span>

          <!-- Minute -->
          <select id="rm-minute" style="${selStyle}">
            ${minOpts}
          </select>

          <!-- AM / PM -->
          <div style="display:flex;flex-direction:column;gap:0.3rem;flex-shrink:0;">
            <button id="rm-am" onclick="rmSetPeriod('AM')"
              style="padding:0.4rem 0.75rem;border-radius:0.5rem;border:1.5px solid rgba(201,168,76,0.35);font-size:0.85rem;font-weight:700;cursor:pointer;transition:all 0.15s;background:${!isPM?'#c9a84c':'transparent'};color:${!isPM?'#0a1628':'#6b92bc'};">AM</button>
            <button id="rm-pm" onclick="rmSetPeriod('PM')"
              style="padding:0.4rem 0.75rem;border-radius:0.5rem;border:1.5px solid rgba(201,168,76,0.35);font-size:0.85rem;font-weight:700;cursor:pointer;transition:all 0.15s;background:${isPM?'#c9a84c':'transparent'};color:${isPM?'#0a1628':'#6b92bc'};">PM</button>
          </div>
        </div>

        <!-- Live preview -->
        <div id="rm-preview" style="margin-top:0.875rem;text-align:center;font-size:1rem;font-weight:700;color:#c9a84c;font-family:'IBM Plex Mono',monospace;letter-spacing:0.05em;">
          ${StudyReminder.formatTime(hour, minute)} daily
        </div>

        <p style="margin-top:0.4rem;font-size:0.7rem;color:#6b92bc;text-align:center;">Notification daily — even when app is closed.</p>
      </div>

      <div id="reminder-notif-warning" style="display:none;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);border-radius:0.625rem;padding:0.75rem;margin-bottom:1rem;font-size:0.78rem;color:#ef4444;text-align:center;">
        ⚠️ Notifications blocked. Please enable in browser settings.
      </div>

      <button onclick="saveReminderFromModal()" style="width:100%;padding:0.875rem;background:linear-gradient(135deg,#c9a84c,#dab850);color:#0a1628;border:none;border-radius:0.75rem;font-size:0.95rem;font-weight:700;cursor:pointer;margin-bottom:0.75rem;">✅ Set Reminder</button>
      <button onclick="disableReminderFromModal()" style="width:100%;padding:0.75rem;background:transparent;color:#6b92bc;border:1px solid rgba(255,255,255,0.1);border-radius:0.75rem;font-size:0.85rem;font-weight:500;cursor:pointer;">🔕 Turn Off Reminders</button>
    </div>
    <style>
      @keyframes slideUpModal{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:none}}
      #rm-hour:focus,#rm-minute:focus{border-color:#c9a84c!important;box-shadow:0 0 0 3px rgba(201,168,76,0.15)}
      #rm-hour option,#rm-minute option{background:#0d1f35;color:#e2effd;}
    </style>`;

  document.body.appendChild(overlay);

  // Live preview update on change
  const updatePreview = () => {
    const h   = parseInt(document.getElementById('rm-hour')?.value || 6);
    const m   = parseInt(document.getElementById('rm-minute')?.value || 0);
    const pm  = document.getElementById('rm-pm')?.style.background === 'rgb(201, 168, 76)';
    const h24 = pm ? (h===12?12:h+12) : (h===12?0:h);
    const prev = document.getElementById('rm-preview');
    if (prev) prev.textContent = StudyReminder.formatTime(h24, m) + ' daily';
  };
  document.getElementById('rm-hour')?.addEventListener('change', updatePreview);
  document.getElementById('rm-minute')?.addEventListener('change', updatePreview);

  if ('Notification' in window && Notification.permission === 'denied') {
    document.getElementById('reminder-notif-warning').style.display = 'block';
  }
}

// AM/PM toggle helper
function rmSetPeriod(period) {
  const amBtn = document.getElementById('rm-am');
  const pmBtn = document.getElementById('rm-pm');
  if (!amBtn || !pmBtn) return;
  if (period === 'AM') {
    amBtn.style.background = '#c9a84c'; amBtn.style.color = '#0a1628';
    pmBtn.style.background = 'transparent'; pmBtn.style.color = '#6b92bc';
  } else {
    pmBtn.style.background = '#c9a84c'; pmBtn.style.color = '#0a1628';
    amBtn.style.background = 'transparent'; amBtn.style.color = '#6b92bc';
  }
  // Update preview
  const h  = parseInt(document.getElementById('rm-hour')?.value || 6);
  const m  = parseInt(document.getElementById('rm-minute')?.value || 0);
  const h24 = period === 'PM' ? (h===12?12:h+12) : (h===12?0:h);
  const prev = document.getElementById('rm-preview');
  if (prev) prev.textContent = StudyReminder.formatTime(h24, m) + ' daily';
}

function closeReminderModal() {
  document.getElementById('reminder-modal')?.remove();
  renderProfile();
}

async function saveReminderFromModal() {
  const hSel  = document.getElementById('rm-hour');
  const mSel  = document.getElementById('rm-minute');
  const pmBtn = document.getElementById('rm-pm');

  if (!hSel || !mSel) { toast('Please select a time.', 'error'); return; }

  const h12  = parseInt(hSel.value);
  const m    = parseInt(mSel.value);
  const isPM = pmBtn?.style.background === 'rgb(201, 168, 76)';
  const h24  = isPM ? (h12 === 12 ? 12 : h12 + 12) : (h12 === 12 ? 0 : h12);

  const ok = await StudyReminder.enable(h24, m);
  if (ok) {
    toast(`✅ Reminder set for ${StudyReminder.formatTime(h24, m)} daily!`, 'success');
    closeReminderModal();
  } else {
    document.getElementById('reminder-notif-warning').style.display = 'block';
  }
}

function disableReminderFromModal() {
  StudyReminder.disable();
  toast('🔕 Study reminders turned off.', 'info');
  closeReminderModal();
}

async function toggleStudyReminder() {
  const s = StudyReminder.load();
  if (s.enabled) {
    await StudyReminder.disable();
    toast('🔕 Study reminders turned off.', 'info');
    renderProfile();
  } else {
    openReminderModal();
  }
}


// ============================================================
// DARK / LIGHT MODE
// ============================================================
function toggleDarkMode() {
  App.darkMode = !App.darkMode;
  document.documentElement.setAttribute('data-theme', App.darkMode ? '' : 'light');
  localStorage.setItem('navpath-dark', App.darkMode ? '1' : '0');
}

// ============================================================
// PREMIUM MODAL
// ============================================================
function openPremiumModal() {
  // Admin never sees the premium paywall
  if (isAdmin()) {
    toast('🛡️ Admin account — full access already enabled!', 'success');
    return;
  }
  show('#premium-modal');
}
function closePremiumModal() { hide('#premium-modal'); }

function selectPlan(plan) {
  App.selectedPlan = plan;
  $$('.plan-card').forEach(el => el.classList.remove('selected'));
  $(`#plan-${plan}`)?.classList.add('selected');
}

// ============================================================
// RAZORPAY PAYMENT
// ============================================================
async function initiatePurchase() {
  const plan = App.selectedPlan;
  const prices = { monthly: 9900, yearly: 19900 };
  const labels  = { monthly: '3-Month Plan', yearly: '1-Year Plan' };
  const amount  = prices[plan];

  const RAZORPAY_KEY = 'rzp_test_YOUR_KEY_HERE'; // ← replace with real key

  const options = {
    key: RAZORPAY_KEY,
    amount,
    currency: 'INR',
    name: 'NavPath',
    description: labels[plan],
    image: 'assets/icons/icon-192.png',
    handler: async function(response) {
      await handlePaymentSuccess(response, plan);
    },
    prefill: {
      email: App.user?.email || '',
      name: App.userDoc?.displayName || ''
    },
    theme: { color: '#c9a84c' },
    modal: { ondismiss: () => toast('Payment cancelled.', 'error') }
  };

  if (typeof Razorpay === 'undefined') {
    toast('Payment gateway not loaded. Please try again.', 'error');
    return;
  }

  const rzp = new Razorpay(options);
  rzp.open();
}

async function handlePaymentSuccess(response, plan) {
  const expiry = new Date();
  if (plan === 'monthly') expiry.setMonth(expiry.getMonth() + 3);
  else expiry.setFullYear(expiry.getFullYear() + 1);

  if (App.firebase && App.user) {
    const { db } = App.firebase;
    await db.collection('users').doc(App.user.uid).update({
      isPremium: true,
      premiumExpiry: fbTimestampFromDate(expiry),
      planType: plan,
    });
    await db.collection('users').doc(App.user.uid)
      .collection('payments').add({
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_order_id: response.razorpay_order_id || '',
        amount: plan === 'monthly' ? 99 : 199,
        plan,
        createdAt: fbTimestampNow()
      });
    App.userDoc.isPremium = true;
  }

  closePremiumModal();
  toast('🎉 Payment successful! Full access unlocked.', 'success');
  renderDashboard();
  renderSyllabus();
}

// ============================================================
// PWA SERVICE WORKER
// ============================================================
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js')
      .then(reg => console.log('[NavPath] Service Worker registered:', reg.scope))
      .catch(err => console.warn('[NavPath] SW registration failed:', err));
  }
}

// ============================================================
// INSTALL PROMPT
// ============================================================
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  $('#install-banner')?.classList.remove('hidden');
});

function installApp() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(result => {
      if (result.outcome === 'accepted') toast('NavPath installed! 🎉', 'success');
      deferredInstallPrompt = null;
      $('#install-banner')?.classList.add('hidden');
    });
  }
}

// ============================================================
// AUTH TAB TOGGLE
// FIX #8: Original code used $(`#tab-${tab}`) which matched BOTH
// the auth tab buttons (id="tab-login") AND the tab content divs
// (id="tab-dashboard" etc.). By renaming the auth button IDs to
// "authtab-login" / "authtab-signup" (done in index.html fix too),
// the selector is unambiguous.
// ============================================================
function switchAuthTab(tab) {
  // Deactivate all auth tab buttons
  $$('.auth-tab').forEach(t => t.classList.remove('active'));

  // Support BOTH old IDs (tab-login/tab-signup) and new IDs (authtab-login/authtab-signup)
  // This way the script works regardless of which index.html version is deployed
  const btn = $(`#authtab-${tab}`) || $(`#tab-${tab}`);
  btn?.classList.add('active');

  if (tab === 'login') {
    $('#signup-form')?.classList.add('hidden');
    $('#login-form')?.classList.remove('hidden');
    // Focus first input for better UX
    setTimeout(() => $('#login-email')?.focus(), 50);
  } else {
    $('#login-form')?.classList.add('hidden');
    $('#signup-form')?.classList.remove('hidden');
    // Focus first input for better UX
    setTimeout(() => $('#signup-name')?.focus(), 50);
  }
}

// ============================================================
// BOOT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const savedDark = localStorage.getItem('navpath-dark');
  if (savedDark === '0') {
    App.darkMode = false;
    document.documentElement.setAttribute('data-theme', 'light');
  }

  registerServiceWorker();
  initApp();
  setupAdminLongPress();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const loginForm = $('#login-form');
      const signupForm = $('#signup-form');
      if (loginForm && !loginForm.classList.contains('hidden')) handleLogin();
      else if (signupForm && !signupForm.classList.contains('hidden')) handleSignup();
    }
  });
});


// ============================================================
// TOPIC ACTION MODAL
// ============================================================
let _activeTopicId   = null;
let _activeChapterId = null;

function openTopicModal(topicId, topicName, chapterId, chapterName) {
  _activeTopicId   = topicId;
  _activeChapterId = chapterId;

  const modal = document.getElementById('topic-action-modal');
  if (!modal) return;
  document.getElementById('topic-modal-name').textContent    = topicName;
  document.getElementById('topic-modal-chapter').textContent = chapterName;

  const hasContent = App.content && App.content[topicId];

  // FIX: safely get question count from the merged topics structure
  // questions are indexed by chapterId in App.questions.topics
  const qBank = App.questions?.topics || App.questions?.questions || {};
  const chapterQs = qBank[chapterId] || [];
  const hasQuestions = chapterQs.length > 0;

  const studyBtn    = document.getElementById('topic-study-btn');
  const practiceBtn = document.getElementById('topic-practice-btn');

  if (studyBtn)
    studyBtn.querySelector('.topic-action-sub').textContent =
      hasContent ? 'Read full notes & theory' : 'Notes coming soon';

  if (practiceBtn)
    practiceBtn.querySelector('.topic-action-sub').textContent =
      hasQuestions ? `${chapterQs.length}+ MCQs with explanations` : 'Questions coming soon';

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeTopicModal() {
  document.getElementById('topic-action-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

// ── Study button handler (called from Syllabus topic modal)
function handleTopicStudy() {
  closeTopicModal();
  if (!_activeTopicId) return;

  switchTab('study');

  const browseEl  = $('#study-browse-area');
  const contentEl = $('#study-content-area');
  if (!browseEl || !contentEl) return;

  // Delegate to the shared study open function
  studyOpenTopic(
    _activeTopicId,
    document.getElementById('topic-modal-name')?.textContent || '',
    _activeChapterId,
    document.getElementById('topic-modal-chapter')?.textContent || ''
  );
}

// ── Practice button handler (from syllabus modal)
function handleTopicPractice() {
  closeTopicModal();
  if (!_activeChapterId) return;
  startQuiz(_activeChapterId);
}

// ── Practice button from inside study screen
function handleTopicPracticeFromStudy() {
  if (!_activeChapterId) { renderStudyBrowse(); return; }
  startQuiz(_activeChapterId);
}

// ── Chapter-level practice shortcut (📝 button on chapter header in Syllabus)
function startChapterPractice(chapterId, chapterName) {
  _activeChapterId = chapterId;
  startQuiz(chapterId);
}


// ============================================================
// LOAD CONTENT.JSON
// ============================================================
async function loadContent() {
  try {
    const res = await fetch('content.json');
    if (!res.ok) throw new Error('content.json not found');
    App.content = await res.json();
    console.log('[NavPath] content.json loaded ✓');
  } catch(e) {
    App.content = {};
    console.error('[NavPath] Failed to load content.json:', e.message);
  }
}

// ============================================================
// MOCK TEST SYSTEM — Timed full-paper simulation
// ============================================================
const MockTest = {
  active: false,
  testConfig: null,
  questions: [],
  answers: {},          // { idx: selectedOptionIndex }
  startTime: null,
  timerInterval: null,
  durationSecs: 0,
  remainingSecs: 0,
};

function openMockTestModal() {
  const mockTests = App.questions?.mockTests || [];
  if (!mockTests.length) {
    toast('Mock tests not loaded. Please reload the app.', 'error');
    return;
  }
  const modal = document.getElementById('mock-test-modal');
  if (!modal) {
    renderMockTestModal(mockTests);
  } else {
    modal.classList.remove('hidden');
  }
}

function renderMockTestModal(mockTests) {
  // Remove old if exists
  document.getElementById('mock-test-modal')?.remove();

  const div = document.createElement('div');
  div.id = 'mock-test-modal';
  div.className = 'modal-overlay';
  div.onclick = (e) => { if (e.target === div) closeMockTestModal(); };

  const cards = mockTests.map(t => `
    <div class="mock-test-card" onclick="startMockTest('${t.id}')" style="
      border:1px solid var(--card-border);border-radius:var(--radius-sm);
      padding:1rem;margin-bottom:0.75rem;cursor:pointer;
      background:var(--glass);transition:var(--transition);"
      onmouseover="this.style.borderColor='var(--gold)'"
      onmouseout="this.style.borderColor='var(--card-border)'">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div style="font-weight:700;font-size:0.9rem;color:var(--text-primary);margin-bottom:0.25rem;">${t.title}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">${t.description}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;margin-left:0.75rem;">
          <div style="font-size:0.8rem;color:var(--gold);font-weight:600;">⏱ ${t.duration} min</div>
          <div style="font-size:0.72rem;color:var(--text-muted);">${t.totalMarks} marks</div>
        </div>
      </div>
    </div>
  `).join('');

  div.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div class="modal-body">
        <h2 style="text-align:center;font-size:1.2rem;margin-bottom:0.4rem;">🎯 Timed Mock Tests</h2>
        <p style="text-align:center;font-size:0.8rem;color:var(--text-muted);margin-bottom:1.25rem;">
          Simulate real NEA exam conditions. Timer starts immediately.
        </p>
        ${cards}
        <button class="btn btn-outline btn-block" style="margin-top:0.5rem;" onclick="closeMockTestModal()">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(div);
}

function closeMockTestModal() {
  document.getElementById('mock-test-modal')?.classList.add('hidden');
}

function startMockTest(testId) {
  closeMockTestModal();
  const testConfig = (App.questions?.mockTests || []).find(t => t.id === testId);
  if (!testConfig) { toast('Test not found.', 'error'); return; }

  // Gather questions from specified topics
  const qBank = App.questions?.topics || App.questions?.questions || {};
  let allQuestions = [];
  testConfig.topics.forEach(topicId => {
    const qs = qBank[topicId];
    if (qs && qs.length) {
      allQuestions.push(...qs.map(q => ({ ...q, _topic: topicId })));
    }
  });

  // Shuffle and cap
  allQuestions = allQuestions.sort(() => Math.random() - 0.5);
  const maxQ = testConfig.id === 'mock-full' ? 150 : 50;
  allQuestions = allQuestions.slice(0, maxQ);

  if (!allQuestions.length) {
    toast('Not enough questions loaded for this mock test.', 'error');
    return;
  }

MockTest.active = true;
  MockTest.testConfig = testConfig;
  MockTest.questions = allQuestions;
  MockTest.answers = {};
  MockTest.startTime = Date.now();
  MockTest.durationSecs = testConfig.duration * 60;
  MockTest.remainingSecs = MockTest.durationSecs;

  switchTab('practice');
  renderMockTestScreen();
  startMockTimer();
}

function renderMockTestScreen() {
  const browseEl   = $('#practice-browse-area');
  const quizArea   = $('#quiz-question-area');
  const resultArea = $('#quiz-result-area');
  if (browseEl)   browseEl.classList.add('hidden');
  if (quizArea)   quizArea.classList.add('hidden');
  if (resultArea) resultArea.classList.add('hidden');

  let mockArea = document.getElementById('mock-test-area');
  if (!mockArea) {
    mockArea = document.createElement('div');
    mockArea.id = 'mock-test-area';
    document.getElementById('tab-practice')?.querySelector('.main-content')?.appendChild(mockArea);
  }
  mockArea.classList.remove('hidden');

  const q = MockTest.questions;
  const total = q.length;
mockArea.innerHTML = `
    <div class="practice-container" id="mock-container">
      <div class="practice-top-bar" style="position:sticky;top:0;z-index:10;background:var(--navy-deep);padding:0.75rem 1rem;margin:-1rem -1rem 1rem -1rem;">
        <button class="practice-back-btn" onclick="confirmExitMockTest()">✕ Exit</button>
        <div style="font-size:0.8rem;font-weight:600;color:var(--text-primary);">${MockTest.testConfig.title}</div>
        <div style="text-align:right;">
          <div id="mock-timer" style="font-family:var(--font-mono);font-size:1rem;color:var(--gold);font-weight:700;">--:--</div>
          <div style="font-size:0.65rem;color:var(--text-muted);">remaining</div>
        </div>
      </div>

      <div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:1rem;flex-wrap:wrap;">
        <div style="font-size:0.75rem;color:var(--text-muted);">Question <span id="mock-q-counter">1</span>/${total}</div>
        <div style="flex:1;background:var(--card-border);height:4px;border-radius:4px;overflow:hidden;">
          <div id="mock-prog-bar" style="height:100%;background:var(--gold);width:0%;transition:width 0.3s;"></div>
        </div>
        <div id="mock-answered-count" style="font-size:0.75rem;color:var(--success);">0 answered</div>
      </div>

      <div id="mock-question-display"></div>

      <div style="display:flex;gap:0.75rem;margin-top:1.25rem;flex-wrap:wrap;">
        <button class="btn btn-outline" id="mock-prev-btn" onclick="mockNav(-1)" style="flex:1;" disabled>← Prev</button>
        <button class="btn btn-outline" id="mock-next-btn" onclick="mockNav(1)" style="flex:1;">Next →</button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(2.5rem,1fr));gap:0.4rem;margin-top:1.25rem;padding:0.75rem;background:var(--card-bg);border-radius:var(--radius-sm);">
        ${q.map((_,i) => `<button id="mock-grid-${i}" onclick="mockJumpTo(${i})"
          style="padding:0.4rem;border-radius:6px;font-size:0.72rem;font-weight:600;
                 background:var(--navy-mid);border:1px solid var(--card-border);color:var(--text-muted);
                 cursor:pointer;transition:all 0.2s;">${i+1}</button>`).join('')}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:1.25rem;">
        <div style="background:var(--card-bg);border-radius:var(--radius-sm);padding:0.75rem;text-align:center;">
          <div style="font-size:1.1rem;font-weight:700;color:var(--success);" id="mock-stat-answered">0</div>
          <div style="font-size:0.7rem;color:var(--text-muted);">Answered</div>
        </div>
        <div style="background:var(--card-bg);border-radius:var(--radius-sm);padding:0.75rem;text-align:center;">
          <div style="font-size:1.1rem;font-weight:700;color:var(--warning);" id="mock-stat-unanswered">${total}</div>
          <div style="font-size:0.7rem;color:var(--text-muted);">Unanswered</div>
        </div>
      </div>

      <button class="btn btn-gold btn-block" style="margin-top:1.25rem;margin-bottom:2rem;" onclick="submitMockTest()">
        ✅ Submit Test
      </button>
    </div>
  `;

  MockTest._currentIdx = 0;
  renderMockQuestion(0);
}

function renderMockQuestion(idx) {
  MockTest._currentIdx = idx;
  const q = MockTest.questions[idx];
  const total = MockTest.questions.length;
  const answered = Object.keys(MockTest.answers).length;

  // Update progress bar and counters
  const pct = Math.round(((idx) / total) * 100);
  document.getElementById('mock-prog-bar').style.width = pct + '%';
  document.getElementById('mock-q-counter').textContent = idx + 1;
  document.getElementById('mock-answered-count').textContent = answered + ' answered';
  document.getElementById('mock-stat-answered').textContent = answered;
  document.getElementById('mock-stat-unanswered').textContent = total - answered;

  // Update nav buttons
  document.getElementById('mock-prev-btn').disabled = idx === 0;
  document.getElementById('mock-next-btn').textContent = idx === total - 1 ? 'Last ✓' : 'Next →';
  document.getElementById('mock-next-btn').disabled = idx === total - 1;

  // Update grid button highlighting
  document.querySelectorAll('[id^="mock-grid-"]').forEach((btn, i) => {
    btn.style.background = MockTest.answers[i] !== undefined ? 'rgba(34,197,94,0.2)' : 'var(--navy-mid)';
    btn.style.borderColor = MockTest.answers[i] !== undefined ? 'var(--success)' :
                            i === idx ? 'var(--gold)' : 'var(--card-border)';
    btn.style.color = i === idx ? 'var(--gold)' :
                      MockTest.answers[i] !== undefined ? 'var(--success)' : 'var(--text-muted)';
  });

  const letters = ['A', 'B', 'C', 'D'];
  const selectedAnswer = MockTest.answers[idx];

  const optionsHtml = q.options.map((opt, i) => {
    const isSelected = selectedAnswer === i;
    return `<button class="practice-option ${isSelected ? 'mock-selected' : ''}"
      onclick="mockSelectAnswer(${idx}, ${i})"
      style="${isSelected ? 'border-color:var(--gold);background:rgba(201,168,76,0.15);' : ''}">
      <span class="practice-option-letter" style="${isSelected ? 'background:var(--gold);color:var(--navy-deepest);' : ''}">${letters[i]}</span>
      <span class="practice-option-text">${opt}</span>
    </button>`;
  }).join('');

  document.getElementById('mock-question-display').innerHTML = `
    <div class="practice-question-card">
      <div class="practice-q-number">Q${idx + 1}</div>
      <div class="practice-q-text">${q.q || q.question}</div>
    </div>
    <div class="practice-options" id="mock-options-${idx}">${optionsHtml}</div>
  `;
}

function mockSelectAnswer(questionIdx, optionIdx) {
  MockTest.answers[questionIdx] = optionIdx;
  renderMockQuestion(questionIdx);
}

function mockNav(dir) {
  const newIdx = MockTest._currentIdx + dir;
  if (newIdx >= 0 && newIdx < MockTest.questions.length) {
    renderMockQuestion(newIdx);
  }
}

function mockJumpTo(idx) {
  renderMockQuestion(idx);
}

function startMockTimer() {
  clearInterval(MockTest.timerInterval);
  MockTest.timerInterval = setInterval(() => {
    MockTest.remainingSecs--;
    const timerEl = document.getElementById('mock-timer');
    if (timerEl) {
      const m = Math.floor(MockTest.remainingSecs / 60);
      const s = MockTest.remainingSecs % 60;
      timerEl.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      if (MockTest.remainingSecs <= 300) timerEl.style.color = 'var(--danger)'; // red in last 5 min
      if (MockTest.remainingSecs <= 60)  timerEl.style.animation = 'pulse 1s infinite';
    }
    if (MockTest.remainingSecs <= 0) {
      clearInterval(MockTest.timerInterval);
      toast('⏱ Time up! Auto-submitting...', 'error');
      setTimeout(submitMockTest, 1500);
    }
  }, 1000);
}

function confirmExitMockTest() {
  const answered = Object.keys(MockTest.answers).length;
  const total = MockTest.questions.length;
  if (confirm(`Exit mock test? You've answered ${answered}/${total} questions. Progress will be lost.`)) {
    exitMockTest();
  }
}

function exitMockTest() {
  clearInterval(MockTest.timerInterval);
  MockTest.active = false;
  const mockArea = document.getElementById('mock-test-area');
  if (mockArea) mockArea.classList.add('hidden');
  renderPracticeBrowse();
}

function submitMockTest() {
  clearInterval(MockTest.timerInterval);
  MockTest.active = false;

  const questions = MockTest.questions;
  const total = questions.length;
  let correct = 0;
  const wrongQs = [];

  questions.forEach((q, i) => {
    const selected = MockTest.answers[i];
    const ans = q.answer;
    if (selected === ans) {
      correct++;
    } else {
      wrongQs.push({ q, selected, idx: i });
    }
  });

  const unanswered = total - Object.keys(MockTest.answers).length;
  const pct = Math.round(correct / total * 100);
  const timeTaken = MockTest.durationSecs - MockTest.remainingSecs;
  const minsUsed = Math.floor(timeTaken / 60);
  const secsUsed = timeTaken % 60;

  let grade, emoji, gradeCls;
  if (pct >= 80)       { grade = 'A+'; emoji = '🏆'; gradeCls = 'grade-aplus'; }
  else if (pct >= 65)  { grade = 'A';  emoji = '🥇'; gradeCls = 'grade-a'; }
  else if (pct >= 50)  { grade = 'B';  emoji = '👍'; gradeCls = 'grade-b'; }
  else if (pct >= 35)  { grade = 'C';  emoji = '📖'; gradeCls = 'grade-c'; }
  else                 { grade = 'D';  emoji = '⚓'; gradeCls = 'grade-d'; }

  const mockArea = document.getElementById('mock-test-area');
  if (!mockArea) return;
  mockArea.classList.remove('hidden');

  // Build wrong questions review (max 5)
  const wrongHtml = wrongQs.slice(0, 5).map(({ q, selected, idx }) => {
    const letters = ['A','B','C','D'];
    return `
      <div style="background:var(--card-bg);border-radius:var(--radius-sm);padding:0.75rem;margin-bottom:0.5rem;border-left:3px solid var(--danger);">
        <div style="font-size:0.78rem;font-weight:600;color:var(--text-primary);margin-bottom:0.4rem;">Q${idx+1}: ${(q.q || q.question).slice(0,80)}${(q.q || q.question).length > 80 ? '…' : ''}</div>
        <div style="font-size:0.72rem;margin-bottom:0.2rem;"><span style="color:var(--danger);">✗ Your answer: ${selected !== undefined ? letters[selected] + ' – ' + q.options[selected] : 'Not answered'}</span></div>
        <div style="font-size:0.72rem;"><span style="color:var(--success);">✓ Correct: ${letters[q.answer]} – ${q.options[q.answer]}</span></div>
        ${q.explanation ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.3rem;font-style:italic;">💡 ${q.explanation.slice(0,120)}…</div>` : ''}
      </div>`;
  }).join('');

mockArea.innerHTML = `
    <div class="practice-container">
      <div class="practice-results">
        <div class="result-hero">
          <div class="result-emoji">${emoji}</div>
          <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.25rem;">${MockTest.testConfig.title}</div>
          <div class="result-grade ${gradeCls}">${grade}</div>
          <div class="result-score">${correct} / ${total}</div>
          <div class="result-pct-text">${pct}%</div>
        </div>

        <div class="result-stats-row" style="grid-template-columns:repeat(4,1fr);">
          <div class="result-stat result-stat-correct">
            <div class="result-stat-num">${correct}</div>
            <div class="result-stat-lbl">Correct</div>
          </div>
          <div class="result-stat result-stat-wrong">
            <div class="result-stat-num">${total - correct - unanswered}</div>
            <div class="result-stat-lbl">Wrong</div>
          </div>
          <div class="result-stat" style="background:rgba(245,158,11,0.1);">
            <div class="result-stat-num" style="color:var(--warning);">${unanswered}</div>
            <div class="result-stat-lbl">Skipped</div>
          </div>
          <div class="result-stat result-stat-pct">
            <div class="result-stat-num">${minsUsed}m ${secsUsed}s</div>
            <div class="result-stat-lbl">Time used</div>
          </div>
        </div>

        ${wrongQs.length ? `
          <div style="margin-top:1.25rem;">
            <div style="font-size:0.8rem;font-weight:700;color:var(--text-primary);margin-bottom:0.75rem;">
              📌 Review — First ${Math.min(5, wrongQs.length)} wrong answers
            </div>
            ${wrongHtml}
          </div>` : '<div style="text-align:center;color:var(--success);margin:1rem 0;font-weight:600;">🎯 Perfect or near-perfect — outstanding!</div>'}

        <div class="result-actions" style="margin-top:1.25rem;">
          <button class="btn btn-gold btn-block" onclick="startMockTest('${MockTest.testConfig.id}')">🔄 Retake This Test</button>
          <button class="btn btn-outline btn-block" style="margin-top:0.75rem;" onclick="exitMockTest()">← Back to Practice</button>
        </div>

        <div style="padding-bottom:5rem;"></div>
      </div>
    </div>
  `;
}


// ============================================================
// ADMIN LONG-PRESS — secret entry, admin email only
// ============================================================
const ADMIN_EMAIL_KEY = 'navpath.admin@gmail.com';

// ── Admin check — used by canAccessTopic & renderTrialBanner
function isAdmin() {
  const user = App?.firebase?.auth?.currentUser || App?.user;
  return !!(user && user.email === ADMIN_EMAIL_KEY);
}

function setupAdminLongPress() {
  const logo = document.querySelector('.nav-logo');
  if (!logo) return;
  let pressTimer = null;
  let toastEl    = null;

  function startPress() {
    const user = App.firebase?.auth?.currentUser;
    if (!user || user.email !== ADMIN_EMAIL_KEY) return;
    toastEl = document.createElement('div');
    toastEl.style.cssText = 'position:fixed;bottom:5.5rem;left:50%;transform:translateX(-50%);background:rgba(201,168,76,0.15);border:1.5px solid rgba(201,168,76,0.45);border-radius:50px;padding:0.4rem 1.2rem;color:#c9a84c;font-family:IBM Plex Mono,monospace;font-size:0.68rem;font-weight:600;z-index:9999;pointer-events:none;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,0.4);';
    toastEl.textContent = '⛳ Hold to open Admin Panel…';
    document.body.appendChild(toastEl);
    pressTimer = setTimeout(() => {
      if (toastEl) toastEl.remove();
      window.location.href = 'admin.html';
    }, 2000);
  }

  function cancelPress() {
    clearTimeout(pressTimer);
    if (toastEl) { toastEl.remove(); toastEl = null; }
  }

  logo.addEventListener('mousedown',   startPress);
  logo.addEventListener('touchstart',  startPress, { passive: true });
  logo.addEventListener('mouseup',     cancelPress);
  logo.addEventListener('mouseleave',  cancelPress);
  logo.addEventListener('touchend',    cancelPress);
  logo.addEventListener('touchcancel', cancelPress);
}

// [Duplicate setupAdminLongPress removed — FIX applied]

// FIX #5: renderQuestion and App were not exported to window,
// breaking the inline override script in index.html
// ============================================================
window.handleSignup      = handleSignup;
window.handleLogin       = handleLogin;
window.handleLogout      = handleLogout;
window.switchAuthTab     = switchAuthTab;
window.switchTab         = switchTab;
window.togglePaper       = togglePaper;
window.toggleChapter     = toggleChapter;
window.toggleTopic       = toggleTopic;
window.startQuiz         = startQuiz;
window.renderQuestion    = renderQuestion;
window.selectAnswer      = selectAnswer;
window.nextQuestion      = nextQuestion;
window.resetQuiz         = resetQuiz;
window.openPremiumModal  = openPremiumModal;
window.closePremiumModal = closePremiumModal;
window.selectPlan        = selectPlan;
window.initiatePurchase  = initiatePurchase;
window.toggleDarkMode    = toggleDarkMode;
window.toggleStudyReminder = toggleStudyReminder;
window.openReminderModal   = openReminderModal;
window.closeReminderModal  = closeReminderModal;
window.saveReminderFromModal  = saveReminderFromModal;
window.disableReminderFromModal = disableReminderFromModal;
window.installApp        = installApp;
window.openTopicModal    = openTopicModal;
window.closeTopicModal   = closeTopicModal;
window.handleTopicStudy  = handleTopicStudy;
window.handleTopicPractice = handleTopicPractice;
window.handleTopicPracticeFromStudy = handleTopicPracticeFromStudy;
window.startChapterPractice = startChapterPractice;
window._handleStudyAfterResult = _handleStudyAfterResult;
window.renderStudyBrowse    = renderStudyBrowse;
window.renderPracticeBrowse = renderPracticeBrowse;
window.studyOpenTopic       = studyOpenTopic;
window.studyStartPractice   = studyStartPractice;
window.practiceStartChapter = practiceStartChapter;
window.practiceGoBack       = practiceGoBack;
window.openMockTestModal    = openMockTestModal;
window.closeMockTestModal   = closeMockTestModal;
window.startMockTest        = startMockTest;
window.submitMockTest       = submitMockTest;
window.confirmExitMockTest  = confirmExitMockTest;
window.exitMockTest         = exitMockTest;
window.mockNav              = mockNav;
window.mockJumpTo           = mockJumpTo;
window.mockSelectAnswer        = mockSelectAnswer;
window.setupAdminLongPress     = setupAdminLongPress;
window.openReminderModal       = openReminderModal;
window.closeReminderModal      = closeReminderModal;
window.saveReminderFromModal   = saveReminderFromModal;
window.disableReminderFromModal = disableReminderFromModal;
window.toggleStudyReminder     = toggleStudyReminder;
window.rmSetPeriod             = rmSetPeriod;
