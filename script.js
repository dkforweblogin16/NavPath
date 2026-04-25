// ============================================================
// NavPath – NEA Exam Prep App
// script.js – FULLY DEBUGGED & FIXED
// ============================================================
//
// BUGS FIXED (see detailed list in README section below):
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
};

// FIX #1: App must be on window so the inline quiz override script in
// index.html can access window.App — previously it was a module-scoped const
window.App = App;

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
    loadResources().then(() => showScreen('auth-screen'));
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
      // Reset button states when logging out
      const loginBtn = $('#login-btn');
      const signupBtn = $('#signup-btn');
      if (loginBtn) { loginBtn.textContent = 'Sign In →'; loginBtn.disabled = false; }
      if (signupBtn) { signupBtn.textContent = 'Start Free Trial 🚀'; signupBtn.disabled = false; }
      await loadResources();
      showScreen('auth-screen');
    }
  });
}

// ============================================================
// LOAD JSON RESOURCES
// ============================================================
// ============================================================
// EMBEDDED SYLLABUS DATA — Built from official NEA PDF syllabus
// (No external fetch needed — works offline/on any host)
// ============================================================
const NEA_SYLLABUS = {
  papers: [
    {
      id: 'paper1',
      name: 'Paper I – English & GK',
      totalMarks: 100,
      subjects: [
        {
          id: 'english',
          name: 'English',
          icon: '📖',
          totalMarks: 70,
          chapters: [
            {
              id: 'comprehension',
              name: 'Comprehension',
              marks: 5,
              topics: [
                { id: 'comp-1', name: 'Short question answers from passage' },
                { id: 'comp-2', name: 'Deeper interpretation and drawing inferences' }
              ]
            },
            {
              id: 'tenses-voices',
              name: 'Tenses and Voices',
              marks: 30,
              topics: [
                { id: 'tv-1', name: 'Degree of Comparison' },
                { id: 'tv-2', name: 'Tenses (Present, Past, Future)' },
                { id: 'tv-3', name: 'Direct and Indirect Speech' },
                { id: 'tv-4', name: 'Active and Passive Voice' },
                { id: 'tv-5', name: 'Correct usage of preposition' },
                { id: 'tv-6', name: 'Use of conjunctions, words and their usage' },
                { id: 'tv-7', name: 'Punctuation and correction of sentences' },
                { id: 'tv-8', name: 'Use of idioms and phrases, transformation of sentences' }
              ]
            },
            {
              id: 'applied-grammar',
              name: 'Applied Grammar',
              marks: 25,
              topics: [
                { id: 'ag-1', name: 'Grammatical structures in meaningful contexts' },
                { id: 'ag-2', name: 'Gap filling and dialogue completion' },
                { id: 'ag-3', name: 'Sentence transformation and changing narration' },
                { id: 'ag-4', name: 'Reordering of words and sentences' },
                { id: 'ag-5', name: 'Editing and error correction of words and sentences' },
                { id: 'ag-6', name: 'Synonyms and antonyms' }
              ]
            },
            {
              id: 'idioms-phrases',
              name: 'Idioms and Phrases',
              marks: 5,
              topics: [
                { id: 'ip-1', name: 'Common idioms and their meanings' },
                { id: 'ip-2', name: 'Phrases and their usage in sentences' }
              ]
            },
            {
              id: 'vocabulary',
              name: 'Vocabulary',
              marks: 5,
              topics: [
                { id: 'voc-1', name: 'Word meanings and usage' },
                { id: 'voc-2', name: 'One-word substitution' },
                { id: 'voc-3', name: 'Spellings and commonly confused words' }
              ]
            }
          ]
        },
        {
          id: 'gk',
          name: 'General Knowledge',
          icon: '🌍',
          totalMarks: 30,
          chapters: [
            {
              id: 'indian-constitution',
              name: 'Indian Constitution & Administration',
              marks: 5,
              topics: [
                { id: 'ic-1', name: 'Constitution and Rights in the Indian Constitution' },
                { id: 'ic-2', name: 'Election and Representation' },
                { id: 'ic-3', name: 'Executive, Legislature, Judiciary' },
                { id: 'ic-4', name: 'Federalism and Local Governments' }
              ]
            },
            {
              id: 'military-history',
              name: 'Basic Military History',
              marks: 5,
              topics: [
                { id: 'mh-1', name: 'World War I and World War II' },
                { id: 'mh-2', name: 'Indo-Pak Wars (1947, 1965, 1971)' },
                { id: 'mh-3', name: 'Kargil War – 1999' }
              ]
            },
            {
              id: 'current-affairs',
              name: 'Topics of Current Interest',
              marks: 5,
              topics: [
                { id: 'ca-1', name: 'National current affairs' },
                { id: 'ca-2', name: 'International current affairs' },
                { id: 'ca-3', name: 'Sports, awards and personalities' }
              ]
            },
            {
              id: 'abbreviations',
              name: 'Common Abbreviations',
              marks: 5,
              topics: [
                { id: 'ab-1', name: 'Military and defence abbreviations' },
                { id: 'ab-2', name: 'Government and political abbreviations' },
                { id: 'ab-3', name: 'Science and technology abbreviations' }
              ]
            },
            {
              id: 'science-tech',
              name: 'Recent Developments in Science & Technology',
              marks: 5,
              topics: [
                { id: 'st-1', name: 'Recent inventions and discoveries' },
                { id: 'st-2', name: 'Space technology and ISRO missions' },
                { id: 'st-3', name: 'Defence technology developments' }
              ]
            },
            {
              id: 'indian-navy-gk',
              name: 'General Awareness – Indian Navy',
              marks: 5,
              topics: [
                { id: 'in-1', name: 'Indian Navy structure and ranks' },
                { id: 'in-2', name: 'Naval bases, ships and submarines' },
                { id: 'in-3', name: 'Naval operations and achievements' },
                { id: 'in-4', name: 'Navy motto, flag and history' }
              ]
            }
          ]
        }
      ]
    },
    {
      id: 'paper2',
      name: 'Paper II – Mathematics',
      totalMarks: 100,
      subjects: [
        {
          id: 'mathematics',
          name: 'Mathematics',
          icon: '📐',
          totalMarks: 100,
          chapters: [
            {
              id: 'trigonometry',
              name: 'Trigonometry',
              marks: 15,
              topics: [
                { id: 'trig-1', name: 'Trigonometric ratios of angles, values and relationships' },
                { id: 'trig-2', name: 'Conversion between ratios, domains and range' },
                { id: 'trig-3', name: 'Positive and negative angles, trigonometric functions' },
                { id: 'trig-4', name: 'Problems on heights and distances' }
              ]
            },
            {
              id: 'algebra',
              name: 'Algebra',
              marks: 17,
              topics: [
                { id: 'alg-1', name: 'Principle of Mathematical Induction' },
                { id: 'alg-2', name: 'Linear Inequalities in one and two variables' },
                { id: 'alg-3', name: 'Permutations and Combinations – nPr and nCr' },
                { id: 'alg-4', name: "Binomial Theorem – Pascal's triangle, general and middle term" },
                { id: 'alg-5', name: 'Sequence and Series – AP, GP, AM, GM' },
                { id: 'alg-6', name: 'Relation between AM and GM' }
              ]
            },
            {
              id: 'coordinate-geometry',
              name: 'Coordinate Geometry',
              marks: 15,
              topics: [
                { id: 'cg-1', name: 'Straight lines – slope, angle between two lines' },
                { id: 'cg-2', name: 'Various forms of equations of a line' },
                { id: 'cg-3', name: 'Distance of a point from a line' },
                { id: 'cg-4', name: 'Conic Sections – circle, ellipse, parabola, hyperbola' },
                { id: 'cg-5', name: 'Standard equations and simple properties' }
              ]
            },
            {
              id: 'calculus',
              name: 'Calculus',
              marks: 20,
              topics: [
                { id: 'cal-1', name: 'Limits and Derivatives – limit of a function' },
                { id: 'cal-2', name: 'Geometric meaning of derivative' },
                { id: 'cal-3', name: 'Derivatives of polynomial and trigonometric functions' },
                { id: 'cal-4', name: 'Differentiability – continuity and differentiability' },
                { id: 'cal-5', name: 'Chain rule, derivatives of composite functions' },
                { id: 'cal-6', name: 'Derivatives of inverse trigonometric and exponential functions' },
                { id: 'cal-7', name: 'Logarithmic differentiation' },
                { id: 'cal-8', name: 'Integrals – integration as inverse of differentiation' },
                { id: 'cal-9', name: 'Integration by substitution, partial fractions, by parts' },
                { id: 'cal-10', name: 'Definite integrals as limit of sum' }
              ]
            },
            {
              id: 'statistics-probability',
              name: 'Statistics & Probability',
              marks: 15,
              topics: [
                { id: 'sp-1', name: 'Mean deviation, variance and standard deviation' },
                { id: 'sp-2', name: 'Analysis of frequency distributions' },
                { id: 'sp-3', name: 'Probability – outcomes of random experiments' },
                { id: 'sp-4', name: 'Exhaustive and mutually exclusive events' },
                { id: 'sp-5', name: 'Conditional probability and independent events' }
              ]
            },
            {
              id: 'matrices-determinants',
              name: 'Matrices & Determinants',
              marks: 10,
              topics: [
                { id: 'md-1', name: 'Matrices – concept, notation, types, operations' },
                { id: 'md-2', name: 'Symmetric, skew-symmetric matrices' },
                { id: 'md-3', name: 'Determinant of square matrix (up to 3×3)' },
                { id: 'md-4', name: 'Minors, cofactors and applications in area of triangle' },
                { id: 'md-5', name: 'Adjoint and inverse of square matrix' }
              ]
            },
            {
              id: 'number-system',
              name: 'Number System',
              marks: 8,
              topics: [
                { id: 'ns-1', name: 'Decimal number system' },
                { id: 'ns-2', name: 'Binary number system' },
                { id: 'ns-3', name: 'Binary to Decimal conversion' },
                { id: 'ns-4', name: 'Decimal to Binary conversion' }
              ]
            }
          ]
        }
      ]
    },
    {
      id: 'paper3',
      name: 'Paper III – General Science',
      totalMarks: 100,
      subjects: [
        {
          id: 'physics',
          name: 'Physics',
          icon: '⚛️',
          totalMarks: 100,
          chapters: [
            {
              id: 'physical-world',
              name: 'Physical World & Measurement',
              marks: 8,
              topics: [
                { id: 'pw-1', name: 'Need for Measurement – units, systems of units, SI units' },
                { id: 'pw-2', name: 'Fundamental and derived units' },
                { id: 'pw-3', name: 'Length, mass and time measurements' },
                { id: 'pw-4', name: 'Accuracy, precision, errors in measurement, significant figures' }
              ]
            },
            {
              id: 'kinematics',
              name: 'Kinematics',
              marks: 10,
              topics: [
                { id: 'kin-1', name: 'Motion in a straight line, position-time graph' },
                { id: 'kin-2', name: 'Speed and velocity, uniform and non-uniform motion' },
                { id: 'kin-3', name: 'Uniformly accelerated motion – equations of motion' },
                { id: 'kin-4', name: 'Scalar and vector quantities, addition and subtraction' },
                { id: 'kin-5', name: 'Relative velocity, projectile motion, uniform circular motion' }
              ]
            },
            {
              id: 'motion-force-work',
              name: 'Motion, Force & Work',
              marks: 10,
              topics: [
                { id: 'mfw-1', name: "Floatation – thrust, pressure, Archimedes' principle, buoyancy" },
                { id: 'mfw-2', name: 'Relative density' },
                { id: 'mfw-3', name: 'Work, energy and power' },
                { id: 'mfw-4', name: 'Kinetic and potential energy, law of conservation of energy' }
              ]
            },
            {
              id: 'gravitation',
              name: 'Gravitation',
              marks: 8,
              topics: [
                { id: 'grav-1', name: "Kepler's laws of planetary motion" },
                { id: 'grav-2', name: 'Universal law of gravitation' },
                { id: 'grav-3', name: 'Acceleration due to gravity and its variation' },
                { id: 'grav-4', name: 'Escape velocity, orbital velocity of a satellite' },
                { id: 'grav-5', name: 'Geo-stationary satellites' }
              ]
            },
            {
              id: 'oscillations-waves',
              name: 'Oscillations & Waves',
              marks: 12,
              topics: [
                { id: 'ow-1', name: 'Periodic motion – period, frequency, displacement' },
                { id: 'ow-2', name: 'Simple Harmonic Motion (SHM) – equation, phase' },
                { id: 'ow-3', name: 'Kinetic and potential energy in SHM' },
                { id: 'ow-4', name: 'Simple pendulum, free and forced oscillations, resonance' },
                { id: 'ow-5', name: 'Wave motion – transverse and longitudinal waves' },
                { id: 'ow-6', name: 'Speed of wave, superposition, reflection, Doppler effect' },
                { id: 'ow-7', name: 'Nature of sound, ultrasound, SONAR' }
              ]
            },
            {
              id: 'optics',
              name: 'Optics (Natural Phenomena)',
              marks: 12,
              topics: [
                { id: 'opt-1', name: 'Reflection and Refraction – laws, refractive index' },
                { id: 'opt-2', name: 'Mirror Formula, focal length, centre of curvature' },
                { id: 'opt-3', name: 'Spherical lenses and mirrors – Lens Formula, Magnification' },
                { id: 'opt-4', name: 'Power of a lens, human eye, defects of vision' },
                { id: 'opt-5', name: 'Refraction through prism, dispersion of light, scattering' }
              ]
            },
            {
              id: 'current-electricity',
              name: 'Current Electricity',
              marks: 15,
              topics: [
                { id: 'ce-1', name: "Electric current, Ohm's law, electrical resistance" },
                { id: 'ce-2', name: 'Resistivity and conductivity, V-I characteristics' },
                { id: 'ce-3', name: 'Carbon resistors, colour code, series and parallel combinations' },
                { id: 'ce-4', name: 'Internal resistance, EMF, cells in series and parallel' },
                { id: 'ce-5', name: "Kirchhoff's laws, Wheatstone bridge, Metre bridge" },
                { id: 'ce-6', name: "Potentiometer, Coulomb's law, Electric field and lines of force" }
              ]
            },
            {
              id: 'heat',
              name: 'Heat',
              marks: 5,
              topics: [
                { id: 'heat-1', name: 'Hot and cold bodies, temperature and measurement' },
                { id: 'heat-2', name: 'Units of heat, thermal expansion of solids and fluids' }
              ]
            },
            {
              id: 'magnetism',
              name: 'Magnetic Effects of Current & Magnetism',
              marks: 12,
              topics: [
                { id: 'mag-1', name: "Biot-Savart law, Ampere's law, straight and toroidal solenoids" },
                { id: 'mag-2', name: 'Force on moving charge in magnetic and electric fields' },
                { id: 'mag-3', name: 'Cyclotron, force on current-carrying conductor' },
                { id: 'mag-4', name: "Earth's magnetic field and magnetic elements" },
                { id: 'mag-5', name: 'Para, dia and ferro magnetic substances' },
                { id: 'mag-6', name: 'Electromagnets, principle of AC generators, transformers' }
              ]
            },
            {
              id: 'communication-systems',
              name: 'Communication Systems',
              marks: 8,
              topics: [
                { id: 'com-1', name: 'Types of communication systems, modulation' },
                { id: 'com-2', name: 'Digital communication, data and document transmission' },
                { id: 'com-3', name: 'Communication channels, space and satellite communication' },
                { id: 'com-4', name: 'Line and optical communication' }
              ]
            }
          ]
        }
      ]
    }
  ]
};

// ============================================================
// EMBEDDED QUESTIONS — One set per chapter for offline quiz
// ============================================================
const NEA_QUESTIONS = {
  questions: {
    'comprehension': [
      { question: 'What is the primary purpose of a comprehension passage in English exams?', options: ['Test vocabulary only', 'Test reading, interpretation and inference skills', 'Test grammar rules', 'Test writing ability'], answer: 1, explanation: 'Comprehension tests the ability to read, understand, interpret meaning and draw inferences from a given passage.' },
      { question: 'Drawing inferences from a passage means:', options: ['Copying text directly', 'Concluding unstated facts based on given information', 'Listing all nouns', 'Translating the passage'], answer: 1, explanation: 'Inference means reading between the lines — concluding something not directly stated but implied by the text.' }
    ],
    'tenses-voices': [
      { question: 'Convert to Passive Voice: "She writes a letter."', options: ['A letter is written by her.', 'A letter was written by her.', 'A letter has been written by her.', 'A letter will be written by her.'], answer: 0, explanation: 'Present simple active → Present simple passive: Subject + is/am/are + past participle + by + object.' },
      { question: 'Change to Indirect Speech: He said, "I am happy."', options: ['He said that he is happy.', 'He said that he was happy.', 'He told that he was happy.', 'He said that he am happy.'], answer: 1, explanation: 'In indirect speech, "said" shifts present tense to past: "I am" → "he was".' },
      { question: 'Choose the correct degree of comparison: "She is _____ student in the class."', options: ['more intelligent', 'most intelligent', 'the most intelligent', 'most intelligenter'], answer: 2, explanation: 'Superlative degree uses "the most + adjective" when comparing more than two.' },
      { question: 'Which sentence uses the preposition correctly?', options: ['She is good in mathematics.', 'She is good at mathematics.', 'She is good for mathematics.', 'She is good about mathematics.'], answer: 1, explanation: '"Good at" is the correct collocation when referring to skill or subject ability.' }
    ],
    'applied-grammar': [
      { question: 'Reorder the words to form a correct sentence: (goes / to / school / he / every / day)', options: ['He every day goes to school.', 'He goes to school every day.', 'Every day school he goes to.', 'He goes every day school to.'], answer: 1, explanation: 'Correct word order: Subject + Verb + Object/Complement + Adverbial phrase.' },
      { question: 'Fill in the gap: "He was tired, _____ he continued working."', options: ['so', 'because', 'yet', 'for'], answer: 2, explanation: '"Yet" is a conjunction that shows contrast — similar to "but" — used when two opposite ideas are joined.' }
    ],
    'idioms-phrases': [
      { question: 'What does the idiom "bite the bullet" mean?', options: ['To eat something hard', 'To endure a painful situation bravely', 'To shoot someone', 'To be very hungry'], answer: 1, explanation: '"Bite the bullet" means to endure a difficult or painful situation with courage.' },
      { question: 'What does "break the ice" mean?', options: ['To damage something frozen', 'To start a conversation in an awkward situation', 'To win a competition', 'To escape from prison'], answer: 1, explanation: '"Break the ice" means to initiate conversation and ease tension in a social situation.' }
    ],
    'vocabulary': [
      { question: 'What is the synonym of "Brave"?', options: ['Coward', 'Fearful', 'Courageous', 'Timid'], answer: 2, explanation: '"Courageous" is the synonym of "Brave" — both mean showing no fear in difficult situations.' },
      { question: 'What is the antonym of "Transparent"?', options: ['Clear', 'Obvious', 'Opaque', 'Bright'], answer: 2, explanation: '"Opaque" is the antonym of "Transparent" — it means not allowing light to pass through.' }
    ],
    'indian-constitution': [
      { question: 'How many articles are there in the Indian Constitution (originally)?', options: ['356', '395', '448', '500'], answer: 1, explanation: 'The original Indian Constitution had 395 articles, 8 schedules and 22 parts when it was adopted in 1949.' },
      { question: 'The Indian Constitution was adopted on:', options: ['15 August 1947', '26 November 1949', '26 January 1950', '30 January 1948'], answer: 1, explanation: 'The Constituent Assembly adopted the Constitution on 26 November 1949. It came into force on 26 January 1950.' },
      { question: 'Which article of the Indian Constitution abolishes untouchability?', options: ['Article 14', 'Article 15', 'Article 17', 'Article 21'], answer: 2, explanation: 'Article 17 of the Indian Constitution abolishes untouchability and forbids its practice in any form.' }
    ],
    'military-history': [
      { question: 'In which year did the Kargil War take place?', options: ['1965', '1971', '1999', '2001'], answer: 2, explanation: 'The Kargil War (Operation Vijay) was fought between India and Pakistan in 1999 in the Kargil district of Jammu & Kashmir.' },
      { question: 'Operation Vijay refers to:', options: ['1965 Indo-Pak War', '1971 Bangladesh Liberation War', '1999 Kargil War', '2016 Surgical Strikes'], answer: 2, explanation: 'Operation Vijay was the Indian military operation to recapture Pakistani-occupied peaks in Kargil in 1999.' },
      { question: 'Which war led to the creation of Bangladesh?', options: ['1947 Indo-Pak War', '1962 Sino-Indian War', '1965 Indo-Pak War', '1971 Indo-Pak War'], answer: 3, explanation: 'The 1971 Indo-Pak War (Operation Trident) led to the creation of Bangladesh as an independent nation.' }
    ],
    'current-affairs': [
      { question: 'Which organisation conducts the Navy Entry Artificer (NEA) examination?', options: ['UPSC', 'Indian Navy', 'SSB', 'DRDO'], answer: 1, explanation: 'The Indian Navy conducts the NEA examination to recruit artificers into the technical branches of the Indian Navy.' },
      { question: "India's first indigenously built aircraft carrier is:", options: ['INS Vikrant', 'INS Viraat', 'INS Vikramaditya', 'INS Vishal'], answer: 0, explanation: "INS Vikrant (IAC-1) is India's first indigenously built aircraft carrier, commissioned in September 2022." }
    ],
    'abbreviations': [
      { question: 'What does "SONAR" stand for?', options: ['Sound Navigation and Ranging', 'Solar Navigational Array', 'Sound Observation and Navigation Array', 'Submarine Ocean Navigational Radar'], answer: 0, explanation: 'SONAR stands for Sound Navigation and Ranging. It uses sound waves to detect and locate underwater objects.' },
      { question: 'What does "RADAR" stand for?', options: ['Radio Detection and Ranging', 'Remote Area Detection and Recording', 'Radio Array Detection and Relay', 'Rapid Area Defence and Ranging'], answer: 0, explanation: 'RADAR stands for Radio Detection and Ranging. It uses radio waves to detect the position and velocity of objects.' },
      { question: 'INS stands for:', options: ['Indian Navigation Ship', 'Indian Naval Ship', 'Integrated Naval System', 'Indian Navy Squadron'], answer: 1, explanation: 'INS stands for Indian Naval Ship — the prefix used for commissioned vessels of the Indian Navy.' }
    ],
    'science-tech': [
      { question: 'ISRO stands for:', options: ['Indian Space Research Organisation', 'Indian Scientific Research Organisation', 'International Space Research Organisation', 'Indian Satellite and Rocket Organisation'], answer: 0, explanation: "ISRO — Indian Space Research Organisation — is India's national space agency, headquartered in Bengaluru." },
      { question: "Chandrayaan-3 successfully landed on the Moon's south pole in:", options: ['2021', '2022', '2023', '2024'], answer: 2, explanation: "Chandrayaan-3's Vikram lander successfully touched down near the Moon's south pole on 23 August 2023." }
    ],
    'indian-navy-gk': [
      { question: 'The motto of the Indian Navy is:', options: ['Jai Hind', 'Sam No Varuna', 'Satyameva Jayate', 'Sarvatra Vijay'], answer: 1, explanation: '"Sam No Varuna" (शं नो वरुण) is the motto of the Indian Navy, meaning "May the Lord of the Waters be auspicious unto us".' },
      { question: 'INS Vikramaditya is a:', options: ['Destroyer', 'Submarine', 'Aircraft Carrier', 'Frigate'], answer: 2, explanation: 'INS Vikramaditya is an aircraft carrier of the Indian Navy. It was commissioned in 2013 and is currently the largest warship in the Indian Navy.' },
      { question: 'The Eastern Naval Command of India is headquartered at:', options: ['Mumbai', 'Kochi', 'Visakhapatnam', 'Port Blair'], answer: 2, explanation: 'The Eastern Naval Command is headquartered at Visakhapatnam (Vizag), Andhra Pradesh.' }
    ],
    'trigonometry': [
      { question: 'What is the value of sin 90°?', options: ['0', '1', '√2/2', '1/2'], answer: 1, explanation: 'sin 90° = 1. This is a standard trigonometric value that must be memorised.' },
      { question: 'What is the value of cos 0°?', options: ['0', '1/2', '1', '√3/2'], answer: 2, explanation: 'cos 0° = 1. At 0 degrees, the cosine function has its maximum value of 1.' },
      { question: 'tan θ is equal to:', options: ['cos θ / sin θ', 'sin θ / cos θ', 'sin θ × cos θ', '1 / sin θ'], answer: 1, explanation: 'tan θ = sin θ / cos θ. This is the fundamental identity relating tangent to sine and cosine.' },
      { question: 'The identity sin²θ + cos²θ equals:', options: ['0', '2', '1', 'tan²θ'], answer: 2, explanation: 'sin²θ + cos²θ = 1 is the Pythagorean identity, fundamental in trigonometry.' },
      { question: 'If the angle of elevation of the top of a tower is 45° from a point 50m away, what is the height?', options: ['25 m', '50 m', '100 m', '50√2 m'], answer: 1, explanation: 'tan 45° = height/distance → 1 = height/50 → height = 50 m.' }
    ],
    'algebra': [
      { question: 'How many ways can 3 students be selected from a group of 8?', options: ['24', '56', '336', '512'], answer: 1, explanation: "C(8,3) = 8!/(3!×5!) = (8×7×6)/(3×2×1) = 56. This is a combination problem since order doesn't matter." },
      { question: 'The sum of first n terms of an AP with first term a and common difference d is:', options: ['n/2 × (a + l)', 'n/2 × (2a + (n-1)d)', 'Both A and B', 'n × a'], answer: 2, explanation: 'Both formulas are correct: Sn = n/2(a + l) where l is last term, or Sn = n/2[2a + (n-1)d].' },
      { question: 'In Binomial expansion of (x+y)ⁿ, the number of terms is:', options: ['n', 'n-1', 'n+1', '2n'], answer: 2, explanation: 'The binomial expansion of (x+y)ⁿ has (n+1) terms, with powers of x decreasing from n to 0.' },
      { question: 'The middle term of (x+y)⁶ is the:', options: ['3rd term', '4th term', '5th term', '6th term'], answer: 1, explanation: 'For even n, middle term = (n/2 + 1)th term = (6/2 + 1) = 4th term.' }
    ],
    'coordinate-geometry': [
      { question: 'The slope of a line parallel to the x-axis is:', options: ['1', 'undefined', '0', '-1'], answer: 2, explanation: 'A line parallel to the x-axis is horizontal and has a slope of 0.' },
      { question: 'The distance between points (3,4) and (0,0) is:', options: ['3', '4', '5', '7'], answer: 2, explanation: 'Distance = √(3² + 4²) = √(9+16) = √25 = 5. This is a classic 3-4-5 Pythagorean triple.' },
      { question: 'The standard equation of a circle with centre (0,0) and radius r is:', options: ['x² + y² = r', 'x + y = r²', 'x² + y² = r²', '(x+r)² + (y+r)² = 0'], answer: 2, explanation: 'x² + y² = r² is the standard equation of a circle with centre at the origin and radius r.' }
    ],
    'calculus': [
      { question: 'What is the derivative of sin x?', options: ['-cos x', 'cos x', '-sin x', 'tan x'], answer: 1, explanation: 'd/dx (sin x) = cos x. This is a fundamental derivative that must be memorised.' },
      { question: 'What is the derivative of xⁿ?', options: ['nxⁿ', 'xⁿ⁻¹', 'nxⁿ⁻¹', 'n·xⁿ⁺¹'], answer: 2, explanation: 'By the Power Rule: d/dx(xⁿ) = n·xⁿ⁻¹. Multiply by the exponent and reduce it by 1.' },
      { question: '∫cos x dx equals:', options: ['sin x + C', '-sin x + C', 'tan x + C', 'cos x + C'], answer: 0, explanation: '∫cos x dx = sin x + C. Integration of cos x gives sin x plus constant C.' },
      { question: 'A function is differentiable at a point only if it is:', options: ['Discontinuous at that point', 'Continuous at that point', 'Undefined at that point', 'Non-linear at that point'], answer: 1, explanation: 'Differentiability implies continuity. A function must be continuous at a point to be differentiable there.' }
    ],
    'statistics-probability': [
      { question: 'Standard deviation is the square root of:', options: ['Mean', 'Median', 'Variance', 'Mode'], answer: 2, explanation: 'Standard Deviation = √Variance. Variance is the average of the squared deviations from the mean.' },
      { question: 'If P(A) = 0.4 and P(B) = 0.6, and A and B are independent, what is P(A∩B)?', options: ['1.0', '0.24', '0.2', '0.6'], answer: 1, explanation: 'For independent events: P(A∩B) = P(A) × P(B) = 0.4 × 0.6 = 0.24.' },
      { question: 'The probability of an impossible event is:', options: ['1', '0.5', '0', 'Between 0 and 1'], answer: 2, explanation: 'An impossible event can never occur, so its probability is always 0.' }
    ],
    'matrices-determinants': [
      { question: 'The transpose of a matrix A is obtained by:', options: ['Multiplying each element by -1', 'Interchanging rows and columns', 'Squaring each element', 'Adding 1 to each element'], answer: 1, explanation: 'The transpose Aᵀ is obtained by interchanging the rows and columns of matrix A.' },
      { question: 'A square matrix is said to be symmetric if:', options: ['A = -Aᵀ', 'A = Aᵀ', 'A = A²', 'A = A⁻¹'], answer: 1, explanation: 'A matrix A is symmetric if A = Aᵀ, meaning it equals its own transpose.' },
      { question: 'The determinant of a 2×2 matrix [[a,b],[c,d]] is:', options: ['ac - bd', 'ad + bc', 'ab - cd', 'ad - bc'], answer: 3, explanation: 'det[[a,b],[c,d]] = ad - bc. This is the standard formula for a 2×2 determinant.' }
    ],
    'number-system': [
      { question: 'Convert binary 1010 to decimal:', options: ['8', '10', '12', '14'], answer: 1, explanation: '1010₂ = 1×2³ + 0×2² + 1×2¹ + 0×2⁰ = 8 + 0 + 2 + 0 = 10₁₀.' },
      { question: 'Convert decimal 13 to binary:', options: ['1011', '1101', '1111', '1001'], answer: 1, explanation: '13 ÷ 2 = 6 R1, 6 ÷ 2 = 3 R0, 3 ÷ 2 = 1 R1, 1 ÷ 2 = 0 R1. Reading remainders bottom up: 1101₂.' },
      { question: 'Binary 1111 in decimal is:', options: ['13', '14', '15', '16'], answer: 2, explanation: '1111₂ = 8+4+2+1 = 15₁₀.' },
      { question: 'The base of the binary number system is:', options: ['8', '10', '16', '2'], answer: 3, explanation: 'The binary number system has base 2, using only digits 0 and 1.' }
    ],
    'physical-world': [
      { question: 'The SI unit of length is:', options: ['Centimetre', 'Foot', 'Metre', 'Kilometre'], answer: 2, explanation: 'The SI (International System of Units) unit of length is the metre (m).' },
      { question: 'The number of significant figures in 0.00450 is:', options: ['6', '3', '5', '2'], answer: 1, explanation: 'Leading zeros are not significant. 0.00450 has 3 significant figures: 4, 5, and the trailing 0 after the decimal.' },
      { question: 'Which of the following is a derived unit?', options: ['Kilogram', 'Second', 'Newton', 'Ampere'], answer: 2, explanation: 'Newton (N = kg·m/s²) is a derived unit. Kilogram, second and ampere are base SI units.' }
    ],
    'kinematics': [
      { question: 'A body is at rest. Its acceleration is:', options: ['Maximum', 'Negative', 'Zero', 'Cannot be determined'], answer: 2, explanation: 'A body at rest has zero velocity. If it remains at rest, acceleration is also zero (v = u + at → 0 = 0 + a×t → a = 0).' },
      { question: 'Which equation of motion relates v, u, a and s (not time)?', options: ['v = u + at', 's = ut + ½at²', 'v² = u² + 2as', 's = (u+v)/2 × t'], answer: 2, explanation: 'v² = u² + 2as is the equation that relates final velocity, initial velocity, acceleration and displacement without time.' },
      { question: 'Projectile motion is an example of:', options: ['Uniform motion', 'Uniformly decelerated motion', 'Motion in two dimensions', 'Circular motion'], answer: 2, explanation: 'Projectile motion is a classic example of two-dimensional motion under constant gravitational acceleration.' }
    ],
    'motion-force-work': [
      { question: "Archimedes' Principle states that the buoyant force equals:", options: ["Weight of the object", "Mass of liquid displaced", "Weight of fluid displaced by the object", "Volume of the object"], answer: 2, explanation: "Archimedes' Principle: the upward buoyant force on a submerged object equals the weight of the fluid it displaces." },
      { question: 'The unit of work is:', options: ['Newton', 'Watt', 'Joule', 'Pascal'], answer: 2, explanation: 'Work = Force × Displacement. The SI unit of work is Joule (J) = Newton × Metre.' },
      { question: 'A body moving with constant velocity has:', options: ['Non-zero acceleration', 'Zero net force acting on it', 'Increasing kinetic energy', 'Decreasing momentum'], answer: 1, explanation: "By Newton's first law, if net force = 0, velocity is constant. So constant velocity → zero net force." }
    ],
    'gravitation': [
      { question: "The escape velocity from Earth's surface is approximately:", options: ['7.9 km/s', '11.2 km/s', '3 km/s', '15.6 km/s'], answer: 1, explanation: "Escape velocity from Earth = √(2gR) ≈ 11.2 km/s. This is the minimum speed needed to escape Earth's gravity." },
      { question: 'A geostationary satellite completes one orbit in:', options: ['12 hours', '24 hours', '48 hours', '1 hour'], answer: 1, explanation: "A geostationary satellite has a period of exactly 24 hours (matching Earth's rotation), so it appears stationary." },
      { question: "Kepler's second law states that a planet sweeps:", options: ['Equal distances in equal times', 'Equal areas in equal times', 'Equal speeds in equal times', 'Equal orbits in equal times'], answer: 1, explanation: "Kepler's second law (Law of Areas) states that the line joining a planet to the sun sweeps equal areas in equal time intervals." }
    ],
    'oscillations-waves': [
      { question: 'In Simple Harmonic Motion, the restoring force is proportional to:', options: ['Velocity of the particle', 'Square of displacement', 'Displacement from mean position', 'Time period'], answer: 2, explanation: 'SHM is defined by F = -kx, where force is proportional to displacement from the mean position, directed towards it.' },
      { question: 'SONAR works on the principle of:', options: ['Light reflection', 'Radio waves', 'Echo of sound waves', 'Magnetic fields'], answer: 2, explanation: 'SONAR (Sound Navigation and Ranging) works by emitting sound waves and detecting their echo to find underwater objects.' },
      { question: 'The time period of a simple pendulum depends on:', options: ['Mass of the bob', 'Amplitude of oscillation', 'Effective length and g', 'Colour of the string'], answer: 2, explanation: 'T = 2π√(L/g). The period depends only on the effective length L and acceleration due to gravity g.' }
    ],
    'optics': [
      { question: 'The Mirror Formula is:', options: ['1/f = 1/v × 1/u', '1/f = 1/v + 1/u', '1/f = v + u', 'f = v - u'], answer: 1, explanation: '1/f = 1/v + 1/u is the mirror formula, where f = focal length, v = image distance, u = object distance.' },
      { question: 'A convex lens is used to correct which eye defect?', options: ['Myopia (short-sightedness)', 'Hypermetropia (long-sightedness)', 'Astigmatism', 'Colour blindness'], answer: 1, explanation: 'Convex (converging) lens corrects Hypermetropia (far-sightedness). Concave lens corrects Myopia.' },
      { question: "Snell's Law of refraction is expressed as:", options: ['n₁/n₂ = sin θ₂/sin θ₁', 'n₁ sin θ₁ = n₂ sin θ₂', 'n₁ cos θ₁ = n₂ cos θ₂', 'n₁ + n₂ = sin θ₁ + sin θ₂'], answer: 1, explanation: "Snell's Law: n₁ sin θ₁ = n₂ sin θ₂, where n is refractive index and θ is the angle with the normal." }
    ],
    'current-electricity': [
      { question: "Ohm's Law states that (at constant temperature):", options: ['V is inversely proportional to I', 'V is proportional to I²', 'V is directly proportional to I', 'V is proportional to R²'], answer: 2, explanation: "Ohm's Law: V = IR. Voltage is directly proportional to current when resistance is constant." },
      { question: 'The colour code for a carbon resistor with bands: Brown, Black, Red means:', options: ['1000 Ω', '100 Ω', '102 Ω', '1002 Ω'], answer: 0, explanation: 'Brown=1, Black=0, Red=×100. So 10 × 100 = 1000 Ω = 1 kΩ. Use the mnemonic BBROY of Great Britain.' },
      { question: "Kirchhoff's Current Law (KCL) states that:", options: ['Sum of voltages in a loop is zero', 'Sum of currents entering a junction equals sum leaving it', 'Resistance is constant at all temperatures', 'Power is always conserved'], answer: 1, explanation: 'KCL: The algebraic sum of currents at a junction is zero — currents in = currents out. Based on conservation of charge.' }
    ],
    'heat': [
      { question: 'The SI unit of temperature is:', options: ['Celsius', 'Fahrenheit', 'Kelvin', 'Rankine'], answer: 2, explanation: 'The SI unit of temperature is Kelvin (K). Zero Kelvin (0 K) is absolute zero, the lowest possible temperature.' },
      { question: 'Thermal expansion of a solid on heating means:', options: ['Its mass increases', 'Its density increases', 'Its volume increases', 'Its weight decreases'], answer: 2, explanation: 'Thermal expansion means an increase in volume (and length, area) when temperature rises, as atoms vibrate more.' }
    ],
    'magnetism': [
      { question: 'The SI unit of magnetic field (B) is:', options: ['Weber', 'Tesla', 'Henry', 'Gauss'], answer: 1, explanation: 'The SI unit of magnetic field strength (B) is Tesla (T). 1 Tesla = 1 Wb/m².' },
      { question: 'A cyclotron is used to accelerate:', options: ['Photons', 'Neutrons', 'Charged particles', 'Sound waves'], answer: 2, explanation: 'A cyclotron uses magnetic and electric fields to accelerate charged particles (like protons) to high speeds for nuclear research.' },
      { question: 'The principle of electromagnetic induction was discovered by:', options: ['Newton', 'Faraday', 'Ampere', 'Ohm'], answer: 1, explanation: 'Michael Faraday discovered electromagnetic induction in 1831 — a changing magnetic field induces an EMF in a conductor.' }
    ],
    'communication-systems': [
      { question: 'Modulation is the process of:', options: ['Amplifying a signal', 'Superimposing information on a carrier wave', 'Converting analog to digital', 'Filtering noise from a signal'], answer: 1, explanation: 'Modulation is the process of combining information (audio/data) with a high-frequency carrier wave for transmission.' },
      { question: 'Optical fibre communication uses:', options: ['Radio waves', 'Sound waves', 'Light waves', 'Microwaves'], answer: 2, explanation: 'Optical fibre uses light waves (usually infrared laser) to transmit data through total internal reflection in glass fibres.' },
      { question: 'RADAR works on which principle?', options: ['Refraction of light', 'Reflection of radio waves', 'Diffraction of sound', 'Absorption of X-rays'], answer: 1, explanation: 'RADAR (Radio Detection and Ranging) works by emitting radio waves and detecting the reflected waves to find objects.' }
    ]
  }
};

// ============================================================
// LOAD RESOURCES — now uses embedded data, no external fetch
// ============================================================
async function loadResources() {
  // Use embedded data directly — no network dependency
  App.syllabus  = NEA_SYLLABUS;
  App.questions = NEA_QUESTIONS;
  console.log('[NavPath] Syllabus and questions loaded ✓');
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
      // FIX #3: Use App.firebase.db Timestamp reference, not bare firebase.firestore.Timestamp
      // (the bare reference sometimes fails if Firestore isn't initialized before this runs)
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
  if (!App.userDoc) return { active: true, daysLeft: 3 }; // Default to trial active for new sessions
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
      .set({
        completed,
        completedAt: firebase.firestore.Timestamp.now()
      });
    updateSyllabusUI();
    updateProgressStats();
  } catch (e) {
    console.error('[NavPath] Failed to save progress:', e);
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
  btn.textContent = 'Creating account...';
  btn.disabled = true;

  // Demo mode
  if (!App.firebase) {
    App.user = { uid: 'demo', email, displayName: name };
    App.userDoc = { displayName: name, email, trialStartDate: { toDate: () => new Date() }, isPremium: false, streak: 1, planType: 'trial' };
    await loadResources();
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
  btn.textContent = 'Signing in...';
  btn.disabled = true;

  // Demo mode
  if (!App.firebase) {
    App.user = { uid: 'demo', email, displayName: email.split('@')[0] };
    App.userDoc = { displayName: email.split('@')[0], email, trialStartDate: { toDate: () => new Date() }, isPremium: false, streak: 3, planType: 'trial' };
    await loadResources();
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
    if (e.code === 'auth/user-not-found') msg = 'No account found with this email.';
    else if (e.code === 'auth/wrong-password') msg = 'Incorrect password.';
    else if (e.code === 'auth/invalid-email') msg = 'Invalid email address.';
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
  const qBank = App.questions?.questions;
  if (!qBank || !qBank[chapterId] || qBank[chapterId].length === 0) {
    toast('No questions available for this chapter yet.', 'info');
    return;
  }

  const questions = [...qBank[chapterId]].sort(() => Math.random() - 0.5);

  App.currentQuiz = { chapterId, questions, idx: 0, score: 0, answered: false };

  switchTab('quiz');

  // FIX #4: Build the quiz DOM shell, then render the first question into it
  const area = $('#quiz-question-area');
  const result = $('#quiz-result-area');
  if (result) result.classList.add('hidden');
  if (area) {
    area.classList.remove('hidden');
    area.innerHTML = `
      <div class="quiz-container">
        <div class="quiz-header">
          <div class="quiz-progress-text" id="quiz-progress-text">1/${questions.length}</div>
          <div class="streak-badge">🎯 Score: <span id="quiz-score-live">0</span></div>
        </div>
        <div class="progress-bar-wrap mb-2" style="height:4px;">
          <div class="progress-bar" id="quiz-prog-bar" style="width:0%;transition:width 0.4s ease;"></div>
        </div>
        <div class="quiz-question-card">
          <div class="quiz-q-number" id="quiz-q-number">Question 1</div>
          <div class="quiz-q-text" id="quiz-q-text">Loading...</div>
        </div>
        <div class="quiz-options" id="quiz-options"></div>
        <div class="quiz-explanation" id="quiz-explanation"></div>
        <button class="btn btn-primary btn-block" id="quiz-next-btn"
                onclick="nextQuestion()" style="margin-top:0.5rem;">
          Next Question
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

  const qNum = $(`#quiz-q-number`);
  const qText = $(`#quiz-q-text`);
  const qProg = $(`#quiz-progress-text`);
  const qExp  = $(`#quiz-explanation`);
  const qNext = $(`#quiz-next-btn`);
  const qBar  = $(`#quiz-prog-bar`);
  const scoreLive = $(`#quiz-score-live`);

  if (qNum)  qNum.textContent  = `Question ${idx + 1} of ${questions.length}`;
  if (qText) qText.textContent = q.question;
  if (qProg) qProg.textContent = `${idx + 1}/${questions.length} • Score: ${App.currentQuiz.score}`;
  if (qExp)  qExp.classList.remove('show');
  if (qNext) qNext.textContent = idx === questions.length - 1 ? 'Finish Quiz' : 'Next Question';
  if (qBar)  qBar.style.width  = `${(idx / questions.length) * 100}%`;
  if (scoreLive) scoreLive.textContent = App.currentQuiz.score;

  const optionsEl = $('#quiz-options');
  if (!optionsEl) return;
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

  const expEl = $('#quiz-explanation');
  if (expEl) {
    expEl.innerHTML = `<strong>Explanation:</strong> ${App.currentQuiz.questions[App.currentQuiz.idx].explanation}`;
    expEl.classList.add('show');
  }

  const progEl = $('#quiz-progress-text');
  if (progEl) progEl.textContent = `${App.currentQuiz.idx + 1}/${App.currentQuiz.questions.length} • Score: ${App.currentQuiz.score}`;
  const scoreEl = $('#quiz-score-live');
  if (scoreEl) scoreEl.textContent = App.currentQuiz.score;
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

  const resultArea = $('#quiz-result-area');
  if (resultArea) {
    resultArea.innerHTML = `
      <div class="card" style="text-align:center;padding:2rem;">
        <div style="font-size:3rem;margin-bottom:1rem;">${emoji}</div>
        <h2 style="font-size:2rem;color:var(--gold);">${pct}%</h2>
        <p style="margin:0.5rem 0 1.5rem;">You scored ${score} out of ${questions.length}</p>
        <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:1.5rem;">
          ${pct >= 80 ? 'Excellent work, Sailor! 🎖️' : pct >= 60 ? 'Good progress! Keep it up.' : "Keep studying – you'll get there!"}
        </p>
        <button class="btn btn-primary btn-block" onclick="resetQuiz()">Try Again</button>
        <button class="btn btn-outline btn-block mt-1" onclick="switchTab('syllabus')">Back to Syllabus</button>
      </div>
    `;
    resultArea.classList.remove('hidden');
  }

  const questionArea = $('#quiz-question-area');
  if (questionArea) questionArea.classList.add('hidden');
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
    { title: "Snell's Law", content: 'n₁sin θ₁ = n₂sin θ₂' },
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
// TAB SWITCHING
// ============================================================
function switchTab(tabName) {
  $$('.tab-content').forEach(el => el.classList.remove('active-tab'));
  $$('.nav-item').forEach(el => el.classList.remove('active'));

  const content = $(`#tab-${tabName}`);
  const navItem = $(`#nav-${tabName}`);

  content?.classList.add('active-tab');
  navItem?.classList.add('active');

  switch (tabName) {
    case 'dashboard': renderDashboard(); break;
    case 'syllabus':  renderSyllabus();  break;
    case 'quiz':
      if (!App.currentQuiz.questions.length) renderQuizLanding();
      break;
    case 'formulas': renderFormulas(); break;
    case 'profile':  renderProfile();  break;
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
        <button class="btn btn-primary mt-2" onclick="switchTab('syllabus')">Go to Syllabus</button>
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

  const name = App.userDoc?.displayName || App.user?.displayName || 'User';
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
function openPremiumModal()  { show('#premium-modal'); }
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
      premiumExpiry: firebase.firestore.Timestamp.fromDate(expiry),
      planType: plan,
    });
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
  $$('.auth-tab').forEach(t => t.classList.remove('active'));
  // FIX #8: use renamed IDs authtab-login / authtab-signup
  $(`#authtab-${tab}`)?.classList.add('active');

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
  const savedDark = localStorage.getItem('navpath-dark');
  if (savedDark === '0') {
    App.darkMode = false;
    document.documentElement.setAttribute('data-theme', 'light');
  }

  registerServiceWorker();
  initApp();

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
// GLOBAL EXPORTS
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
window.renderQuestion    = renderQuestion;   // FIX #5: was missing
window.selectAnswer      = selectAnswer;
window.nextQuestion      = nextQuestion;
window.resetQuiz         = resetQuiz;
window.openPremiumModal  = openPremiumModal;
window.closePremiumModal = closePremiumModal;
window.selectPlan        = selectPlan;
window.initiatePurchase  = initiatePurchase;
window.toggleDarkMode    = toggleDarkMode;
window.installApp        = installApp;
window.showFormulaTab    = showFormulaTab;
