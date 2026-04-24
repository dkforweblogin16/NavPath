// ============================================================
// NavPath – NEA Exam Prep App
// script.js – Main Application Logic
// ============================================================

'use strict';

// ============================================================
// APP STATE
// ============================================================
const App = {
  user: null,            // Firebase user object
  userDoc: null,         // Firestore user document data
  syllabus: null,        // Loaded syllabus JSON
  questions: null,       // Loaded questions JSON
  progress: {},          // Map of topicId → true/false (completed)
  currentScreen: null,
  currentPaper: null,
  currentQuiz: { chapterId: null, questions: [], idx: 0, score: 0, answered: false },
  firebase: null,        // { auth, db }
  selectedPlan: 'yearly', // Default plan selection
  darkMode: true,
};

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
  $$('.screen').forEach(s => s.classList.remove('active'));
  const s = $(`#${id}`);
  if (s) {
    s.classList.add('active');
    App.currentScreen = id;
  }
}

// ============================================================
// FIREBASE INIT
// ============================================================
function initApp() {
  // Initialize Firebase
  App.firebase = window.initFirebase?.();

  if (!App.firebase) {
    console.warn('Firebase not configured. Running in demo mode.');
    loadResources().then(() => showScreen('auth-screen'));
    return;
  }

  const { auth } = App.firebase;

  // Listen for auth state changes
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      App.user = user;
      await loadUserData();
      await loadResources();
      renderDashboard();
      showScreen('main-screen');
      updateNavHighlight('dashboard');
    } else {
      App.user = null;
      App.userDoc = null;
      App.progress = {};
      await loadResources();
      showScreen('auth-screen');
    }
  });
}

// ============================================================
// LOAD JSON RESOURCES
// ============================================================
async function loadResources() {
  try {
    const [syllabusRes, questionsRes] = await Promise.all([
      fetch('data/syllabus.json'),
      fetch('data/questions.json')
    ]);
    App.syllabus = await syllabusRes.json();
    App.questions = await questionsRes.json();
    console.log('Resources loaded ✓');
  } catch (e) {
    console.error('Failed to load resources:', e);
    toast('Failed to load data. Please refresh.', 'error');
  }
}

// ============================================================
// LOAD USER DATA FROM FIRESTORE
// ============================================================
async function loadUserData() {
  if (!App.firebase || !App.user) return;
  const { db } = App.firebase;
  const uid = App.user.uid;

  try {
    // Get user document
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();

    if (userSnap.exists) {
      App.userDoc = userSnap.data();
    } else {
      // First time user – create document
      const now = firebase.firestore.Timestamp.now();
      App.userDoc = {
        email: App.user.email,
        displayName: App.user.displayName || App.user.email.split('@')[0],
        createdAt: now,
        trialStartDate: now,
        isPremium: false,
        premiumExpiry: null,
        planType: 'trial',
        streak: 0,
        lastStudiedDate: null,
      };
      await userRef.set(App.userDoc);
    }

    // Load progress
    const progressSnap = await userRef.collection('progress').get();
    App.progress = {};
    progressSnap.forEach(doc => {
      App.progress[doc.id] = doc.data().completed;
    });

    // Update streak
    await updateStreak();

  } catch (e) {
    console.error('Failed to load user data:', e);
    toast('Could not load your progress. Check connection.', 'error');
  }
}

// ============================================================
// TRIAL & PREMIUM CHECKS
// ============================================================
function getTrialStatus() {
  if (!App.userDoc) return { active: false, daysLeft: 0 };
  if (App.userDoc.isPremium) return { active: false, isPremium: true, daysLeft: 999 };

  const start = App.userDoc.trialStartDate?.toDate?.() || new Date(App.userDoc.trialStartDate || Date.now());
  const now = new Date();
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysElapsed = Math.floor((now - start) / msPerDay);
  const daysLeft = Math.max(0, 3 - daysElapsed);

  return { active: daysLeft > 0, daysLeft, isPremium: false };
}

function canAccessTopic(topicId) {
  const trial = getTrialStatus();
  if (trial.isPremium || trial.active) return true;
  // After trial: only completed topics are accessible
  return App.progress[topicId] === true;
}

// ============================================================
// SAVE PROGRESS TO FIRESTORE
// ============================================================
async function saveTopicProgress(topicId, completed) {
  App.progress[topicId] = completed;

  if (!App.firebase || !App.user) {
    // Demo mode – just update local state
    updateSyllabusUI();
    return;
  }

  const { db } = App.firebase;
  const uid = App.user.uid;

  try {
    await db.collection('users').doc(uid)
      .collection('progress').doc(topicId)
      .set({
        completed,
        completedAt: firebase.firestore.Timestamp.now()
      });
    updateSyllabusUI();
    updateProgressStats();
  } catch (e) {
    console.error('Failed to save progress:', e);
    toast('Could not save progress. Try again.', 'error');
  }
}

// ============================================================
// STREAK TRACKING
// ============================================================
async function updateStreak() {
  if (!App.userDoc || !App.firebase || !App.user) return;

  const today = new Date().toISOString().split('T')[0];
  const lastDate = App.userDoc.lastStudiedDate;

  if (lastDate === today) return; // Already updated today

  let newStreak = App.userDoc.streak || 0;
  if (lastDate) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().split('T')[0];
    if (lastDate === yStr) {
      newStreak += 1; // Continued streak
    } else if (lastDate !== today) {
      newStreak = 1; // Reset streak
    }
  } else {
    newStreak = 1;
  }

  App.userDoc.streak = newStreak;
  App.userDoc.lastStudiedDate = today;

  await App.firebase.db.collection('users').doc(App.user.uid).update({
    streak: newStreak,
    lastStudiedDate: today
  }).catch(e => console.warn('Streak update failed:', e));
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
  btn.textContent = 'Creating account...';
  btn.disabled = true;

  // Demo mode
  if (!App.firebase) {
    App.user = { uid: 'demo', email, displayName: name };
    App.userDoc = { displayName: name, email, trialStartDate: { toDate: () => new Date() }, isPremium: false, streak: 1, planType: 'trial' };
    await loadResources();
    renderDashboard();
    showScreen('main-screen');
    updateNavHighlight('dashboard');
    toast('Welcome to NavPath! (Demo Mode)', 'success');
    return;
  }

  try {
    const { auth, db } = App.firebase;
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    await cred.user.updateProfile({ displayName: name });
    toast('Account created! Welcome aboard 🎉', 'success');
    // onAuthStateChanged will handle the rest
  } catch (e) {
    toast(e.message || 'Signup failed. Please try again.', 'error');
    btn.textContent = 'Create Account';
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
  btn.textContent = 'Signing in...';
  btn.disabled = true;

  // Demo mode
  if (!App.firebase) {
    App.user = { uid: 'demo', email, displayName: email.split('@')[0] };
    App.userDoc = { displayName: email.split('@')[0], email, trialStartDate: { toDate: () => new Date() }, isPremium: false, streak: 3, planType: 'trial' };
    await loadResources();
    renderDashboard();
    showScreen('main-screen');
    updateNavHighlight('dashboard');
    toast('Logged in! (Demo Mode)', 'success');
    return;
  }

  try {
    await App.firebase.auth.signInWithEmailAndPassword(email, pass);
    // onAuthStateChanged handles the rest
  } catch (e) {
    toast('Invalid email or password.', 'error');
    btn.textContent = 'Sign In';
    btn.disabled = false;
  }
}

// ============================================================
// AUTH – LOGOUT
// ============================================================
async function handleLogout() {
  if (App.firebase) {
    await App.firebase.auth.signOut();
  } else {
    App.user = null;
    showScreen('auth-screen');
  }
}

// ============================================================
// DASHBOARD RENDER
// ============================================================
function renderDashboard() {
  const name = App.userDoc?.displayName || App.user?.displayName || 'Sailor';
  const firstName = name.split(' ')[0];

  // Welcome
  $('#welcome-name').innerHTML = `Welcome back, <span>${firstName}</span>`;

  // Trial banner
  renderTrialBanner();

  // Streak
  const streak = App.userDoc?.streak || 1;
  $('#streak-count').textContent = streak;

  // Progress stats
  updateProgressStats();

  // Progress chart
  renderProgressChart();
}

function renderTrialBanner() {
  const trial = getTrialStatus();
  const banner = $('#trial-banner');
  const premBadge = $('#premium-badge');

  if (trial.isPremium) {
    banner?.classList.add('hidden');
    premBadge?.classList.remove('hidden');
  } else if (trial.active) {
    banner?.classList.remove('hidden');
    premBadge?.classList.add('hidden');
    if ($('#trial-days')) $('#trial-days').textContent = trial.daysLeft;
    const hours = new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening';
    if ($('#trial-message')) $('#trial-message').textContent = `${trial.daysLeft} day${trial.daysLeft !== 1 ? 's' : ''} left in your free trial`;
  } else {
    // Trial expired
    if (banner) {
      banner.classList.remove('hidden');
      banner.style.borderColor = 'rgba(239,68,68,0.4)';
      banner.style.background = 'rgba(239,68,68,0.07)';
      if ($('#trial-days')) { $('#trial-days').style.color = '#ef4444'; $('#trial-days').textContent = '0'; }
      if ($('#trial-message')) $('#trial-message').textContent = 'Trial expired – Upgrade to continue';
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

  // Main progress bar
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
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.raw}% complete`
          }
        }
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

    // Count totals
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
            <div style="display:flex;gap:0.5rem;align-items:center;">
              <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();startQuiz('${chapter.id}')">Quiz</button>
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
  const trial = getTrialStatus();
  let html = '';

  chapter.topics.forEach(topic => {
    const done = App.progress[topic.id] || false;
    const accessible = canAccessTopic(topic.id);
    const isLocked = !accessible;

    html += `
      <div class="topic-item ${done ? 'completed' : ''} ${isLocked ? 'locked' : ''}"
           onclick="${isLocked ? 'openPremiumModal()' : `toggleTopic('${topic.id}')`}">
        <div class="topic-check">${done ? '✓' : ''}</div>
        <span class="topic-name">${topic.name}</span>
        ${isLocked ? '<span class="lock-icon">🔒</span>' : ''}
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
    // Update streak
    await updateStreak();
  }
}

function updateSyllabusUI() {
  // Re-render syllabus if on that tab
  if (App.currentScreen === 'main-screen' && document.getElementById('tab-syllabus')?.classList.contains('active-tab')) {
    renderSyllabus();
  }
  updateProgressStats();
}

// ============================================================
// QUIZ SYSTEM
// ============================================================
function startQuiz(chapterId) {
  const qBank = App.questions?.questions;
  if (!qBank || !qBank[chapterId] || qBank[chapterId].length === 0) {
    toast('No questions available for this chapter yet.', 'info');
    return;
  }

  // Shuffle questions
  const questions = [...qBank[chapterId]].sort(() => Math.random() - 0.5);

  App.currentQuiz = {
    chapterId,
    questions,
    idx: 0,
    score: 0,
    answered: false
  };

  showQuizScreen();
  renderQuestion();
}

function showQuizScreen() {
  // Switch tab to quiz view
  switchTab('quiz');
}

function renderQuestion() {
  const { questions, idx } = App.currentQuiz;
  const q = questions[idx];
  if (!q) { showQuizResults(); return; }

  App.currentQuiz.answered = false;

  $('#quiz-q-number').textContent = `Question ${idx + 1} of ${questions.length}`;
  $('#quiz-q-text').textContent = q.question;
  $('#quiz-progress-text').textContent = `${idx + 1}/${questions.length} • Score: ${App.currentQuiz.score}`;
  $('#quiz-explanation').classList.remove('show');
  $('#quiz-next-btn').textContent = idx === questions.length - 1 ? 'Finish Quiz' : 'Next Question';

  // Render options
  const optionsEl = $('#quiz-options');
  optionsEl.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D'];
  q.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'quiz-option';
    btn.innerHTML = `<span class="quiz-option-letter">${letters[i]}</span>${opt}`;
    btn.onclick = () => selectAnswer(i, q.answer);
    optionsEl.appendChild(btn);
  });
}

function selectAnswer(selected, correct) {
  if (App.currentQuiz.answered) return;
  App.currentQuiz.answered = true;

  const options = $$('.quiz-option');
  options.forEach((opt, i) => {
    if (i === correct) opt.classList.add('correct');
    else if (i === selected) opt.classList.add('wrong');
    opt.onclick = null;
  });

  if (selected === correct) {
    App.currentQuiz.score++;
    toast('Correct! ✓', 'success');
  } else {
    toast('Wrong. Review the explanation below.', 'error');
  }

  // Show explanation
  const expEl = $('#quiz-explanation');
  expEl.innerHTML = `<strong>Explanation:</strong> ${App.currentQuiz.questions[App.currentQuiz.idx].explanation}`;
  expEl.classList.add('show');

  $('#quiz-progress-text').textContent = `${App.currentQuiz.idx + 1}/${App.currentQuiz.questions.length} • Score: ${App.currentQuiz.score}`;
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
  const { score, questions } = App.currentQuiz;
  const pct = Math.round(score / questions.length * 100);
  const emoji = pct >= 80 ? '🏆' : pct >= 60 ? '👍' : '📚';

  $('#quiz-result-area').innerHTML = `
    <div class="card" style="text-align:center;padding:2rem;">
      <div style="font-size:3rem;margin-bottom:1rem;">${emoji}</div>
      <h2 style="font-size:2rem;color:var(--gold);">${pct}%</h2>
      <p style="margin:0.5rem 0 1.5rem;">You scored ${score} out of ${questions.length}</p>
      <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:1.5rem;">
        ${pct >= 80 ? 'Excellent work, Sailor! 🎖️' : pct >= 60 ? 'Good progress! Keep it up.' : 'Keep studying – you\'ll get there!'}
      </p>
      <button class="btn btn-primary btn-block" onclick="resetQuiz()">Try Again</button>
      <button class="btn btn-outline btn-block mt-1" onclick="switchTab('syllabus')">Back to Syllabus</button>
    </div>
  `;
  $('#quiz-question-area').classList.add('hidden');
  $('#quiz-result-area').classList.remove('hidden');
}

function resetQuiz() {
  $('#quiz-question-area').classList.remove('hidden');
  $('#quiz-result-area').classList.add('hidden');
  if (App.currentQuiz.chapterId) {
    startQuiz(App.currentQuiz.chapterId);
  }
}

// ============================================================
// FORMULAS / NOTES
// ============================================================
const FORMULAS = {
  math: [
    { title: 'Quadratic Formula', content: 'x = (-b ± √(b²-4ac)) / 2a' },
    { title: 'AP – nth Term', content: 'aₙ = a + (n-1)d' },
    { title: 'AP – Sum', content: 'Sₙ = n/2 × [2a + (n-1)d]' },
    { title: 'GP – nth Term', content: 'aₙ = a × rⁿ⁻¹' },
    { title: 'Binomial Theorem', content: '(x+y)ⁿ = Σ C(n,r)xⁿ⁻ʳyʳ' },
    { title: 'sin²θ + cos²θ', content: '= 1' },
    { title: 'tan θ', content: '= sin θ / cos θ' },
    { title: 'Area of Triangle (Det)', content: 'Δ = ½|x₁(y₂-y₃) + x₂(y₃-y₁) + x₃(y₁-y₂)|' },
    { title: 'Binary → Decimal', content: 'Sum of (bit × 2ⁿ) from right, n starts at 0' },
    { title: 'Distance Formula', content: 'd = √[(x₂-x₁)² + (y₂-y₁)²]' },
  ],
  physics: [
    { title: "Newton's 2nd Law", content: 'F = ma' },
    { title: 'Kinematic Equation 1', content: 'v = u + at' },
    { title: 'Kinematic Equation 2', content: 's = ut + ½at²' },
    { title: 'Kinematic Equation 3', content: 'v² = u² + 2as' },
    { title: "Ohm's Law", content: 'V = IR' },
    { title: 'Power (Electrical)', content: 'P = VI = I²R = V²/R' },
    { title: 'Escape Velocity', content: 'vₑ = √(2gR) ≈ 11.2 km/s' },
    { title: "Archimedes' Principle", content: 'Buoyant Force = ρ × V × g' },
    { title: 'Mirror Formula', content: '1/f = 1/v + 1/u' },
    { title: 'Lens Formula', content: '1/f = 1/v - 1/u' },
    { title: 'Snell\'s Law', content: 'n₁sin θ₁ = n₂sin θ₂' },
    { title: 'SHM Frequency', content: 'f = 1/(2π) × √(k/m)' },
  ]
};

function renderFormulas() {
  const container = $('#formulas-container');
  if (!container) return;

  container.innerHTML = `
    <div class="section-header mb-2">
      <h2 class="section-title">📐 Formulas & Tricks</h2>
    </div>

    <div class="mb-2">
      <div style="display:flex;gap:0.5rem;margin-bottom:1rem;">
        <button class="btn btn-primary btn-sm" id="fm-btn-math" onclick="showFormulaTab('math')">Mathematics</button>
        <button class="btn btn-outline btn-sm" id="fm-btn-physics" onclick="showFormulaTab('physics')">Physics</button>
      </div>
      <div id="formula-list"></div>
    </div>
  `;

  showFormulaTab('math');
}

function showFormulaTab(tab) {
  $('#fm-btn-math')?.classList.toggle('btn-primary', tab === 'math');
  $('#fm-btn-math')?.classList.toggle('btn-outline', tab !== 'math');
  $('#fm-btn-physics')?.classList.toggle('btn-primary', tab === 'physics');
  $('#fm-btn-physics')?.classList.toggle('btn-outline', tab !== 'physics');

  const list = $('#formula-list');
  if (!list) return;

  list.innerHTML = FORMULAS[tab].map(f => `
    <div class="formula-card">
      <div class="formula-title">${f.title}</div>
      <div class="formula-content">${f.content}</div>
    </div>
  `).join('');
}

// ============================================================
// TAB SWITCHING (inside main screen)
// ============================================================
function switchTab(tabName) {
  // Hide all tab contents
  $$('.tab-content').forEach(el => el.classList.remove('active-tab'));
  $$('.nav-item').forEach(el => el.classList.remove('active'));

  const content = $(`#tab-${tabName}`);
  const navItem = $(`#nav-${tabName}`);

  content?.classList.add('active-tab');
  navItem?.classList.add('active');

  // Render content for the tab
  switch (tabName) {
    case 'dashboard':
      renderDashboard();
      break;
    case 'syllabus':
      renderSyllabus();
      break;
    case 'quiz':
      if (!App.currentQuiz.questions.length) renderQuizLanding();
      break;
    case 'formulas':
      renderFormulas();
      break;
    case 'profile':
      renderProfile();
      break;
  }
}

function updateNavHighlight(tab) {
  switchTab(tab);
}

function renderQuizLanding() {
  const el = $('#quiz-question-area');
  const result = $('#quiz-result-area');
  if (result) result.classList.add('hidden');
  if (el) {
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🧠</div>
        <h3>Practice Questions</h3>
        <p>Go to Syllabus → tap "Quiz" on any chapter to start practicing.</p>
      </div>
    `;
  }
}

// ============================================================
// PROFILE SCREEN
// ============================================================
function renderProfile() {
  const el = $('#tab-profile');
  if (!el) return;

  const name = App.userDoc?.displayName || 'User';
  const email = App.user?.email || '';
  const trial = getTrialStatus();
  const streak = App.userDoc?.streak || 0;

  let statusBadge = trial.isPremium
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
          ${trial.isPremium
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
        <div class="settings-item">
          <div class="settings-item-left">
            <div class="settings-item-icon">🔔</div>
            <span>Study Reminders</span>
          </div>
          <label class="toggle-switch">
            <input type="checkbox">
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
  show('#premium-modal');
}

function closePremiumModal() {
  hide('#premium-modal');
}

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
  const prices = { monthly: 9900, yearly: 19900 }; // in paise
  const labels = { monthly: '3-Month Plan', yearly: '1-Year Plan' };
  const amount = prices[plan];

  // 🔑 REPLACE with your actual Razorpay Key ID
  const RAZORPAY_KEY = 'rzp_test_YOUR_KEY_HERE';

  const options = {
    key: RAZORPAY_KEY,
    amount: amount,
    currency: 'INR',
    name: 'NavPath',
    description: labels[plan],
    image: 'assets/icons/icon-192.png',
    handler: async function(response) {
      // Payment successful – verify on backend or update Firestore
      await handlePaymentSuccess(response, plan);
    },
    prefill: {
      email: App.user?.email || '',
      name: App.userDoc?.displayName || ''
    },
    theme: { color: '#c9a84c' },
    modal: {
      ondismiss: () => toast('Payment cancelled.', 'error')
    }
  };

  if (typeof Razorpay === 'undefined') {
    toast('Payment gateway not loaded. Please try again.', 'error');
    return;
  }

  const rzp = new Razorpay(options);
  rzp.open();
}

async function handlePaymentSuccess(response, plan) {
  // In production: verify payment on your backend server
  // For now, update Firestore directly (use Cloud Functions in production)

  const expiry = new Date();
  if (plan === 'monthly') expiry.setMonth(expiry.getMonth() + 3);
  else expiry.setFullYear(expiry.getFullYear() + 1);

  if (App.firebase && App.user) {
    const { db } = App.firebase;
    await db.collection('users').doc(App.user.uid).update({
      isPremium: true,
      premiumExpiry: firebase.firestore.Timestamp.fromDate(expiry),
      planType: plan,
    });

    // Log payment
    await db.collection('users').doc(App.user.uid)
      .collection('payments').add({
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_order_id: response.razorpay_order_id || '',
        amount: plan === 'monthly' ? 99 : 199,
        plan,
        createdAt: firebase.firestore.Timestamp.now()
      });

    App.userDoc.isPremium = true;
  }

  closePremiumModal();
  toast('🎉 Payment successful! Full access unlocked.', 'success');
  renderDashboard();
  renderSyllabus();
}

// ============================================================
// PWA SERVICE WORKER REGISTRATION
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
// ============================================================
function switchAuthTab(tab) {
  $$('.auth-tab').forEach(t => t.classList.remove('active'));
  $(`#tab-${tab}`)?.classList.add('active');

  if (tab === 'login') {
    $('#signup-form')?.classList.add('hidden');
    $('#login-form')?.classList.remove('hidden');
  } else {
    $('#login-form')?.classList.add('hidden');
    $('#signup-form')?.classList.remove('hidden');
  }
}

// ============================================================
// BOOT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  // Check saved dark mode preference
  const savedDark = localStorage.getItem('navpath-dark');
  if (savedDark === '0') {
    App.darkMode = false;
    document.documentElement.setAttribute('data-theme', 'light');
  }

  // Register service worker
  registerServiceWorker();

  // Initialize the app
  initApp();

  // Handle enter key on forms
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const loginForm = $('#login-form');
      const signupForm = $('#signup-form');
      if (loginForm && !loginForm.classList.contains('hidden')) handleLogin();
      else if (signupForm && !signupForm.classList.contains('hidden')) handleSignup();
    }
  });
});

// Expose necessary functions to global scope for onclick handlers
window.handleSignup = handleSignup;
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
window.switchAuthTab = switchAuthTab;
window.switchTab = switchTab;
window.togglePaper = togglePaper;
window.toggleChapter = toggleChapter;
window.toggleTopic = toggleTopic;
window.startQuiz = startQuiz;
window.selectAnswer = selectAnswer;
window.nextQuestion = nextQuestion;
window.resetQuiz = resetQuiz;
window.openPremiumModal = openPremiumModal;
window.closePremiumModal = closePremiumModal;
window.selectPlan = selectPlan;
window.initiatePurchase = initiatePurchase;
window.toggleDarkMode = toggleDarkMode;
window.installApp = installApp;
window.showFormulaTab = showFormulaTab;
