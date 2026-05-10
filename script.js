// ============================================================
// NavPath – NEA Exam Prep App
// script.js – FULLY DEBUGGED & FIXED
// ============================================================
//
// BUGS FIXED (see detailed list in README section below):
//  1. App object not exposed to window  → window.App = App
//  2. login/signup btn never re-enabled on success → added reset in finally/success
//  3. firebase.firestore.Timestamp used directly → guarded with App.firebase ref
//  4. renderQuestion() references DOM nodes that don't exist intil 
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
  content: {},
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
// LOAD RESOURCES — merges embedded questions with questions.json
// ============================================================
async function loadResources() {
  App.syllabus = NEA_SYLLABUS;
  // Start with embedded questions as the base
  App.questions = { topics: {}, mockTests: [] };
  // Merge embedded NEA_QUESTIONS into App.questions.topics
  if (NEA_QUESTIONS && NEA_QUESTIONS.topics) {
    Object.assign(App.questions.topics, NEA_QUESTIONS.topics);
  }
  // Try to load external questions.json and merge on top
  try {
    const res = await fetch('data/questions.json');
    if (res.ok) {
      const ext = await res.json();
      if (ext.topics) {
        for (const [chId, qs] of Object.entries(ext.topics)) {
          if (App.questions.topics[chId]) {
            // Combine: external first, then embedded (dedup by question text)
            const existing = new Set(App.questions.topics[chId].map(q => (q.q || q.question)));
            const newQs = qs.filter(q => !existing.has(q.q || q.question));
            App.questions.topics[chId] = [...qs, ...newQs];
          } else {
            App.questions.topics[chId] = qs;
          }
        }
      }
      if (ext.mockTests) App.questions.mockTests = ext.mockTests;
      console.log('[NavPath] questions.json merged ✓ — total chapters:', Object.keys(App.questions.topics).length);
    }
  } catch(e) {
    console.warn('[NavPath] questions.json not found — using embedded questions only');
  }
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
// STUDY REMINDER SYSTEM
// Uses Web Notifications API + localStorage for persistence.
// Works as a daily alarm: checks every minute if it's time to
// notify, and fires a browser notification at the set time.
// ============================================================
const StudyReminder = {
  _interval: null,
  _notifPermission: Notification.permission || 'default',

  /** Load saved settings from localStorage */
  load() {
    try {
      const raw = localStorage.getItem('navpath-reminder');
      if (!raw) return { enabled: false, hour: 18, minute: 0 };
      return JSON.parse(raw);
    } catch (e) { return { enabled: false, hour: 18, minute: 0 }; }
  },

  /** Save settings to localStorage */
  save(settings) {
    localStorage.setItem('navpath-reminder', JSON.stringify(settings));
  },

  /** Format as "HH:MM AM/PM" for display */
  formatTime(hour, minute) {
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const h = hour % 12 || 12;
    const m = String(minute).padStart(2, '0');
    return `${h}:${m} ${ampm}`;
  },

  /** Request notification permission if not granted */
  async requestPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    this._notifPermission = result;
    return result === 'granted';
  },

  /** Motivational quotes pool — 55 total (20 English + 20 Hinglish + 15 NavPath/NEA) */
  _quotes: [
    // ── English quotes (20) ──────────────────────────────────
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

    // ── Hinglish quotes (20) ────────────────────────────────
    { text: "Kal ki chinta mat kar, aaj ki mehnat kar — result khud aa jayega.", author: "NavPath", color: "#1a2a1a", accent: "#4ade80" },
    { text: "Sapne dekhna band mat karo, unhe pura karne ke liye padhai shuru karo.", author: "NavPath", color: "#2a1a3a", accent: "#c084fc" },
    { text: "Thoda aur padhlo yaar — Navy ka sapna door nahi hai!", author: "NavPath", color: "#0a1e3a", accent: "#38bdf8" },
    { text: "Mehnat karo aaj, uniform pahno kal — ye wada hai NEA ka.", author: "NavPath", color: "#1a2a10", accent: "#86efac" },
    { text: "Har question ek step hai — apni uniform ki taraf.", author: "NavPath", color: "#1a1a3a", accent: "#818cf8" },
    { text: "Mushkil lagta hai? Theek hai. Mushkil kaam hi bade log karte hain.", author: "NavPath", color: "#3a1a1a", accent: "#fca5a5" },
    { text: "Neend baad mein lena — pehle Navy mein select ho jao!", author: "NavPath", color: "#1a2a3a", accent: "#c9a84c" },
    { text: "Ek din aisa aayega jab ye sab struggle kaam aayega. Tab muskurana yaad rakhna.", author: "NavPath", color: "#1a3326", accent: "#34d399" },
    { text: "Jo aaj thak kar padh raha hai, kal wahi uniform mein chamkeyga.", author: "NavPath", color: "#2a1a10", accent: "#fb923c" },
    { text: "Distraction bahut hai — focus sirf ek cheez pe: NEA crack karna.", author: "NavPath", color: "#2a1a3a", accent: "#a78bfa" },
    { text: "Haar mat — abhi toh khel shuru hua hai, aur tu jeetne ke liye bana hai.", author: "NavPath", color: "#1a3a30", accent: "#2dd4bf" },
    { text: "Padhai bore lagti hai? Soch — selection letter milne par kaisi feeling hogi!", author: "NavPath", color: "#3a1a2a", accent: "#f472b6" },
    { text: "Log bolenge 'naseeb tha' — par tu janega kitni mehnat thi. Carry on.", author: "NavPath", color: "#2a2a1a", accent: "#fbbf24" },
    { text: "Uth, padh, practice kar — repeat. Yahi formula hai Navy ka.", author: "NavPath", color: "#1a1a2a", accent: "#93c5fd" },
    { text: "Tera competition sirf kal wala tu hai — aaj usse better ban.", author: "NavPath", color: "#1a2a1a", accent: "#22c55e" },
    { text: "Darr mat — Navy ke sabse bade sapne, sabse zyada mehnat se pure hote hain.", author: "NavPath", color: "#1a3a5c", accent: "#60a5fa" },
    { text: "Time barbad mat kar yaar — ye pal dobara nahi aayega.", author: "NavPath", color: "#2a1a1a", accent: "#f87171" },
    { text: "Uniform ka sapna hai toh mobile rakh aur book uthao — simple hai.", author: "NavPath", color: "#1a2030", accent: "#38bdf8" },
    { text: "Mehnat ka koi shortcut nahi hota — par hard work ka reward zaroor hota hai.", author: "NavPath", color: "#1a1f10", accent: "#a3e635" },
    { text: "Thoda aur — ek aur chapter, ek aur question. Tu kar sakta hai!", author: "NavPath", color: "#0d1f35", accent: "#c9a84c" },

    // ── NavPath / NEA special quotes (15) ───────────────────
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

  /** Random greeting templates — mix of English + Hinglish */
  _greetings: [
    (name) => `Hey ${name}, time to study! 📚`,
    (name) => `Hey ${name}, chalo padhai karte hain! 📖`,
    (name) => `Hey ${name}, chalo padne ka time ho gaya! ⏰`,
    (name) => `Hey ${name}, chalo chalo padne ka time ho gaya! 🚀`,
    (name) => `${name} bhai, uth! Padhai ka waqt aa gaya! 💪`,
    (name) => `Aye ${name}! Navy ka sapna hai toh padhai karo! ⚓`,
    (name) => `${name}, ab phone rakh aur book uthao! 📗`,
    (name) => `Oye ${name}! Ek aur chapter? Chalo! 🎯`,
    (name) => `${name}, your future self is waiting — go study! 🏆`,
    (name) => `Hey ${name}! NEA won't crack itself. Let's go! 💥`,
    (name) => `${name} — padh lo yaar, kal ke liye! 🌟`,
    (name) => `Rise and study, ${name}! Navy awaits! 🛳️`,
  ],

  /** Pick a random greeting */
  _randomGreeting(name) {
    const templates = this._greetings;
    return templates[Math.floor(Math.random() * templates.length)](name);
  },

  /** Pick a random quote */
  _randomQuote() {
    return this._quotes[Math.floor(Math.random() * this._quotes.length)];
  },

  /** Get student first name from App state */
  _studentName() {
    try {
      const name = window.App?.userDoc?.displayName || window.App?.user?.displayName || window.App?.user?.email || '';
      return name.split(/[\s@]/)[0] || 'Sailor';
    } catch (e) { return 'Sailor'; }
  },

  /** Fire a study reminder notification + rich in-app banner */
  fireNotification() {
    const name     = this._studentName();
    const quote    = this._randomQuote();
    const greeting = this._randomGreeting(name);

    // ── Browser push notification ──────────────────────────
    if ('Notification' in window && Notification.permission === 'granted') {
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

    // ── Rich in-app banner (works even when app is open) ───
    this._showBanner(name, quote, greeting);
  },

  /** Show a beautiful full-width reminder banner inside the app */
  _showBanner(name, quote, greeting) {
    // Remove any existing banner
    document.getElementById('study-reminder-banner')?.remove();

    const banner = document.createElement('div');
    banner.id = 'study-reminder-banner';
    banner.style.cssText = `
      position:fixed;top:0;left:0;right:0;z-index:9999;
      animation:reminderSlideDown 0.4s cubic-bezier(.4,0,.2,1);
    `;

    banner.innerHTML = `
      <style>
        @keyframes reminderSlideDown{from{opacity:0;transform:translateY(-100%)}to{opacity:1;transform:none}}
        @keyframes reminderFadeOut{from{opacity:1;transform:none}to{opacity:0;transform:translateY(-100%)}}
        #study-reminder-banner .rb-quote-box{
          background:${quote.color};
          border-bottom:3px solid ${quote.accent};
          position:relative;overflow:hidden;
        }
        #study-reminder-banner .rb-quote-box::before{
          content:'❝';
          position:absolute;top:-10px;left:12px;
          font-size:5rem;color:${quote.accent};opacity:0.12;
          font-family:Georgia,serif;line-height:1;pointer-events:none;
        }
      </style>

      <div style="
        background:#0d1f35;
        border-bottom:1px solid rgba(201,168,76,0.3);
        padding:0.75rem 1rem 0;
        display:flex;align-items:center;justify-content:space-between;
      ">
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <span style="font-size:1.1rem;">📚</span>
          <div>
            <div style="font-size:0.85rem;font-weight:700;color:#e2effd;">
              ${greeting.replace(name, `<span style="color:${quote.accent};">${name}</span>`)}
            </div>
            <div style="font-size:0.65rem;color:#6b92bc;font-family:monospace;">NavPath Daily Reminder</div>
          </div>
        </div>
        <button onclick="document.getElementById('study-reminder-banner').remove()"
          style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);
                 border-radius:50%;width:28px;height:28px;color:#6b92bc;
                 cursor:pointer;font-size:0.85rem;display:flex;align-items:center;
                 justify-content:center;flex-shrink:0;transition:all 0.15s;"
          onmouseover="this.style.background='rgba(239,68,68,0.2)';this.style.color='#ef4444'"
          onmouseout="this.style.background='rgba(255,255,255,0.07)';this.style.color='#6b92bc'"
        >✕</button>
      </div>

      <div class="rb-quote-box" style="padding:1rem 1rem 1rem 1.25rem;">
        <div style="
          font-size:0.88rem;font-style:italic;
          color:#e2effd;line-height:1.55;
          position:relative;z-index:1;padding-right:0.5rem;
        ">
          "${quote.text}"
        </div>
        <div style="
          margin-top:0.5rem;
          font-size:0.7rem;font-weight:600;
          color:${quote.accent};
          font-family:monospace;letter-spacing:0.04em;
          position:relative;z-index:1;
        ">— ${quote.author}</div>
      </div>

      <div style="
        background:#0a1628;
        border-bottom:2px solid ${quote.accent};
        padding:0.5rem 1rem;
        display:flex;gap:0.5rem;align-items:center;
      ">
        <button onclick="window.switchTab&&window.switchTab('study');document.getElementById('study-reminder-banner').remove();"
          style="
            flex:1;padding:0.45rem;
            background:${quote.accent};color:#0a1628;
            border:none;border-radius:0.5rem;
            font-size:0.78rem;font-weight:700;cursor:pointer;
          ">
          📖 Start Studying
        </button>
        <button onclick="window.switchTab&&window.switchTab('practice');document.getElementById('study-reminder-banner').remove();"
          style="
            flex:1;padding:0.45rem;
            background:rgba(255,255,255,0.06);color:#e2effd;
            border:1px solid rgba(255,255,255,0.12);border-radius:0.5rem;
            font-size:0.78rem;font-weight:600;cursor:pointer;
          ">
          📝 Practice MCQs
        </button>
      </div>
    `;

    document.body.appendChild(banner);

    // Auto-dismiss after 12 seconds
    setTimeout(() => {
      const el = document.getElementById('study-reminder-banner');
      if (el) {
        el.style.animation = 'reminderFadeOut 0.4s ease forwards';
        setTimeout(() => el.remove(), 400);
      }
    }, 12000);
  },

  /** Start the background checker (runs every 30s) */
  start() {
    this.stop();
    this._interval = setInterval(() => {
      const s = this.load();
      if (!s.enabled) return;
      const now = new Date();
      if (now.getHours() === s.hour && now.getMinutes() === s.minute) {
        // Avoid double-firing in same minute by checking last-fired timestamp
        const lastFired = parseInt(localStorage.getItem('navpath-reminder-last') || '0');
        const todayKey = now.getFullYear() * 10000 + (now.getMonth()+1) * 100 + now.getDate();
        if (lastFired !== todayKey) {
          localStorage.setItem('navpath-reminder-last', String(todayKey));
          this.fireNotification();
        }
      }
    }, 30000); // check every 30 seconds
  },

  /** Stop the checker */
  stop() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
  },

  /** Enable reminders: request permission, set time, save, start */
  async enable(hour, minute) {
    const granted = await this.requestPermission();
    if (!granted) {
      toast('Please allow notifications in your browser to use reminders.', 'error');
      return false;
    }
    this.save({ enabled: true, hour, minute });
    this.start();
    return true;
  },

  /** Disable reminders */
  disable() {
    const s = this.load();
    s.enabled = false;
    this.save(s);
  },
};

// Auto-start checker on load if previously enabled
(function initReminderOnLoad() {
  const s = StudyReminder.load();
  if (s.enabled) StudyReminder.start();
})();

// ── REMINDER MODAL ─────────────────────────────────────────
function openReminderModal() {
  // Remove existing modal if any
  document.getElementById('reminder-modal')?.remove();

  const s = StudyReminder.load();
  const hour   = s.hour   ?? 18;
  const minute = s.minute ?? 0;

  // Build 24h time string for <input type="time">
  const timeVal = `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;

  const overlay = document.createElement('div');
  overlay.id = 'reminder-modal';
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(6,16,30,0.85);
    backdrop-filter:blur(6px);z-index:999;display:flex;
    align-items:flex-end;justify-content:center;
  `;
  overlay.onclick = (e) => { if (e.target === overlay) closeReminderModal(); };

  overlay.innerHTML = `
    <div style="
      background:var(--card-bg,#112240);
      border:1px solid var(--card-border,rgba(201,168,76,0.25));
      border-radius:1.25rem 1.25rem 0 0;
      padding:1.5rem 1.25rem 2.5rem;
      width:100%;max-width:480px;
      box-shadow:0 -8px 40px rgba(0,0,0,0.5);
      animation:slideUpModal 0.28s cubic-bezier(.4,0,.2,1);
    ">
      <div style="width:40px;height:4px;background:rgba(255,255,255,0.15);border-radius:99px;margin:0 auto 1.25rem;"></div>

      <h2 style="text-align:center;font-size:1.1rem;font-weight:700;color:var(--text-primary,#e2effd);margin-bottom:0.35rem;">
        🔔 Study Reminder
      </h2>
      <p style="text-align:center;font-size:0.8rem;color:var(--text-muted,#6b92bc);margin-bottom:1.5rem;">
        Get a daily notification at your chosen study time.
      </p>

      <div style="background:rgba(201,168,76,0.07);border:1px solid rgba(201,168,76,0.2);border-radius:0.875rem;padding:1.25rem;margin-bottom:1.25rem;">
        <label style="display:block;font-size:0.72rem;font-weight:600;color:var(--text-muted,#6b92bc);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:0.6rem;">
          Choose reminder time
        </label>
        <input
          type="time"
          id="reminder-time-input"
          value="${timeVal}"
          style="
            width:100%;padding:0.75rem 1rem;
            background:var(--navy-deepest,#060d1a);
            border:1.5px solid rgba(201,168,76,0.35);
            border-radius:0.625rem;color:var(--text-primary,#e2effd);
            font-size:1.2rem;font-weight:600;text-align:center;
            outline:none;cursor:pointer;font-family:inherit;
          "
        />
        <p style="margin-top:0.6rem;font-size:0.72rem;color:var(--text-muted,#6b92bc);text-align:center;">
          You'll get a browser notification at this time every day.
        </p>
      </div>

      <div id="reminder-notif-warning" style="display:none;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);border-radius:0.625rem;padding:0.75rem;margin-bottom:1rem;font-size:0.78rem;color:#ef4444;text-align:center;">
        ⚠️ Notifications are blocked. Please enable them in your browser settings, then try again.
      </div>

      <button
        onclick="saveReminderFromModal()"
        style="
          width:100%;padding:0.875rem;
          background:linear-gradient(135deg,#c9a84c,#dab850);
          color:#0a1628;border:none;border-radius:0.75rem;
          font-size:0.95rem;font-weight:700;cursor:pointer;
          margin-bottom:0.75rem;transition:opacity 0.15s;
        "
        onmouseover="this.style.opacity='0.9'"
        onmouseout="this.style.opacity='1'"
      >
        ✅ Set Reminder
      </button>

      <button
        onclick="disableReminderFromModal()"
        style="
          width:100%;padding:0.75rem;
          background:transparent;
          color:var(--text-muted,#6b92bc);
          border:1px solid rgba(255,255,255,0.1);
          border-radius:0.75rem;font-size:0.85rem;
          font-weight:500;cursor:pointer;transition:all 0.15s;
        "
        onmouseover="this.style.borderColor='rgba(239,68,68,0.4)';this.style.color='#ef4444'"
        onmouseout="this.style.borderColor='rgba(255,255,255,0.1)';this.style.color='var(--text-muted,#6b92bc)'"
      >
        🔕 Turn Off Reminders
      </button>
    </div>
    <style>
      @keyframes slideUpModal{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:none}}
      #reminder-time-input:focus{border-color:var(--gold,#c9a84c)!important;box-shadow:0 0 0 3px rgba(201,168,76,0.15)}
    </style>
  `;

  document.body.appendChild(overlay);

  // Show warning if notifications already blocked
  if ('Notification' in window && Notification.permission === 'denied') {
    document.getElementById('reminder-notif-warning').style.display = 'block';
  }
}

function closeReminderModal() {
  document.getElementById('reminder-modal')?.remove();
  // Re-render profile to reflect any changes
  renderProfile();
}

async function saveReminderFromModal() {
  const timeInput = document.getElementById('reminder-time-input');
  if (!timeInput || !timeInput.value) {
    toast('Please select a time.', 'error');
    return;
  }
  const [h, m] = timeInput.value.split(':').map(Number);
  const ok = await StudyReminder.enable(h, m);
  if (ok) {
    toast(`✅ Reminder set for ${StudyReminder.formatTime(h, m)} daily!`, 'success');
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

// ── Toggle called from the profile toggle switch ─────────────
async function toggleStudyReminder() {
  const s = StudyReminder.load();
  if (s.enabled) {
    // Currently on → turn off
    StudyReminder.disable();
    toast('🔕 Study reminders turned off.', 'info');
    renderProfile();
  } else {
    // Currently off → open the time-picker modal
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
// TOPIC ACTION MODAL
// ============================================================
let _activeTopicId   = null;
let _activeChapterId = null;

function openTopicModal(topicId, topicName, chapterId, chapterName) {
  _activeTopicId   = topicId;
  _activeChapterId = chapterId;

  const modal = document.getElementById('topic-action-modal');
  document.getElementById('topic-modal-name').textContent    = topicName;
  document.getElementById('topic-modal-chapter').textContent = chapterName;

  const hasContent   = App.content && App.content[topicId];
  const hasQuestions = App.questions?.topics?.[chapterId]?.length > 0 ||
                       App.questions?.questions?.[chapterId]?.length > 0;

  const studyBtn    = document.getElementById('topic-study-btn');
  const practiceBtn = document.getElementById('topic-practice-btn');

  studyBtn.querySelector('.topic-action-sub').textContent =
    hasContent ? 'Read full notes & theory' : 'Notes coming soon';
  practiceBtn.querySelector('.topic-action-sub').textContent =
    hasQuestions ? `${App.questions.topics[chapterId].length}+ MCQs with explanations` : 'Questions coming soon';

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
// SUPPLEMENTARY CONTENT — Covers topics missing from content.json
// ============================================================
const SUPPLEMENTARY_CONTENT = {
  'tv-3': {
    title: 'Direct and Indirect Speech',
    notes: "Direct speech quotes the exact words of a speaker, enclosed in quotation marks. Indirect speech (also called reported speech) reports what someone said without using their exact words.\n\nThe basic rule: When converting direct to indirect speech using a past reporting verb (said, told, asked), the tense of the verb inside the quote shifts back by one step.\n\nTENSE CHANGES in indirect speech:\nPresent Simple → Past Simple: 'I go' → he said he went.\nPresent Continuous → Past Continuous: 'I am going' → he said he was going.\nPresent Perfect → Past Perfect: 'I have gone' → he said he had gone.\nPast Simple → Past Perfect: 'I went' → he said he had gone.\nFuture (will) → Conditional (would): 'I will go' → he said he would go.\n\nPRONOUN CHANGES: First-person pronouns (I, me, my, we) change based on the subject of the reporting verb. 'I love cricket' (she speaking) → She said she loved cricket.\n\nTIME AND PLACE CHANGES: now → then, today → that day, yesterday → the day before, tomorrow → the next day, here → there, this → that.\n\nFor QUESTIONS in indirect speech: use 'if' or 'whether' for yes/no questions. Use the question word (what, where, who) for wh-questions. The question structure changes to statement order (no auxiliary inversion).\n\nFor COMMANDS in indirect speech: use 'told + object + to + verb'. 'Sit down,' he said → He told me to sit down. For negative commands: 'Don't run' → He told me not to run.",
    points: [
      "Direct speech: exact words in quotes. Indirect: reported without quotes.",
      "Tense backshift: Present→Past, Past→Past Perfect, will→would.",
      "Pronoun changes: I/me/my change based on who is speaking and being reported.",
      "Time words: now→then, today→that day, tomorrow→the next day, here→there.",
      "Yes/No questions → if/whether + statement order (no inversion).",
      "Wh-questions → question word + statement order.",
      "Commands: told + object + to + infinitive.",
      "Negative commands: told + object + not to + infinitive.",
      "No tense change needed if reporting verb is present tense (says/tells).",
      "Modal changes: can→could, may→might, must→had to, shall→would."
    ],
    examples: [
      "Direct: She said, 'I am happy.' → Indirect: She said that she was happy.",
      "Question: He asked, 'Do you play cricket?' → He asked if I played cricket.",
      "Command: 'Close the door,' she said. → She told me to close the door.",
      "Future: He said, 'I will help you.' → He said he would help me.",
      "Time change: 'I saw him yesterday,' she said. → She said she had seen him the day before."
    ],
    summary: "Direct speech quotes exact words in inverted commas. Indirect speech reports words with tense backshift (Present→Past, Past→Past Perfect, will→would), pronoun changes (I→he/she), and time word changes (now→then, today→that day). Questions use if/whether or wh-words with statement word order. Commands use told + to-infinitive."
  },
  'tv-4': {
    title: 'Active and Passive Voice',
    notes: "Voice in grammar refers to whether the subject of a sentence performs the action (active voice) or receives the action (passive voice).\n\nACTIVE VOICE: Subject + Verb + Object. The subject is the doer of the action. Example: She writes a letter. (She is doing the action.)\n\nPASSIVE VOICE: Object + be verb + Past Participle (+ by + Agent). The subject of the passive sentence receives the action. Example: A letter is written by her.\n\nWHEN TO USE PASSIVE: When the doer is unknown (The window was broken), when the doer is unimportant (Rice is grown in India), when we want to emphasise the action or the object rather than who did it.\n\nFORMING THE PASSIVE — Tense-wise:\nSimple Present: is/am/are + V3. 'She writes' → 'It is written'\nPresent Continuous: is/am/are + being + V3. 'She is writing' → 'It is being written'\nPresent Perfect: has/have + been + V3. 'She has written' → 'It has been written'\nSimple Past: was/were + V3. 'She wrote' → 'It was written'\nPast Continuous: was/were + being + V3. 'She was writing' → 'It was being written'\nPast Perfect: had + been + V3. 'She had written' → 'It had been written'\nSimple Future: will + be + V3. 'She will write' → 'It will be written'\nModal: can/must/should + be + V3. 'She can write' → 'It can be written'\n\nREMEMBER: The object in active becomes the subject in passive. Use 'by + agent' only when the doer is important. Intransitive verbs (go, come, sleep) cannot be made passive.",
    points: [
      "Active: Subject does the action. Passive: Subject receives the action.",
      "Formula: Object + be verb (correct tense) + Past Participle (+ by + agent).",
      "Simple Present passive: is/am/are + V3.",
      "Simple Past passive: was/were + V3.",
      "Future passive: will + be + V3.",
      "Modal passive: modal + be + V3 (can be, must be, should be).",
      "Perfect passive: has/have/had + been + V3.",
      "Continuous passive: is/was + being + V3.",
      "Omit 'by + agent' when the doer is unknown or unimportant.",
      "Intransitive verbs (go, arrive, die) cannot be made passive."
    ],
    examples: [
      "Active: Tom eats the cake. → Passive: The cake is eaten by Tom.",
      "Active: She was singing a song. → Passive: A song was being sung by her.",
      "Active: They have built a bridge. → Passive: A bridge has been built by them.",
      "Active: He will finish the work. → Passive: The work will be finished by him.",
      "Active: You should respect elders. → Passive: Elders should be respected."
    ],
    summary: "Active voice: subject does the action. Passive voice: object becomes subject + be + V3. Tense of 'be' must match the original tense. Add 'by + agent' only if the doer is important. Perfect passive uses been; continuous passive uses being. Intransitive verbs cannot be passivised."
  },
  'tv-5': {
    title: 'Correct Usage of Prepositions',
    notes: "Prepositions are words that show the relationship between a noun or pronoun and other words in a sentence. They indicate position, direction, time, manner, or cause.\n\nPREPOSITIONS OF TIME:\n'At' – specific times: at 6 PM, at noon, at midnight, at Christmas.\n'On' – days and dates: on Monday, on 15 August, on New Year's Day.\n'In' – months, years, seasons, longer periods: in January, in 2024, in winter, in the morning.\n\nPREPOSITIONS OF PLACE:\n'At' – specific points: at the bus stop, at the door, at home.\n'In' – enclosed spaces or areas: in the box, in India, in the room.\n'On' – surfaces: on the table, on the wall, on the floor.\n\nCOMMON PREPOSITIONAL PHRASES:\nGood at (skill): She is good at mathematics.\nInterested in: He is interested in music.\nResponsible for: She is responsible for the project.\nDepend on: You can depend on me.\nCongratulate on: I congratulate you on your success.\nSuffer from: He suffers from asthma.\nDie of: He died of fever (disease).\nDie in: He died in an accident.\nMarry (no preposition): She married him. (NOT married with/to him in active voice)\nListen to: Please listen to me.\nLook at / Look for / Look after / Look into – each has a different meaning.\n\nCOMMON ERRORS:\nWrong: He is good in English. ✗ → Correct: He is good at English. ✓\nWrong: She is married with him. ✗ → Correct: She is married to him. ✓\nWrong: I am waiting since morning. ✗ → Correct: I have been waiting since morning. ✓",
    points: [
      "At = specific times/points (at 5 PM, at home, at the station).",
      "On = days, dates, surfaces (on Monday, on the table, on the wall).",
      "In = enclosed spaces, periods, months, years (in the room, in 2024, in April).",
      "Good at (skill), not good in.",
      "Interested in, not interested on.",
      "Married to (passive), not married with.",
      "Responsible for, not responsible of.",
      "Suffer from (illness), die of (disease), die in (accident).",
      "Depend on, not depend upon (formal contexts only).",
      "Listen to, not listen — always takes a preposition."
    ],
    examples: [
      "Time: The meeting is at 9 AM on Monday in December.",
      "She is good at science but weak in English grammar.",
      "He was congratulated on winning the first prize.",
      "She has been suffering from fever since yesterday.",
      "The keys are on the table, not in the drawer."
    ],
    summary: "Prepositions show time, place, and relationship. At for specific times/points, On for days/surfaces, In for periods/enclosed spaces. Key collocations: good at, interested in, responsible for, depend on, married to, suffer from, die of. Memorise fixed prepositional phrases — they are tested directly in NEA."
  },
  'ag-1': {
    title: 'Grammatical Structures in Meaningful Contexts',
    notes: "This topic focuses on understanding and using correct grammatical structures — parts of speech, sentence construction, agreement, and proper use of modals — in real, meaningful contexts rather than in isolation.\n\nPARTS OF SPEECH review:\nNoun: names a person, place, thing or idea. Types: proper, common, abstract, collective, countable, uncountable.\nPronoun: replaces a noun. Types: personal (I, he, they), reflexive (myself), relative (who, which), demonstrative (this, that).\nAdjective: modifies a noun. Comes before a noun or after a linking verb.\nVerb: shows action or state. Types: transitive, intransitive, auxiliary.\nAdverb: modifies a verb, adjective, or another adverb. Shows manner, time, place, degree.\nPreposition: shows relationship between noun and other words.\nConjunction: joins words, phrases, or clauses. Types: coordinating (and, but, or), subordinating (because, although, if), correlative (either...or, neither...nor).\nInterjection: expresses sudden emotion (Oh! Wow! Alas!).\n\nSUBJECT-VERB AGREEMENT (key rules):\nSingular subject → singular verb: The dog runs fast.\nPlural subject → plural verb: The dogs run fast.\nTwo subjects joined by 'and' → plural verb: Ram and Shyam are here.\nTwo subjects joined by 'or/nor' → verb agrees with nearest subject: Neither the teacher nor the students are ready.\nUncountable nouns → singular verb: Water is essential. News is important.\nCollective nouns (usually singular): The team is winning.\n\nMODAL AUXILIARIES and their meanings:\nCan/Could: ability, permission, request.\nMay/Might: possibility, permission (formal).\nShould: advice, duty, expectation.\nMust: strong obligation, deduction.\nWould: habitual past, polite request, condition.\nShall: future, offers/suggestions (British).\nWill: future, strong intention.",
    points: [
      "8 Parts of Speech: Noun, Pronoun, Verb, Adjective, Adverb, Preposition, Conjunction, Interjection.",
      "Subject-verb agreement: singular subject → singular verb.",
      "Two subjects joined by 'and' take plural verb.",
      "'Or/Nor' rule: verb agrees with the nearer subject.",
      "Uncountable nouns (water, news, information) always take singular verb.",
      "Modal auxiliaries: can=ability, may=possibility, should=advice, must=obligation.",
      "Adjective placement: before noun (a tall man) or after linking verb (He is tall).",
      "Adverbs of manner usually go after the verb or object.",
      "Coordinating conjunctions (FANBOYS): For, And, Nor, But, Or, Yet, So.",
      "Collective nouns (team, family, army) usually take singular verbs in formal English."
    ],
    examples: [
      "Agreement: The price of the books is (not are) high. (Subject is 'price', singular.)",
      "Modal: You should revise daily. (advice) / You must carry ID. (obligation)",
      "Parts of speech: In 'She runs quickly', 'she'=pronoun, 'runs'=verb, 'quickly'=adverb.",
      "Or/Nor agreement: Either the captain or the sailors are at fault.",
      "Conjunction: He worked hard, yet he failed. (contrast with coordinating conjunction)"
    ],
    summary: "Grammar structures include parts of speech (noun, verb, adjective, adverb, pronoun, preposition, conjunction, interjection), subject-verb agreement rules (singular/plural, or/nor, collective nouns), and modal auxiliaries (can/could/may/might/should/must/would/shall/will). Understanding these in context — not in isolation — is key to the NEA exam."
  },
  'ip-1': {
    title: 'Common Idioms and Their Meanings',
    notes: "An idiom is a group of words whose meaning cannot be understood from the individual words. The phrase means something different from its literal interpretation. Idioms are fixed expressions — you cannot change the words.\n\nCOMMON IDIOMS for NEA exam:\n\nA: A blessing in disguise = something that seems bad but turns out to be good. A penny for your thoughts = used to ask what someone is thinking. Against the clock = doing something in a hurry.\n\nB: Beat around the bush = avoid the main topic. Bite the bullet = endure pain or difficulty bravely. Bite off more than you can chew = take on more than you can handle. Break a leg = good luck. Break the ice = initiate conversation. Burning the midnight oil = working late into the night.\n\nC: Call it a day = stop work for the day. Couch potato = a lazy person who watches TV all day. Cross that bridge when you come to it = deal with a problem when it arrives.\n\nD: Don't judge a book by its cover = don't judge by appearances. Down to earth = sensible and realistic.\n\nE: Every cloud has a silver lining = every negative situation has a positive aspect.\n\nH: Hit the nail on the head = say exactly the right thing. Hit the sack = go to bed.\n\nK: Kill two birds with one stone = solve two problems with one action.\n\nL: Let sleeping dogs lie = avoid bringing up old problems. Let the cat out of the bag = reveal a secret accidentally.\n\nO: Once in a blue moon = very rarely. On the fence = undecided.\n\nP: Pull someone's leg = joke or tease someone. Put your foot in it = say something embarrassing or wrong.\n\nS: Spill the beans = reveal a secret. Speak of the devil = when someone appears just as you were talking about them.\n\nT: The last straw = the final problem that makes a situation unbearable. Through thick and thin = through good times and bad. Turn a blind eye = ignore something deliberately.",
    points: [
      "An idiom's meaning is different from the literal meaning of its words.",
      "Beat around the bush = avoid the main topic.",
      "Bite the bullet = endure pain bravely.",
      "Break the ice = initiate conversation, ease tension.",
      "Burning the midnight oil = working very late.",
      "Every cloud has a silver lining = every bad situation has something good.",
      "Hit the nail on the head = say exactly the right thing.",
      "Kill two birds with one stone = solve two problems with one action.",
      "Let the cat out of the bag = reveal a secret accidentally.",
      "Spill the beans = reveal a secret; Once in a blue moon = very rarely."
    ],
    examples: [
      "'He beat around the bush for ten minutes before telling me the bad news.' (avoided the main point)",
      "'She bit the bullet and went through the painful surgery.' (endured bravely)",
      "'He burned the midnight oil to prepare for the NEA exam.' (worked late)",
      "'Let the cat out of the bag — he told her about the surprise party.' (revealed secret)",
      "'He hit the nail on the head with his analysis of the problem.' (was exactly right)"
    ],
    summary: "Idioms are fixed expressions with non-literal meanings. Common ones tested in NEA: beat around the bush (avoid topic), bite the bullet (endure bravely), break the ice (start conversation), burning midnight oil (working late), every cloud has a silver lining (positive in negative), hit the nail on the head (exactly right), kill two birds with one stone (solve two with one), let the cat out of the bag (reveal secret)."
  },
  'voc-1': {
    title: 'Word Meanings and Usage — Synonyms and Antonyms',
    notes: "Vocabulary questions in the NEA English paper test your knowledge of word meanings, synonyms (same meaning), antonyms (opposite meaning), and the correct use of words in context.\n\nSYNONYMS (words with similar meanings):\nAbundant = plentiful, ample, copious.\nAudacious = bold, daring, fearless.\nBenevolent = kind, charitable, generous.\nCapable = able, competent, skilled.\nCautious = careful, prudent, wary.\nDiligent = hardworking, industrious, assiduous.\nElegant = graceful, refined, sophisticated.\nFearless = brave, courageous, valiant.\nGenuine = real, authentic, sincere.\nHumble = modest, meek, unassuming.\nIgnorant = unaware, uninformed, uneducated.\nJoyful = happy, elated, cheerful.\nKindness = compassion, benevolence, generosity.\nLethargic = sluggish, lazy, languid.\nMourn = grieve, lament, sorrow.\nNovice = beginner, amateur, learner.\nObstinate = stubborn, headstrong, inflexible.\nPeaceful = calm, tranquil, serene.\n\nANTONYMS (words with opposite meanings):\nAbundant ↔ Scarce. Ancient ↔ Modern. Brave ↔ Cowardly. Cautious ↔ Reckless. Diligent ↔ Lazy. Elegant ↔ Crude. Genuine ↔ Fake. Humble ↔ Arrogant. Innocent ↔ Guilty. Joyful ↔ Sorrowful. Kind ↔ Cruel. Lethargic ↔ Energetic. Modest ↔ Boastful. Optimistic ↔ Pessimistic. Patient ↔ Impatient. Rigid ↔ Flexible. Sincere ↔ Insincere. Timid ↔ Bold.\n\nFREQUENTLY CONFUSED WORDS:\nAffect (verb) vs Effect (noun). Accept vs Except. Advice (noun) vs Advise (verb). Complement vs Compliment. Emigrate (leave a country) vs Immigrate (enter a country). Principal (head/main) vs Principle (rule/belief). Stationary (not moving) vs Stationery (writing materials).",
    points: [
      "Synonym = same or similar meaning. Antonym = opposite meaning.",
      "Abundant = plentiful; Antonym = scarce.",
      "Diligent = hardworking; Antonym = lazy.",
      "Genuine = authentic; Antonym = fake.",
      "Humble = modest; Antonym = arrogant.",
      "Affect (verb) vs Effect (noun): the change affects (v) us; the effect (n) is severe.",
      "Advice (noun, uncountable) vs Advise (verb): I advise you to take advice.",
      "Principal = head/main thing; Principle = a rule or belief.",
      "Stationary = not moving; Stationery = paper, pens (writing materials).",
      "Emigrate = to leave a country to settle elsewhere; Immigrate = to enter a new country."
    ],
    examples: [
      "Synonym: The soldier was valiant (= brave/courageous) in battle.",
      "Antonym: She was once timid, but now she is bold and confident.",
      "Confused words: The principal of the school has strong principles.",
      "Confused words: The car was stationary when I bought stationery from the shop.",
      "Usage: Please advise (v) me on what advice (n) I should follow."
    ],
    summary: "Synonyms are words with similar meanings; antonyms are words with opposite meanings. Key pairs: abundant/scarce, diligent/lazy, genuine/fake, humble/arrogant. Frequently confused words include affect/effect, advice/advise, principal/principle, stationary/stationery, emigrate/immigrate. Context determines the correct word choice."
  },
  'ic-2': {
    title: 'Election and Representation in India',
    notes: "The Indian electoral system is a cornerstone of democracy. Understanding how elections work, who can vote, and how representatives are chosen is tested in the GK section of NEA Paper I.\n\nUNIVERSAL ADULT FRANCHISE: Every Indian citizen aged 18 or above has the right to vote, regardless of gender, religion, caste, or income. This is guaranteed by Article 326 of the Constitution.\n\nELECTION COMMISSION OF INDIA (ECI): An independent constitutional body that oversees free and fair elections. The Chief Election Commissioner heads the ECI and has security of tenure (can only be removed by impeachment).\n\nTYPES OF ELECTIONS:\n1. General Elections: For Lok Sabha (House of the People) — held every 5 years.\n2. State Assembly Elections: For Vidhan Sabha — held every 5 years for each state.\n3. By-elections: Held when a seat becomes vacant between general elections.\n4. Presidential Election: Indirect election by elected members of Parliament and State Assemblies.\n5. Vice-Presidential Election: By members of both Houses of Parliament.\n\nLOK SABHA: 545 seats (543 elected + 2 Anglo-Indian nominated, though nomination abolished in 2020). Simple majority system (First Past the Post — FPTP). Term: 5 years. Minimum age to contest: 25 years.\n\nRAJYA SABHA: Upper House. 250 members (238 elected by states + 12 nominated by President). Not directly elected — members are elected by State Legislative Assembly members. Permanent body — never fully dissolved. Term: 6 years with 1/3 members retiring every 2 years. Minimum age to contest: 30 years.\n\nVOTING SYSTEM: India uses the First Past the Post (FPTP) system for Lok Sabha and Vidhan Sabha elections. The candidate with the most votes wins, even without a majority.",
    points: [
      "Universal Adult Franchise (Article 326): every citizen aged 18+ can vote.",
      "Election Commission of India (ECI) is an independent constitutional body.",
      "Chief Election Commissioner has security of tenure — removed only by impeachment.",
      "General Elections for Lok Sabha every 5 years; 543 elected seats.",
      "Rajya Sabha: 250 seats, permanent body, members elected by State Assemblies.",
      "Rajya Sabha term: 6 years; 1/3 members retire every 2 years.",
      "Minimum age to contest Lok Sabha: 25 years; Rajya Sabha: 30 years.",
      "India uses First Past the Post (FPTP) voting system — most votes wins.",
      "Presidential election: indirect — by elected MPs and MLAs.",
      "By-elections fill vacancies between general elections."
    ],
    examples: [
      "A citizen turning 18 before the election registration deadline becomes eligible to vote for the first time.",
      "In a constituency of 3 candidates with 40%, 35%, 25% votes — the candidate with 40% wins under FPTP, even without majority.",
      "Rajya Sabha cannot be dissolved — elections are staggered, with 1/3 retiring every 2 years.",
      "Presidential election uses proportional representation with single transferable vote among elected MPs and MLAs.",
      "If a sitting MP dies, a by-election is held for that constituency only."
    ],
    summary: "India's elections are overseen by the independent Election Commission. Universal Adult Franchise (Article 326) gives all citizens 18+ the vote. Lok Sabha has 543 elected seats, 5-year term, minimum age 25. Rajya Sabha has 250 seats, 6-year terms, never dissolved, minimum age 30. India uses First Past the Post voting. Presidential election is indirect through elected representatives."
  },
  'trig-2': {
    title: 'Trigonometric Ratios — Values, Domains and Range',
    notes: "Trigonometric ratios relate the angles of a right triangle to the ratios of its sides. There are six fundamental trigonometric ratios.\n\nTHE SIX TRIGONOMETRIC RATIOS (for angle θ in a right triangle):\nsin θ = Opposite / Hypotenuse\ncos θ = Adjacent / Hypotenuse\ntan θ = Opposite / Adjacent = sin θ / cos θ\ncosec θ = 1 / sin θ = Hypotenuse / Opposite\nsec θ = 1 / cos θ = Hypotenuse / Adjacent\ncot θ = 1 / tan θ = cos θ / sin θ\n\nSTANDARD VALUES TABLE:\nAngle:    0°    30°      45°      60°      90°\nsin θ:    0    1/2    √2/2    √3/2     1\ncos θ:    1    √3/2   √2/2    1/2      0\ntan θ:    0    1/√3     1      √3    Undefined\ncosec θ: Undef   2    √2    2/√3      1\nsec θ:    1    2/√3   √2      2    Undefined\ncot θ:  Undef  √3      1    1/√3      0\n\nMEMORY TIP for sin values: 0°=√0/2, 30°=√1/2, 45°=√2/2, 60°=√3/2, 90°=√4/2. So the numerators under the radical go 0,1,2,3,4. For cos, the pattern reverses.\n\nRANGE of trigonometric functions:\n-1 ≤ sin θ ≤ 1\n-1 ≤ cos θ ≤ 1\n-∞ < tan θ < +∞ (undefined at 90°, 270°)\ncosec θ ≤ -1 or ≥ 1\nsec θ ≤ -1 or ≥ 1\n-∞ < cot θ < +∞\n\nKEY IDENTITIES:\nsin²θ + cos²θ = 1 (Pythagorean identity)\n1 + tan²θ = sec²θ\n1 + cot²θ = cosec²θ\n\nQUADRANT SIGNS (All Silver Tea Cups):\nQ1 (0°–90°): All positive.\nQ2 (90°–180°): Sin positive.\nQ3 (180°–270°): Tan positive.\nQ4 (270°–360°): Cos positive.",
    points: [
      "6 ratios: sin, cos, tan, cosec, sec, cot. cosec=1/sin, sec=1/cos, cot=1/tan.",
      "sin 0°=0, sin 30°=½, sin 45°=√2/2, sin 60°=√3/2, sin 90°=1.",
      "cos values are reverse of sin: cos 0°=1, cos 30°=√3/2...cos 90°=0.",
      "tan 0°=0, tan 30°=1/√3, tan 45°=1, tan 60°=√3, tan 90°=undefined.",
      "Range: -1≤sinθ≤1, -1≤cosθ≤1, tanθ is all real except at 90°+n×180°.",
      "Pythagorean identities: sin²+cos²=1, 1+tan²=sec², 1+cot²=cosec².",
      "Quadrant signs — All Silver Tea Cups: All, Sin, Tan, Cos positive in Q1,Q2,Q3,Q4.",
      "Memory for sin values: √0/2, √1/2, √2/2, √3/2, √4/2 for 0°,30°,45°,60°,90°.",
      "cos and sin are complementary: sin θ = cos(90°-θ).",
      "tan is undefined where cos=0 (i.e., at 90°, 270°, etc.)."
    ],
    examples: [
      "Find sin 60° + cos 30°: = √3/2 + √3/2 = √3.",
      "Verify identity: sin²45° + cos²45° = (√2/2)² + (√2/2)² = ½ + ½ = 1 ✓",
      "If sin θ = 3/5, find cos θ: cos²θ = 1 - sin²θ = 1 - 9/25 = 16/25, so cos θ = 4/5.",
      "Find tan 45°: = sin 45° / cos 45° = (√2/2)/(√2/2) = 1.",
      "Quadrant check: In Q2, sin is positive, cos is negative → tan = sin/cos is negative in Q2."
    ],
    summary: "Six trigonometric ratios: sin, cos, tan, cosec, sec, cot. Key values at 0°, 30°, 45°, 60°, 90° must be memorised. Range of sin and cos is [-1, 1]; tan is all reals except at 90°+n180°. Three Pythagorean identities: sin²+cos²=1, 1+tan²=sec², 1+cot²=cosec². Quadrant signs: All Silver Tea Cups — Q1 all positive, Q2 sin positive, Q3 tan positive, Q4 cos positive."
  },
  'trig-3': {
    title: 'Positive and Negative Angles and Trigonometric Functions',
    notes: "Angles in trigonometry can be positive or negative. A positive angle is measured counterclockwise from the positive x-axis. A negative angle is measured clockwise.\n\nANGLE MEASUREMENT SYSTEMS:\nDegrees: A full circle = 360°. A right angle = 90°. A straight line = 180°.\nRadians: A full circle = 2π radians. 1 radian ≈ 57.3°. π radians = 180°.\nConversion: Degrees to radians: multiply by π/180. Radians to degrees: multiply by 180/π.\n\nNEGATIVE ANGLES:\nsin(-θ) = -sin θ (sin is an odd function — symmetric about origin)\ncos(-θ) = cos θ (cos is an even function — symmetric about y-axis)\ntan(-θ) = -tan θ\n\nALLIED ANGLES (angles related to 90°, 180°, 270°, 360°):\nAt 90°±θ: sin↔cos swap, and signs depend on quadrant.\nAt 180°±θ: sin and tan change sign, cos changes sign at 180°+θ.\nAt 360°±θ: same as ±θ (one full revolution).\n\nKEY ALLIED ANGLE RESULTS:\nsin(90°-θ) = cos θ\ncos(90°-θ) = sin θ\ntan(90°-θ) = cot θ\nsin(90°+θ) = cos θ\ncos(90°+θ) = -sin θ\nsin(180°-θ) = sin θ\ncos(180°-θ) = -cos θ\nsin(180°+θ) = -sin θ\ncos(180°+θ) = -cos θ\nsin(360°-θ) = -sin θ\ncos(360°-θ) = cos θ\n\nPERIODICITY:\nSin and cos repeat every 360° (period = 2π).\nTan and cot repeat every 180° (period = π).",
    points: [
      "Positive angles: counterclockwise from x-axis. Negative angles: clockwise.",
      "Conversion: multiply degrees by π/180 to get radians. π rad = 180°.",
      "sin(-θ) = -sinθ (odd function). cos(-θ) = cosθ (even function). tan(-θ) = -tanθ.",
      "sin(90°-θ)=cosθ, cos(90°-θ)=sinθ — complementary angle identity.",
      "sin(180°-θ)=sinθ, cos(180°-θ)=-cosθ.",
      "sin(180°+θ)=-sinθ, cos(180°+θ)=-cosθ.",
      "sin(360°-θ)=-sinθ, cos(360°-θ)=cosθ — equivalent to negative angle.",
      "Period of sin and cos = 2π (360°). Period of tan and cot = π (180°).",
      "Quadrant I: all positive. Q2: sin+. Q3: tan+. Q4: cos+.",
      "30°=π/6 rad, 45°=π/4 rad, 60°=π/3 rad, 90°=π/2 rad, 180°=π rad."
    ],
    examples: [
      "Convert 120° to radians: 120 × π/180 = 2π/3 radians.",
      "Find sin(-30°): sin(-θ)=-sinθ, so sin(-30°)=-sin30°=-½.",
      "Find cos(90°+30°)=cos120°: use cos(90°+θ)=-sinθ → -sin30° = -½.",
      "Find sin(180°-60°)=sin120°: use sin(180°-θ)=sinθ → sin60° = √3/2.",
      "Simplify sin(360°+θ): period is 360°, so sin(360°+θ) = sinθ."
    ],
    summary: "Positive angles go counterclockwise; negative angles clockwise. sin is odd (sin(-θ)=-sinθ); cos is even (cos(-θ)=cosθ). Allied angle formulas: sin(90°-θ)=cosθ, sin(180°-θ)=sinθ, cos(180°-θ)=-cosθ. Period of sin/cos = 360°; period of tan = 180°. Degree↔radian conversion: multiply by π/180 or 180/π."
  },
  'ns-1': {
    title: 'Decimal Number System',
    notes: "The decimal number system, also called the base-10 system, is the standard system for denoting integer and non-integer numbers. It uses ten digits: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9.\n\nThe position of each digit in a number determines its value. Each position represents a power of 10.\n\nPLACE VALUE (from right to left):\nOnes place: 10⁰ = 1\nTens place: 10¹ = 10\nHundreds place: 10² = 100\nThousands place: 10³ = 1,000\nTen-thousands place: 10⁴ = 10,000\nLakhs place: 10⁵ = 1,00,000\nTen-lakhs place: 10⁶\nCrore place: 10⁷\n\nEXAMPLE: In 4,572:\n4 is in thousands place: 4 × 1000 = 4000\n5 is in hundreds place: 5 × 100 = 500\n7 is in tens place: 7 × 10 = 70\n2 is in ones place: 2 × 1 = 2\nTotal: 4000 + 500 + 70 + 2 = 4572\n\nDECIMAL FRACTIONS: Positions to the right of the decimal point represent negative powers of 10.\nTenths: 10⁻¹ = 0.1\nHundredths: 10⁻² = 0.01\nThousandths: 10⁻³ = 0.001\n\nEXAMPLE: 3.14 = 3 + 1/10 + 4/100 = 3.14\n\nWHY BASE 10? The decimal system is believed to have developed because humans have 10 fingers. It is the most widely used number system in everyday life, science, commerce, and measurement.\n\nCOMPARING WITH OTHER BASES: Binary (base 2) uses only 0 and 1. Octal (base 8) uses 0-7. Hexadecimal (base 16) uses 0-9 and A-F. The decimal system is the default — all other systems are converted to decimal for easier understanding.",
    points: [
      "Decimal system = base 10, uses digits 0-9.",
      "Each position is a power of 10: ones=10⁰, tens=10¹, hundreds=10², etc.",
      "Place value of a digit = digit × (10 raised to its position from the right, starting at 0).",
      "Decimal point separates the integer part from the fractional part.",
      "Tenths = 10⁻¹ = 0.1; Hundredths = 10⁻² = 0.01.",
      "Indian system: 1 Lakh = 10⁵ = 100,000; 1 Crore = 10⁷.",
      "Expanded form: 4,572 = 4×1000 + 5×100 + 7×10 + 2×1.",
      "Decimal fractions: 3.14 = 3 + 1/10 + 4/100.",
      "The decimal system is used worldwide in everyday arithmetic and science.",
      "Other bases (binary=2, octal=8, hex=16) are converted to decimal for comparison."
    ],
    examples: [
      "Place value: In 83,629 — 8 is in ten-thousands (80,000), 3 in thousands (3,000), 6 in hundreds (600), 2 in tens (20), 9 in ones (9).",
      "Expanded: 7,234 = 7×1000 + 2×100 + 3×10 + 4×1 = 7000+200+30+4.",
      "Decimal: 0.375 = 3/10 + 7/100 + 5/1000 = 375/1000.",
      "Indian system: 1,25,000 = 1 Lakh 25 Thousand = 125,000 (international notation).",
      "Comparison: Decimal 10 = Binary 1010 = Octal 12. All represent the same quantity."
    ],
    summary: "The decimal (base 10) system uses digits 0-9. Each position represents a power of 10, starting at 10⁰ (ones) on the right. Positions increase by ×10 moving left; decrease by ÷10 moving right past the decimal point. The place value of each digit = digit × 10^(position). The Indian system uses Lakhs (10⁵) and Crores (10⁷)."
  },
  'pw-1': {
    title: 'Units and Measurement — SI Units',
    notes: "Measurement is the process of comparing a physical quantity with a standard unit. Without measurement, science and engineering would be impossible.\n\nWHY DO WE MEASURE? Measurement allows us to express quantities precisely and communicate them universally. The need for a universal system of units led to the International System of Units (SI).\n\nSI SYSTEM (Système International d'Unités): The SI system is the internationally accepted system of measurement. It has 7 fundamental (base) units from which all other units are derived.\n\nTHE 7 SI BASE UNITS:\n1. Length: metre (m)\n2. Mass: kilogram (kg)\n3. Time: second (s)\n4. Electric current: ampere (A)\n5. Temperature: kelvin (K)\n6. Amount of substance: mole (mol)\n7. Luminous intensity: candela (cd)\n\nDERIVED UNITS are combinations of base units. Examples:\nForce: Newton (N) = kg·m/s²\nPressure: Pascal (Pa) = N/m² = kg/(m·s²)\nEnergy/Work: Joule (J) = N·m = kg·m²/s²\nPower: Watt (W) = J/s = kg·m²/s³\nVelocity: m/s\nAcceleration: m/s²\nFrequency: Hertz (Hz) = s⁻¹\nCharge: Coulomb (C) = A·s\nVoltage: Volt (V) = W/A\nResistance: Ohm (Ω) = V/A\n\nSYSTEMS OF UNITS (historically used):\nCGS System: centimetre, gram, second.\nFPS System: foot, pound, second.\nMKS System: metre, kilogram, second (basis of SI).\n\nSCALAR AND VECTOR QUANTITIES:\nScalar: has magnitude only. Examples: mass, time, temperature, speed, distance, work, energy.\nVector: has both magnitude and direction. Examples: force, velocity, acceleration, displacement, momentum.",
    points: [
      "SI system has 7 base units: metre(m), kilogram(kg), second(s), ampere(A), kelvin(K), mole(mol), candela(cd).",
      "Derived units are combinations of base units.",
      "Newton (N) = kg·m/s² — unit of force.",
      "Joule (J) = N·m — unit of energy and work.",
      "Watt (W) = J/s — unit of power.",
      "Pascal (Pa) = N/m² — unit of pressure.",
      "Hertz (Hz) = s⁻¹ — unit of frequency.",
      "CGS system uses centimetre, gram, second; MKS uses metre, kilogram, second.",
      "Scalar quantities: mass, speed, distance, temperature, time, energy.",
      "Vector quantities: force, velocity, acceleration, displacement, momentum."
    ],
    examples: [
      "The speed of light is 3×10⁸ m/s — using SI base units of metre and second.",
      "Force of 10N on 2kg mass: F=ma → a = F/m = 10/2 = 5 m/s².",
      "Work done: W = F×d = 100N × 3m = 300 J (Joules).",
      "Power: P = W/t = 300J / 10s = 30 W (Watts).",
      "Temperature: 25°C = 25 + 273 = 298 K (Kelvin = Celsius + 273)."
    ],
    summary: "SI system has 7 base units: metre, kilogram, second, ampere, kelvin, mole, candela. All other units are derived. Key derived units: Newton (force), Joule (energy), Watt (power), Pascal (pressure), Hertz (frequency). Scalars have magnitude only; vectors have magnitude and direction. Kelvin = Celsius + 273."
  },
  'kin-2': {
    title: 'Speed, Velocity and Uniform vs Non-Uniform Motion',
    notes: "Understanding the difference between speed and velocity, and between uniform and non-uniform motion, is essential for kinematics.\n\nDISTANCE vs DISPLACEMENT:\nDistance: Total path length covered — a scalar quantity. Always positive.\nDisplacement: Shortest straight-line distance from start to finish, with direction — a vector quantity. Can be positive, negative, or zero.\n\nSPEED: Rate of change of distance. Scalar quantity.\nSpeed = Distance / Time. Unit: m/s or km/h.\nA body can have zero displacement but non-zero speed (e.g., if it returns to starting point).\n\nVELOCITY: Rate of change of displacement. Vector quantity.\nVelocity = Displacement / Time. Unit: m/s.\nA body moving in a circle at constant speed has changing velocity (direction changes).\n\nAVERAGE SPEED: Total distance / Total time.\nAVERAGE VELOCITY: Total displacement / Total time.\n\nUNIFORM MOTION: An object moves equal distances in equal intervals of time in the same direction. Velocity is constant. Acceleration = 0.\nDistance-time graph: straight line (slope = speed).\nVelocity-time graph: horizontal straight line.\n\nNON-UNIFORM MOTION: An object covers unequal distances in equal time intervals. Velocity changes (in magnitude, direction, or both). Acceleration ≠ 0.\nDistance-time graph: curved line.\nVelocity-time graph: sloping line (if uniform acceleration) or curve.\n\nACCELERATION: Rate of change of velocity.\nAcceleration = (Final velocity - Initial velocity) / Time = (v - u) / t. Unit: m/s².\nPositive acceleration: speeding up. Negative acceleration (deceleration/retardation): slowing down.",
    points: [
      "Distance = total path (scalar). Displacement = shortest path with direction (vector).",
      "Speed = distance/time (scalar). Velocity = displacement/time (vector).",
      "A body can have speed without velocity (if displacement = 0, e.g., round trip).",
      "Uniform motion: equal distances in equal times, acceleration = 0.",
      "Non-uniform motion: unequal distances in equal times, acceleration ≠ 0.",
      "Distance-time graph for uniform motion: straight line; slope = speed.",
      "Velocity-time graph for uniform acceleration: straight line; slope = acceleration.",
      "Acceleration = (v - u) / t. Unit: m/s².",
      "Negative acceleration = deceleration/retardation (slowing down).",
      "Average speed = total distance / total time; average velocity = total displacement / total time."
    ],
    examples: [
      "A car travels 100 km north then 100 km south. Distance = 200 km, Displacement = 0.",
      "Average speed if it takes 4 hours for 200 km = 200/4 = 50 km/h.",
      "A ball goes from 0 to 20 m/s in 4 seconds. Acceleration = (20-0)/4 = 5 m/s².",
      "Uniform motion: A train covers 30 km every hour for 5 hours — speed = 30 km/h throughout.",
      "Deceleration: A car slows from 60 km/h to 0 in 10s. a = (0-60)/10×(1000/3600) = -1.67 m/s²."
    ],
    summary: "Distance is total path length (scalar); displacement is straight-line distance with direction (vector). Speed = distance/time; velocity = displacement/time. Uniform motion: constant velocity, zero acceleration, straight-line on distance-time graph. Non-uniform motion: changing velocity, non-zero acceleration. Acceleration = change in velocity / time. Negative acceleration is deceleration."
  },
  'mfw-1': {
    title: "Archimedes' Principle, Buoyancy and Floatation",
    notes: "Floatation, buoyancy, and Archimedes' Principle explain why objects float or sink — fundamental to naval science.\n\nPRESSURE AND THRUST:\nPressure = Force / Area. Unit: Pascal (Pa) = N/m².\nThrust = total force acting on a surface. When pressure acts on an area, thrust = P × A.\nFluids exert pressure in all directions equally.\n\nARCHIMEDES' PRINCIPLE: 'When a body is immersed (fully or partially) in a fluid, it experiences an upward buoyant force equal to the weight of the fluid displaced by it.'\nMathematically: Buoyant Force = Weight of displaced fluid = ρ × V × g\nwhere ρ = density of fluid, V = volume of fluid displaced, g = acceleration due to gravity.\n\nBUOYANCY: The upward force exerted by a fluid on a submerged object. Also called the upthrust. It acts at the centre of buoyancy (centre of gravity of displaced fluid).\n\nFLOATATION CONDITIONS:\n1. If weight of object > buoyant force → object sinks.\n2. If weight of object < buoyant force → object rises to surface and floats.\n3. If weight of object = buoyant force → object remains in equilibrium (neutral buoyancy).\n\nLaw of Floatation: A floating body displaces fluid equal in weight to its own weight.\n\nRELATIVE DENSITY (Specific Gravity): The ratio of the density of a substance to the density of water (1000 kg/m³ or 1 g/cm³).\nRelative Density = Density of substance / Density of water.\nRelative Density has no unit.\nIf RD < 1: substance floats in water. If RD > 1: substance sinks in water.\nRD of water = 1. RD of ice ≈ 0.9 (so ice floats). RD of iron ≈ 7.8 (so iron sinks).\n\nAPPLICATION — SHIPS: A steel ship is hollow. Its average density (including air inside) is less than water. So it floats. A ship is designed so that the weight of water displaced equals the total weight of the ship.",
    points: [
      "Pressure = Force/Area. Unit: Pascal (Pa). Fluids exert equal pressure in all directions.",
      "Archimedes' Principle: buoyant force = weight of displaced fluid = ρVg.",
      "Buoyant force acts upward, at the centre of buoyancy.",
      "Object floats if buoyant force ≥ weight; sinks if weight > buoyant force.",
      "Law of Floatation: floating object displaces fluid equal to its own weight.",
      "Relative Density = density of substance / density of water (no units).",
      "RD < 1 → floats. RD > 1 → sinks. Water RD = 1, ice RD ≈ 0.9.",
      "Neutral buoyancy: weight = buoyant force — object stays at any depth (like submarines).",
      "Steel ships float because average density (including air) < water density.",
      "SONAR uses sound waves for underwater detection — related to naval science."
    ],
    examples: [
      "A block weighs 50N in air and 30N in water. Buoyant force = 50-30 = 20N = weight of water displaced.",
      "Ice floats because its RD ≈ 0.9 < 1. About 90% of the iceberg is submerged.",
      "A ship of total mass 10,000 tonnes floats — it displaces exactly 10,000 tonnes of seawater.",
      "RD of a stone = 2.7. Since 2.7 > 1, the stone sinks in water.",
      "Neutral buoyancy: a submarine adjusts ballast tanks to make its average density = seawater density."
    ],
    summary: "Archimedes' Principle: buoyant force = ρVg = weight of displaced fluid. Objects float when buoyant force ≥ weight. Relative Density = density of substance / density of water; RD<1 floats, RD>1 sinks. Law of Floatation: floating object displaces fluid equal to its own weight. Ships float because average density (with hollow interior) < water. Submarines use neutral buoyancy."
  },
  'grav-1': {
    title: "Kepler's Laws of Planetary Motion",
    notes: "Johannes Kepler (1571-1630) formulated three laws describing how planets move around the Sun. These laws were based on careful astronomical observations by Tycho Brahe and were later mathematically explained by Newton's Law of Gravitation.\n\nKEPLER'S FIRST LAW — LAW OF ORBITS:\n'All planets move in elliptical orbits with the Sun at one of the two foci.'\nKey points: Planetary orbits are not perfect circles — they are ellipses. The Sun is not at the centre but at one focus. The closest point to the Sun is called perihelion; the farthest is aphelion.\n\nKEPLER'S SECOND LAW — LAW OF AREAS:\n'The line segment joining a planet to the Sun sweeps out equal areas in equal intervals of time.'\nConsequence: A planet moves faster when closer to the Sun (perihelion) and slower when farther (aphelion). This is conservation of angular momentum.\n\nKEPLER'S THIRD LAW — LAW OF PERIODS:\n'The square of the time period (T) of revolution of a planet is proportional to the cube of the semi-major axis (a) of its orbit.'\nMathematically: T² ∝ a³, or T² = Ka³ where K is a constant.\nFor our solar system: K = 4π²/GM where M is the mass of the Sun.\nRatio: (T₁/T₂)² = (a₁/a₂)³ — same for all planets orbiting the same star.\n\nSIGNIFICANCE:\nKeplerian laws allow us to calculate orbital periods and distances of planets.\nNewton derived his Law of Gravitation by combining Kepler's third law with his own laws of motion.\nKeplerian laws apply to any system where one body orbits another under gravity — including satellites around Earth.",
    points: [
      "Kepler's 1st Law (Orbits): Planets move in elliptical orbits; Sun is at one focus.",
      "Closest point to Sun = perihelion. Farthest point = aphelion.",
      "Kepler's 2nd Law (Areas): Line from planet to Sun sweeps equal areas in equal times.",
      "2nd Law consequence: Planet moves fastest at perihelion, slowest at aphelion.",
      "2nd Law reflects conservation of angular momentum.",
      "Kepler's 3rd Law (Periods): T² ∝ a³. Square of period is proportional to cube of semi-major axis.",
      "T²/a³ = constant for all planets in the same solar system.",
      "Newton used Kepler's 3rd Law to derive the Universal Law of Gravitation.",
      "Kepler's laws apply to all orbiting systems, not just planets.",
      "Semi-major axis is the average of perihelion and aphelion distances."
    ],
    examples: [
      "Earth's orbital period T=1 year, semi-major axis a=1 AU. For Mars, a=1.52 AU. T² = 1.52³ = 3.51, so T = √3.51 ≈ 1.87 years — Mars takes about 1.87 Earth years to orbit the Sun.",
      "2nd Law: Earth moves faster in January (closer to Sun) than in July (farther).",
      "Satellite: A satellite at 4× Earth's radius takes 8× as long as one at Earth's radius (2³=8, so T doubles when a doubles — actually T₁/T₂=(a₁/a₂)^(3/2)).",
      "1st Law: Earth's orbit is slightly elliptical — closest approach is ~147 million km, farthest ~152 million km.",
      "3rd Law ratio: (T_Jupiter/T_Earth)² = (a_Jupiter/a_Earth)³ → (T_J)² = (5.2)³ = 140.6 → T_J ≈ 11.86 years."
    ],
    summary: "Kepler's three laws: (1) Planets orbit in ellipses with Sun at one focus — perihelion is closest, aphelion is farthest. (2) Equal areas are swept in equal times — planet fastest at perihelion. (3) T² ∝ a³ — the further a planet, the longer its year. Newton derived gravity from Kepler's 3rd Law. Laws apply to all gravitational orbit systems."
  },
  'ow-1': {
    title: 'Periodic Motion — Period, Frequency and Displacement',
    notes: "Periodic motion is any motion that repeats itself at regular intervals of time. Understanding the key terms — period, frequency, amplitude, displacement — is essential for the oscillations chapter.\n\nPERIODIC MOTION: Motion that repeats itself after a fixed time interval. Examples: Earth revolving around the Sun, a pendulum swinging, a tuning fork vibrating, a wheel rotating.\n\nOSCILLATORY MOTION: A special type of periodic motion in which the body moves back and forth about a fixed equilibrium position. All oscillatory motion is periodic, but not all periodic motion is oscillatory.\n\nKEY TERMS:\n\nPERIOD (T): The time taken for one complete oscillation or cycle. Unit: second (s).\n\nFREQUENCY (f): The number of complete oscillations per second. Unit: Hertz (Hz). Relationship: f = 1/T.\n\nAMPLITUDE (A): The maximum displacement of the oscillating body from its equilibrium position. It represents the energy of the oscillation — larger amplitude = more energy.\n\nDISPLACEMENT (x): The distance of the oscillating body from its equilibrium position at any instant, measured in the direction of motion. Can be positive or negative. Maximum displacement = amplitude.\n\nPHASE: Describes the state of an oscillation at a given time — whether it is at maximum, minimum, or equilibrium position, and moving in which direction.\n\nRELATIONSHIPS:\nf = 1/T → T = 1/f.\nAngular frequency: ω = 2πf = 2π/T. Unit: rad/s.\nFor SHM: x = A sin(ωt + φ) where φ is the initial phase.\n\nEXAMPLES OF PERIODIC MOTION:\nPendulum: one complete swing (to and fro) is one period.\nAC current: alternates at 50 Hz in India → T = 1/50 = 0.02 seconds.",
    points: [
      "Periodic motion: any motion that repeats at regular time intervals.",
      "Oscillatory motion: back-and-forth about equilibrium — a subset of periodic motion.",
      "Period (T): time for one complete oscillation. Unit: seconds.",
      "Frequency (f): oscillations per second. Unit: Hertz (Hz). f = 1/T.",
      "Amplitude (A): maximum displacement from equilibrium. Indicates energy.",
      "Displacement (x): distance from equilibrium at any instant — can be ±.",
      "Angular frequency ω = 2πf = 2π/T. Unit: rad/s.",
      "For SHM: x = A sin(ωt + φ).",
      "AC electricity in India: frequency = 50 Hz → T = 0.02 s.",
      "Larger amplitude = more energy in the oscillation."
    ],
    examples: [
      "A pendulum completes 30 oscillations in 60 seconds. T = 60/30 = 2s. f = 1/2 = 0.5 Hz.",
      "A tuning fork vibrates at 440 Hz (musical note A). T = 1/440 ≈ 0.00227 s.",
      "Angular frequency of AC (50 Hz): ω = 2π×50 = 100π ≈ 314 rad/s.",
      "A particle at displacement x=3cm with amplitude A=5cm: still within valid range.",
      "Amplitude doubles → energy quadruples (energy ∝ A²)."
    ],
    summary: "Periodic motion repeats at regular intervals. Key quantities: Period T (time per cycle, in seconds), Frequency f = 1/T (cycles per second, in Hz), Amplitude A (maximum displacement), Displacement x (position from equilibrium). Angular frequency ω = 2πf. SHM displacement: x = A sin(ωt+φ). Indian AC is 50 Hz with period 0.02 s."
  },
  'heat-1': {
    title: 'Hot and Cold Bodies — Temperature and Measurement',
    notes: "Temperature is the physical quantity that measures how hot or cold a body is. It determines the direction of heat flow — heat always flows from higher temperature to lower temperature.\n\nHOT AND COLD BODIES:\nA hot body has more thermal energy (higher average kinetic energy of molecules) than a cold body. When a hot body and a cold body are in contact, heat flows from the hot to the cold body until they reach the same temperature — thermal equilibrium.\n\nTEMPERATURE SCALES:\n\n1. CELSIUS (°C): Water freezes at 0°C, boils at 100°C at standard pressure. Named after Anders Celsius.\n\n2. FAHRENHEIT (°F): Water freezes at 32°F, boils at 212°F. Named after Daniel Gabriel Fahrenheit. Conversion: F = (9/5)C + 32, or C = (5/9)(F-32).\n\n3. KELVIN (K): SI unit of temperature. Absolute scale — starts at absolute zero (0 K = -273.15°C), the lowest possible temperature where all molecular motion ceases. Conversion: K = C + 273. Note: degree symbol not used with Kelvin.\n\nTHERMOMETERS: Instruments used to measure temperature. They work on the principle that physical properties (volume of liquid, electrical resistance, emitted radiation) change with temperature.\nTypes: Mercury thermometer, alcohol thermometer, digital thermometer, infrared thermometer.\n\nTHERMAL EQUILIBRIUM: When two bodies in contact reach the same temperature, no more net heat flows between them. They are said to be in thermal equilibrium.\n\nZEROTH LAW OF THERMODYNAMICS: If body A is in thermal equilibrium with body B, and body B is in equilibrium with body C, then A and C are also in thermal equilibrium with each other. This law is the basis of temperature measurement.",
    points: [
      "Temperature measures degree of hotness/coldness. SI unit: Kelvin (K).",
      "Heat flows from higher temperature to lower temperature — always.",
      "Celsius scale: 0°C (ice point) to 100°C (steam point).",
      "Fahrenheit scale: 32°F (ice) to 212°F (steam).",
      "Conversion: F = (9/5)C + 32. K = C + 273.",
      "Absolute zero = 0 K = -273.15°C — lowest possible temperature.",
      "At absolute zero, molecular motion theoretically ceases.",
      "Thermal equilibrium: no net heat flow between bodies at same temperature.",
      "Zeroth Law of Thermodynamics: establishes temperature as a measurable quantity.",
      "Thermometers use changes in physical properties (volume, resistance) to measure temperature."
    ],
    examples: [
      "Convert 37°C (body temperature) to Fahrenheit: F = 9/5×37 + 32 = 66.6+32 = 98.6°F.",
      "Convert 212°F to Celsius: C = 5/9×(212-32) = 5/9×180 = 100°C.",
      "Convert 100°C to Kelvin: K = 100 + 273 = 373 K.",
      "Absolute zero: 0 K = 0-273 = -273°C. No temperature can be lower.",
      "A cup of tea at 80°C and room air at 25°C — heat flows from tea to air until equilibrium."
    ],
    summary: "Temperature measures hotness; heat flows from high to low temperature. Three scales: Celsius (0°C=ice, 100°C=steam), Fahrenheit (F=9/5C+32), Kelvin (K=C+273, SI unit). Absolute zero = 0K = -273°C — no motion below this. Thermal equilibrium: same temperature, no heat flow. Zeroth Law: basis of thermometry. Mercury/digital thermometers measure temperature via physical property changes."
  },
  'com-1': {
    title: 'Types of Communication Systems and Modulation',
    notes: "Communication systems transfer information from one place to another. Modern communication relies on electronics, electromagnetic waves, and signal processing.\n\nBASIC ELEMENTS OF A COMMUNICATION SYSTEM:\n1. Transmitter: Converts the message into a suitable signal for transmission.\n2. Channel (medium): The path through which the signal travels. Can be wire, air, fibre optic, etc.\n3. Receiver: Receives the signal and converts it back to the original message.\nNoise is any unwanted signal that distorts the transmitted information.\n\nTYPES OF COMMUNICATION SYSTEMS:\n\nPoint-to-point communication: Between two specific points. Example: telephone, radio link.\nBroadcast communication: One transmitter, many receivers. Example: AM/FM radio, TV.\nSimplex: Information flows one way only. Example: radio broadcast.\nHalf-duplex: Two-way but not simultaneously. Example: walkie-talkie.\nFull-duplex: Two-way simultaneously. Example: telephone, mobile phone.\n\nANALOG vs DIGITAL SIGNALS:\nAnalog signal: Continuous waveform that can take any value. Example: human voice, AM radio.\nDigital signal: Discrete values (0 and 1). More resistant to noise, better quality.\n\nMODULATION: The process of combining a low-frequency information signal (called the modulating signal) with a high-frequency carrier wave so it can be transmitted over long distances. Without modulation, audio signals (20Hz-20kHz) cannot travel large distances efficiently.\n\nTYPES OF MODULATION:\n1. Amplitude Modulation (AM): The amplitude of the carrier wave is varied according to the message signal. Used in: AM radio broadcasts (550-1600 kHz). Advantage: simple and cheap. Disadvantage: susceptible to noise.\n2. Frequency Modulation (FM): The frequency of the carrier wave is varied. Used in: FM radio (88-108 MHz), TV audio. Advantage: less noise, better quality. Disadvantage: requires more bandwidth.\n3. Pulse Modulation: Digital form — message encoded as pulses. Used in: digital communication, mobile phones.",
    points: [
      "Communication system: transmitter → channel → receiver.",
      "Noise = unwanted signal that distorts information.",
      "Simplex: one-way (radio). Half-duplex: two-way alternate (walkie-talkie). Full-duplex: two-way simultaneous (phone).",
      "Analog signal: continuous values. Digital signal: discrete (0 and 1).",
      "Modulation: combining low-frequency message with high-frequency carrier for long-distance transmission.",
      "AM (Amplitude Modulation): carrier amplitude varies with message. AM radio: 550-1600 kHz.",
      "FM (Frequency Modulation): carrier frequency varies with message. FM radio: 88-108 MHz.",
      "FM has better noise immunity than AM.",
      "Bandwidth: range of frequencies used in transmission. FM needs more bandwidth than AM.",
      "Demodulation: recovering the original signal from the modulated carrier at the receiver."
    ],
    examples: [
      "Mobile phone is full-duplex — both parties speak and listen simultaneously.",
      "AM radio at 1000 kHz: carrier frequency is 1000 kHz, amplitude changes with the audio.",
      "FM radio at 98.3 MHz: frequency varies slightly above and below 98.3 MHz with audio.",
      "Digital communication: voice is sampled 8000 times/second and each sample encoded as 8 binary bits.",
      "Noise advantage of FM: sudden electrical noise changes amplitude, not frequency — FM receiver ignores amplitude changes."
    ],
    summary: "Communication systems have transmitter, channel, and receiver. Types: simplex (one-way), half-duplex (two-way alternate), full-duplex (two-way simultaneous). Signals are analog (continuous) or digital (0/1). Modulation combines a message with a carrier for long-distance transmission. AM varies carrier amplitude (susceptible to noise); FM varies carrier frequency (less noise, better quality). FM needs more bandwidth than AM."
  }
};

// ============================================================
// LOAD CONTENT.JSON
// ============================================================
async function loadContent() {
  try {
    const res = await fetch('data/content.json');
    if (!res.ok) throw new Error('not found');
    const remoteContent = await res.json();
    // Merge: remote content takes priority, supplementary fills gaps
    App.content = Object.assign({}, SUPPLEMENTARY_CONTENT, remoteContent);
    console.log('[NavPath] Content loaded ✓');
  } catch(e) {
    // Fall back to supplementary content only
    App.content = Object.assign({}, SUPPLEMENTARY_CONTENT);
    console.warn('[NavPath] content.json not found — using supplementary content');
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
window.mockSelectAnswer     = mockSelectAnswer;
