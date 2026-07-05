/** @jsxRuntime classic */
// React is loaded as a UMD global via CDN in index.html
const {
  useState,
  useMemo,
  useEffect,
  useCallback
} = React;

// ══════════════════════════════════════════════════════════════════
// FIREBASE LAYER — Firestore + Auth via compat SDK (loaded in index.html)
// Falls back to localStorage if Firebase isn't configured.
// ══════════════════════════════════════════════════════════════════

// ── Firebase helpers (use window._fbAuth / window._fbDb from index.html) ──
const fbAuth = () => window._fbAuth || null;
const fbDb = () => window._fbDb || null;

// Firestore path helpers
const fsUserDoc = (uid, col, id) => fbDb()?.collection("users").doc(uid).collection(col).doc(id);
const fsUserCol = (uid, col) => fbDb()?.collection("users").doc(uid).collection(col);

// Write a document to Firestore (background, non-blocking)
async function fsSet(uid, col, id, data) {
  if (!fbDb() || !uid) return;
  try {
    await fsUserDoc(uid, col, id).set({
      ...data,
      _updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, {
      merge: true
    });
  } catch (e) {
    console.warn("Firestore write failed:", e.message);
  }
}

// Delete a document from Firestore
async function fsDel(uid, col, id) {
  if (!fbDb() || !uid) return;
  try {
    await fsUserDoc(uid, col, id).delete();
  } catch {}
}

// Load all docs in a collection as an array
async function fsLoadCol(uid, col) {
  if (!fbDb() || !uid) return null;
  try {
    const snap = await fsUserCol(uid, col).get();
    return snap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));
  } catch {
    return null;
  }
}

// Load a single document
async function fsLoadDoc(uid, col, id) {
  if (!fbDb() || !uid) return null;
  try {
    const snap = await fsUserDoc(uid, col, id).get();
    return snap.exists ? {
      id: snap.id,
      ...snap.data()
    } : null;
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════
// PERSISTENCE LAYER — localStorage + Firestore dual-write
// ══════════════════════════════════════════════════════════════════

const STORAGE_KEYS = {
  PROFILE: "sp_profile",
  SAVED_TEMPLATES: "sp_saved_templates",
  CUSTOM_WORKOUTS: "sp_custom_workouts",
  SESSION_LOGS: "sp_session_logs",
  WEIGHT_LOG: "sp_weight_log",
  RECOVERY_LOG: "sp_recovery_log",
  SUPPLEMENT_LOG: "sp_supplement_log",
  BODYCOMP_LOG: "sp_bodycomp_log",
  STREAK: "sp_streak"
};

// ── localStorage helpers ────────────────────────────────────────
const STORAGE_VERSION = "sp_v2"; // bump to reset all users to onboarding

// ── STORAGE LAYER ──────────────────────────────────────────────
// Uses window.storage (Claude artifact persistent API) as primary,
// with localStorage as fallback for deployed Firebase hosting.
// window.storage survives across artifact sessions — localStorage does not.

const _memStore = {}; // in-memory cache for synchronous reads

async function storagePersistAsync(key, value) {
  // Async write to window.storage (artifact API) — fire and forget
  try {
    if (window.storage) await window.storage.set(key, JSON.stringify(value));
  } catch {}
}
async function storageLoadAsync(key, fallback = null) {
  try {
    if (window.storage) {
      const result = await window.storage.get(key);
      if (result && result.value != null) return JSON.parse(result.value);
    }
  } catch {}
  return fallback;
}
function storageGet(key, fallback = null) {
  // Synchronous: check memory cache first (populated on init)
  if (key in _memStore) return _memStore[key];
  // Fall back to localStorage for deployed environment
  try {
    const storedVersion = localStorage.getItem("sp_version");
    if (storedVersion && storedVersion !== STORAGE_VERSION) {
      Object.values(STORAGE_KEYS).forEach(k => {
        localStorage.removeItem(k);
        delete _memStore[k];
      });
      localStorage.setItem("sp_version", STORAGE_VERSION);
      return fallback;
    }
    localStorage.setItem("sp_version", STORAGE_VERSION);
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      _memStore[key] = parsed;
      return parsed;
    }
  } catch {}
  return fallback;
}
function storageSet(key, value) {
  _memStore[key] = value;
  storagePersistAsync(key, value); // async write to window.storage
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
function storageClear(key) {
  delete _memStore[key];
  try {
    if (window.storage) window.storage.delete(key);
  } catch {}
  try {
    localStorage.removeItem(key);
  } catch {}
}

// ── usePersistedState: drop-in replacement for useState ─────────
// Usage: const [value, setValue] = usePersistedState(STORAGE_KEYS.X, default)
// Firebase swap: replace storageGet/storageSet with Firestore calls
function usePersistedState(storageKey, defaultValue) {
  const [state, setStateRaw] = useState(() => storageGet(storageKey, defaultValue));
  const setState = useCallback(updater => {
    setStateRaw(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      storageSet(storageKey, next);
      return next;
    });
  }, [storageKey]);
  return [state, setState];
}

// ── Firebase scaffold ────────────────────────────────────────────
// When ready to connect Firebase, replace usePersistedState calls
// with these Firestore equivalents:
//
//
// async function fbGet(userId, collection, key) {
//   const snap = await getDoc(doc(db, "users", userId, collection, key));
//   return snap.exists() ? snap.data() : null;
// }
//
// async function fbSet(userId, collection, key, data) {
//   await setDoc(doc(db, "users", userId, collection, key), data, { merge: true });
// }
//
// Firebase data structure:
// users/{userId}/
//   profile/data          → { goal, weight, equipment, experience }
//   savedTemplates/{day}  → { name, exercises[], phase, savedAt }
//   customWorkouts/{id}   → { name, exercises[], phase, createdAt }
//   sessionLogs/{date}    → { cycleDay, sets: { exId: [{w,r,rir}] } }
//   weightLog/{date}      → { w: number }
//   recoveryLog/{date}    → { sleep, soreness, energy }
//   supplementLog/{date}  → { am: bool, pm: bool }
//   streak/data           → { count, lastDate }

// ── DEFAULT WEIGHT LOG (seeded on first load) ────────────────────
const DEFAULT_WEIGHT_LOG = []; // starts empty — user logs real data

const DEFAULT_RECOVERY_LOG = []; // starts empty — user logs real data

const DEFAULT_CUSTOM_WORKOUTS = [];
// Starts empty — users build their own custom workouts

// ── DESIGN TOKENS ────────────────────────────────────
const T = {
  // ── BACKGROUNDS ─────────────────────────────────
  bg: "#000000",
  // true black — maximum contrast
  surface: "#0A0A0A",
  // elevated surfaces
  card: "#111111",
  // cards
  cardHover: "#181818",
  // card hover state
  border: "#1C1C1C",
  // default border
  borderHi: "#2A2A2A",
  // highlighted border

  // ── SEMANTIC COLORS — each means something specific ──
  // Primary brand / nav / active states
  accent: "#F1F5F9",
  // near-white — headline, primary CTA
  accentBg: "#F1F5F914",
  accentDim: "#94A3B8",
  // Strength phase / intensity / fast-twitch / PRs
  crimson: "#EF4444",
  crimsonBg: "#EF444414",
  // Hypertrophy phase / data / slow-twitch / information
  steel: "#3B82F6",
  steelBg: "#3B82F614",
  // Today's session / progress / completed sets / positive delta
  emerald: "#22C55E",
  emeraldBg: "#22C55E14",
  // Warning / approaching MRV / moderate risk
  amber: "#F59E0B",
  amberBg: "#F59E0B14",
  // Meditation / mindfulness / custom categories
  violet: "#7C3AED",
  violetBg: "#7C3AED14",
  // Gold — reserved ONLY for PRs and milestone moments
  gold: "#C9A84C",
  goldDim: "#7A5E1E",
  goldBg: "#C9A84C12",
  goldBg2: "#C9A84C22",
  // ── NEUTRAL TEXT ────────────────────────────────
  dim: "#4B5563",
  // disabled / placeholder
  muted: "#6B7280",
  // secondary text
  text: "#D1D5DB",
  // body text
  bright: "#F9FAFB",
  // primary text / headlines
  white: "#FFFFFF" // maximum emphasis
};

// ── FIBER / REP LOGIC ────────────────────────────────
function getRepsForFiber(fiber, phase) {
  if (phase === "strength") {
    if (fiber === "fast") return {
      sets: 3,
      reps: "1–6",
      rest: "2–5 min"
    };
    if (fiber === "mixed") return {
      sets: 3,
      reps: "3–8",
      rest: "2–5 min"
    };
    if (fiber === "slow") return {
      sets: 4,
      reps: "6–10",
      rest: "1–2 min"
    };
  } else {
    if (fiber === "fast") return {
      sets: 3,
      reps: "8–12",
      rest: "1–2 min"
    };
    if (fiber === "mixed") return {
      sets: 3,
      reps: "10–15",
      rest: "1–2 min"
    };
    if (fiber === "slow") return {
      sets: 4,
      reps: "15–20",
      rest: "45–60s"
    };
  }
}

// ── MOVEMENT LIBRARY ─────────────────────────────────
const LIBRARY = [
// ── CHEST ──────────────────────────────────────────────────────────────
{
  id: "c1",
  name: "Barbell Bench Press",
  muscles: ["Chest", "Triceps", "Front Delt"],
  fiber: "fast",
  equipment: ["full", "barbell"],
  level: 2,
  pattern: "push",
  cue: "Tuck elbows 45°, bar to lower chest, drive through heels.",
  note: "Primary chest strength anchor. No grinder reps."
}, {
  id: "c2",
  name: "DB Flat Press",
  muscles: ["Chest", "Triceps", "Front Delt"],
  fiber: "fast",
  equipment: ["full", "home"],
  level: 1,
  pattern: "push",
  cue: "Neutral grip, lower to chest level, press and squeeze.",
  note: "DB version allows deeper stretch and more range."
}, {
  id: "c3",
  name: "Smith Machine Flat Press",
  muscles: ["Chest", "Triceps"],
  fiber: "fast",
  equipment: ["full"],
  level: 1,
  pattern: "push",
  cue: "Set bar to lower chest, feet flat, control the negative.",
  note: "Good for learning bar path without stability demand."
}, {
  id: "c4",
  name: "Machine Chest Press",
  muscles: ["Chest", "Triceps"],
  fiber: "mixed",
  equipment: ["full"],
  level: 1,
  pattern: "push",
  cue: "Seat height: handles at lower chest. Full ROM each rep.",
  note: "Beginner-friendly — no balance demand."
}, {
  id: "c5",
  name: "Incline Barbell Press",
  muscles: ["Upper Chest", "Front Delt", "Triceps"],
  fiber: "fast",
  equipment: ["full", "barbell"],
  level: 2,
  pattern: "push",
  cue: "30–45° incline, bar to upper chest, elbows at 60°.",
  note: "Upper chest specialist. Heavy load, low rep range."
}, {
  id: "c6",
  name: "Incline DB Press",
  muscles: ["Upper Chest", "Front Delt"],
  fiber: "fast",
  equipment: ["full", "home"],
  level: 1,
  pattern: "push",
  cue: "Same as barbell but pronate at top for upper fiber squeeze.",
  note: "More ROM than barbell incline."
}, {
  id: "c7",
  name: "Cable Chest Fly",
  muscles: ["Chest", "Upper Chest"],
  fiber: "slow",
  equipment: ["full"],
  level: 2,
  pattern: "push",
  cue: "Slight bend in elbows, lead with elbows not hands, stretch at bottom.",
  note: "Peak contraction and stretch in one movement."
}, {
  id: "c8",
  name: "Weighted Dips",
  muscles: ["Lower Chest", "Triceps", "Front Delt"],
  fiber: "fast",
  equipment: ["full", "home"],
  level: 3,
  pattern: "push",
  cue: "Lean forward for chest emphasis, elbows flared slightly.",
  note: "Advanced — strong tricep and shoulder prerequisite."
}, {
  id: "c9",
  name: "Push-Up (weighted)",
  muscles: ["Chest", "Triceps", "Front Delt"],
  fiber: "mixed",
  equipment: ["full", "home", "minimal"],
  level: 1,
  pattern: "push",
  cue: "Straight body, hands just wider than shoulder-width, full depth.",
  note: "Bodyweight base. Add plates or vest for progressive overload."
},
// ── SHOULDERS ───────────────────────────────────────────────────────────
{
  id: "s1",
  name: "Seated Barbell OHP",
  muscles: ["Front Delt", "Lateral Delt", "Triceps"],
  fiber: "fast",
  equipment: ["full", "barbell"],
  level: 2,
  pattern: "push",
  cue: "Bar rests on traps, brace core, press in a straight line.",
  note: "Primary overhead strength movement."
}, {
  id: "s2",
  name: "DB Shoulder Press",
  muscles: ["Front Delt", "Lateral Delt", "Triceps"],
  fiber: "fast",
  equipment: ["full", "home"],
  level: 1,
  pattern: "push",
  cue: "Neutral spine, press overhead and slightly in front.",
  note: "Easier on joints than barbell — great all-rounder."
}, {
  id: "s3",
  name: "Arnold Press",
  muscles: ["Front Delt", "Lateral Delt", "Rear Delt"],
  fiber: "fast",
  equipment: ["full", "home"],
  level: 2,
  pattern: "push",
  cue: "Start palms facing you, rotate to pronated at top.",
  note: "Hits all three delt heads through rotation."
}, {
  id: "s4",
  name: "Lateral Raise",
  muscles: ["Lateral Delt"],
  fiber: "slow",
  equipment: ["full", "home", "minimal"],
  level: 1,
  pattern: "push",
  cue: "Slight forward lean, lead with elbows, stop at shoulder height.",
  note: "Isolation work for the cap. High reps work best."
}, {
  id: "s5",
  name: "Cable Lateral Raise",
  muscles: ["Lateral Delt"],
  fiber: "slow",
  equipment: ["full"],
  level: 1,
  pattern: "push",
  cue: "Cable below hip, cross-body pull, constant tension throughout.",
  note: "Constant tension advantage over DBs."
}, {
  id: "s6",
  name: "Face Pull",
  muscles: ["Rear Delt", "Rotator Cuff", "Traps"],
  fiber: "slow",
  equipment: ["full"],
  level: 1,
  pattern: "pull",
  cue: "Rope to forehead, elbows high and wide, external rotate at end.",
  note: "Shoulder health essential. Do this every session."
}, {
  id: "s7",
  name: "Rear Delt Fly (DB)",
  muscles: ["Rear Delt", "Traps"],
  fiber: "slow",
  equipment: ["full", "home"],
  level: 1,
  pattern: "pull",
  cue: "Bent over or incline bench, wide arc with slight elbow bend.",
  note: "Pairs well with pressing volume for shoulder balance."
}, {
  id: "s8",
  name: "Upright Row (Cable)",
  muscles: ["Lateral Delt", "Traps"],
  fiber: "mixed",
  equipment: ["full"],
  level: 2,
  pattern: "pull",
  cue: "Elbows lead the pull, stop at chin height.",
  note: "Safer on cable than barbell. Avoid if shoulder issues."
},
// ── BACK — LATS ─────────────────────────────────────────────────────────
{
  id: "b1",
  name: "Deadlift",
  muscles: ["Lats", "Lower Back", "Glutes", "Hamstrings", "Traps"],
  fiber: "fast",
  equipment: ["full", "barbell"],
  level: 3,
  pattern: "hinge",
  cue: "Bar over mid-foot, shoulder blades over bar, push floor away.",
  note: "The king. Technique first, weight second."
}, {
  id: "b2",
  name: "Romanian Deadlift",
  muscles: ["Hamstrings", "Glutes", "Lower Back", "Lats"],
  fiber: "fast",
  equipment: ["full", "barbell", "home"],
  level: 2,
  pattern: "hinge",
  cue: "Hinge at hips, bar drags down legs, feel hamstring stretch.",
  note: "Hip-hinge pattern. Excellent hamstring lengthener."
}, {
  id: "b3",
  name: "Pull-Up (weighted)",
  muscles: ["Lats", "Biceps", "Mid Back"],
  fiber: "fast",
  equipment: ["full", "home"],
  level: 3,
  pattern: "pull",
  cue: "Dead hang start, lead with elbows, chest to bar.",
  note: "Lat width builder. Add weight once 10 reps is easy."
}, {
  id: "b4",
  name: "Lat Pulldown",
  muscles: ["Lats", "Biceps", "Rear Delt"],
  fiber: "fast",
  equipment: ["full"],
  level: 1,
  pattern: "pull",
  cue: "Lean back 10°, pull to upper chest, squeeze lats at bottom.",
  note: "Pull-up substitute or volume supplement."
}, {
  id: "b5",
  name: "Cable Row (seated)",
  muscles: ["Mid Back", "Lats", "Biceps", "Rear Delt"],
  fiber: "fast",
  equipment: ["full"],
  level: 1,
  pattern: "pull",
  cue: "Stay tall, drive elbows back, pause and squeeze at end.",
  note: "Row volume = back thickness."
}, {
  id: "b6",
  name: "Barbell Row",
  muscles: ["Mid Back", "Lats", "Biceps", "Traps"],
  fiber: "fast",
  equipment: ["full", "barbell"],
  level: 2,
  pattern: "pull",
  cue: "Hinge to 45°, bar to navel, elbows track back.",
  note: "Heavy compound row. High skill demand."
}, {
  id: "b7",
  name: "DB Row",
  muscles: ["Lats", "Mid Back", "Biceps"],
  fiber: "fast",
  equipment: ["full", "home"],
  level: 1,
  pattern: "pull",
  cue: "Supported arm, elbow drives past hip, full stretch at bottom.",
  note: "Allows very heavy loads unilaterally."
}, {
  id: "b8",
  name: "Chest-Supported Row",
  muscles: ["Mid Back", "Rear Delt", "Biceps"],
  fiber: "mixed",
  equipment: ["full", "home"],
  level: 1,
  pattern: "pull",
  cue: "Chest on pad eliminates lower back. Row to hip, not stomach.",
  note: "Beginner-friendly back thickness work."
}, {
  id: "b9",
  name: "Straight-Arm Pulldown",
  muscles: ["Lats"],
  fiber: "slow",
  equipment: ["full"],
  level: 1,
  pattern: "pull",
  cue: "Straight arms, pull from overhead to hips in an arc.",
  note: "Pure lat isolation. Great for mind-muscle connection."
}, {
  id: "b10",
  name: "Single-Arm Lat Pulldown",
  muscles: ["Lats", "Biceps"],
  fiber: "slow",
  equipment: ["full"],
  level: 1,
  pattern: "pull",
  cue: "Lean into the working side, full stretch at top.",
  note: "Unilateral — fixes left-right imbalances."
}, {
  id: "b11",
  name: "T-Bar Row",
  muscles: ["Mid Back", "Lats", "Traps"],
  fiber: "fast",
  equipment: ["full", "barbell"],
  level: 2,
  pattern: "pull",
  cue: "Chest on pad, elbows wide for upper back, narrow for lats.",
  note: "Great for mid-back mass."
}, {
  id: "b12",
  name: "Face Pull (Rope)",
  muscles: ["Rear Delt", "Traps", "Rotator Cuff"],
  fiber: "slow",
  equipment: ["full"],
  level: 1,
  pattern: "pull",
  cue: "High cable, pull to forehead, elbows flare wide.",
  note: "Shoulder health staple. Never skip."
}, {
  id: "b13",
  name: "Inverted Row",
  muscles: ["Mid Back", "Lats", "Biceps"],
  fiber: "mixed",
  equipment: ["home", "minimal"],
  level: 1,
  pattern: "pull",
  cue: "Body straight, pull chest to bar, squeeze shoulder blades.",
  note: "Bodyweight row — scales by adjusting angle."
}, {
  id: "b14",
  name: "Rack Pull",
  muscles: ["Traps", "Lower Back", "Glutes", "Lats"],
  fiber: "fast",
  equipment: ["full", "barbell"],
  level: 2,
  pattern: "hinge",
  cue: "Set bar at knee height, same hinge pattern as deadlift.",
  note: "Overload above knee. Trap and upper back emphasis."
}, {
  id: "b15",
  name: "Good Morning",
  muscles: ["Hamstrings", "Lower Back", "Glutes"],
  fiber: "fast",
  equipment: ["full", "barbell"],
  level: 3,
  pattern: "hinge",
  cue: "Bar on traps, soft knee bend, hinge until torso is parallel.",
  note: "High skill demand. Master RDL first."
},
// ── LEGS — QUADS ────────────────────────────────────────────────────────
{
  id: "l1",
  name: "Back Squat",
  muscles: ["Quads", "Glutes", "Hamstrings", "Adductors"],
  fiber: "fast",
  equipment: ["full", "barbell"],
  level: 3,
  pattern: "squat",
  cue: "Bar on traps, brace, knees out, break parallel.",
  note: "The lower body king. Technique is non-negotiable."
}, {
  id: "l2",
  name: "Front Squat",
  muscles: ["Quads", "Glutes", "Core (stability)"],
  fiber: "fast",
  equipment: ["full", "barbell"],
  level: 3,
  pattern: "squat",
  cue: "Elbows high, upright torso, knees track over toes.",
  note: "Quad-dominant squat variant. Brutal on core."
}, {
  id: "l3",
  name: "Hack Squat (machine)",
  muscles: ["Quads", "Glutes"],
  fiber: "fast",
  equipment: ["full"],
  level: 1,
  pattern: "squat",
  cue: "Feet low on plate, full ROM, let knees travel over toes.",
  note: "Machine squat — safe for learning quad emphasis."
}, {
  id: "l4",
  name: "Leg Press",
  muscles: ["Quads", "Glutes", "Hamstrings"],
  fiber: "mixed",
  equipment: ["full"],
  level: 1,
  pattern: "squat",
  cue: "Foot position controls emphasis. Don't lock knees at top.",
  note: "Volume machine for quads and glutes."
}, {
  id: "l5",
  name: "Bulgarian Split Squat",
  muscles: ["Quads", "Glutes", "Adductors"],
  fiber: "fast",
  equipment: ["full", "home"],
  level: 2,
  pattern: "squat",
  cue: "Rear foot elevated, front foot out, knee tracks over toes.",
  note: "Unilateral beast. Humbling for most."
}, {
  id: "l6",
  name: "Goblet Squat",
  muscles: ["Quads", "Glutes", "Core (stability)"],
  fiber: "mixed",
  equipment: ["full", "home", "minimal"],
  level: 1,
  pattern: "squat",
  cue: "Weight held at chest, squat deep, knees out.",
  note: "Beginner squat pattern teacher. High reps work well."
}, {
  id: "l7",
  name: "Leg Extension",
  muscles: ["Quads"],
  fiber: "slow",
  equipment: ["full"],
  level: 1,
  pattern: "squat",
  cue: "Full extension and pause at top, control the descent.",
  note: "Quad isolation. High reps for hypertrophy."
}, {
  id: "l8",
  name: "Lunge (walking)",
  muscles: ["Quads", "Glutes", "Adductors"],
  fiber: "mixed",
  equipment: ["full", "home", "minimal"],
  level: 1,
  pattern: "squat",
  cue: "Long stride, knee to inch above floor, upright torso.",
  note: "Functional and unilateral. Bodyweight or loaded."
},
// ── LEGS — HAMSTRINGS ────────────────────────────────────────────────────
{
  id: "h1",
  name: "Lying Leg Curl",
  muscles: ["Hamstrings"],
  fiber: "slow",
  equipment: ["full"],
  level: 1,
  pattern: "hinge",
  cue: "Toes plantarflexed, curl to glutes, control return.",
  note: "Hamstring isolation. Supinate toes to hit biceps femoris."
}, {
  id: "h2",
  name: "Seated Leg Curl",
  muscles: ["Hamstrings"],
  fiber: "slow",
  equipment: ["full"],
  level: 1,
  pattern: "hinge",
  cue: "Seated position adds stretch at origin — more ROM.",
  note: "Better stretch than lying curl."
}, {
  id: "h3",
  name: "Nordic Hamstring Curl",
  muscles: ["Hamstrings"],
  fiber: "fast",
  equipment: ["full", "home"],
  level: 3,
  pattern: "hinge",
  cue: "Lock ankles, lower eccentrically as slow as possible.",
  note: "Injury-prevention gold standard. Eccentric dominant."
}, {
  id: "h4",
  name: "Glute-Ham Raise",
  muscles: ["Hamstrings", "Glutes", "Lower Back"],
  fiber: "fast",
  equipment: ["full"],
  level: 3,
  pattern: "hinge",
  cue: "Lower under control, use hamstrings to pull back up.",
  note: "Advanced. Prerequisite: Nordic curl."
}, {
  id: "h5",
  name: "Stiff-Leg Deadlift",
  muscles: ["Hamstrings", "Lower Back", "Glutes"],
  fiber: "fast",
  equipment: ["full", "barbell", "home"],
  level: 2,
  pattern: "hinge",
  cue: "Minimal knee bend, lower until hamstring stretch, drive hips forward.",
  note: "Hamstring lengthener under load."
},
// ── LEGS — GLUTES ────────────────────────────────────────────────────────
{
  id: "g1",
  name: "Hip Thrust (barbell)",
  muscles: ["Glutes", "Hamstrings"],
  fiber: "fast",
  equipment: ["full", "barbell", "home"],
  level: 2,
  pattern: "hinge",
  cue: "Shoulder on bench, bar on hip flexor, drive hips up and squeeze.",
  note: "Primary glute builder. Pad the bar."
}, {
  id: "g2",
  name: "Cable Pull-Through",
  muscles: ["Glutes", "Hamstrings"],
  fiber: "slow",
  equipment: ["full"],
  level: 1,
  pattern: "hinge",
  cue: "Face away from cable, hinge back, drive hips forward.",
  note: "Teaches hip hinge pattern. Beginner-friendly."
}, {
  id: "g3",
  name: "Single-Leg Hip Thrust",
  muscles: ["Glutes", "Hamstrings"],
  fiber: "slow",
  equipment: ["full", "home"],
  level: 2,
  pattern: "hinge",
  cue: "One foot flat, drive through heel, don't let pelvis drop.",
  note: "Fixes glute imbalances. Harder than bilateral."
}, {
  id: "g4",
  name: "Sumo Deadlift",
  muscles: ["Glutes", "Adductors", "Quads", "Lats"],
  fiber: "fast",
  equipment: ["full", "barbell"],
  level: 2,
  pattern: "hinge",
  cue: "Wide stance, toes out, hips close to bar, drive knees out.",
  note: "Hip-dominant deadlift. Great for glute and adductor work."
}, {
  id: "g5",
  name: "Cable Kickback",
  muscles: ["Glutes", "Glute Med"],
  fiber: "slow",
  equipment: ["full"],
  level: 1,
  pattern: "hinge",
  cue: "Slight forward lean, drive heel back and up, squeeze at top.",
  note: "Glute isolation. Keep the hip extended."
}, {
  id: "g6",
  name: "Step-Up (weighted)",
  muscles: ["Glutes", "Quads", "Adductors"],
  fiber: "mixed",
  equipment: ["full", "home"],
  level: 1,
  pattern: "squat",
  cue: "Full foot on box, drive through heel, control descent.",
  note: "Functional and unilateral. Underrated movement."
}, {
  id: "g7",
  name: "Abductor Machine",
  muscles: ["Glute Med", "Abductors"],
  fiber: "slow",
  equipment: ["full"],
  level: 1,
  pattern: "push",
  cue: "Sit tall, press legs out, squeeze at peak.",
  note: "Glute med isolation. Pairs well with hip thrusts."
},
// ── ARMS — BICEPS ────────────────────────────────────────────────────────
{
  id: "a1",
  name: "Barbell Curl",
  muscles: ["Biceps", "Brachialis"],
  fiber: "fast",
  equipment: ["full", "barbell", "home"],
  level: 1,
  pattern: "pull",
  cue: "Elbows pinned, supinate wrist at top, lower fully.",
  note: "Strength-focused bicep work. Classic mass builder."
}, {
  id: "a2",
  name: "Incline DB Curl",
  muscles: ["Biceps (Long Head)", "Brachialis"],
  fiber: "slow",
  equipment: ["full", "home"],
  level: 1,
  pattern: "pull",
  cue: "Arms hang behind torso on incline — maximum long head stretch.",
  note: "Best long head stretch available. Don't skip this."
}, {
  id: "a3",
  name: "Hammer Curl",
  muscles: ["Brachialis", "Brachioradialis", "Biceps"],
  fiber: "mixed",
  equipment: ["full", "home", "minimal"],
  level: 1,
  pattern: "pull",
  cue: "Neutral grip throughout, curl and squeeze brachialis at top.",
  note: "Forearm and brachialis builder. Great arm thickness."
}, {
  id: "a4",
  name: "Cable Curl",
  muscles: ["Biceps"],
  fiber: "slow",
  equipment: ["full"],
  level: 1,
  pattern: "pull",
  cue: "Low cable, supinate through the curl, constant tension.",
  note: "Better constant tension than free weight curls."
}, {
  id: "a5",
  name: "Concentration Curl",
  muscles: ["Biceps (Long Head)"],
  fiber: "slow",
  equipment: ["full", "home"],
  level: 1,
  pattern: "pull",
  cue: "Elbow on inner thigh, full ROM, squeeze hard at top.",
  note: "Classic isolation. Great for peak contraction."
}, {
  id: "a6",
  name: "Preacher Curl",
  muscles: ["Biceps"],
  fiber: "slow",
  equipment: ["full"],
  level: 1,
  pattern: "pull",
  cue: "Upper arm flat on pad, lower to near-full extension.",
  note: "Removes momentum. Short head emphasis."
}, {
  id: "a7",
  name: "EZ Bar Curl",
  muscles: ["Biceps", "Brachialis"],
  fiber: "fast",
  equipment: ["full", "barbell", "home"],
  level: 1,
  pattern: "pull",
  cue: "Semi-supinated grip reduces wrist strain. Full ROM.",
  note: "Easier on wrists than straight bar. More tolerable volume."
},
// ── ARMS — TRICEPS ────────────────────────────────────────────────────────
{
  id: "t1",
  name: "Close Grip Bench Press",
  muscles: ["Triceps", "Chest", "Front Delt"],
  fiber: "fast",
  equipment: ["full", "barbell"],
  level: 2,
  pattern: "push",
  cue: "Hands shoulder-width, tuck elbows, lower to lower chest.",
  note: "Heaviest tricep load possible. Strength-phase staple."
}, {
  id: "t2",
  name: "EZ Bar Skull Crusher",
  muscles: ["Triceps (Long Head)", "Triceps"],
  fiber: "mixed",
  equipment: ["full", "barbell", "home"],
  level: 2,
  pattern: "push",
  cue: "Lower to forehead, elbows stay still, drive bar up.",
  note: "Long head emphasis. Builds arm size fast."
}, {
  id: "t3",
  name: "DB Skull Crusher",
  muscles: ["Triceps (Long Head)", "Triceps"],
  fiber: "slow",
  equipment: ["full", "home"],
  level: 1,
  pattern: "push",
  cue: "DBs parallel, lower beside ears, elbows stay fixed.",
  note: "Easier to load than EZ bar. Better ROM per arm."
}, {
  id: "t4",
  name: "Overhead Cable Extension",
  muscles: ["Triceps (Long Head)"],
  fiber: "slow",
  equipment: ["full"],
  level: 1,
  pattern: "push",
  cue: "Rope behind head, elbows point forward, extend fully.",
  note: "Maximum long head stretch. The best isolation for size."
}, {
  id: "t5",
  name: "Rope Pushdown",
  muscles: ["Triceps"],
  fiber: "slow",
  equipment: ["full"],
  level: 1,
  pattern: "push",
  cue: "Spread rope at bottom, elbows pinned to sides, full lockout.",
  note: "Classic tricep finisher. High reps, constant tension."
}, {
  id: "t6",
  name: "Cable Pushdown (bar)",
  muscles: ["Triceps"],
  fiber: "slow",
  equipment: ["full"],
  level: 1,
  pattern: "push",
  cue: "Bar to hips, elbows stay pinned, lockout and squeeze.",
  note: "More stable than rope. Good for overloading."
}, {
  id: "t7",
  name: "Seated Tricep Skullcrusher",
  muscles: ["Triceps (Long Head)", "Triceps"],
  fiber: "slow",
  equipment: ["full", "home"],
  level: 1,
  pattern: "push",
  cue: "DB or EZ bar, elbows forward, lower behind head, extend.",
  note: "Overhead position = long head stretch."
}, {
  id: "t8",
  name: "Floor Press",
  muscles: ["Triceps", "Chest"],
  fiber: "fast",
  equipment: ["full", "home", "barbell"],
  level: 1,
  pattern: "push",
  cue: "Elbows touch floor between reps. ROM is limited to lockout.",
  note: "Lockout strength builder. Safe without a spotter."
}, {
  id: "t9",
  name: "Diamond Push-Up",
  muscles: ["Triceps", "Chest"],
  fiber: "mixed",
  equipment: ["full", "home", "minimal"],
  level: 2,
  pattern: "push",
  cue: "Hands touching, elbows go back (not out), full depth.",
  note: "Bodyweight tricep work. Brutal at high reps."
}, {
  id: "t10",
  name: "Tricep Dip (bar)",
  muscles: ["Triceps", "Chest", "Front Delt"],
  fiber: "fast",
  equipment: ["full", "home"],
  level: 2,
  pattern: "push",
  cue: "Upright torso for tricep emphasis, full lockout at top.",
  note: "Bodyweight-plus. Easier to weight than push-ups."
},
// ── CORE ─────────────────────────────────────────────────────────────────
{
  id: "cr1",
  name: "Plank",
  muscles: ["Core (stability)", "Abs"],
  fiber: "slow",
  equipment: ["full", "home", "minimal"],
  level: 1,
  pattern: "carry",
  cue: "Straight body, glutes squeezed, breathe through it.",
  note: "Anti-extension. Hold 60s before adding weight."
}, {
  id: "cr2",
  name: "Ab Wheel Rollout",
  muscles: ["Abs", "Core (stability)", "Lats"],
  fiber: "slow",
  equipment: ["full", "home"],
  level: 2,
  pattern: "carry",
  cue: "Hips forward slightly, extend until lower back is flat, pull back.",
  note: "One of the best core movements. Master the knee version first."
}, {
  id: "cr3",
  name: "Cable Crunch",
  muscles: ["Abs"],
  fiber: "slow",
  equipment: ["full"],
  level: 1,
  pattern: "rotation",
  cue: "Rope from high cable, crunch down by flexing spine, not hips.",
  note: "Weighted abs work. Don't use momentum."
}, {
  id: "cr4",
  name: "Hanging Leg Raise",
  muscles: ["Abs", "Hip Flexors"],
  fiber: "slow",
  equipment: ["full", "home"],
  level: 2,
  pattern: "rotation",
  cue: "Dead hang, tuck knees first, progress to straight legs.",
  note: "Real abs strength. Most people do this wrong."
}, {
  id: "cr5",
  name: "Russian Twist",
  muscles: ["Obliques", "Core (rotational)"],
  fiber: "slow",
  equipment: ["full", "home", "minimal"],
  level: 1,
  pattern: "rotation",
  cue: "Lean back 45°, keep spine neutral, rotate from torso not arms.",
  note: "Oblique rotational work. Add weight for progression."
}, {
  id: "cr6",
  name: "Pallof Press",
  muscles: ["Core (stability)", "Obliques"],
  fiber: "slow",
  equipment: ["full"],
  level: 1,
  pattern: "carry",
  cue: "Stand perpendicular to cable, press and hold, resist rotation.",
  note: "Anti-rotation staple. Underrated for core stability."
},
// ── CALVES ───────────────────────────────────────────────────────────────
{
  id: "cv1",
  name: "Standing Calf Raise",
  muscles: ["Calves (Gastrocnemius)"],
  fiber: "slow",
  equipment: ["full", "home", "minimal"],
  level: 1,
  pattern: "push",
  cue: "Full stretch at bottom, pause, rise high, pause and squeeze.",
  note: "Gastrocnemius emphasis. Knee straight."
}, {
  id: "cv2",
  name: "Seated Calf Raise",
  muscles: ["Calves (Soleus)"],
  fiber: "slow",
  equipment: ["full"],
  level: 1,
  pattern: "push",
  cue: "Pad on lower quads, full ROM, soleus is a slow-twitch muscle.",
  note: "Soleus emphasis. Knee bent. High reps always."
},
// ── BICEPS (original bi prefix from sessions) ────────────────────────────

// ── CHEST — additional movements ─────────────────────────────────────────
{
  id: "c10",
  name: "Cable Fly (low to high)",
  muscles: ["Upper Chest"],
  fiber: "slow",
  equipment: ["full"],
  level: 2,
  pattern: "push",
  cue: "Cable at hip height, arc upward across body, meet at eye level.",
  note: "Best upper chest isolation with constant tension."
}, {
  id: "c12",
  name: "Machine Fly (Pec Deck)",
  muscles: ["Chest"],
  fiber: "slow",
  equipment: ["full"],
  level: 1,
  pattern: "push",
  cue: "Elbows slightly bent, squeeze pecs together at the front.",
  note: "Safest chest fly option. Good for beginners."
}, {
  id: "c13",
  name: "Dumbbell Pullover",
  muscles: ["Chest", "Lats"],
  fiber: "slow",
  equipment: ["full", "home"],
  level: 2,
  pattern: "pull",
  cue: "Elbows slightly bent, lower DB behind head, pull back over chest.",
  note: "Targets both chest and lat serratus. Classic mass builder."
},
// ── LEGS — additional movements ──────────────────────────────────────────
{
  id: "l9",
  name: "Leg Press (high feet)",
  muscles: ["Glutes", "Hamstrings", "Quads"],
  fiber: "mixed",
  equipment: ["full"],
  level: 1,
  pattern: "squat",
  cue: "Feet high on plate shifts load to glutes and hamstrings.",
  note: "High foot position = posterior chain emphasis."
}, {
  id: "l10",
  name: "Adductor Machine",
  muscles: ["Adductors"],
  fiber: "slow",
  equipment: ["full"],
  level: 1,
  pattern: "squat",
  cue: "Sit tall, squeeze legs together, control the return.",
  note: "Inner thigh isolation. High reps work best."
}, {
  id: "l16",
  name: "RDL (legs day)",
  muscles: ["Hamstrings", "Glutes", "Lower Back"],
  fiber: "fast",
  equipment: ["full", "barbell", "home"],
  level: 2,
  pattern: "hinge",
  cue: "Hinge at hips, bar drags down legs, feel hamstring stretch.",
  note: "Hip-hinge pattern. Excellent hamstring lengthener."
},
// ── SHOULDERS — additional movements ─────────────────────────────────────
{
  id: "s10",
  name: "Rear Delt Fly (Machine)",
  muscles: ["Rear Delt", "Traps"],
  fiber: "slow",
  equipment: ["full"],
  level: 1,
  pattern: "pull",
  cue: "Chest pad support, wide arc, squeeze shoulder blades at end.",
  note: "Machine version removes lower back involvement."
}, {
  id: "s11",
  name: "Cable Face Pull",
  muscles: ["Rear Delt", "Rotator Cuff", "Traps"],
  fiber: "slow",
  equipment: ["full"],
  level: 1,
  pattern: "pull",
  cue: "Rope to forehead, elbows high and wide, external rotate at end.",
  note: "Shoulder health essential. Do this every session."
}];

// ── SESSIONS ─────────────────────────────────────────
const SESSIONS_DATA = {
  // ── STRENGTH PHASE (Days 1,3,5,7) ──────────────────────────────────────
  // Logic: compound-first, fast-twitch dominant, 4-6 reps, full recovery between sets
  // Day 1 — Legs Strength
  // Squat pattern → hip hinge → unilateral → knee flexion → glute isolation → calves
  1: {
    label: "Legs — Strength",
    phase: "strength",
    muscles: ["Quads", "Glutes", "Hamstrings", "Calves", "Adductors"],
    exercises: ["l1", "l16", "l5", "h1", "l7", "l10", "cv1"],
    notes: "Squat anchor sets tone for everything that follows. Rest 3-5 min between compound sets. RDL on day 1 keeps hamstring stimulus while quads are still fresh from the squat."
  },
  // Day 3 — Chest Strength
  // Heavy horizontal press → upper chest → dip → isolation
  3: {
    label: "Chest — Strength",
    phase: "strength",
    muscles: ["Chest", "Upper Chest", "Triceps", "Front Delt"],
    exercises: ["c1", "c5", "c8", "c2", "c7", "t1"],
    notes: "Barbell bench is the anchor — load it heavy. Incline second while CNS is still primed. Weighted dips close out chest before moving to tricep isolation. No fluff."
  },
  // Day 5 — Back Strength
  // Vertical pull → horizontal pull → hinge → rear delt health → bicep compound
  5: {
    label: "Back & Biceps — Strength",
    phase: "strength",
    muscles: ["Lats", "Mid Back", "Rear Delt", "Biceps", "Brachialis"],
    exercises: ["b3", "b6", "b1", "b5", "b12", "a1", "a3"],
    notes: "Pull-up sets the vertical pull. Barbell row for horizontal power. Deadlift here builds top-end posterior chain strength. Face pull is non-negotiable — keeps the shoulder girdle healthy across all the pressing volume."
  },
  // Day 7 — Shoulders Strength
  // Overhead compound → lateral width → rear delt → trap → tricep strength
  7: {
    label: "Shoulders & Tris — Strength",
    phase: "strength",
    muscles: ["Front Delt", "Lateral Delt", "Rear Delt", "Triceps", "Traps"],
    exercises: ["s1", "s4", "s6", "b14", "t1", "t2", "t8"],
    notes: "OHP is the primary shoulder strength movement. Laterals for width. Face pull for rear delt health. Rack pulls here build trap mass without overlap with day 5 deadlifts. Tricep strength closes the session."
  },
  // ── HYPERTROPHY PHASE (Days 9,11,13,15) ────────────────────────────────
  // Logic: volume-focused, mixed and slow fiber, 8-15 reps, mechanical tension + metabolic stress
  // Day 9 — Legs Hypertrophy
  // Machine/hack for quad isolation → leg press for volume → unilateral → hamstring curl → glute cable work → calves
  9: {
    label: "Legs — Hypertrophy",
    phase: "hypertrophy",
    muscles: ["Quads", "Glutes", "Hamstrings", "Calves", "Adductors", "Abductors"],
    exercises: ["l3", "l4", "l5", "h2", "g1", "g5", "l10", "l7", "cv2"],
    notes: "Hack squat gives quad isolation with machine safety. Leg press loads volume. Bulgarian split squat for unilateral quad and glute work. Seated curl emphasizes the hamstring stretch position. Hip thrust and cable kickback finish glutes. Calves at the end — both soleus and gastroc covered."
  },
  // Day 11 — Chest Hypertrophy
  // Machine/DB for constant tension → incline volume → fly for stretch → pullover for serratus → tricep long head
  11: {
    label: "Chest — Hypertrophy",
    phase: "hypertrophy",
    muscles: ["Chest", "Upper Chest", "Triceps"],
    exercises: ["c4", "c2", "c6", "c7", "c10", "c12", "c13", "t3", "t4"],
    notes: "Machine press first gives max tension without stability demand — lets you focus on the chest contraction. DB flat adds ROM. Incline DB for upper chest volume. Fly for the stretch position. Low-to-high cable targets upper chest differently. Pullover stretches the serratus and lats. Tricep skull crushers and overhead extension finish with long-head emphasis."
  },
  // Day 13 — Back Hypertrophy
  // Lat pulldown volume → cable row → chest-supported row → straight-arm pulldown → bicep peak + thickness
  13: {
    label: "Back & Biceps — Hypertrophy",
    phase: "hypertrophy",
    muscles: ["Lats", "Mid Back", "Rear Delt", "Biceps", "Brachialis"],
    exercises: ["b4", "b7", "b8", "b9", "b11", "b10", "s10", "a2", "a4", "a3"],
    notes: "Lat pulldown for lat width. DB row for heavy unilateral pulling. Chest-supported row isolates mid-back without lower back fatigue. Straight-arm pulldown for pure lat isolation. T-bar row adds thickness. Single-arm pulldown fixes imbalances. Rear delt machine rounds out the rear shoulder. Incline curl for long head stretch — the most underutilized bicep exercise. Cable curl for constant tension."
  },
  // Day 15 — Shoulders Hypertrophy
  // DB/Arnold press for full ROM → cable laterals for constant tension → rear delt isolation → tricep long head volume
  15: {
    label: "Shoulders & Tris — Hypertrophy",
    phase: "hypertrophy",
    muscles: ["Front Delt", "Lateral Delt", "Rear Delt", "Triceps", "Traps"],
    exercises: ["s2", "s3", "s5", "s4", "s11", "s7", "s10", "t4", "t5", "t3"],
    notes: "DB press for full ROM. Arnold press hits all three delt heads through rotation. Cable laterals give constant tension the entire arc — more effective than DBs for lateral delt hypertrophy. Two lateral variations for volume. Cable face pull and rear delt fly for posterior shoulder balance. Overhead cable extension maxes long-head stretch — the most important tricep exercise for size. Rope pushdown for pump. DB skull crusher to finish."
  }
};
const CYCLE = [{
  day: 1,
  rest: false
}, {
  day: 2,
  rest: true
}, {
  day: 3,
  rest: false
}, {
  day: 4,
  rest: true
}, {
  day: 5,
  rest: false
}, {
  day: 6,
  rest: true
}, {
  day: 7,
  rest: false
}, {
  day: 8,
  rest: true
}, {
  day: 9,
  rest: false
}, {
  day: 10,
  rest: true
}, {
  day: 11,
  rest: false
}, {
  day: 12,
  rest: true
}, {
  day: 13,
  rest: false
}, {
  day: 14,
  rest: true
}, {
  day: 15,
  rest: false
}, {
  day: 16,
  rest: true
}];
const GOALS = [{
  id: "recomp",
  label: "Recomp",
  sub: "Shift body composition",
  icon: "⚖️",
  color: T.steel
}, {
  id: "bulk",
  label: "Lean Bulk",
  sub: "Build mass, minimal fat",
  icon: "📈",
  color: T.emerald
}, {
  id: "cut",
  label: "Cut",
  sub: "Reveal what you built",
  icon: "🔥",
  color: T.amber
}, {
  id: "peak",
  label: "Peak",
  sub: "Strength PRs",
  icon: "🏆",
  color: T.gold
}];
const EQUIP = [{
  id: "full",
  label: "Full Commercial Gym",
  icon: "🏋️"
}, {
  id: "home",
  label: "Home Gym",
  icon: "🏠"
}, {
  id: "barbell",
  label: "Barbell Only",
  icon: "🔩"
}, {
  id: "minimal",
  label: "Minimal / Bodyweight",
  icon: "🤸"
}];
const EXPERIENCE = [{
  id: "beginner",
  label: "Beginner",
  sub: "0–1 yr",
  color: T.emerald
}, {
  id: "intermediate",
  label: "Intermediate",
  sub: "1–3 yrs",
  color: T.steel
}, {
  id: "advanced",
  label: "Advanced",
  sub: "3+ yrs",
  color: T.accent
}];
const FIBER_COLOR = {
  fast: T.crimson,
  mixed: T.amber,
  slow: T.steel
};
const FIBER_LABEL = {
  fast: "Fast-Twitch",
  mixed: "Mixed",
  slow: "Slow-Twitch"
};
const EQUIP_LABEL = {
  full: "Full Gym",
  home: "Home Gym",
  barbell: "Barbell Only",
  minimal: "Minimal"
};

// ── MUSCLE GROUP COLOR SYSTEM ─────────────────────────
// Card accent color by primary muscle group trained
const MUSCLE_GROUP_COLOR = {
  // Chest
  "Chest": "#E11D48",
  "Upper Chest": "#E11D48",
  // Back
  "Lats": "#0891B2",
  "Mid Back": "#0891B2",
  "Lower Back": "#0891B2",
  "Traps": "#0891B2",
  "Rear Delt": "#0891B2",
  "Rotator Cuff": "#0891B2",
  // Legs
  "Quads": "#16A34A",
  "Hamstrings": "#16A34A",
  "Glutes": "#16A34A",
  "Glute Med": "#16A34A",
  "Adductors": "#16A34A",
  "Abductors": "#16A34A",
  "Calves (Soleus)": "#16A34A",
  "Calves (Gastrocnemius)": "#16A34A",
  // Shoulders
  "Front Delt": "#6366F1",
  "Lateral Delt": "#6366F1",
  // Arms
  "Biceps": "#D97706",
  "Biceps (Long Head)": "#D97706",
  "Brachialis": "#D97706",
  "Brachioradialis": "#D97706",
  "Triceps": "#D97706",
  "Triceps (Long Head)": "#D97706",
  // Core
  "Abs": "#7C3AED",
  "Obliques": "#7C3AED",
  "Core (stability)": "#7C3AED",
  "Core (rotational)": "#7C3AED",
  "Hip Flexors": "#7C3AED"
};
const MUSCLE_GROUP_LABEL = {
  "#E11D48": "Chest",
  "#0891B2": "Back",
  "#16A34A": "Legs",
  "#6366F1": "Shoulders",
  "#D97706": "Arms",
  "#7C3AED": "Core"
};

// Get the primary color for a movement based on its first muscle
function getMovementColor(muscles) {
  if (!muscles || muscles.length === 0) return T.dim;
  for (const m of muscles) {
    if (MUSCLE_GROUP_COLOR[m]) return MUSCLE_GROUP_COLOR[m];
  }
  return T.dim;
}
const MUSCLE_MRV = {
  "Chest": 16,
  "Upper Chest": 10,
  "Lats": 18,
  "Mid Back": 14,
  "Quads": 18,
  "Hamstrings": 16,
  "Glutes": 16,
  "Lateral Delt": 12,
  "Rear Delt": 12,
  "Front Delt": 8,
  "Triceps": 14,
  "Biceps": 14,
  "Calves": 20
};

// ── UI PRIMITIVES ────────────────────────────────────
function Tag({
  text,
  color,
  xs
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: xs ? 9 : 10,
      fontWeight: 700,
      letterSpacing: "0.07em",
      padding: xs ? "2px 6px" : "3px 8px",
      borderRadius: 4,
      background: color + "1E",
      color,
      border: `1px solid ${color}40`,
      display: "inline-flex",
      alignItems: "center",
      lineHeight: 1.2
    }
  }, text);
}
function Btn({
  children,
  onClick,
  variant = "primary",
  size = "md",
  disabled,
  style = {}
}) {
  const [h, setH] = useState(false);
  const [pressed, setPressed] = useState(false);
  const base = {
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 700,
    fontFamily: "inherit",
    transition: "all 0.12s cubic-bezier(0.34,1.56,0.64,1)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    transform: pressed ? "scale(0.96)" : h ? "scale(1.01)" : "scale(1)",
    letterSpacing: "0.01em",
    ...style
  };
  const sz = size === "sm" ? {
    fontSize: 11,
    padding: "6px 14px",
    borderRadius: 8
  } : size === "lg" ? {
    fontSize: 15,
    padding: "16px 28px",
    borderRadius: 14
  } : {
    fontSize: 13,
    padding: "10px 18px",
    borderRadius: 10
  };
  const v = variant === "primary" ? {
    background: disabled ? T.dim : T.accent,
    color: disabled ? T.surface : T.bg,
    opacity: disabled ? 0.5 : 1,
    boxShadow: h && !disabled ? `0 4px 20px ${T.accent}40` : "none"
  } : variant === "ghost" ? {
    background: "transparent",
    color: h ? T.bright : T.muted,
    border: `1px solid ${h ? T.borderHi : T.border}`
  } : variant === "danger" ? {
    background: h ? T.crimson + "33" : "transparent",
    color: T.crimson,
    border: `1px solid ${T.crimson}44`
  } : {
    background: h ? T.accentBg : "transparent",
    color: T.accent,
    border: `1px solid ${T.accentDim}`
  };
  return /*#__PURE__*/React.createElement("button", {
    onClick: disabled ? null : onClick,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => {
      setH(false);
      setPressed(false);
    },
    onMouseDown: () => setPressed(true),
    onMouseUp: () => setPressed(false),
    onTouchStart: () => setPressed(true),
    onTouchEnd: () => setPressed(false),
    style: {
      ...base,
      ...sz,
      ...v
    }
  }, children);
}
function Card({
  children,
  style = {},
  onClick,
  glow,
  color
}) {
  const [h, setH] = useState(false);
  const glowColor = color || T.accent;
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: {
      background: h && onClick ? T.cardHover : T.card,
      border: `1px solid ${glow ? glowColor + "55" : h && onClick ? T.borderHi : T.border}`,
      borderRadius: 14,
      padding: 16,
      cursor: onClick ? "pointer" : "default",
      transition: "all 0.18s ease",
      boxShadow: glow ? `0 0 28px ${glowColor}18, 0 2px 8px rgba(0,0,0,0.4)` : "0 1px 3px rgba(0,0,0,0.3)",
      transform: h && onClick ? "translateY(-1px)" : "none",
      width: "100%",
      boxSizing: "border-box",
      ...style
    }
  }, children);
}
function Divider() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: 1,
      background: T.border,
      margin: "14px 0"
    }
  });
}
function Label({
  children,
  color
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      fontWeight: 800,
      letterSpacing: "0.14em",
      color: color || T.dim,
      marginBottom: 10,
      textTransform: "uppercase"
    }
  }, children);
}

// ── INTENSITY ARC ─────────────────────────────────────// ── INTENSITY ARC ─────────────────────────────────────
function IntensityArc({
  cycleDay,
  phase
}) {
  const week = phase === "strength" ? Math.ceil(cycleDay / 2) : Math.ceil((cycleDay - 8) / 2);
  const pct = phase === "strength" ? [0.3, 0.6, 0.9, 0.2][week - 1] || 0.5 : [0.25, 0.5, 0.75, 0.15][week - 1] || 0.4;
  const r = 28,
    cx = 36,
    cy = 36,
    circ = 2 * Math.PI * r;
  const color = pct < 0.5 ? T.emerald : pct < 0.8 ? T.amber : T.crimson;
  const label = pct < 0.5 ? "MEV" : pct < 0.8 ? "MAV" : "MRV";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      width: 72,
      height: 72
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: 72,
    height: 72,
    style: {
      transform: "rotate(-90deg)"
    }
  }, /*#__PURE__*/React.createElement("circle", {
    cx: cx,
    cy: cy,
    r: r,
    fill: "none",
    stroke: T.border,
    strokeWidth: 4
  }), /*#__PURE__*/React.createElement("circle", {
    cx: cx,
    cy: cy,
    r: r,
    fill: "none",
    stroke: color,
    strokeWidth: 4,
    strokeDasharray: circ,
    strokeDashoffset: circ * (1 - pct),
    strokeLinecap: "round",
    style: {
      transition: "stroke-dashoffset 0.6s ease"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      fontWeight: 700,
      color,
      lineHeight: 1
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: T.muted,
      lineHeight: 1,
      marginTop: 1
    }
  }, "W", week)));
}

// ── ONBOARDING ───────────────────────────────────────
function Onboarding({
  onComplete
}) {
  const [phase, setPhase] = useState("splash"); // splash | steps | summary
  const [step, setStep] = useState(0);
  const [sel, setSel] = useState({
    goal: null,
    equipment: null,
    experience: null,
    weight: "",
    height: "",
    age: "",
    sex: "male",
    name: ""
  });
  const [animIn, setAnimIn] = useState(true);
  function nextStep() {
    setAnimIn(false);
    setTimeout(() => {
      if (step < STEPS.length - 1) {
        setStep(s => s + 1);
        setAnimIn(true);
      } else {
        setPhase("summary");
      }
    }, 180);
  }
  function prevStep() {
    if (step === 0) {
      setPhase("splash");
      return;
    }
    setAnimIn(false);
    setTimeout(() => {
      setStep(s => s - 1);
      setAnimIn(true);
    }, 180);
  }

  // ── STEPS ──────────────────────────────────────────────────
  const STEPS = [
  // 0 — Name
  {
    eyebrow: "LET\'S START",
    title: "What should we call you?",
    sub: "This is your space. We\'ll personalize everything to your name.",
    valid: sel.name.trim().length > 0,
    content: /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("input", {
      placeholder: "Your name or nickname",
      value: sel.name,
      onChange: e => setSel(s => ({
        ...s,
        name: e.target.value
      })),
      "aria-label": "Your name",
      autoFocus: true,
      style: {
        width: "100%",
        background: T.surface,
        border: `2px solid ${sel.name ? T.accent : T.border}`,
        borderRadius: 12,
        padding: "16px 18px",
        color: T.bright,
        fontSize: 20,
        fontWeight: 700,
        outline: "none",
        fontFamily: "inherit",
        boxSizing: "border-box",
        transition: "border-color 0.2s",
        letterSpacing: "-0.01em"
      }
    }), sel.name && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 16,
        fontSize: 18,
        color: T.accent,
        fontWeight: 700,
        animation: "fadeUp 0.3s ease"
      }
    }, "Welcome, ", sel.name, ". 👋"))
  },
  // 1 — Goal
  {
    eyebrow: "YOUR MISSION",
    title: `What are you training for${sel.name ? ", " + sel.name : ""}?`,
    sub: "This sets your calorie targets, macro split, and how we program your cycles.",
    valid: !!sel.goal,
    content: /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 10
      }
    }, GOALS.map(g => {
      const active = sel.goal === g.id;
      return /*#__PURE__*/React.createElement("div", {
        key: g.id,
        onClick: () => setSel(s => ({
          ...s,
          goal: g.id
        })),
        style: {
          background: active ? g.color + "14" : T.card,
          border: `2px solid ${active ? g.color : T.border}`,
          borderRadius: 12,
          padding: "16px 18px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 14,
          transition: "all 0.15s",
          transform: active ? "scale(1.01)" : "scale(1)",
          boxShadow: active ? `0 4px 24px ${g.color}22` : "0 2px 8px rgba(0,0,0,0.3)"
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          width: 44,
          height: 44,
          borderRadius: 12,
          flexShrink: 0,
          background: active ? g.color + "22" : T.surface,
          border: `1px solid ${active ? g.color + "44" : T.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 24
        }
      }, g.icon), /*#__PURE__*/React.createElement("div", {
        style: {
          flex: 1
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontWeight: 800,
          fontSize: 15,
          color: active ? g.color : T.bright,
          marginBottom: 3
        }
      }, g.label), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 12,
          color: T.muted,
          lineHeight: 1.5
        }
      }, g.sub)), /*#__PURE__*/React.createElement("div", {
        style: {
          width: 22,
          height: 22,
          borderRadius: "50%",
          flexShrink: 0,
          background: active ? g.color : "transparent",
          border: `2px solid ${active ? g.color : T.dim}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          color: T.bg,
          fontWeight: 800,
          transition: "all 0.2s"
        }
      }, active ? "✓" : ""));
    }))
  },
  // 2 — Equipment
  {
    eyebrow: "YOUR ARENA",
    title: "Where do you train?",
    sub: "We\'ll filter your movement library to exactly what you have access to. No guessing.",
    valid: !!sel.equipment,
    content: /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10
      }
    }, EQUIP.map(e => {
      const active = sel.equipment === e.id;
      return /*#__PURE__*/React.createElement("div", {
        key: e.id,
        onClick: () => setSel(s => ({
          ...s,
          equipment: e.id
        })),
        style: {
          background: active ? T.accent + "12" : T.card,
          border: `2px solid ${active ? T.accent : T.border}`,
          borderRadius: 12,
          padding: "22px 12px",
          cursor: "pointer",
          textAlign: "center",
          transition: "all 0.15s",
          transform: active ? "scale(1.03)" : "scale(1)",
          boxShadow: active ? `0 4px 20px ${T.accent}18` : "0 2px 8px rgba(0,0,0,0.3)"
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 30,
          marginBottom: 10
        }
      }, e.icon), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 13,
          fontWeight: 700,
          color: active ? T.accent : T.bright,
          marginBottom: 3
        }
      }, e.label), active && /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 9,
          color: T.accent,
          fontWeight: 700,
          letterSpacing: "0.1em",
          marginTop: 6
        }
      }, "SELECTED"));
    }))
  },
  // 3 — Experience
  {
    eyebrow: "YOUR LEVEL",
    title: "How long have you been training?",
    sub: "Sets your starting volume landmarks. This adapts over time — be honest.",
    valid: !!sel.experience,
    content: /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 10
      }
    }, EXPERIENCE.map(e => {
      const active = sel.experience === e.id;
      return /*#__PURE__*/React.createElement("div", {
        key: e.id,
        onClick: () => setSel(s => ({
          ...s,
          experience: e.id
        })),
        style: {
          display: "flex",
          alignItems: "center",
          gap: 14,
          background: active ? e.color + "12" : T.card,
          border: `2px solid ${active ? e.color : T.border}`,
          borderRadius: 12,
          padding: "14px 18px",
          cursor: "pointer",
          transition: "all 0.15s",
          transform: active ? "scale(1.01)" : "scale(1)"
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          width: 40,
          height: 40,
          borderRadius: 10,
          flexShrink: 0,
          background: active ? e.color + "22" : T.surface,
          border: `1px solid ${active ? e.color + "44" : T.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20
        }
      }, e.icon || "💪"), /*#__PURE__*/React.createElement("div", {
        style: {
          flex: 1
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontWeight: 800,
          fontSize: 14,
          color: active ? e.color : T.bright,
          marginBottom: 2
        }
      }, e.label), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 12,
          color: T.muted
        }
      }, e.sub)), active && /*#__PURE__*/React.createElement("div", {
        style: {
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: e.color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 10,
          color: T.bg,
          fontWeight: 800
        }
      }, "✓"));
    }))
  },
  // 4 — Body stats
  {
    eyebrow: "YOUR BODY",
    title: "A few quick measurements",
    sub: "Used to calculate your protein floor, TDEE, and body composition estimates. Never shared.",
    valid: !!sel.weight && !!sel.age,
    content: /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 16
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9,
        fontWeight: 700,
        color: T.dim,
        letterSpacing: "0.12em",
        marginBottom: 8,
        textTransform: "uppercase"
      }
    }, "Biological sex"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8
      }
    }, ["male", "female"].map(s => /*#__PURE__*/React.createElement("button", {
      key: s,
      onClick: () => setSel(p => ({
        ...p,
        sex: s
      })),
      style: {
        flex: 1,
        padding: "12px 0",
        borderRadius: 10,
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 700,
        background: sel.sex === s ? T.steel + "22" : T.card,
        border: `2px solid ${sel.sex === s ? T.steel : T.border}`,
        color: sel.sex === s ? T.steel : T.muted,
        transition: "all 0.15s"
      }
    }, s.charAt(0).toUpperCase() + s.slice(1))))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10
      }
    }, [{
      key: "weight",
      label: "Weight (lbs)",
      ph: "185",
      icon: "⚖️"
    }, {
      key: "height",
      label: "Height (in)",
      ph: "70",
      icon: "📏"
    }].map(f => /*#__PURE__*/React.createElement("div", {
      key: f.key
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9,
        fontWeight: 700,
        color: T.dim,
        letterSpacing: "0.12em",
        marginBottom: 8,
        textTransform: "uppercase"
      }
    }, f.label), /*#__PURE__*/React.createElement("input", {
      type: "number",
      placeholder: f.ph,
      value: sel[f.key],
      onChange: e => setSel(s => ({
        ...s,
        [f.key]: e.target.value
      })),
      style: {
        width: "100%",
        background: T.surface,
        border: `2px solid ${sel[f.key] ? T.accent : T.border}`,
        borderRadius: 10,
        padding: "13px 12px",
        color: T.bright,
        fontSize: 18,
        fontWeight: 700,
        outline: "none",
        fontFamily: "inherit",
        textAlign: "center",
        boxSizing: "border-box",
        transition: "border-color 0.2s"
      }
    })))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9,
        fontWeight: 700,
        color: T.dim,
        letterSpacing: "0.12em",
        marginBottom: 8,
        textTransform: "uppercase"
      }
    }, "Age"), /*#__PURE__*/React.createElement("input", {
      type: "number",
      placeholder: "28",
      value: sel.age,
      onChange: e => setSel(s => ({
        ...s,
        age: e.target.value
      })),
      style: {
        width: "100%",
        background: T.surface,
        border: `2px solid ${sel.age ? T.accent : T.border}`,
        borderRadius: 10,
        padding: "13px 14px",
        color: T.bright,
        fontSize: 18,
        fontWeight: 700,
        outline: "none",
        fontFamily: "inherit",
        textAlign: "center",
        boxSizing: "border-box",
        transition: "border-color 0.2s"
      }
    })), sel.weight && sel.age && /*#__PURE__*/React.createElement("div", {
      style: {
        background: T.emeraldBg,
        border: `1px solid ${T.emerald}44`,
        borderRadius: 12,
        padding: "14px 16px",
        animation: "fadeUp 0.3s ease"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: T.emerald,
        letterSpacing: "0.1em",
        marginBottom: 10
      }
    }, "YOUR STARTING TARGETS"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 0
      }
    }, [{
      l: "Protein floor",
      v: `${Math.round(Number(sel.weight) * (MACRO_GOALS.find(g => g.id === sel.goal)?.proteinMult || 1.3))}g`,
      c: T.emerald
    }, {
      l: "Cycle length",
      v: "16 days",
      c: T.accent
    }, {
      l: "Sessions",
      v: "8 / cycle",
      c: T.steel
    }].map((s, i) => /*#__PURE__*/React.createElement("div", {
      key: s.l,
      style: {
        textAlign: "center",
        borderRight: i < 2 ? `1px solid ${T.border}` : "none",
        padding: "0 8px"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 18,
        fontWeight: 800,
        color: s.c
      }
    }, s.v), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9,
        color: T.dim,
        marginTop: 2,
        textTransform: "uppercase",
        letterSpacing: "0.06em"
      }
    }, s.l))))))
  }];
  const cur = STEPS[step];
  const totalSteps = STEPS.length;

  // ── SPLASH SCREEN ───────────────────────────────────────────
  if (phase === "splash") {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        minHeight: "100vh",
        background: T.bg,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "0 0 40px",
        overflow: "hidden",
        position: "relative"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        top: -100,
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(400px, 90vw)",
        height: "min(400px, 90vw)",
        background: `radial-gradient(circle, ${T.accent}08 0%, transparent 70%)`,
        pointerEvents: "none"
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        top: 80,
        left: -60,
        width: "min(200px, 50vw)",
        height: "min(200px, 50vw)",
        background: `radial-gradient(circle, ${T.crimson}06 0%, transparent 70%)`,
        pointerEvents: "none"
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        top: 120,
        right: -60,
        width: "min(200px, 50vw)",
        height: "min(200px, 50vw)",
        background: `radial-gradient(circle, ${T.steel}06 0%, transparent 70%)`,
        pointerEvents: "none"
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "80px 32px 0",
        textAlign: "center"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 72,
        height: 72,
        borderRadius: 20,
        marginBottom: 32,
        background: `linear-gradient(135deg, ${T.accent}22, ${T.steel}22)`,
        border: `1px solid ${T.accent}33`,
        boxShadow: `0 0 40px ${T.accent}12`
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 32
      }
    }, "⚡")), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: "0.3em",
        color: T.dim,
        marginBottom: 16,
        textTransform: "uppercase"
      }
    }, "Solutus Nexus presents"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 42,
        fontWeight: 800,
        color: T.bright,
        letterSpacing: "-0.04em",
        lineHeight: 0.95,
        marginBottom: 6
      }
    }, "Superhuman"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 42,
        fontWeight: 800,
        background: `linear-gradient(135deg, ${T.accent}, ${T.accentDim})`,
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        letterSpacing: "-0.04em",
        lineHeight: 0.95,
        marginBottom: 32
      }
    }, "Physique"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 16,
        color: T.muted,
        lineHeight: 1.6,
        maxWidth: 280,
        margin: "0 auto",
        marginBottom: 48
      }
    }, "The 16-day training system built for people who are serious about results."), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 10,
        marginBottom: 0
      }
    }, [{
      icon: "💪",
      label: "Strength",
      color: T.crimson,
      sub: "Fast-twitch development"
    }, {
      icon: "🔬",
      label: "Science",
      color: T.steel,
      sub: "MEV/MAV/MRV programmed"
    }, {
      icon: "📈",
      label: "Progress",
      color: T.emerald,
      sub: "PR tracking every cycle"
    }].map(p => /*#__PURE__*/React.createElement("div", {
      key: p.label,
      style: {
        background: T.card,
        border: `1px solid ${p.color}22`,
        borderRadius: 14,
        padding: "16px 8px",
        textAlign: "center"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 24,
        marginBottom: 8
      }
    }, p.icon), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        fontWeight: 800,
        color: p.color,
        letterSpacing: "0.04em"
      }
    }, p.label), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9,
        color: T.dim,
        marginTop: 4,
        lineHeight: 1.4,
        whiteSpace: "pre"
      }
    }, p.sub))))), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "0 24px"
      }
    }, /*#__PURE__*/React.createElement(Btn, {
      size: "lg",
      style: {
        width: "100%",
        marginBottom: 14,
        background: T.accent,
        color: T.bg,
        fontSize: 16,
        fontWeight: 800,
        padding: "18px 0",
        borderRadius: 14,
        boxShadow: `0 8px 32px ${T.accent}22`
      },
      onClick: () => {
        setPhase("steps");
        setStep(0);
      }
    }, "Start Building →"), /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "center",
        fontSize: 11,
        color: T.dim
      }
    }, "Takes 2 minutes · Free · No credit card")));
  }

  // ── SUMMARY SCREEN ──────────────────────────────────────────
  if (phase === "summary") {
    const goal = GOALS.find(g => g.id === sel.goal);
    const equip = EQUIP.find(e => e.id === sel.equipment);
    const exp = EXPERIENCE.find(e => e.id === sel.experience);
    const proteinMult = MACRO_GOALS.find(g => g.id === sel.goal)?.proteinMult || 1.3;
    const protein = Math.round(Number(sel.weight) * proteinMult);
    const bmi = sel.weight && sel.height ? (Number(sel.weight) * 703 / Number(sel.height) ** 2).toFixed(1) : null;
    return /*#__PURE__*/React.createElement("div", {
      style: {
        minHeight: "100vh",
        background: T.bg,
        padding: "48px 24px 48px",
        display: "flex",
        flexDirection: "column"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "center",
        marginBottom: 32
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 40,
        marginBottom: 12
      }
    }, "🎯"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 26,
        fontWeight: 800,
        color: T.bright,
        letterSpacing: "-0.02em",
        marginBottom: 6
      }
    }, sel.name ? `${sel.name}, your plan is ready.` : "Your plan is ready."), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 14,
        color: T.muted
      }
    }, "Here's what we built for you.")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 10,
        marginBottom: 28
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        background: goal?.color + "12",
        border: `1px solid ${goal?.color}44`,
        borderRadius: 14,
        padding: "16px 18px",
        display: "flex",
        alignItems: "center",
        gap: 14
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 28
      }
    }, goal?.icon), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: goal?.color,
        letterSpacing: "0.1em",
        marginBottom: 2
      }
    }, "YOUR GOAL"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 16,
        fontWeight: 800,
        color: T.bright
      }
    }, goal?.label), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: T.muted,
        marginTop: 1
      }
    }, goal?.sub))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 8
      }
    }, [{
      l: "Protein Target",
      v: `${protein}g/day`,
      c: T.emerald,
      icon: "🥩"
    }, {
      l: "Equipment",
      v: equip?.label,
      c: T.accent,
      icon: equip?.icon
    }, {
      l: "Experience",
      v: exp?.label,
      c: T.steel,
      icon: exp?.icon || "💪"
    }, {
      l: "Cycle Length",
      v: "16 days",
      c: T.amber,
      icon: "🗓"
    }].map(s => /*#__PURE__*/React.createElement("div", {
      key: s.l,
      style: {
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        padding: "14px 14px",
        display: "flex",
        alignItems: "center",
        gap: 10
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 20
      }
    }, s.icon), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 15,
        fontWeight: 800,
        color: s.c
      }
    }, s.v), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9,
        color: T.dim,
        marginTop: 1,
        textTransform: "uppercase",
        letterSpacing: "0.06em"
      }
    }, s.l))))), /*#__PURE__*/React.createElement("div", {
      style: {
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 14,
        padding: "16px 18px"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: T.dim,
        letterSpacing: "0.12em",
        marginBottom: 12
      }
    }, "WHAT HAPPENS NEXT"), [{
      icon: "📋",
      text: "Your 16-day cycle loads — Day 1 is ready to go"
    }, {
      icon: "🏋️",
      text: "Each session adapts to your equipment and experience"
    }, {
      icon: "📊",
      text: "Every set logged builds your progress history"
    }, {
      icon: "🔁",
      text: "Your PRs carry into every new cycle automatically"
    }].map((item, i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        marginBottom: i < 3 ? 10 : 0
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 16,
        flexShrink: 0
      }
    }, item.icon), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        color: T.text,
        lineHeight: 1.5
      }
    }, item.text))))), /*#__PURE__*/React.createElement(Btn, {
      size: "lg",
      style: {
        width: "100%",
        background: T.accent,
        color: T.bg,
        fontSize: 16,
        fontWeight: 800,
        padding: "18px 0",
        borderRadius: 14,
        boxShadow: `0 8px 32px ${T.accent}22`
      },
      onClick: () => onComplete(sel)
    }, "Enter Superhuman Physique →"));
  }

  // ── STEP SCREENS ────────────────────────────────────────────
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: "100vh",
      background: T.bg,
      display: "flex",
      flexDirection: "column"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "16px 24px 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 4,
      marginBottom: 6
    }
  }, STEPS.map((_, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: 1,
      height: 3,
      borderRadius: 2,
      background: i < step ? T.emerald : i === step ? T.accent : T.border,
      transition: "background 0.4s",
      transform: i === step ? "scaleY(1.5)" : "scaleY(1)",
      transformOrigin: "center"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: prevStep,
    style: {
      background: "none",
      border: "none",
      color: T.muted,
      fontSize: 13,
      cursor: "pointer",
      padding: "4px 0",
      display: "flex",
      alignItems: "center",
      gap: 4
    }
  }, "← Back"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: T.dim
    }
  }, step + 1, " of ", totalSteps))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "28px 24px 0",
      flex: 1,
      opacity: animIn ? 1 : 0,
      transform: animIn ? "translateY(0)" : "translateY(8px)",
      transition: "opacity 0.18s ease, transform 0.18s ease"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      fontWeight: 800,
      letterSpacing: "0.2em",
      color: T.accent,
      marginBottom: 10,
      textTransform: "uppercase"
    }
  }, cur.eyebrow), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 24,
      fontWeight: 800,
      color: T.bright,
      letterSpacing: "-0.02em",
      lineHeight: 1.2,
      marginBottom: 8
    }
  }, cur.title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.muted,
      lineHeight: 1.6,
      marginBottom: 28
    }
  }, cur.sub), cur.content), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "24px",
      paddingBottom: 40
    }
  }, /*#__PURE__*/React.createElement(Btn, {
    size: "lg",
    disabled: !cur.valid,
    style: {
      width: "100%",
      fontSize: 15,
      fontWeight: 800,
      padding: "17px 0",
      borderRadius: 14
    },
    onClick: nextStep
  }, step < STEPS.length - 1 ? "Continue →" : "Review My Plan →"), !cur.valid && /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      fontSize: 11,
      color: T.dim,
      marginTop: 10
    }
  }, step === 0 ? "Enter your name to continue" : step === 1 ? "Select a goal to continue" : step === 2 ? "Select your equipment" : step === 3 ? "Select your experience level" : "Enter your weight and age")));
}

// ── DASHBOARD ────────────────────────────────────────
// Mock session completion history with real dates
// In production: stored in DB, written on session completion
// SESSION_HISTORY is derived live from sessionLogs (persisted state)
// See getDerivedHistory(sessionLogs) below

function daysSince(dateStr) {
  const then = new Date(dateStr + "T12:00:00");
  const now = new Date();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}
function formatDate(dateStr) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}
// ── DERIVED DATA HELPERS ─────────────────────────────────────
// All data comes from sessionLogs (persisted localStorage / Firebase)

// Get previous sets for an exercise from sessionLogs
function getPrevLifts(sessionLogs, exerciseId) {
  const entries = Object.entries(sessionLogs).sort(([a], [b]) => b.localeCompare(a)); // most recent first
  for (const [, dayLog] of entries) {
    const sets = dayLog.sets?.[exerciseId];
    if (sets && sets.length > 0) return sets;
  }
  return [];
}

// Derive session history from sessionLogs
function getDerivedHistory(sessionLogs) {
  return Object.entries(sessionLogs).sort(([a], [b]) => b.localeCompare(a)).map(([date, log]) => ({
    date,
    cycleDay: log.cycleDay,
    label: SESSIONS_DATA[log.cycleDay]?.label || "Session",
    exercises: Object.keys(log.sets || {}).length
  })).filter(h => h.cycleDay);
}

// Get the last training cycle day from sessionLogs
function getCurrentCycleDay(sessionLogs) {
  const history = getDerivedHistory(sessionLogs);
  if (!history.length) return 1;
  const lastDay = history[0].cycleDay;
  // Advance to next training day
  for (let d = lastDay + 1; d <= 16; d++) {
    if (!CYCLE.find(c => c.day === d)?.rest) return d;
  }
  return 1; // wrap cycle
}

// Calculate streak from sessionLogs
function getStreak(sessionLogs) {
  const dates = Object.keys(sessionLogs).sort().reverse();
  if (!dates.length) return 0;
  let streak = 0;
  let prev = null;
  for (const d of dates) {
    const curr = new Date(d);
    if (!prev) {
      streak = 1;
      prev = curr;
      continue;
    }
    const diff = Math.round((prev - curr) / (1000 * 60 * 60 * 24));
    if (diff <= 2) {
      streak++;
      prev = curr;
    } else break;
  }
  return streak;
}

// Build LIFTS-style chart data from sessionLogs for a given exercise
function getLiftHistory(sessionLogs, exerciseId, phase) {
  const results = [];
  const entries = Object.entries(sessionLogs).sort(([a], [b]) => a.localeCompare(b));
  let cycle = 1;
  let lastCycleDay = null;
  for (const [date, log] of entries) {
    const sets = log.sets?.[exerciseId];
    if (!sets || !sets.length) continue;
    if (lastCycleDay && log.cycleDay < lastCycleDay) cycle++;
    lastCycleDay = log.cycleDay;
    const best = sets.reduce((mx, s) => s.w > mx.w ? s : mx, sets[0]);
    const sessionPhase = SESSIONS_DATA[log.cycleDay]?.phase || "strength";
    const phaseLabel = sessionPhase === "strength" ? "str" : "hyp";
    results.push({
      cycle,
      phase: phaseLabel,
      label: `C${cycle} ${phaseLabel === "str" ? "Str" : "Hyp"}`,
      w: best.w,
      r: best.r,
      date: new Date(date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric"
      })
    });
  }
  return results;
}

// PR: highest weight ever logged for an exercise
function getExercisePR(sessionLogs, exerciseId) {
  let pr = 0;
  for (const dayLog of Object.values(sessionLogs)) {
    const sets = dayLog.sets?.[exerciseId] || [];
    for (const s of sets) {
      if (s.w > pr) pr = s.w;
    }
  }
  return pr || null;
}

// Count total PRs set this cycle (weight higher than any previous cycle)
function countPRs(sessionLogs) {
  const exIds = new Set();
  for (const log of Object.values(sessionLogs)) {
    Object.keys(log.sets || {}).forEach(id => exIds.add(id));
  }
  let prs = 0;
  for (const id of exIds) {
    const history = getLiftHistory(sessionLogs, id);
    if (history.length >= 2) {
      const last = history[history.length - 1].w;
      const prev = Math.max(...history.slice(0, -1).map(h => h.w));
      if (last > prev) prs++;
    }
  }
  return prs;
}
function Dashboard({
  profile,
  setTab,
  setCycleDay,
  cycleDay,
  supplementLog = {},
  setSupplementLog = () => {},
  sessionLogs = {},
  uid = null
}) {
  const goal = GOALS.find(g => g.id === profile?.goal);
  const proteinMult = MACRO_GOALS.find(g => g.id === profile?.goal)?.proteinMult || 1.3;
  const protein = Math.round(Number(profile?.weight || 185) * proteinMult);
  const sessionHistory = getDerivedHistory(sessionLogs);
  // cycleDay is the single source of truth — kept in sync by App's useEffect
  const currentDay = cycleDay;
  const sessionData = SESSIONS_DATA[currentDay];
  const isRestDay = CYCLE.find(c => c.day === currentDay)?.rest ?? false;
  const [dayPrompt, setDayPrompt] = useState(null);
  const [selectedDay, setSelectedDay] = useState(cycleDay);
  const [showRecipe, setShowRecipe] = useState(false);

  // Keep the cycle strip's selected day in sync if cycleDay advances
  // (e.g. right after onboarding, or after a session is logged)
  useEffect(() => {
    setSelectedDay(cycleDay);
  }, [cycleDay]);
  const lastSession = sessionHistory[0] || null;
  const gap = lastSession ? daysSince(lastSession.date) : 0;
  const missedDay = gap > 3; // every-other-day schedule means >2 days = missed
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "20px 20px 120px",
      width: "100%",
      boxSizing: "border-box"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: "0.2em",
      color: T.dim,
      marginBottom: 10,
      textTransform: "uppercase"
    }
  }, today.toUpperCase()), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 12,
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 32,
      fontWeight: 800,
      color: T.bright,
      letterSpacing: "-0.03em",
      lineHeight: 1
    }
  }, profile?.name ? `Hey, ${profile.name}` : "Today"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      fontWeight: 700,
      color: T.dim,
      letterSpacing: "0.08em",
      paddingBottom: 2
    }
  }, "CYCLE ", sessionHistory.length > 0 ? Math.ceil(sessionHistory.length / 8) : 1, " · DAY ", currentDay, " OF 16")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 7,
      height: 7,
      borderRadius: "50%",
      flexShrink: 0,
      background: sessionData?.phase === "strength" ? T.crimson : T.steel,
      boxShadow: `0 0 10px ${sessionData?.phase === "strength" ? T.crimson : T.steel}99`
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600,
      letterSpacing: "0.01em",
      color: sessionData?.phase === "strength" ? T.crimson : T.steel
    }
  }, sessionData?.label, " — ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 400,
      color: T.muted
    }
  }, sessionData?.phase === "strength" ? "Strength Phase" : "Hypertrophy Phase")))), lastSession ? /*#__PURE__*/React.createElement(Card, {
    style: {
      marginBottom: 14,
      padding: "12px 16px",
      border: missedDay ? `1px solid ${T.amber}66` : `1px solid ${T.emerald}33`,
      background: missedDay ? T.amberBg : T.emeraldBg
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: missedDay ? T.amber : T.dim,
      fontWeight: 700,
      letterSpacing: "0.06em"
    }
  }, missedDay ? `⚠ ${gap} DAYS SINCE LAST SESSION` : "LAST SESSION"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.bright,
      fontWeight: 600,
      marginTop: 2
    }
  }, lastSession.label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: T.muted,
      marginTop: 1
    }
  }, formatDate(lastSession.date), " · ", gap === 0 ? "today" : gap === 1 ? "yesterday" : `${gap} days ago`)), missedDay && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: T.amber,
      textAlign: "right",
      maxWidth: 130,
      lineHeight: 1.4
    }
  }, "No problem — pick up where you left off. Don't double up."))) : /*#__PURE__*/React.createElement(Card, {
    style: {
      marginBottom: 14,
      padding: "12px 16px",
      border: `1px solid ${T.steel}33`,
      background: T.steelBg
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18
    }
  }, "👋"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: T.steel,
      fontWeight: 700,
      letterSpacing: "0.06em"
    }
  }, "FIRST SESSION"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: T.muted,
      marginTop: 1
    }
  }, "Complete today's session to start your history")))), isRestDay ? /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement(Card, {
    glow: true,
    color: T.violet,
    style: {
      padding: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Tag, {
    text: "REST DAY",
    color: T.violet
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 22,
      fontWeight: 800,
      color: T.bright,
      margin: "8px 0 4px",
      letterSpacing: "-0.01em"
    }
  }, "Recovery Day"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.muted
    }
  }, "Growth happens here. Choose how to use it.")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 36
    }
  }, "😴")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 8,
      marginBottom: 14
    }
  }, [{
    icon: "🚶",
    label: "Active Recovery",
    sub: "15–20 min light cardio",
    color: T.emerald
  }, {
    icon: "🔥",
    label: "Cardio Session",
    sub: "Dedicated workout",
    color: T.amber
  }, {
    icon: "🧠",
    label: "Meditation",
    sub: "Mental recovery",
    color: T.violet
  }, {
    icon: "😴",
    label: "Passive Rest",
    sub: "Full recovery day",
    color: T.steel
  }].map(opt => /*#__PURE__*/React.createElement("div", {
    key: opt.label,
    onClick: () => {
      setCycleDay(currentDay);
      setTab("session");
    },
    style: {
      background: opt.color + "12",
      border: `1px solid ${opt.color}33`,
      borderRadius: 10,
      padding: "12px 10px",
      cursor: "pointer",
      transition: "all 0.15s",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 22,
      marginBottom: 5
    }
  }, opt.icon), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 700,
      color: opt.color,
      marginBottom: 2
    }
  }, opt.label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: T.dim,
      lineHeight: 1.3
    }
  }, opt.sub)))), /*#__PURE__*/React.createElement(Divider, null), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: T.muted
    }
  }, "Next: Day ", currentDay + 1, " — ", SESSIONS_DATA[currentDay + 1]?.label || "Coming up"), /*#__PURE__*/React.createElement(Btn, {
    size: "sm",
    onClick: () => {
      setCycleDay(currentDay);
      setTab("session");
    }
  }, "Choose →")))) : /*#__PURE__*/React.createElement(Card, {
    glow: true,
    color: T.emerald,
    style: {
      marginBottom: 14,
      padding: 20
    },
    onClick: () => {
      setCycleDay(currentDay);
      setTab("session");
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Tag, {
    text: "TODAY'S SESSION",
    color: T.emerald
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 21,
      fontWeight: 700,
      color: T.bright,
      margin: "8px 0 4px"
    }
  }, sessionData?.label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.muted
    }
  }, sessionData?.exercises.length, " exercises · ~", Math.round((sessionData?.exercises.length || 0) * 7), " min · 2–5 min rest"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10,
      display: "flex",
      gap: 6,
      flexWrap: "wrap"
    }
  }, sessionData?.muscles.slice(0, 3).map(m => /*#__PURE__*/React.createElement(Tag, {
    key: m,
    text: m,
    color: getMovementColor([m]),
    xs: true
  })), sessionData?.muscles.length > 3 && /*#__PURE__*/React.createElement(Tag, {
    text: `+${sessionData.muscles.length - 3}`,
    color: T.dim,
    xs: true
  })), sessionData?.notes && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10,
      fontSize: 11,
      color: T.dim,
      lineHeight: 1.5,
      fontStyle: "italic",
      borderLeft: `2px solid ${T.emerald}44`,
      paddingLeft: 8
    }
  }, sessionData.notes)), /*#__PURE__*/React.createElement(IntensityArc, {
    cycleDay: currentDay,
    phase: sessionData?.phase
  })), /*#__PURE__*/React.createElement(Divider, null), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: T.muted
    }
  }, "Next rest: Day ", currentDay + 1), /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    size: "sm",
    onClick: e => {
      e.stopPropagation();
      setCycleDay(currentDay);
      setTab("session");
    }
  }, "Start →"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: 8,
      marginBottom: 14,
      width: "100%"
    }
  }, [{
    l: "Protein",
    v: `${protein}g`,
    sub: "daily floor",
    c: T.emerald
  }, {
    l: "Phase",
    v: goal?.label,
    sub: "current goal",
    c: goal?.color || T.steel
  }, {
    l: "Day",
    v: `${currentDay} / 16`,
    sub: "cycle progress",
    c: T.steel
  }].map(s => /*#__PURE__*/React.createElement(Card, {
    key: s.l,
    style: {
      padding: "12px 10px",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 19,
      fontWeight: 700,
      color: s.c
    }
  }, s.v), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: T.dim,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      marginTop: 2
    }
  }, s.l), s.sub && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 8,
      color: T.dim,
      opacity: 0.7,
      marginTop: 1
    }
  }, s.sub)))), /*#__PURE__*/React.createElement(Card, {
    style: {
      marginBottom: 14,
      padding: 14
    }
  }, /*#__PURE__*/React.createElement(Label, null, "16-Day Cycle"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 3,
      overflowX: "auto",
      paddingBottom: 2,
      width: "100%",
      minWidth: 0
    }
  }, CYCLE.map(c => {
    const isDone = c.day < currentDay;
    const isToday = c.day === currentDay;
    const isNext = c.day === currentDay + 1; // immediate next session
    const isSel = c.day === selectedDay;
    const sesh = SESSIONS_DATA[c.day];
    const phaseColor = sesh?.phase === "strength" ? T.crimson : T.steel;
    const selColor = c.rest ? T.violet : phaseColor;
    // Next session = amber callout
    const nextColor = T.amber;
    const baseColor = isToday ? T.emerald : isSel ? selColor : isNext ? nextColor : isDone && !c.rest ? T.emerald + "88" : T.dim;
    return /*#__PURE__*/React.createElement("div", {
      key: c.day,
      onClick: () => {
        setSelectedDay(c.day);
        const seshData = SESSIONS_DATA[c.day];
        setDayPrompt({
          day: c.day,
          rest: c.rest,
          label: c.rest ? "Rest Day" : seshData?.label,
          phase: seshData?.phase,
          done: c.day < currentDay,
          isToday: c.day === currentDay
        });
      },
      style: {
        flexShrink: 0,
        width: 34,
        borderRadius: 6,
        cursor: "pointer",
        padding: "6px 0",
        textAlign: "center",
        transition: "background 0.1s, border-color 0.1s, transform 0.1s, box-shadow 0.1s",
        background: isToday ? T.emerald + "22" : isSel ? selColor + "22" : isNext ? nextColor + "18" : isDone && !c.rest ? T.emeraldBg : T.surface,
        border: `1px solid ${isToday ? T.emerald : isSel ? selColor : isNext ? nextColor : isDone && !c.rest ? T.emerald + "44" : T.border}`,
        boxShadow: isSel && !isToday ? `0 0 10px ${selColor}44` : "none",
        transform: isSel ? "scale(1.08)" : "scale(1)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9,
        fontWeight: isSel || isToday || isNext ? 800 : 400,
        color: baseColor
      }
    }, c.day), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 7,
        color: baseColor,
        marginTop: 1,
        lineHeight: 1.2,
        padding: "0 2px"
      }
    }, c.rest ? "REST" : sesh?.label.split(" ")[0] || ""), (isToday || isSel || isNext) && /*#__PURE__*/React.createElement("div", {
      style: {
        width: 4,
        height: 4,
        borderRadius: "50%",
        background: isToday ? T.emerald : isNext && !isSel ? nextColor : selColor,
        margin: "2px auto 0"
      }
    }));
  }))), /*#__PURE__*/React.createElement(Card, {
    style: {
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: T.accent,
      letterSpacing: "0.1em",
      marginBottom: 2
    }
  }, "RECOVERY"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: T.muted
    }
  }, isRestDay ? "Rest day — pick your recovery activity" : "Optional recovery alongside training")), isRestDay && /*#__PURE__*/React.createElement("div", {
    style: {
      width: 8,
      height: 8,
      borderRadius: "50%",
      background: T.violet,
      boxShadow: `0 0 10px ${T.violet}88`,
      animation: "pulse 2s infinite"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      overflowX: "auto",
      paddingBottom: 2,
      width: "100%"
    }
  }, [{
    icon: "🚶",
    label: "Cardio",
    color: T.amber
  }, {
    icon: "🧠",
    label: "Meditation",
    color: T.violet
  }, {
    icon: "🧘",
    label: "Mobility",
    color: T.steel
  }, {
    icon: "😴",
    label: "Passive",
    color: T.dim
  }].map(opt => /*#__PURE__*/React.createElement("button", {
    key: opt.label,
    onClick: () => {
      const restDayNum = CYCLE.find(c => c.rest && c.day >= currentDay)?.day || currentDay;
      setCycleDay(isRestDay ? currentDay : restDayNum);
      setTab("session");
    },
    style: {
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 4,
      padding: "10px 14px",
      background: opt.color + "12",
      border: `1px solid ${opt.color}33`,
      borderRadius: 10,
      cursor: "pointer",
      minWidth: 64
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 20
    }
  }, opt.icon), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      fontWeight: 700,
      color: opt.color
    }
  }, opt.label)))), !isRestDay && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: T.dim,
      marginTop: 8,
      lineHeight: 1.4
    }
  }, "Daily walking + optional cardio supported any day. Tap to log.")), (() => {
    const hour = new Date().getHours();
    const isAM = hour < 14;
    const suppColor = isAM ? T.accent : T.steel;
    const suppLabel = isAM ? "AM Supplements" : "PM Supplements";
    const suppItems = isAM ? "Creatine · D3 · K2 · Zinc · Boron · Royal Jelly · Bee Pollen · Bamboo" : "Magnesium · Fish Oil · Zinc · Glycine · Melatonin";
    const suppTime = isAM ? "Take with breakfast" : "Take 30–60 min before sleep";
    const todayKey = new Date().toISOString().slice(0, 10);
    const todayLog = supplementLog[todayKey] || {
      am: false,
      pm: false
    };
    const isDone = isAM ? todayLog.am : todayLog.pm;
    return /*#__PURE__*/React.createElement(Card, {
      style: {
        marginBottom: 8,
        background: isDone ? T.emeraldBg : T.card,
        border: `1px solid ${isDone ? T.emerald + "44" : T.border}`
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 7,
        marginBottom: 3
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: isDone ? T.emerald : suppColor,
        boxShadow: isDone ? `0 0 6px ${T.emerald}88` : "none"
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        fontWeight: 700,
        color: isDone ? T.emerald : T.bright
      }
    }, suppLabel), !isDone && /*#__PURE__*/React.createElement(Tag, {
      text: isAM ? "NOW" : "TONIGHT",
      color: suppColor,
      xs: true
    }), isDone && /*#__PURE__*/React.createElement(Tag, {
      text: "DONE ✓",
      color: T.emerald,
      xs: true
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: T.muted,
        marginBottom: 2
      }
    }, suppItems), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: T.dim
      }
    }, suppTime)), !isDone ? /*#__PURE__*/React.createElement(Btn, {
      variant: "ghost",
      size: "sm",
      onClick: () => {
        const key = isAM ? "am" : "pm";
        const entry = {
          ...(supplementLog[todayKey] || {}),
          [key]: true
        };
        setSupplementLog(prev => ({
          ...prev,
          [todayKey]: entry
        }));
        if (uid) fsSet(uid, "supplementLog", todayKey, entry);
      }
    }, "✓ Done") : /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        const key = isAM ? "am" : "pm";
        const entry = {
          ...(supplementLog[todayKey] || {}),
          [key]: false
        };
        setSupplementLog(prev => ({
          ...prev,
          [todayKey]: entry
        }));
        if (uid) fsSet(uid, "supplementLog", todayKey, entry);
      },
      style: {
        background: "none",
        border: "none",
        color: T.dim,
        fontSize: 11,
        cursor: "pointer",
        padding: "4px 6px"
      }
    }, "undo")));
  })(), /*#__PURE__*/React.createElement(Card, {
    style: {
      background: T.violet + "0E",
      border: `1px solid ${T.violet}33`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 700,
      color: T.violet,
      marginBottom: 2
    }
  }, "🌿 Anti-Inflammatory Drink"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: T.muted
    }
  }, "First + last thing every day · Daily Protocol")), /*#__PURE__*/React.createElement(Btn, {
    variant: "ghost",
    size: "sm",
    onClick: () => setShowRecipe(true)
  }, "Recipe"))), dayPrompt && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      background: "#000000CC",
      zIndex: 50,
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "center"
    },
    onClick: () => setDayPrompt(null)
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      background: T.surface,
      borderRadius: "16px 16px 0 0",
      width: "100%",
      maxWidth: 480,
      padding: "24px 20px 32px",
      border: `1px solid ${T.border}`,
      borderBottom: "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.12em",
      color: dayPrompt.isToday ? T.emerald : dayPrompt.done ? T.emerald : dayPrompt.rest ? T.steel : T.muted,
      marginBottom: 4
    }
  }, dayPrompt.isToday ? "TODAY · " : dayPrompt.done ? "COMPLETED · " : "UPCOMING · ", "DAY ", dayPrompt.day, " OF 16"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 20,
      fontWeight: 700,
      color: T.bright
    }
  }, dayPrompt.label), dayPrompt.phase && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: T.muted,
      marginTop: 2
    }
  }, dayPrompt.phase === "strength" ? "Strength Phase" : "Hypertrophy Phase")), /*#__PURE__*/React.createElement("button", {
    onClick: () => setDayPrompt(null),
    style: {
      background: "none",
      border: "none",
      color: T.dim,
      fontSize: 20,
      cursor: "pointer",
      padding: 0
    }
  }, "✕")), dayPrompt.done && !dayPrompt.rest && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "10px 14px",
      background: T.emeraldBg,
      border: `1px solid ${T.emerald}33`,
      borderRadius: 8,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      fontWeight: 700,
      color: T.emerald,
      letterSpacing: "0.08em",
      marginBottom: 4
    }
  }, "PREVIOUS SESSION"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.text
    }
  }, sessionHistory.find(h => h.cycleDay === dayPrompt.day) ? `${sessionHistory.find(h => h.cycleDay === dayPrompt.day).exercises} exercises logged · ${formatDate(sessionHistory.find(h => h.cycleDay === dayPrompt.day).date)}` : "Session was completed this cycle.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, dayPrompt.rest ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Btn, {
    style: {
      width: "100%"
    },
    onClick: () => {
      setCycleDay(dayPrompt.day);
      setTab("session");
      setDayPrompt(null);
    }
  }, dayPrompt.done ? "View Rest Day Log" : "Go to Rest Day →")) : /*#__PURE__*/React.createElement(React.Fragment, null, dayPrompt.done && /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    style: {
      width: "100%"
    },
    onClick: () => {
      setCycleDay(dayPrompt.day);
      setTab("session");
      setDayPrompt(null);
    }
  }, "📋 View Previous Session"), /*#__PURE__*/React.createElement(Btn, {
    style: {
      width: "100%"
    },
    onClick: () => {
      setCycleDay(dayPrompt.day);
      setTab("session");
      setDayPrompt(null);
    }
  }, dayPrompt.isToday ? "🏋️ Start Today's Session →" : dayPrompt.done ? "🔁 Redo This Session" : "🏋️ Go to This Session →")), /*#__PURE__*/React.createElement("button", {
    onClick: () => setDayPrompt(null),
    style: {
      background: "none",
      border: "none",
      color: T.dim,
      fontSize: 13,
      cursor: "pointer",
      padding: "8px 0"
    }
  }, "Cancel")))), showRecipe && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      background: "#000000DD",
      zIndex: 50,
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "center"
    },
    onClick: () => setShowRecipe(false)
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      background: T.surface,
      borderRadius: "16px 16px 0 0",
      width: "100%",
      maxWidth: 480,
      padding: "24px 20px 36px",
      border: `1px solid ${T.violet}44`,
      borderBottom: "none",
      maxHeight: "85vh",
      overflowY: "auto"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: T.violet,
      fontWeight: 700,
      letterSpacing: "0.12em",
      marginBottom: 3
    }
  }, "DAILY PROTOCOL"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 20,
      fontWeight: 800,
      color: T.bright,
      letterSpacing: "-0.01em"
    }
  }, "🌿 Anti-Inflammatory Drink")), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowRecipe(false),
    style: {
      background: "none",
      border: "none",
      color: T.dim,
      fontSize: 20,
      cursor: "pointer"
    }
  }, "✕")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "10px 14px",
      background: T.violet + "12",
      borderRadius: 8,
      marginBottom: 16,
      fontSize: 12,
      color: T.text,
      lineHeight: 1.6
    }
  }, "First and last thing every day. Non-negotiable for recovery and gut health. Reduces systemic inflammation, supports digestion, and improves nutrient absorption — all critical for recovery."), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: T.dim,
      letterSpacing: "0.1em",
      marginBottom: 10
    }
  }, "INGREDIENTS — MAKES 1–2 GALLONS"), [{
    item: "Fresh ginger",
    amount: "10–15 pieces (1 inch each)"
  }, {
    item: "Fresh turmeric",
    amount: "10–15 pieces (1 inch each)"
  }, {
    item: "Garlic",
    amount: "2 full bulbs"
  }, {
    item: "Cardamom pods",
    amount: "20–30 pods"
  }, {
    item: "Black pepper",
    amount: "3 tablespoons"
  }, {
    item: "Lemons",
    amount: "4 lemons, quartered"
  }, {
    item: "Water",
    amount: "Fill the pot as full as possible"
  }].map((ing, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "8px 0",
      borderBottom: i < 6 ? `1px solid ${T.border}` : "none"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: T.bright
    }
  }, ing.item), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: T.muted
    }
  }, ing.amount))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: T.dim,
      letterSpacing: "0.1em",
      margin: "16px 0 10px"
    }
  }, "INSTRUCTIONS"), ["Add all ingredients to a large pot.", "Fill with water as much as possible without boiling over.", "Bring to a full boil, then boil for 40 minutes.", "Let cool completely, then strain and store in the fridge.", "Keeps for up to 1 week refrigerated."].map((step, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      gap: 10,
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 22,
      height: 22,
      borderRadius: "50%",
      background: T.violet + "22",
      border: `1px solid ${T.violet}44`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 10,
      fontWeight: 700,
      color: T.violet,
      flexShrink: 0
    }
  }, i + 1), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.text,
      lineHeight: 1.5
    }
  }, step))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16,
      padding: "12px 14px",
      background: T.violetBg,
      border: `1px solid ${T.violet}44`,
      borderRadius: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: T.violet,
      marginBottom: 8
    }
  }, "DAILY SERVING — MORNING + NIGHT"), ["6 oz of the brewed drink", "1 oz 100% grapefruit juice", "1 serving apple cider vinegar", "1 serving psyllium husk", "Mix and drink immediately"].map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      gap: 8,
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: T.violet
    }
  }, "·"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: T.text
    }
  }, s)))))));
}

// ── SESSION SCREEN ────────────────────────────────────
// Mock previous lift history — keyed by exercise id, then set index
// In production this comes from the database
// PREV_LIFTS is now computed live from sessionLogs — see getPrevLifts(sessionLogs)

// ── REST DAY SCREEN ───────────────────────────────────

// ── PR FLASH ─────────────────────────────────────────
function PRFlash({
  lift,
  weight,
  onDone
}) {
  useEffect(() => {
    const t = setTimeout(onDone, 2800);
    return () => clearTimeout(t);
  }, [onDone]);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 100,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      pointerEvents: "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      animation: "prPulse 0.4s cubic-bezier(0.34,1.56,0.64,1)"
    }
  }, /*#__PURE__*/React.createElement("style", null, `@keyframes prPulse{0%{transform:scale(0.5);opacity:0}60%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}`), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 64,
      marginBottom: 8
    }
  }, "🏆"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 28,
      fontWeight: 800,
      color: T.gold,
      letterSpacing: "-0.02em",
      textShadow: `0 0 40px ${T.gold}`
    }
  }, "NEW PR!"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 16,
      color: T.bright,
      marginTop: 6,
      fontWeight: 700
    }
  }, weight, " lbs — ", lift), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: T.gold,
      marginTop: 4
    }
  }, "Personal Record Achieved")));
}
const RestDayScreen = ({
  cycleDay
}) => {
  const [mode, setMode] = useState(null); // null | "passive" | "active" | "cardio"
  const [cardioType, setCardioType] = useState(null);
  const [cardioLog, setCardioLog] = useState({
    duration: "",
    notes: ""
  });
  const [logged, setLogged] = useState(false);
  const prevTraining = cycleDay > 1 ? cycleDay - 1 : null;
  const nextTraining = cycleDay < 16 ? cycleDay + 1 : 1;
  const prevSession = SESSIONS_DATA[prevTraining];
  const nextSession = SESSIONS_DATA[nextTraining];
  const CARDIO_OPTIONS = [{
    id: "incline",
    label: "Incline Treadmill",
    icon: "🚶",
    protocol: "2.8–3.2 mph · 10–15% incline · 15 min",
    why: "Low-impact, high-efficiency. Elevates heart rate without CNS stress."
  }, {
    id: "elliptical",
    label: "Elliptical",
    icon: "🔄",
    protocol: "Moderate resistance · conversational pace · 15 min",
    why: "Zero impact. Good for active recovery when legs are sore from Day 1."
  }, {
    id: "bike",
    label: "Stationary Bike",
    icon: "🚴",
    protocol: "Low resistance · 60–70 RPM · 20 min",
    why: "Drives blood flow to legs without taxing quads or hamstrings."
  }, {
    id: "walk",
    label: "Outdoor Walk",
    icon: "🌳",
    protocol: "30–45 min · any pace · bonus sunlight",
    why: "30–45 min daily walking is non-negotiable. Light activity that compounds over time."
  }, {
    id: "swim",
    label: "Swimming",
    icon: "🏊",
    protocol: "Easy technique work · 20–30 min",
    why: "Full body low-impact recovery. Excellent if joints are inflamed."
  }, {
    id: "yoga",
    label: "Mobility / Yoga",
    icon: "🧘",
    protocol: "10–20 min · focus on session muscles",
    why: "Improves range of motion for the next strength session."
  }, {
    id: "custom",
    label: "Custom Cardio",
    icon: "✏️",
    protocol: "You define it",
    why: "Any activity not listed. Name it, log the duration and notes."
  }];
  const [customCardioName, setCustomCardioName] = useState("");
  if (logged) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "40px 20px",
        textAlign: "center"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 40,
        marginBottom: 12
      }
    }, "✅"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 18,
        fontWeight: 700,
        color: T.emerald,
        marginBottom: 6
      }
    }, "Rest Day Logged"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        color: T.muted,
        marginBottom: 24
      }
    }, cardioType ? `${cardioLog.duration} min ${CARDIO_OPTIONS.find(c => c.id === cardioType)?.label}` : "Passive rest logged."), /*#__PURE__*/React.createElement(Card, {
      style: {
        textAlign: "left"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: T.dim,
        fontWeight: 700,
        marginBottom: 6
      }
    }, "NEXT UP"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 14,
        fontWeight: 700,
        color: T.bright
      }
    }, "Day ", nextTraining, " — ", nextSession?.label), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: T.muted,
        marginTop: 2
      }
    }, nextSession?.phase === "strength" ? "Strength phase" : "Hypertrophy phase")));
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "20px 20px 120px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.12em",
      color: T.dim,
      marginBottom: 4
    }
  }, "DAY ", cycleDay, " OF 16"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 24,
      fontWeight: 700,
      color: T.bright,
      margin: "4px 0 2px"
    }
  }, "Rest Day"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.muted
    }
  }, "Growth happens here — not in the gym. Choose how to spend this day.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginBottom: 20
    }
  }, prevSession && /*#__PURE__*/React.createElement(Card, {
    style: {
      flex: 1,
      padding: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: T.dim,
      letterSpacing: "0.06em",
      marginBottom: 3
    }
  }, "CAME FROM"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      color: T.text
    }
  }, "Day ", prevTraining), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: T.muted
    }
  }, prevSession.label)), nextSession && /*#__PURE__*/React.createElement(Card, {
    style: {
      flex: 1,
      padding: 12,
      background: T.goldBg,
      border: `1px solid ${T.goldDim}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: T.emerald,
      letterSpacing: "0.06em",
      marginBottom: 3
    }
  }, "NEXT UP"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      color: T.bright
    }
  }, "Day ", nextTraining), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: T.emerald
    }
  }, nextSession.label))), !mode && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Label, null, "How do you want to use today?"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, [{
    id: "passive",
    icon: "😴",
    label: "Passive Rest",
    sub: "No training. Full recovery. Best if soreness is high or sleep was poor.",
    color: T.steel
  }, {
    id: "active",
    icon: "🚶",
    label: "Active Recovery",
    sub: "Light cardio only. 15–20 min low-impact. Improves blood flow without taxing the CNS.",
    color: T.emerald
  }, {
    id: "cardio",
    icon: "🔥",
    label: "Cardio Session",
    sub: "Dedicated cardio work. Aim for 15 min 3–4×/week. Pick your modality.",
    color: T.amber
  }, {
    id: "meditation",
    icon: "🧠",
    label: "Meditation",
    sub: "Mental recovery. Reduces cortisol, improves sleep architecture, and sharpens focus.",
    color: T.violet
  }].map(opt => /*#__PURE__*/React.createElement("div", {
    key: opt.id,
    onClick: () => setMode(opt.id),
    style: {
      background: T.card,
      border: `1px solid ${opt.color}33`,
      borderRadius: 12,
      padding: "16px 18px",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      gap: 14,
      transition: "all 0.15s"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 28
    }
  }, opt.icon), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      fontSize: 14,
      color: T.bright,
      marginBottom: 3
    }
  }, opt.label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: T.muted,
      lineHeight: 1.5
    }
  }, opt.sub)))))), mode === "passive" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    onClick: () => setMode(null),
    style: {
      background: "none",
      border: "none",
      color: T.muted,
      fontSize: 12,
      cursor: "pointer",
      marginBottom: 16,
      padding: 0
    }
  }, "← Back"), /*#__PURE__*/React.createElement(Card, {
    style: {
      background: T.steelBg,
      border: `1px solid ${T.steel}33`,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 700,
      color: T.steel,
      marginBottom: 8
    }
  }, "Passive Rest Checklist"), ["Hit your protein floor — muscle is built during rest, not just during training", "AM + PM supplements — especially magnesium glycinate for sleep quality", "Anti-inflammatory drink (morning and night)", "Hydrate — 2–3L water minimum", "Sleep 7–9 hours — this is when GH is released"].map((item, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      gap: 10,
      padding: "6px 0",
      borderBottom: i < 4 ? `1px solid ${T.border}` : "none",
      alignItems: "flex-start"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 16,
      height: 16,
      borderRadius: "50%",
      flexShrink: 0,
      background: T.steel + "22",
      border: `1px solid ${T.steel}44`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 8,
      color: T.steel,
      marginTop: 1
    }
  }, "✓"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.text,
      lineHeight: 1.5
    }
  }, item)))), /*#__PURE__*/React.createElement(Btn, {
    style: {
      width: "100%"
    },
    onClick: () => setLogged(true)
  }, "Log Passive Rest Day")), (mode === "active" || mode === "cardio") && !cardioType && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    onClick: () => setMode(null),
    style: {
      background: "none",
      border: "none",
      color: T.muted,
      fontSize: 12,
      cursor: "pointer",
      marginBottom: 16,
      padding: 0
    }
  }, "← Back"), /*#__PURE__*/React.createElement(Label, null, mode === "active" ? "Active Recovery — Pick Modality" : "Cardio — Pick Modality"), CARDIO_OPTIONS.map(opt => /*#__PURE__*/React.createElement("div", {
    key: opt.id,
    onClick: () => setCardioType(opt.id),
    style: {
      background: T.card,
      border: `1px solid ${T.border}`,
      borderRadius: 10,
      padding: "13px 14px",
      marginBottom: 8,
      cursor: "pointer",
      transition: "border-color 0.15s"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      marginBottom: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 20
    }
  }, opt.icon), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      fontSize: 14,
      color: T.bright
    }
  }, opt.label)), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "6px 10px",
      background: T.goldBg,
      borderRadius: 6,
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: T.emerald,
      fontWeight: 700,
      marginBottom: 1
    }
  }, "PROTOCOL"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: T.text
    }
  }, opt.protocol)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: T.muted,
      lineHeight: 1.5
    }
  }, opt.why)))), (mode === "active" || mode === "cardio") && cardioType && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    onClick: () => setCardioType(null),
    style: {
      background: "none",
      border: "none",
      color: T.muted,
      fontSize: 12,
      cursor: "pointer",
      marginBottom: 16,
      padding: 0
    }
  }, "← Back"), (() => {
    const sel = CARDIO_OPTIONS.find(c => c.id === cardioType);
    return /*#__PURE__*/React.createElement(Card, {
      glow: true,
      style: {
        marginBottom: 14
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 10
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 24
      }
    }, sel.icon), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 16,
        fontWeight: 700,
        color: T.bright
      }
    }, sel.label), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: T.steel
      }
    }, sel.protocol))), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "8px 12px",
        background: T.steelBg,
        borderRadius: 6,
        marginBottom: 14,
        fontSize: 12,
        color: T.text,
        lineHeight: 1.6
      }
    }, sel.why), /*#__PURE__*/React.createElement(Label, null, "Duration (minutes)"), /*#__PURE__*/React.createElement("input", {
      type: "number",
      placeholder: "15",
      value: cardioLog.duration,
      onChange: e => setCardioLog(p => ({
        ...p,
        duration: e.target.value
      })),
      style: {
        width: "100%",
        background: T.surface,
        border: `1px solid ${cardioLog.duration ? T.emerald : T.border}`,
        borderRadius: 7,
        padding: "10px 12px",
        color: T.bright,
        fontSize: 16,
        fontWeight: 700,
        outline: "none",
        fontFamily: "inherit",
        boxSizing: "border-box",
        marginBottom: 10,
        textAlign: "center"
      }
    }), /*#__PURE__*/React.createElement(Label, null, "Notes (optional)"), /*#__PURE__*/React.createElement("input", {
      placeholder: "e.g. Felt great, kept HR around 130",
      value: cardioLog.notes,
      onChange: e => setCardioLog(p => ({
        ...p,
        notes: e.target.value
      })),
      style: {
        width: "100%",
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 7,
        padding: "10px 12px",
        color: T.bright,
        fontSize: 13,
        outline: "none",
        fontFamily: "inherit",
        boxSizing: "border-box",
        marginBottom: 14
      }
    }), /*#__PURE__*/React.createElement(Btn, {
      style: {
        width: "100%"
      },
      disabled: !cardioLog.duration,
      onClick: () => setLogged(true)
    }, "Log ", sel.label, " — ", cardioLog.duration || "?", " min"));
  })()), mode === "meditation" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    onClick: () => setMode(null),
    style: {
      background: "none",
      border: "none",
      color: T.muted,
      fontSize: 12,
      cursor: "pointer",
      marginBottom: 16,
      padding: 0
    }
  }, "← Back"), /*#__PURE__*/React.createElement(Card, {
    style: {
      background: T.violet + "12",
      border: `1px solid ${T.violet}33`,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      color: T.violet,
      marginBottom: 6
    }
  }, "🧠 Meditation"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.text,
      lineHeight: 1.7,
      marginBottom: 12
    }
  }, "Cortisol is a testosterone antagonist. Elevated chronic stress suppresses testosterone synthesis and blunts recovery. Meditation is not optional for serious athletes — it is a recovery tool."), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: T.violet,
      letterSpacing: "0.08em",
      marginBottom: 8
    }
  }, "EVIDENCE-BASED BENEFITS"), ["Reduces cortisol — directly improves testosterone environment", "Improves slow-wave sleep architecture — where GH is released", "Sharpens mind-muscle connection and session focus", "Reduces systemic inflammation markers"].map((b, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      gap: 8,
      padding: "5px 0",
      borderBottom: i < 3 ? `1px solid ${T.border}` : "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: T.violet,
      fontSize: 12,
      flexShrink: 0
    }
  }, "✓"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: T.text
    }
  }, b)))), /*#__PURE__*/React.createElement(Label, null, "Choose a Session"), [{
    mins: 5,
    title: "5-Min Focus Reset",
    desc: "Box breathing + body scan. Perfect before a training session or after a stressful day.",
    steps: ["Sit comfortably. Close your eyes.", "Breathe in 4s → Hold 4s → Out 4s → Hold 4s. Repeat 4 times.", "Scan from head to feet. Release tension in each area.", "Set one intention for the next training session."]
  }, {
    mins: 10,
    title: "10-Min Recovery",
    desc: "Progressive muscle relaxation. Best post-training or before sleep.",
    steps: ["Lie down. Close your eyes.", "Tense each muscle group for 5s then release. Start at feet.", "Work up through calves, quads, glutes, abs, chest, shoulders, hands.", "Finish with 10 slow breaths. Feel weight sink into the floor."]
  }, {
    mins: 20,
    title: "20-Min Deep Recovery",
    desc: "Full mindfulness session. Ideal on deload week or high-stress days.",
    steps: ["Sit or lie in a quiet space.", "Focus on breath only. When thoughts arise, note them and return to breath.", "At 10 min, shift focus to body sensations without judgment.", "Final 5 min: visualize next cycle's performance — hitting PRs, perfect form."]
  }].map((s, i) => /*#__PURE__*/React.createElement(MeditationCard, {
    key: i,
    session: s,
    onComplete: () => setLogged(true)
  }))), (mode === "active" || mode === "cardio") && cardioType === "custom" && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "0 0 12px"
    }
  }, /*#__PURE__*/React.createElement(Label, null, "What are you doing?"), /*#__PURE__*/React.createElement("input", {
    placeholder: "e.g. Jump rope, rowing machine, basketball...",
    value: customCardioName,
    onChange: e => setCustomCardioName(e.target.value),
    style: {
      width: "100%",
      background: T.surface,
      border: `1px solid ${customCardioName ? T.emerald : T.border}`,
      borderRadius: 7,
      padding: "10px 12px",
      color: T.bright,
      fontSize: 13,
      outline: "none",
      fontFamily: "inherit",
      boxSizing: "border-box"
    }
  })), !mode && /*#__PURE__*/React.createElement(Card, {
    style: {
      marginTop: 16,
      background: T.goldBg,
      border: `1px solid ${T.goldDim}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: T.violet,
      marginBottom: 5
    }
  }, "WHY REST DAYS MATTER"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.text,
      lineHeight: 1.7
    }
  }, "Muscle protein synthesis peaks 24–48 hours post-training — meaning your muscles are literally growing right now. The CNS takes 48–72 hours to fully recover from a maximal strength session. Training again before recovery is complete means lower output and higher injury risk. This rest day is not optional — it is when the work from yesterday pays off.")));
};
function Session({
  profile,
  cycleDay,
  setTab = () => {},
  uid = null,
  savedTemplates = {},
  setSavedTemplates = () => {},
  customWorkouts = [],
  setCustomWorkouts = () => {},
  sessionLogs = {},
  setSessionLogs = () => {}
}) {
  const sessionKey = cycleDay;
  const sessionMeta = SESSIONS_DATA[sessionKey];
  const phase = sessionMeta?.phase || "strength";

  // ── WORKOUT PICKER ────────────────────────────────
  // "picker" = choosing which workout to run
  // "building" = actively in session
  // "done" = session completed
  const [sessionState, setSessionState] = useState("picker"); // picker | building | done
  const [chosenWorkout, setChosenWorkout] = useState(null); // null = not chosen yet
  const [savePrompt, setSavePrompt] = useState(false); // show save-as-template prompt
  const [showBuilder, setShowBuilder] = useState(false); // custom workout builder
  const [newWorkoutName, setNewWorkoutName] = useState("");
  const [builderExercises, setBuilderExercises] = useState([]);
  const [builderSearch, setBuilderSearch] = useState("");
  const [saveTemplateName, setSaveTemplateName] = useState("");
  const [editingWorkout, setEditingWorkout] = useState(null); // cw.id being edited
  const [editName, setEditName] = useState("");
  const [editExercises, setEditExercises] = useState([]);
  const [editSearch, setEditSearch] = useState("");

  // Has a custom template been saved for this cycle day?
  const hasSavedTemplate = !!savedTemplates[cycleDay];
  const savedTemplate = savedTemplates[cycleDay];

  // Build exercise list from a source
  function buildExercisesFrom(source) {
    const equip = profile?.equipment || "full";
    const ids = Array.isArray(source) ? source : source.exercises || [];
    const ph = source.phase || phase;
    return ids.map(item => {
      // item can be a plain ID string OR an object {id, sets, reps, note}
      const id = typeof item === "string" ? item : item.id;
      const overrides = typeof item === "object" ? item : {};
      const mv = LIBRARY.find(m => m.id === id);
      if (!mv) return null;
      const plan = getRepsForFiber(mv.fiber, ph);
      return {
        ...mv,
        ...plan,
        swapped: false,
        completed: false,
        // Custom overrides from saved workout take precedence over defaults
        ...(overrides.sets && {
          sets: overrides.sets
        }),
        ...(overrides.reps && {
          reps: overrides.reps
        }),
        ...(overrides.note && {
          note: overrides.note
        })
      };
    }).filter(Boolean).filter(ex => !ex.equipment || ex.equipment.includes(equip) || ex.equipment.includes("full"));
  }
  const [exercises, setExercises] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const dragTouchY = React.useRef(null);
  const [mode, setMode] = useState(null);
  const [targetIdx, setTargetIdx] = useState(null);
  const [search, setSearch] = useState("");
  const [fiberFilter, setFiberFilter] = useState("ALL");
  const [patternFilter, setPatternFilter] = useState("ALL");
  const [levelFilter, setLevelFilter] = useState("ALL");
  const [muscleFilter, setMuscleFilter] = useState("ALL");
  const [showAllEquipment, setShowAllEquipment] = useState(false);
  const [logs, setLogs] = useState({}); // key: `${exIdx}-${setIdx}-w/r/rir`
  const [lockedSets, setLockedSets] = useState({}); // key: `${exIdx}-${setIdx}` → true when set is done
  const [activeSet, setActiveSet] = useState({}); // key: exIdx → active set index
  const [setCount, setSetCount] = useState({}); // key: exIdx → total sets (allows adding)
  // pending: after timer fires, open this set
  const [pendingAdvance, setPendingAdvance] = useState(null); // {exIdx, setIdx}

  // ── REST TIMER ──────────────────────────────────────
  const [timerActive, setTimerActive] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerTotal, setTimerTotal] = useState(0);
  const [timerLabel, setTimerLabel] = useState("");
  useEffect(() => {
    if (!timerActive || timerSeconds <= 0) {
      if (timerActive && timerSeconds <= 0) {
        setTimerActive(false);
        playChime();
        // Auto-advance to the next set after timer finishes
        if (pendingAdvance !== null) {
          const {
            exIdx,
            setIdx
          } = pendingAdvance;
          setActiveSet(prev => ({
            ...prev,
            [exIdx]: setIdx
          }));
          setExpanded(exIdx);
          setPendingAdvance(null);
        }
      }
      return;
    }
    const id = setTimeout(() => setTimerSeconds(s => s - 1), 1000);
    return () => clearTimeout(id);
  }, [timerActive, timerSeconds, pendingAdvance]);
  function playChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [523, 659, 784].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.35, ctx.currentTime + i * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.5);
        osc.start(ctx.currentTime + i * 0.18);
        osc.stop(ctx.currentTime + i * 0.18 + 0.6);
      });
    } catch (e) {}
  }
  function startTimer(seconds, label) {
    setTimerSeconds(seconds);
    setTimerTotal(seconds);
    setTimerLabel(label);
    setTimerActive(true);
  }
  function getRestSeconds(ex) {
    if (phase === "strength") {
      return ex.fiber === "slow" ? 90 : 180; // 1.5 min slow, 3 min fast/mixed
    }
    return ex.fiber === "slow" ? 60 : 90;
  }
  function fmtTime(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }
  const timerPct = timerTotal > 0 ? timerSeconds / timerTotal * 100 : 0;
  const timerColor = timerSeconds <= 5 ? T.crimson : timerSeconds <= 15 ? T.amber : T.emerald;
  const [timerEditMode, setTimerEditMode] = useState(false);
  const [timerEditVal, setTimerEditVal] = useState("");
  const done = exercises.filter(e => e.completed).length;
  const pct = exercises.length ? Math.round(done / exercises.length * 100) : 0;
  const filteredLib = useMemo(() => {
    let list = mode === "add" && showAllEquipment ? LIBRARY : LIBRARY.filter(m => m.equipment.includes(profile?.equipment || "full"));
    if (mode === "swap" && targetIdx !== null) {
      const tgt = exercises[targetIdx];
      list = list.filter(m => m.muscles.some(mu => tgt?.muscles.includes(mu)));
    }
    // "add" mode used to hard-filter to today's session muscles only — that
    // blocked adding any movement outside today's target muscles entirely.
    // Now: full library is available, sorted with today's-muscle matches first.
    if (fiberFilter !== "ALL") list = list.filter(m => m.fiber === fiberFilter);
    if (patternFilter !== "ALL") list = list.filter(m => m.pattern === patternFilter);
    if (levelFilter !== "ALL") list = list.filter(m => String(m.level || 1) === levelFilter);
    if (muscleFilter !== "ALL") list = list.filter(m => m.muscles.includes(muscleFilter));
    if (search) list = list.filter(m => m.name.toLowerCase().includes(search.toLowerCase()) || m.muscles.some(mu => mu.toLowerCase().includes(search.toLowerCase())));
    if (mode === "add" && sessionMeta?.muscles) {
      list = [...list].sort((a, b) => {
        const aMatch = a.muscles.some(mu => sessionMeta.muscles.includes(mu)) ? 0 : 1;
        const bMatch = b.muscles.some(mu => sessionMeta.muscles.includes(mu)) ? 0 : 1;
        return aMatch - bMatch;
      });
    }
    return list;
  }, [mode, targetIdx, exercises, sessionMeta, fiberFilter, muscleFilter, patternFilter, levelFilter, search, profile, showAllEquipment]);
  function selectMovement(mv) {
    const plan = getRepsForFiber(mv.fiber, phase);
    const newEx = {
      ...mv,
      ...plan,
      swapped: mode === "swap",
      completed: false
    };
    if (mode === "swap") {
      const upd = [...exercises];
      upd[targetIdx] = newEx;
      setExercises(upd);
    } else {
      setExercises(prev => [...prev, newEx]);
    }
    setMode(null);
    setTargetIdx(null);
    setSearch("");
    setFiberFilter("ALL");
  }
  function removeEx(i) {
    setExercises(prev => prev.filter((_, idx) => idx !== i));
  }
  function markComplete(i) {
    const upd = [...exercises];
    upd[i] = {
      ...upd[i],
      completed: true
    };
    setExercises(upd);
    setExpanded(null);
  }
  function completeSet(exIdx, setIdx) {
    const ex = exercises[exIdx];
    const total = setCount[exIdx] || ex.sets || 3;
    const key = `${exIdx}-${setIdx}`;
    // Lock this set
    setLockedSets(prev => ({
      ...prev,
      [key]: true
    }));

    // ── PERSIST SET LOG ──────────────────────────────
    const w = parseFloat(logs[`${exIdx}-${setIdx}-w`] || 0);
    const r = parseInt(logs[`${exIdx}-${setIdx}-r`] || 0);
    const rir = parseInt(logs[`${exIdx}-${setIdx}-rir`] || 0);
    const dateKey = new Date().toISOString().slice(0, 10);
    if (w > 0 && r > 0) {
      setSessionLogs(prev => {
        const dayLog = prev[dateKey] || {
          cycleDay,
          sets: {}
        };
        const exSets = dayLog.sets[ex.id] || [];
        const newLog = {
          ...prev,
          [dateKey]: {
            ...dayLog,
            cycleDay,
            sets: {
              ...dayLog.sets,
              [ex.id]: [...exSets, {
                w,
                r,
                rir,
                setIdx,
                timestamp: Date.now()
              }]
            }
          }
        };
        // Dual-write to Firestore (background, non-blocking)
        if (uid) fsSet(uid, "sessionLogs", dateKey, newLog[dateKey]);
        return newLog;
      });
    }
    const restSec = getRestSeconds(ex);
    const nextSet = setIdx + 1;
    const isLastSet = nextSet >= total;
    if (isLastSet) {
      startTimer(restSec, `${ex.name} · exercise complete`);
      setPendingAdvance(null);
      setTimeout(() => {
        const upd = [...exercises];
        upd[exIdx] = {
          ...upd[exIdx],
          completed: true
        };
        setExercises(upd);
        setExpanded(null);
      }, 300);
    } else {
      const label = `${ex.name} · Set ${nextSet + 1} of ${total} coming up`;
      startTimer(restSec, label);
      setPendingAdvance({
        exIdx,
        setIdx: nextSet
      });
    }
  }
  function getSetCountForEx(exIdx) {
    const ex = exercises[exIdx];
    return setCount[exIdx] || ex?.sets || 3;
  }
  function addSet(exIdx) {
    const current = getSetCountForEx(exIdx);
    setSetCount(prev => ({
      ...prev,
      [exIdx]: current + 1
    }));
    // Open the new set
    setActiveSet(prev => ({
      ...prev,
      [exIdx]: current
    }));
  }

  // ── WORKOUT PICKER SCREEN ──────────────────────────
  if (sessionMeta && sessionState === "picker") {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "20px 20px 120px"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: 20
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => setTab("home"),
      style: {
        background: "none",
        border: "none",
        color: T.muted,
        fontSize: 13,
        cursor: "pointer",
        padding: "0 0 12px",
        display: "flex",
        alignItems: "center",
        gap: 4
      }
    }, "← Back"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.18em",
        color: phase === "strength" ? T.crimson : T.steel,
        marginBottom: 6,
        textTransform: "uppercase"
      }
    }, "DAY ", cycleDay, " · ", phase === "strength" ? "STRENGTH" : "HYPERTROPHY"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 26,
        fontWeight: 800,
        color: T.bright,
        letterSpacing: "-0.02em",
        marginBottom: 4
      }
    }, sessionMeta.label), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        color: T.muted
      }
    }, "Choose how you want to train today")), /*#__PURE__*/React.createElement("div", {
      onClick: () => {
        // Resuming the exact workout already in progress — don't wipe state
        if (chosenWorkout?.type === "default" && exercises.length > 0) {
          setSessionState("building");
        } else {
          setExercises(buildExercisesFrom(sessionMeta.exercises));
          setSessionState("building");
          setChosenWorkout({
            type: "default",
            label: sessionMeta.label
          });
        }
      },
      style: {
        background: T.card,
        border: `1px solid ${phase === "strength" ? T.crimson : T.steel}55`,
        borderLeft: `4px solid ${phase === "strength" ? T.crimson : T.steel}`,
        borderRadius: 12,
        padding: "16px 18px",
        marginBottom: 10,
        cursor: "pointer",
        transition: "all 0.15s",
        boxShadow: `0 2px 16px ${phase === "strength" ? T.crimson : T.steel}12`
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 7,
        marginBottom: 3
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        fontWeight: 800,
        color: T.bright
      }
    }, sessionMeta.label), /*#__PURE__*/React.createElement(Tag, {
      text: "RECOMMENDED",
      color: phase === "strength" ? T.crimson : T.steel,
      xs: true
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: T.dim,
        marginBottom: 8
      }
    }, sessionMeta.exercises.length, " exercises · ~", Math.round(sessionMeta.exercises.length * 7), " min · programmed for today"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 5,
        flexWrap: "wrap"
      }
    }, sessionMeta.muscles?.slice(0, 4).map(m => /*#__PURE__*/React.createElement(Tag, {
      key: m,
      text: m,
      color: getMovementColor([m]),
      xs: true
    })), (sessionMeta.muscles?.length || 0) > 4 && /*#__PURE__*/React.createElement(Tag, {
      text: `+${sessionMeta.muscles.length - 4}`,
      color: T.dim,
      xs: true
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 24,
        flexShrink: 0,
        marginLeft: 8
      }
    }, phase === "strength" ? "💪" : "🔬"))), hasSavedTemplate && /*#__PURE__*/React.createElement("div", {
      onClick: () => {
        if (chosenWorkout?.type === "template" && exercises.length > 0) {
          setSessionState("building");
        } else {
          setExercises(buildExercisesFrom(savedTemplate.exercises));
          setSessionState("building");
          setChosenWorkout({
            type: "template",
            label: savedTemplate.name
          });
        }
      },
      style: {
        background: T.emeraldBg,
        border: `1px solid ${T.emerald}55`,
        borderLeft: `4px solid ${T.emerald}`,
        borderRadius: 12,
        padding: "16px 18px",
        marginBottom: 10,
        cursor: "pointer",
        transition: "all 0.15s"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start"
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 7,
        marginBottom: 3
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        fontWeight: 800,
        color: T.emerald
      }
    }, savedTemplate.name), /*#__PURE__*/React.createElement(Tag, {
      text: "MY VERSION",
      color: T.emerald,
      xs: true
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: T.muted,
        marginBottom: 8
      }
    }, savedTemplate.exercises.length, " exercises · saved ", savedTemplate.savedAt), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 5,
        flexWrap: "wrap"
      }
    }, savedTemplate.exercises.slice(0, 4).map((ex, i) => /*#__PURE__*/React.createElement(Tag, {
      key: i,
      text: ex.name,
      color: getMovementColor(ex.muscles),
      xs: true
    })))), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 24,
        flexShrink: 0
      }
    }, "⭐"))), customWorkouts.length > 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: 10
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: T.dim,
        letterSpacing: "0.1em",
        marginBottom: 8,
        marginTop: 4
      }
    }, "MY SAVED WORKOUTS"), customWorkouts.map(cw => {
      const isEditing = editingWorkout === cw.id;
      return /*#__PURE__*/React.createElement("div", {
        key: cw.id,
        style: {
          background: T.card,
          border: `1px solid ${isEditing ? T.violet : T.violet + "33"}`,
          borderLeft: `4px solid ${T.violet}`,
          borderRadius: 12,
          marginBottom: 8,
          overflow: "hidden"
        }
      }, !isEditing ? /*#__PURE__*/React.createElement("div", {
        style: {
          padding: "14px 16px"
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 8
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          flex: 1,
          cursor: "pointer"
        },
        onClick: () => {
          if (chosenWorkout?.type === "custom" && chosenWorkout?.id === cw.id && exercises.length > 0) {
            setSessionState("building");
          } else {
            setExercises(buildExercisesFrom(cw));
            setSessionState("building");
            setChosenWorkout({
              type: "custom",
              label: cw.name,
              id: cw.id
            });
          }
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 14,
          fontWeight: 700,
          color: T.bright,
          marginBottom: 3
        }
      }, cw.name), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 11,
          color: T.muted,
          marginBottom: 6
        }
      }, cw.exercises.length, " exercises · ", cw.createdAt), /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          gap: 5,
          flexWrap: "wrap"
        }
      }, cw.exercises.slice(0, 4).map((exId, i) => {
        const mv = LIBRARY.find(m => m.id === exId);
        return mv ? /*#__PURE__*/React.createElement(Tag, {
          key: i,
          text: mv.name.split(" ")[0],
          color: getMovementColor(mv.muscles),
          xs: true
        }) : null;
      }), cw.exercises.length > 4 && /*#__PURE__*/React.createElement(Tag, {
        text: `+${cw.exercises.length - 4}`,
        color: T.dim,
        xs: true
      }))), /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          gap: 4,
          flexShrink: 0,
          marginLeft: 8
        }
      }, /*#__PURE__*/React.createElement(Tag, {
        text: cw.phase === "strength" ? "STR" : "HYP",
        color: cw.phase === "strength" ? T.crimson : T.steel,
        xs: true
      }))), /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          gap: 6,
          paddingTop: 8,
          borderTop: `1px solid ${T.border}`
        }
      }, /*#__PURE__*/React.createElement(Btn, {
        size: "sm",
        style: {
          flex: 2
        },
        onClick: () => {
          if (chosenWorkout?.type === "custom" && chosenWorkout?.id === cw.id && exercises.length > 0) {
            setSessionState("building");
          } else {
            setExercises(buildExercisesFrom(cw));
            setSessionState("building");
            setChosenWorkout({
              type: "custom",
              label: cw.name,
              id: cw.id
            });
          }
        }
      }, "▶ Start"), /*#__PURE__*/React.createElement(Btn, {
        variant: "outline",
        size: "sm",
        style: {
          flex: 1
        },
        onClick: e => {
          e.stopPropagation();
          setEditingWorkout(cw.id);
          setEditName(cw.name);
          setEditExercises(cw.exercises.map(e => typeof e === "string" ? {
            id: e
          } : e));
          setEditSearch("");
        }
      }, "✎ Edit"), /*#__PURE__*/React.createElement(Btn, {
        variant: "outline",
        size: "sm",
        onClick: e => {
          e.stopPropagation();
          const copy = {
            ...cw,
            id: Date.now().toString(),
            name: `${cw.name} (Copy)`,
            savedAt: new Date().toLocaleDateString("en-US", {
              month: "short",
              day: "numeric"
            })
          };
          setCustomWorkouts(prev => [...prev, copy]);
          if (uid) fsSet(uid, "customWorkouts", copy.id, copy);
        }
      }, "⧉"), /*#__PURE__*/React.createElement(Btn, {
        variant: "danger",
        size: "sm",
        onClick: e => {
          e.stopPropagation();
          setCustomWorkouts(prev => prev.filter(w => w.id !== cw.id));
          if (uid) fsDel(uid, "customWorkouts", cw.id);
        }
      }, "✕"))) :
      /*#__PURE__*/
      /* ── EDIT MODE ── */
      React.createElement("div", {
        style: {
          padding: "14px 16px"
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 12,
          fontWeight: 700,
          color: T.violet,
          marginBottom: 10
        }
      }, "Editing Workout"), /*#__PURE__*/React.createElement("div", {
        style: {
          marginBottom: 10
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 9,
          color: T.dim,
          letterSpacing: "0.08em",
          marginBottom: 4,
          textTransform: "uppercase"
        }
      }, "Name"), /*#__PURE__*/React.createElement("input", {
        value: editName,
        onChange: e => setEditName(e.target.value),
        style: {
          width: "100%",
          background: T.surface,
          border: `1px solid ${editName ? T.violet : T.border}`,
          borderRadius: 8,
          padding: "9px 12px",
          color: T.bright,
          fontSize: 13,
          outline: "none",
          fontFamily: "inherit",
          boxSizing: "border-box"
        }
      })), /*#__PURE__*/React.createElement("div", {
        style: {
          marginBottom: 10
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 9,
          color: T.dim,
          letterSpacing: "0.08em",
          marginBottom: 4,
          textTransform: "uppercase"
        }
      }, "Phase"), /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          gap: 6
        }
      }, ["strength", "hypertrophy"].map(ph => {
        const isCurPhase = editingWorkout && customWorkouts.find(w => w.id === editingWorkout)?.phase === ph;
        return /*#__PURE__*/React.createElement("button", {
          key: ph,
          onClick: () => setCustomWorkouts(prev => prev.map(w => w.id === cw.id ? {
            ...w,
            phase: ph
          } : w)),
          style: {
            flex: 1,
            padding: "7px 0",
            borderRadius: 8,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
            background: isCurPhase ? (ph === "strength" ? T.crimson : T.steel) + "22" : "transparent",
            border: `1px solid ${isCurPhase ? ph === "strength" ? T.crimson : T.steel : T.border}`,
            color: isCurPhase ? ph === "strength" ? T.crimson : T.steel : T.muted
          }
        }, ph.charAt(0).toUpperCase() + ph.slice(1));
      }))), /*#__PURE__*/React.createElement("div", {
        style: {
          marginBottom: 8
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 9,
          color: T.dim,
          letterSpacing: "0.08em",
          marginBottom: 6,
          textTransform: "uppercase"
        }
      }, "Exercises (", editExercises.length, ")"), editExercises.map((exObj, idx) => {
        const exId = typeof exObj === "string" ? exObj : exObj.id;
        const mv = LIBRARY.find(m => m.id === exId);
        if (!mv) return null;
        const plan = getRepsForFiber(mv.fiber, phase);
        const [showNote, setShowNote] = React.useState(false);
        return /*#__PURE__*/React.createElement("div", {
          key: `${exId}-${idx}`,
          style: {
            borderBottom: `1px solid ${T.border}`,
            paddingBottom: 8,
            marginBottom: 8
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 0"
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            color: T.dim,
            fontSize: 12
          }
        }, "⠿"), /*#__PURE__*/React.createElement("div", {
          style: {
            display: "flex",
            flexDirection: "column",
            gap: 1
          }
        }, /*#__PURE__*/React.createElement("button", {
          onClick: () => {
            if (idx === 0) return;
            const arr = [...editExercises];
            [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
            setEditExercises(arr);
          },
          style: {
            background: "none",
            border: "none",
            color: idx === 0 ? T.dim : T.accent,
            cursor: "pointer",
            fontSize: 10,
            lineHeight: 1,
            padding: "1px 3px"
          }
        }, "▲"), /*#__PURE__*/React.createElement("button", {
          onClick: () => {
            if (idx === editExercises.length - 1) return;
            const arr = [...editExercises];
            [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
            setEditExercises(arr);
          },
          style: {
            background: "none",
            border: "none",
            color: idx === editExercises.length - 1 ? T.dim : T.accent,
            cursor: "pointer",
            fontSize: 10,
            lineHeight: 1,
            padding: "1px 3px"
          }
        }, "▼")), /*#__PURE__*/React.createElement("div", {
          style: {
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: getMovementColor(mv.muscles),
            flexShrink: 0
          }
        }), /*#__PURE__*/React.createElement("div", {
          style: {
            flex: 1,
            minWidth: 0
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 12,
            color: T.text
          }
        }, mv.name), /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 10,
            color: T.dim
          }
        }, mv.muscles.slice(0, 2).join(", "))), /*#__PURE__*/React.createElement("button", {
          onClick: () => setShowNote(s => !s),
          style: {
            background: "none",
            border: "none",
            fontSize: 12,
            cursor: "pointer",
            color: exObj.note ? T.accent : T.dim
          }
        }, "📝"), /*#__PURE__*/React.createElement(Tag, {
          text: FIBER_LABEL[mv.fiber],
          color: FIBER_COLOR[mv.fiber],
          xs: true
        }), /*#__PURE__*/React.createElement("button", {
          onClick: () => setEditExercises(prev => prev.filter((_, i) => i !== idx)),
          style: {
            background: "none",
            border: "none",
            color: T.crimson,
            cursor: "pointer",
            fontSize: 16,
            padding: "0 4px",
            lineHeight: 1
          }
        }, "×")), /*#__PURE__*/React.createElement("div", {
          style: {
            display: "flex",
            gap: 6,
            marginTop: 4,
            paddingLeft: 36
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 4
          }
        }, /*#__PURE__*/React.createElement("span", {
          style: {
            fontSize: 9,
            color: T.dim
          }
        }, "Sets"), /*#__PURE__*/React.createElement("input", {
          type: "number",
          placeholder: String(plan.sets),
          value: exObj.sets || "",
          onChange: e => setEditExercises(prev => prev.map((x, i) => i === idx ? {
            ...(typeof x === "string" ? {
              id: x
            } : x),
            sets: e.target.value ? Number(e.target.value) : undefined
          } : x)),
          style: {
            width: 36,
            background: T.surface,
            border: `1px solid ${exObj.sets ? T.violet : T.border}`,
            borderRadius: 6,
            padding: "3px 6px",
            color: T.bright,
            fontSize: 11,
            textAlign: "center",
            outline: "none",
            fontFamily: "inherit"
          }
        })), /*#__PURE__*/React.createElement("div", {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 4
          }
        }, /*#__PURE__*/React.createElement("span", {
          style: {
            fontSize: 9,
            color: T.dim
          }
        }, "Reps"), /*#__PURE__*/React.createElement("input", {
          type: "number",
          placeholder: String(plan.reps),
          value: exObj.reps || "",
          onChange: e => setEditExercises(prev => prev.map((x, i) => i === idx ? {
            ...(typeof x === "string" ? {
              id: x
            } : x),
            reps: e.target.value ? Number(e.target.value) : undefined
          } : x)),
          style: {
            width: 36,
            background: T.surface,
            border: `1px solid ${exObj.reps ? T.violet : T.border}`,
            borderRadius: 6,
            padding: "3px 6px",
            color: T.bright,
            fontSize: 11,
            textAlign: "center",
            outline: "none",
            fontFamily: "inherit"
          }
        })), /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 9,
            color: T.dim,
            alignSelf: "center"
          }
        }, "default: ", plan.sets, "×", plan.reps)), showNote && /*#__PURE__*/React.createElement("div", {
          style: {
            paddingLeft: 36,
            marginTop: 4
          }
        }, /*#__PURE__*/React.createElement("input", {
          placeholder: "Note: e.g. 'Keep elbows tucked', 'Target weight: 185'",
          value: exObj.note || "",
          onChange: e => setEditExercises(prev => prev.map((x, i) => i === idx ? {
            ...(typeof x === "string" ? {
              id: x
            } : x),
            note: e.target.value || undefined
          } : x)),
          style: {
            width: "100%",
            background: T.surface,
            border: `1px solid ${exObj.note ? T.accent : T.border}`,
            borderRadius: 6,
            padding: "5px 8px",
            color: T.bright,
            fontSize: 11,
            outline: "none",
            fontFamily: "inherit",
            boxSizing: "border-box"
          }
        })));
      })), /*#__PURE__*/React.createElement("div", {
        style: {
          marginBottom: 12
        }
      }, /*#__PURE__*/React.createElement("input", {
        placeholder: "Search to add exercise...",
        value: editSearch,
        onChange: e => setEditSearch(e.target.value),
        style: {
          width: "100%",
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          padding: "8px 12px",
          color: T.bright,
          fontSize: 12,
          outline: "none",
          fontFamily: "inherit",
          boxSizing: "border-box"
        }
      }), editSearch.length > 1 && /*#__PURE__*/React.createElement("div", {
        style: {
          background: T.surface,
          borderRadius: "0 0 8px 8px",
          border: `1px solid ${T.border}`,
          borderTop: "none",
          maxHeight: 150,
          overflowY: "auto"
        }
      }, LIBRARY.filter(mv => (mv.name.toLowerCase().includes(editSearch.toLowerCase()) || mv.muscles.some(m => m.toLowerCase().includes(editSearch.toLowerCase()))) && !editExercises.some(e => (typeof e === "string" ? e : e.id) === mv.id)).slice(0, 6).map(mv => /*#__PURE__*/React.createElement("div", {
        key: mv.id,
        onClick: () => {
          setEditExercises(prev => [...prev, {
            id: mv.id
          }]);
          setEditSearch("");
        },
        style: {
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderBottom: `1px solid ${T.border}`,
          cursor: "pointer"
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: getMovementColor(mv.muscles)
        }
      }), /*#__PURE__*/React.createElement("div", {
        style: {
          flex: 1,
          fontSize: 12,
          color: T.text
        }
      }, mv.name), /*#__PURE__*/React.createElement(Tag, {
        text: FIBER_LABEL[mv.fiber],
        color: FIBER_COLOR[mv.fiber],
        xs: true
      }))))), /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          gap: 8
        }
      }, /*#__PURE__*/React.createElement(Btn, {
        variant: "ghost",
        size: "sm",
        style: {
          flex: 1
        },
        onClick: () => {
          setEditingWorkout(null);
          setEditName("");
          setEditExercises([]);
          setEditSearch("");
        }
      }, "Cancel"), /*#__PURE__*/React.createElement(Btn, {
        size: "sm",
        style: {
          flex: 2
        },
        disabled: !editName || editExercises.length === 0,
        onClick: () => {
          const updated = {
            ...cw,
            name: editName,
            exercises: editExercises,
            updatedAt: new Date().toLocaleDateString("en-US", {
              month: "short",
              day: "numeric"
            })
          };
          setCustomWorkouts(prev => prev.map(w => w.id === cw.id ? updated : w));
          if (uid) fsSet(uid, "customWorkouts", cw.id, updated);
          setEditingWorkout(null);
          setEditName("");
          setEditExercises([]);
          setEditSearch("");
        }
      }, "✓ Save Changes"))));
    })), !showBuilder ? /*#__PURE__*/React.createElement("button", {
      onClick: () => setShowBuilder(true),
      style: {
        width: "100%",
        padding: "12px 0",
        borderRadius: 10,
        background: "transparent",
        border: `1px dashed ${T.borderHi}`,
        color: T.dim,
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6
      }
    }, "+ Build New Workout") : /*#__PURE__*/React.createElement("div", {
      style: {
        background: T.card,
        border: `1px solid ${T.violet}44`,
        borderRadius: 12,
        padding: "16px"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        fontWeight: 700,
        color: T.violet,
        marginBottom: 12
      }
    }, "Build Custom Workout"), /*#__PURE__*/React.createElement("input", {
      placeholder: "Workout name (e.g. Push Day A)",
      value: newWorkoutName,
      onChange: e => setNewWorkoutName(e.target.value),
      style: {
        width: "100%",
        background: T.surface,
        border: `1px solid ${newWorkoutName ? T.violet : T.border}`,
        borderRadius: 8,
        padding: "10px 12px",
        color: T.bright,
        fontSize: 13,
        outline: "none",
        fontFamily: "inherit",
        boxSizing: "border-box",
        marginBottom: 10
      }
    }), /*#__PURE__*/React.createElement("input", {
      placeholder: "Search exercises...",
      value: builderSearch,
      onChange: e => setBuilderSearch(e.target.value),
      style: {
        width: "100%",
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        padding: "10px 12px",
        color: T.bright,
        fontSize: 13,
        outline: "none",
        fontFamily: "inherit",
        boxSizing: "border-box",
        marginBottom: 10
      }
    }), builderExercises.length > 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: 10
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: T.dim,
        letterSpacing: "0.08em",
        marginBottom: 6
      }
    }, "SELECTED (", builderExercises.length, ")"), builderExercises.map((ex, i) => /*#__PURE__*/React.createElement("div", {
      key: ex.id,
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "6px 0",
        borderBottom: `1px solid ${T.border}`
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 7
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: getMovementColor(ex.muscles)
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: T.text
      }
    }, ex.name)), /*#__PURE__*/React.createElement("button", {
      onClick: () => setBuilderExercises(prev => prev.filter((_, j) => j !== i)),
      style: {
        background: "none",
        border: "none",
        color: T.crimson,
        cursor: "pointer",
        fontSize: 14,
        padding: "0 4px"
      }
    }, "×")))), /*#__PURE__*/React.createElement("div", {
      style: {
        maxHeight: 200,
        overflowY: "auto"
      }
    }, LIBRARY.filter(mv => builderSearch.length > 1 && (mv.name.toLowerCase().includes(builderSearch.toLowerCase()) || mv.muscles.some(m => m.toLowerCase().includes(builderSearch.toLowerCase()))) && !builderExercises.find(e => e.id === mv.id)).slice(0, 8).map(mv => /*#__PURE__*/React.createElement("div", {
      key: mv.id,
      onClick: () => {
        setBuilderExercises(prev => [...prev, mv]);
        setBuilderSearch("");
      },
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 0",
        borderBottom: `1px solid ${T.border}`,
        cursor: "pointer"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: getMovementColor(mv.muscles),
        flexShrink: 0
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: T.text
      }
    }, mv.name), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: T.dim
      }
    }, mv.muscles.slice(0, 2).join(", "))), /*#__PURE__*/React.createElement(Tag, {
      text: FIBER_LABEL[mv.fiber],
      color: FIBER_COLOR[mv.fiber],
      xs: true
    })))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        marginTop: 12
      }
    }, /*#__PURE__*/React.createElement(Btn, {
      variant: "ghost",
      size: "sm",
      onClick: () => {
        setShowBuilder(false);
        setBuilderExercises([]);
        setNewWorkoutName("");
      }
    }, "Cancel"), /*#__PURE__*/React.createElement(Btn, {
      size: "sm",
      style: {
        flex: 1
      },
      disabled: !newWorkoutName || builderExercises.length === 0,
      onClick: () => {
        const newCW = {
          id: `cw${Date.now()}`,
          name: newWorkoutName,
          phase,
          exercises: builderExercises.map(e => e.id),
          createdAt: new Date().toLocaleDateString("en-US", {
            month: "short",
            day: "numeric"
          })
        };
        setCustomWorkouts(prev => [...prev, newCW]);
        if (uid) fsSet(uid, "customWorkouts", newCW.id, newCW);
        setExercises(buildExercisesFrom(newCW));
        setSessionState("building");
        setChosenWorkout({
          type: "custom",
          label: newCW.name,
          id: newCW.id
        });
        setShowBuilder(false);
      }
    }, "Save + Start →"))));
  }
  if (!sessionMeta) {
    return /*#__PURE__*/React.createElement(RestDayScreen, {
      cycleDay: cycleDay
    });
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "20px 20px 120px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setSessionState("picker"),
    style: {
      background: "none",
      border: "none",
      color: T.muted,
      fontSize: 13,
      cursor: "pointer",
      padding: "0 0 12px",
      display: "flex",
      alignItems: "center",
      gap: 4
    }
  }, "← Back"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.12em",
      color: phase === "strength" ? T.crimson : T.steel
    }
  }, "DAY ", cycleDay, " · ", phase.toUpperCase()), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 22,
      fontWeight: 700,
      color: T.bright,
      margin: "4px 0"
    }
  }, sessionMeta.label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.muted
    }
  }, exercises.length, " exercises")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-end",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(IntensityArc, {
    cycleDay: cycleDay,
    phase: phase
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (timerActive || timerSeconds > 0) {
        setTimerEditMode(true);
        setTimerEditVal(String(Math.ceil(timerSeconds / 60)));
        setTimerActive(false);
      } else {
        setTimerEditMode(true);
        setTimerEditVal("");
        setTimerSeconds(1);
        setTimerTotal(1);
        setTimerLabel("Manual rest timer");
      }
    },
    style: {
      display: "flex",
      alignItems: "center",
      gap: 5,
      padding: "5px 10px",
      borderRadius: 8,
      cursor: "pointer",
      background: timerActive ? T.emerald + "18" : T.card,
      border: `1px solid ${timerActive ? T.emerald : T.border}`,
      color: timerActive ? T.emerald : T.muted,
      fontSize: 11,
      fontWeight: 700
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13
    }
  }, "⏱"), timerActive ? fmtTime(timerSeconds) : timerSeconds > 0 ? `${fmtTime(timerSeconds)} paused` : "Timer"))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      fontSize: 11,
      color: T.dim,
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement("span", null, done, "/", exercises.length, " exercises"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: pct === 100 ? T.emerald : T.accent
    }
  }, pct, "%")), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 3,
      background: T.border,
      borderRadius: 2
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: "100%",
      borderRadius: 2,
      background: pct === 100 ? T.emerald : T.accent,
      width: `${pct}%`,
      transition: "width 0.6s cubic-bezier(0.34,1.56,0.64,1)",
      boxShadow: pct === 100 ? `0 0 12px ${T.emerald}88` : `0 0 8px ${T.accent}66`
    }
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 5,
      marginBottom: 16
    }
  }, sessionMeta.muscles.map(m => /*#__PURE__*/React.createElement(Tag, {
    key: m,
    text: m,
    color: getMovementColor([m]),
    xs: true
  }))), exercises.map((ex, i) => {
    const isOpen = expanded === i;
    const numSets = getSetCountForEx(i);
    const mvColor = getMovementColor(ex.muscles);
    const mvColorBg = mvColor + "0E";
    const isDragging = dragIdx === i;
    const isDragOver = dragOverIdx === i && dragIdx !== null && dragIdx !== i;
    return /*#__PURE__*/React.createElement("div", {
      key: ex.id + i,
      style: {
        marginBottom: 8,
        opacity: isDragging ? 0.5 : 1,
        transform: isDragOver ? "scale(1.01)" : "none",
        transition: "transform 0.1s, opacity 0.1s"
      }
    }, /*#__PURE__*/React.createElement(Card, {
      onTouchStart: e => {
        if (ex.completed) return;
        setDragIdx(i);
        dragTouchY.current = e.touches[0].clientY;
      },
      onTouchMove: e => {
        if (dragIdx === null || dragIdx !== i) return;
        const dy = e.touches[0].clientY - dragTouchY.current;
        const cardH = 80; // approx card height
        const newIdx = Math.max(0, Math.min(exercises.length - 1, i + Math.round(dy / cardH)));
        setDragOverIdx(newIdx);
      },
      onTouchEnd: () => {
        if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx) {
          const arr = [...exercises];
          const [moved] = arr.splice(dragIdx, 1);
          arr.splice(dragOverIdx, 0, moved);
          setExercises(arr);
          if (expanded === dragIdx) setExpanded(dragOverIdx);
        }
        setDragIdx(null);
        setDragOverIdx(null);
        dragTouchY.current = null;
      },
      style: {
        padding: "14px 16px",
        borderLeft: `3px solid ${ex.completed ? T.emerald : isOpen ? mvColor : mvColor + "66"}`,
        border: `1px solid ${isDragOver ? T.accent + "88" : ex.completed ? T.emerald + "44" : isOpen ? mvColor + "55" : T.border}`,
        background: ex.completed ? T.emeraldBg : isOpen ? mvColorBg : T.card
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        cursor: "pointer"
      },
      onClick: () => {
        if (isOpen) {
          setExpanded(null);
          return;
        }
        setExpanded(i);
        // Sets start collapsed — user taps a set to open it
        // Only auto-set if user has already started this exercise
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 28,
        height: 28,
        borderRadius: "50%",
        flexShrink: 0,
        background: ex.completed ? T.emerald : mvColor + "22",
        border: `1.5px solid ${ex.completed ? T.emerald : mvColor}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 11,
        fontWeight: 800,
        color: ex.completed ? T.bg : mvColor,
        boxShadow: ex.completed ? `0 0 10px ${T.emerald}66` : "none"
      }
    }, ex.completed ? "✓" : i + 1), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexWrap: "wrap",
        gap: 5,
        alignItems: "center",
        marginBottom: 3
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 700,
        fontSize: 14,
        color: ex.completed ? T.emerald : T.bright
      }
    }, ex.name), ex.swapped && /*#__PURE__*/React.createElement(Tag, {
      text: "SWAPPED",
      color: T.amber,
      xs: true
    }), ex.completed && /*#__PURE__*/React.createElement(Tag, {
      text: "LOGGED",
      color: T.emerald,
      xs: true
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
        marginBottom: 4
      }
    }, ex.muscles.slice(0, 2).map(m => /*#__PURE__*/React.createElement(Tag, {
      key: m,
      text: m,
      color: getMovementColor([m]),
      xs: true
    })), ex.muscles.length > 2 && /*#__PURE__*/React.createElement(Tag, {
      text: `+${ex.muscles.length - 2}`,
      color: T.dim,
      xs: true
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: T.muted
      }
    }, numSets, " sets × ", ex.reps, " · ", ex.rest)), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 5
      }
    }, /*#__PURE__*/React.createElement(Tag, {
      text: FIBER_LABEL[ex.fiber],
      color: FIBER_COLOR[ex.fiber]
    }), !ex.completed && /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 1
      },
      onClick: e => e.stopPropagation()
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        if (i === 0) return;
        const arr = [...exercises];
        [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
        setExercises(arr);
        if (expanded === i) setExpanded(i - 1);else if (expanded === i - 1) setExpanded(i);
      },
      style: {
        background: "none",
        border: "none",
        color: i === 0 ? T.dim : T.accent,
        cursor: i === 0 ? "default" : "pointer",
        fontSize: 14,
        lineHeight: 1,
        padding: "2px 4px"
      }
    }, "▲"), /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        if (i === exercises.length - 1) return;
        const arr = [...exercises];
        [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
        setExercises(arr);
        if (expanded === i) setExpanded(i + 1);else if (expanded === i + 1) setExpanded(i);
      },
      style: {
        background: "none",
        border: "none",
        color: i === exercises.length - 1 ? T.dim : T.accent,
        cursor: i === exercises.length - 1 ? "default" : "pointer",
        fontSize: 14,
        lineHeight: 1,
        padding: "2px 4px"
      }
    }, "▼")))), isOpen && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 14,
        borderTop: `1px solid ${T.border}`,
        paddingTop: 14
      },
      onClick: e => e.stopPropagation()
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        color: T.muted,
        lineHeight: 1.6,
        marginBottom: 12
      }
    }, ex.note), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "8px 12px",
        background: FIBER_COLOR[ex.fiber] + "12",
        border: `1px solid ${FIBER_COLOR[ex.fiber]}22`,
        borderRadius: 7,
        marginBottom: 14
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: FIBER_COLOR[ex.fiber],
        letterSpacing: "0.08em",
        marginBottom: 3
      }
    }, "WHY ", ex.reps, " REPS — ", FIBER_LABEL[ex.fiber].toUpperCase()), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: T.muted,
        lineHeight: 1.5
      }
    }, ex.fiber === "fast" && `Fast-twitch dominant. ${ex.reps} reps with maximum load recruits the largest motor units — these are the fibers that grow the most.`, ex.fiber === "slow" && `Slow-twitch dominant. ${ex.reps} reps with controlled tempo matches the fiber biology — time under tension matters more than load here.`, ex.fiber === "mixed" && `Mixed fiber composition. ${ex.reps} reps effectively targets both fiber types in this movement pattern.`)), /*#__PURE__*/React.createElement(Label, null, "Sets"), (() => {
      const totalSets = getSetCountForEx(i);
      const currentActive = activeSet[i] ?? null; // null = no set open yet
      return /*#__PURE__*/React.createElement(React.Fragment, null, Array.from({
        length: totalSets
      }, (_, s) => {
        const setKey = `${i}-${s}`;
        const isLocked = !!lockedSets[setKey];
        const isActive = currentActive !== null && s === currentActive && !isLocked;
        const prev = getPrevLifts(sessionLogs, ex.id)?.[s];
        const w = logs[`${i}-${s}-w`] || "";
        const r = logs[`${i}-${s}-r`] || "";
        const rir = logs[`${i}-${s}-rir`] || "";
        return /*#__PURE__*/React.createElement("div", {
          key: s,
          style: {
            marginBottom: 8
          }
        }, /*#__PURE__*/React.createElement("div", {
          onClick: () => {
            if (isLocked) return;
            // Toggle: tap active set to collapse it, tap inactive to open
            setActiveSet(prev => ({
              ...prev,
              [i]: isActive ? null : s
            }));
          },
          style: {
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 12px",
            borderRadius: isActive ? "8px 8px 0 0" : 8,
            cursor: isLocked ? "default" : "pointer",
            background: isLocked ? T.emeraldBg : isActive ? T.emeraldBg : T.surface,
            border: `1px solid ${isLocked ? T.emerald + "44" : isActive ? T.emerald : T.border}`
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            width: 24,
            height: 24,
            borderRadius: "50%",
            flexShrink: 0,
            background: isLocked ? T.emerald : isActive ? T.emerald : T.border,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            fontWeight: 700,
            color: isLocked || isActive ? T.bg : T.dim
          }
        }, isLocked ? "✓" : s + 1), /*#__PURE__*/React.createElement("div", {
          style: {
            flex: 1
          }
        }, /*#__PURE__*/React.createElement("span", {
          style: {
            fontSize: 12,
            fontWeight: 600,
            color: isLocked ? T.emerald : isActive ? T.emerald : T.muted
          }
        }, "Set ", s + 1, isLocked && w && ` · ${w} lbs × ${r} reps${rir ? ` · RIR ${rir}` : ""}`, !isLocked && !isActive && " · tap to open", isActive && " · active")), prev && !isLocked && /*#__PURE__*/React.createElement("span", {
          style: {
            fontSize: 10,
            color: T.dim
          }
        }, "prev: ", prev.w, "×", prev.r)), isActive && /*#__PURE__*/React.createElement("div", {
          style: {
            background: T.card,
            border: `1px solid ${T.emerald}`,
            borderTop: "none",
            borderRadius: "0 0 8px 8px",
            padding: "12px 12px 14px"
          },
          onClick: e => e.stopPropagation()
        }, prev && /*#__PURE__*/React.createElement("div", {
          style: {
            display: "flex",
            gap: 6,
            marginBottom: 8,
            padding: "6px 10px",
            background: T.goldBg,
            borderRadius: 6,
            justifyContent: "space-between"
          }
        }, /*#__PURE__*/React.createElement("span", {
          style: {
            fontSize: 10,
            color: T.dim
          }
        }, "Last time:"), /*#__PURE__*/React.createElement("span", {
          style: {
            fontSize: 10,
            color: T.accent,
            fontWeight: 600
          }
        }, prev.w, " lbs × ", prev.r, " reps · RIR ", prev.rir)), /*#__PURE__*/React.createElement("div", {
          style: {
            marginBottom: 12
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            display: "flex",
            gap: 8,
            marginBottom: 8
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            flex: 1
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 9,
            color: T.dim,
            letterSpacing: "0.08em",
            marginBottom: 4,
            textAlign: "center"
          }
        }, "WEIGHT (LBS)"), /*#__PURE__*/React.createElement("input", {
          type: "number",
          placeholder: prev ? `${prev.w}` : "0",
          value: w,
          onChange: e => setLogs(prev => ({
            ...prev,
            [`${i}-${s}-w`]: e.target.value
          })),
          style: {
            width: "100%",
            background: T.surface,
            border: `1px solid ${w ? T.emerald : T.border}`,
            borderRadius: 8,
            padding: "12px 8px",
            color: w ? T.bright : T.dim,
            fontSize: 18,
            fontWeight: 700,
            outline: "none",
            fontFamily: "inherit",
            textAlign: "center",
            boxSizing: "border-box"
          }
        })), /*#__PURE__*/React.createElement("div", {
          style: {
            flex: 1
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 9,
            color: T.dim,
            letterSpacing: "0.08em",
            marginBottom: 4,
            textAlign: "center"
          }
        }, "REPS"), /*#__PURE__*/React.createElement("input", {
          type: "number",
          placeholder: prev ? `${prev.r}` : "0",
          value: r,
          onChange: e => setLogs(prev => ({
            ...prev,
            [`${i}-${s}-r`]: e.target.value
          })),
          style: {
            width: "100%",
            background: T.surface,
            border: `1px solid ${r ? T.emerald : T.border}`,
            borderRadius: 8,
            padding: "12px 8px",
            color: r ? T.bright : T.dim,
            fontSize: 18,
            fontWeight: 700,
            outline: "none",
            fontFamily: "inherit",
            textAlign: "center",
            boxSizing: "border-box"
          }
        }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: 9,
            color: T.accent,
            letterSpacing: "0.08em",
            marginBottom: 6,
            textAlign: "center"
          }
        }, "RIR — REPS LEFT IN TANK"), /*#__PURE__*/React.createElement("div", {
          style: {
            display: "flex",
            gap: 6
          }
        }, [{
          v: "0",
          l: "0 — Max",
          c: T.crimson
        }, {
          v: "1",
          l: "1 — Almost",
          c: T.amber
        }, {
          v: "2",
          l: "2 — Hard",
          c: T.amber
        }, {
          v: "3",
          l: "3 — Moderate",
          c: T.emerald
        }].map(rg => /*#__PURE__*/React.createElement("button", {
          key: rg.v,
          onClick: () => setLogs(prev => ({
            ...prev,
            [`${i}-${s}-rir`]: rg.v
          })),
          style: {
            flex: 1,
            padding: "12px 4px",
            borderRadius: 8,
            background: rir === rg.v ? rg.c + "22" : T.surface,
            border: `1px solid ${rir === rg.v ? rg.c : T.border}`,
            color: rir === rg.v ? rg.c : T.dim,
            fontSize: 10,
            fontWeight: 700,
            cursor: "pointer",
            lineHeight: 1.3
          }
        }, rg.l))))), /*#__PURE__*/React.createElement(Btn, {
          style: {
            width: "100%"
          },
          onClick: e => {
            e.stopPropagation();
            completeSet(i, s);
          }
        }, "✓ Complete Set ", s + 1, s + 1 < totalSets ? ` — Rest then Set ${s + 2}` : " — Exercise Done")));
      }), /*#__PURE__*/React.createElement("button", {
        onClick: e => {
          e.stopPropagation();
          addSet(i);
        },
        style: {
          width: "100%",
          padding: "8px 0",
          borderRadius: 8,
          background: "transparent",
          border: `1px dashed ${T.borderHi}`,
          color: T.dim,
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          marginTop: 4
        }
      }, "+ Add Set ", totalSets + 1));
    })(), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(Btn, {
      variant: "outline",
      size: "sm",
      onClick: e => {
        e.stopPropagation();
        setMode("swap");
        setTargetIdx(i);
        setSearch("");
        setFiberFilter("ALL");
      }
    }, "⇄ Swap"), /*#__PURE__*/React.createElement(Btn, {
      variant: "danger",
      size: "sm",
      onClick: e => {
        e.stopPropagation();
        removeEx(i);
      }
    }, "Remove"), ex.completed ? /*#__PURE__*/React.createElement(Btn, {
      variant: "ghost",
      size: "sm",
      style: {
        marginLeft: "auto"
      },
      onClick: e => {
        e.stopPropagation();
        const upd = [...exercises];
        upd[i] = {
          ...upd[i],
          completed: false
        };
        setExercises(upd);
        // Unlock all sets for this exercise
        const total = getSetCountForEx(i);
        setLockedSets(prev => {
          const next = {
            ...prev
          };
          for (let s = 0; s < total; s++) delete next[`${i}-${s}`];
          return next;
        });
        setActiveSet(prev => ({
          ...prev,
          [i]: 0
        }));
      }
    }, "✎ Edit Log") : /*#__PURE__*/React.createElement(Btn, {
      size: "sm",
      style: {
        marginLeft: "auto"
      },
      onClick: e => {
        e.stopPropagation();
        markComplete(i);
      }
    }, "✓ Done")))));
  }), (timerActive || timerSeconds > 0) && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      top: 56,
      left: "50%",
      transform: "translateX(-50%)",
      width: "calc(100% - 32px)",
      maxWidth: 448,
      zIndex: 40,
      background: "#0D0D0D",
      border: `1px solid ${timerColor}66`,
      borderRadius: 12,
      padding: "10px 16px",
      boxShadow: `0 4px 24px ${timerColor}22`
    }
  }, !timerEditMode ?
  /*#__PURE__*/
  /* ── Normal timer view ── */
  React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: () => {
      setTimerEditMode(true);
      setTimerEditVal(String(Math.ceil(timerSeconds / 60)));
      setTimerActive(false);
    },
    style: {
      position: "relative",
      width: 44,
      height: 44,
      flexShrink: 0,
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: 44,
    height: 44,
    style: {
      transform: "rotate(-90deg)"
    }
  }, /*#__PURE__*/React.createElement("circle", {
    cx: 22,
    cy: 22,
    r: 18,
    fill: "none",
    stroke: T.border,
    strokeWidth: 3
  }), /*#__PURE__*/React.createElement("circle", {
    cx: 22,
    cy: 22,
    r: 18,
    fill: "none",
    stroke: timerColor,
    strokeWidth: 3,
    strokeDasharray: 2 * Math.PI * 18,
    strokeDashoffset: 2 * Math.PI * 18 * (1 - timerPct / 100),
    strokeLinecap: "round",
    style: {
      transition: "stroke-dashoffset 1s linear, stroke 0.3s"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 11,
      fontWeight: 700,
      color: timerColor
    }
  }, timerSeconds <= 5 && timerActive ? timerSeconds : fmtTime(timerSeconds))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: timerColor,
      letterSpacing: "0.08em"
    }
  }, timerActive ? "REST" : "TIME'S UP"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setTimerEditMode(true);
      setTimerEditVal(String(Math.ceil(timerSeconds / 60)));
      setTimerActive(false);
    },
    style: {
      background: "none",
      border: `1px solid ${T.border}`,
      borderRadius: 4,
      padding: "1px 6px",
      fontSize: 9,
      color: T.dim,
      cursor: "pointer"
    }
  }, "edit")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: T.muted,
      marginTop: 1
    }
  }, timerLabel), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 2,
      background: T.border,
      borderRadius: 1,
      marginTop: 5
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: "100%",
      background: timerColor,
      borderRadius: 1,
      width: `${timerPct}%`,
      transition: "width 1s linear"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => startTimer(timerTotal, timerLabel),
    style: {
      background: T.card,
      border: `1px solid ${T.border}`,
      color: T.muted,
      borderRadius: 6,
      padding: "4px 10px",
      fontSize: 11,
      cursor: "pointer"
    }
  }, "↺"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setTimerActive(false);
      setTimerSeconds(0);
    },
    style: {
      background: T.card,
      border: `1px solid ${T.border}`,
      color: T.muted,
      borderRadius: 6,
      padding: "4px 10px",
      fontSize: 11,
      cursor: "pointer"
    }
  }, "✕"))) :
  /*#__PURE__*/
  /* ── Edit timer duration ── */
  React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      fontWeight: 700,
      color: timerColor,
      letterSpacing: "0.1em",
      marginBottom: 8
    }
  }, "SET REST DURATION"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 5,
      marginBottom: 10
    }
  }, [{
    label: "30s",
    secs: 30
  }, {
    label: "1 min",
    secs: 60
  }, {
    label: "90s",
    secs: 90
  }, {
    label: "2 min",
    secs: 120
  }, {
    label: "3 min",
    secs: 180
  }, {
    label: "5 min",
    secs: 300
  }].map(p => /*#__PURE__*/React.createElement("button", {
    key: p.label,
    onClick: () => {
      startTimer(p.secs, timerLabel);
      setTimerEditMode(false);
      setTimerEditVal("");
    },
    style: {
      flex: 1,
      padding: "8px 2px",
      borderRadius: 7,
      background: timerTotal === p.secs ? timerColor + "22" : T.card,
      border: `1px solid ${timerTotal === p.secs ? timerColor : T.border}`,
      color: timerTotal === p.secs ? timerColor : T.muted,
      fontSize: 10,
      fontWeight: 700,
      cursor: "pointer"
    }
  }, p.label))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "number",
    placeholder: "Custom minutes",
    value: timerEditVal,
    onChange: e => setTimerEditVal(e.target.value),
    autoFocus: true,
    style: {
      width: "100%",
      background: T.surface,
      border: `1px solid ${timerEditVal ? timerColor : T.border}`,
      borderRadius: 8,
      padding: "9px 12px",
      color: T.bright,
      fontSize: 14,
      fontWeight: 700,
      outline: "none",
      fontFamily: "inherit",
      boxSizing: "border-box",
      textAlign: "center"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      right: 10,
      top: "50%",
      transform: "translateY(-50%)",
      fontSize: 10,
      color: T.dim,
      pointerEvents: "none"
    }
  }, "min")), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      const mins = parseFloat(timerEditVal);
      if (mins > 0) {
        startTimer(Math.round(mins * 60), timerLabel);
      }
      setTimerEditMode(false);
      setTimerEditVal("");
    },
    style: {
      padding: "9px 16px",
      borderRadius: 8,
      background: timerColor,
      border: "none",
      color: T.bg,
      fontSize: 12,
      fontWeight: 700,
      cursor: "pointer"
    }
  }, "Start"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setTimerEditMode(false);
      setTimerEditVal("");
      if (timerTotal > 0) setTimerActive(true);
    },
    style: {
      padding: "9px 12px",
      borderRadius: 8,
      background: T.card,
      border: `1px solid ${T.border}`,
      color: T.muted,
      fontSize: 11,
      cursor: "pointer"
    }
  }, "Cancel")))), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setMode("add");
      setSearch("");
      setFiberFilter("ALL");
      setMuscleFilter("ALL");
      setShowAllEquipment(false);
      setPatternFilter("ALL");
      setLevelFilter("ALL");
    },
    style: {
      width: "100%",
      marginTop: 4,
      padding: "12px 0",
      borderRadius: 10,
      background: "transparent",
      border: `1px dashed ${T.borderHi}`,
      color: T.muted,
      fontSize: 13,
      fontWeight: 600,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 6
    }
  }, "+ Add Movement"), pct === 100 && /*#__PURE__*/React.createElement(Card, {
    glow: true,
    color: T.emerald,
    style: {
      marginTop: 16,
      padding: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 40,
      marginBottom: 4
    }
  }, "🏆"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "center",
      gap: 6,
      marginBottom: 8,
      fontSize: 20
    }
  }, /*#__PURE__*/React.createElement("span", null, "💪"), /*#__PURE__*/React.createElement("span", null, "🔥"), /*#__PURE__*/React.createElement("span", null, "⚡")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 18,
      fontWeight: 700,
      color: T.emerald
    }
  }, "Session Complete"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: T.muted,
      marginTop: 3
    }
  }, "Next: Day ", cycleDay + 1, " — ", SESSIONS_DATA[cycleDay + 1]?.label || "Rest")), sessionMeta && !savePrompt && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "12px 14px",
      background: T.violet + "12",
      border: `1px solid ${T.violet}33`,
      borderRadius: 10,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 700,
      color: T.violet,
      marginBottom: 4
    }
  }, "Save this as your Day ", cycleDay, " template?"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: T.muted,
      marginBottom: 10
    }
  }, "Next time you open Day ", cycleDay, ", your version loads by default."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "ghost",
    size: "sm",
    style: {
      flex: 1
    },
    onClick: () => setSavePrompt("dismiss")
  }, "Not now"), /*#__PURE__*/React.createElement(Btn, {
    size: "sm",
    style: {
      flex: 2,
      background: T.violet,
      color: T.bg
    },
    onClick: () => setSavePrompt("naming")
  }, "Save My Version →"))), savePrompt === "naming" && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "12px 14px",
      background: T.violet + "12",
      border: `1px solid ${T.violet}44`,
      borderRadius: 10,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 700,
      color: T.violet,
      marginBottom: 8
    }
  }, "Name this workout"), /*#__PURE__*/React.createElement("input", {
    placeholder: `My Day ${cycleDay} — ${sessionMeta.label}`,
    value: saveTemplateName,
    onChange: e => setSaveTemplateName(e.target.value),
    style: {
      width: "100%",
      background: T.surface,
      border: `1px solid ${saveTemplateName ? T.violet : T.border}`,
      borderRadius: 8,
      padding: "10px 12px",
      color: T.bright,
      fontSize: 13,
      outline: "none",
      fontFamily: "inherit",
      boxSizing: "border-box",
      marginBottom: 10
    }
  }), /*#__PURE__*/React.createElement(Btn, {
    style: {
      width: "100%",
      background: T.violet,
      color: T.bg
    },
    onClick: () => {
      const name = saveTemplateName || `My Day ${cycleDay} — ${sessionMeta.label}`;
      const today = new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric"
      });
      const tmpl = {
        name,
        exercises: exercises.map(e => ({
          id: e.id,
          name: e.name,
          muscles: e.muscles
        })),
        phase,
        savedAt: today
      };
      setSavedTemplates(prev => ({
        ...prev,
        [cycleDay]: tmpl
      }));
      if (uid) fsSet(uid, "savedTemplates", String(cycleDay), tmpl);
      setSavePrompt("saved");
    }
  }, "✓ Save Template")), savePrompt === "saved" && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "10px 14px",
      background: T.emeraldBg,
      border: `1px solid ${T.emerald}44`,
      borderRadius: 10,
      marginBottom: 14,
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18
    }
  }, "⭐"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: T.emerald,
      fontWeight: 600
    }
  }, "Saved as your Day ", cycleDay, " template")), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: `1px solid ${T.border}`,
      paddingTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      fontWeight: 700,
      color: T.dim,
      letterSpacing: "0.1em",
      marginBottom: 10
    }
  }, "SESSION VOLUME"), (() => {
    const muscleVol = {};
    exercises.forEach(ex => {
      const setsLogged = Object.keys(lockedSets).filter(k => k.startsWith(`${exercises.indexOf(ex)}-`)).length;
      const sets = setsLogged || ex.sets || 0;
      ex.muscles.slice(0, 1).forEach(m => {
        muscleVol[m] = (muscleVol[m] || 0) + sets;
      });
    });
    return Object.entries(muscleVol).map(([m, sets]) => {
      const color = getMovementColor([m]);
      const mrv = MUSCLE_MRV[m] || 16;
      const pctOfMrv = Math.min(sets / mrv * 100, 100);
      return /*#__PURE__*/React.createElement("div", {
        key: m,
        style: {
          marginBottom: 8
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          marginBottom: 3
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          color: T.text,
          fontWeight: 600
        }
      }, m), /*#__PURE__*/React.createElement("span", {
        style: {
          color,
          fontWeight: 700
        }
      }, sets, " sets")), /*#__PURE__*/React.createElement("div", {
        style: {
          height: 4,
          background: T.border,
          borderRadius: 2
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          height: "100%",
          background: color,
          borderRadius: 2,
          width: `${pctOfMrv}%`,
          transition: "width 0.5s"
        }
      })));
    });
  })())), mode && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      background: "#000000E0",
      zIndex: 60,
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: T.surface,
      borderRadius: "16px 16px 0 0",
      width: "100%",
      maxWidth: 520,
      maxHeight: "82vh",
      display: "flex",
      flexDirection: "column",
      border: `1px solid ${T.border}`,
      borderBottom: "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "16px 20px 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      color: T.bright
    }
  }, mode === "swap" ? `Swap: ${exercises[targetIdx]?.name}` : "Add Movement"), /*#__PURE__*/React.createElement(Btn, {
    variant: "ghost",
    size: "sm",
    onClick: () => {
      setMode(null);
      setTargetIdx(null);
      setMuscleFilter("ALL");
      setShowAllEquipment(false);
      setPatternFilter("ALL");
      setLevelFilter("ALL");
    }
  }, "✕ Close")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: T.muted,
      marginBottom: 10,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("span", null, filteredLib.length, " movements ·", " ", mode === "add" && showAllEquipment ? "All Equipment" : EQUIP_LABEL[profile?.equipment || "full"], mode === "swap" && " · Filtered to same muscle group", mode === "add" && " · Today's muscles shown first"), mode === "add" && /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowAllEquipment(s => !s),
    style: {
      flexShrink: 0,
      background: showAllEquipment ? T.accent + "18" : "transparent",
      border: `1px solid ${showAllEquipment ? T.accent : T.border}`,
      color: showAllEquipment ? T.accent : T.dim,
      borderRadius: 10,
      padding: "3px 9px",
      fontSize: 10,
      fontWeight: 700,
      cursor: "pointer",
      whiteSpace: "nowrap"
    }
  }, showAllEquipment ? "✓ All Equipment" : "Show All Equipment")), /*#__PURE__*/React.createElement("input", {
    placeholder: "Search movements or muscles...",
    "aria-label": "Search movements or muscles",
    value: search,
    onChange: e => setSearch(e.target.value),
    style: {
      width: "100%",
      background: T.card,
      border: `1px solid ${T.border}`,
      borderRadius: 8,
      padding: "10px 14px",
      color: T.bright,
      fontSize: 13,
      outline: "none",
      boxSizing: "border-box",
      fontFamily: "inherit",
      marginBottom: 8
    }
  }), mode === "add" && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      overflowX: "auto",
      paddingBottom: 6,
      marginBottom: 4
    }
  }, ["ALL", ...Object.keys(MUSCLE_GROUP_COLOR)].map(m => /*#__PURE__*/React.createElement("button", {
    key: m,
    onClick: () => setMuscleFilter(m),
    style: {
      flexShrink: 0,
      background: muscleFilter === m ? (MUSCLE_GROUP_COLOR[m] || T.accent) + "18" : "transparent",
      border: `1px solid ${muscleFilter === m ? MUSCLE_GROUP_COLOR[m] || T.accent : T.border}`,
      color: muscleFilter === m ? MUSCLE_GROUP_COLOR[m] || T.accent : T.dim,
      borderRadius: 12,
      padding: "4px 10px",
      fontSize: 10,
      fontWeight: muscleFilter === m ? 700 : 400,
      cursor: "pointer"
    }
  }, m === "ALL" ? "All Muscles" : m))), mode === "add" && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      overflowX: "auto",
      paddingBottom: 6,
      marginBottom: 4
    }
  }, ["ALL", "push", "pull", "hinge", "squat", "carry", "rotation"].map(p => /*#__PURE__*/React.createElement("button", {
    key: p,
    onClick: () => setPatternFilter(p),
    style: {
      flexShrink: 0,
      background: patternFilter === p ? T.steel + "18" : "transparent",
      border: `1px solid ${patternFilter === p ? T.steel : T.border}`,
      color: patternFilter === p ? T.steel : T.dim,
      borderRadius: 12,
      padding: "4px 10px",
      fontSize: 10,
      fontWeight: patternFilter === p ? 700 : 400,
      cursor: "pointer"
    }
  }, p === "ALL" ? "All Patterns" : p.charAt(0).toUpperCase() + p.slice(1)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      paddingBottom: 12,
      borderBottom: `1px solid ${T.border}`,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 4
    }
  }, ["ALL", "1", "2", "3"].map(l => /*#__PURE__*/React.createElement("button", {
    key: l,
    onClick: () => setLevelFilter(l),
    style: {
      background: levelFilter === l ? T.accent + "18" : "transparent",
      border: `1px solid ${levelFilter === l ? T.accent : T.border}`,
      color: levelFilter === l ? T.accent : T.dim,
      borderRadius: 10,
      padding: "4px 8px",
      fontSize: 10,
      fontWeight: levelFilter === l ? 700 : 400,
      cursor: "pointer"
    }
  }, l === "ALL" ? "All Levels" : l === "1" ? "●○○ Beginner" : l === "2" ? "●●○ Inter." : "●●● Advanced"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 4
    }
  }, ["ALL", "fast", "mixed", "slow"].map(f => /*#__PURE__*/React.createElement("button", {
    key: f,
    onClick: () => setFiberFilter(f),
    style: {
      background: fiberFilter === f ? (FIBER_COLOR[f] || T.accent) + "18" : "transparent",
      border: `1px solid ${fiberFilter === f ? FIBER_COLOR[f] || T.accent : T.border}`,
      color: fiberFilter === f ? FIBER_COLOR[f] || T.accent : T.dim,
      borderRadius: 10,
      padding: "4px 8px",
      fontSize: 10,
      fontWeight: fiberFilter === f ? 700 : 400,
      cursor: "pointer"
    }
  }, f === "ALL" ? "All Fiber" : FIBER_LABEL[f]))))), /*#__PURE__*/React.createElement("div", {
    style: {
      overflowY: "auto",
      padding: "12px 20px 20px",
      flex: 1,
      minHeight: 0
    }
  }, filteredLib.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      color: T.dim,
      padding: "32px 0",
      fontSize: 13
    }
  }, "No movements match your filters."), filteredLib.map(mv => {
    const plan = getRepsForFiber(mv.fiber, phase);
    const sameF = mode === "swap" && targetIdx !== null && mv.fiber === exercises[targetIdx]?.fiber;
    const mvC = getMovementColor(mv.muscles);
    const needsOtherEquip = mode === "add" && showAllEquipment && !mv.equipment.includes(profile?.equipment || "full");
    const lvl = mv.level || 1;
    const PATTERN_ICON = {
      push: "↑",
      pull: "↓",
      hinge: "⟳",
      squat: "↕",
      carry: "—",
      rotation: "↻"
    };
    return /*#__PURE__*/React.createElement("div", {
      key: mv.id,
      style: {
        background: T.card,
        border: `1px solid ${sameF ? T.emerald + "55" : needsOtherEquip ? T.amber + "33" : T.border}`,
        borderRadius: 12,
        marginBottom: 8,
        opacity: needsOtherEquip ? 0.78 : 1,
        overflow: "hidden"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        height: 3,
        background: mvC,
        borderRadius: "12px 12px 0 0",
        opacity: 0.8
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "10px 12px"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 8,
        marginBottom: 6
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 700,
        fontSize: 14,
        color: T.bright,
        lineHeight: 1.2,
        marginBottom: 3
      }
    }, mv.name), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 2
      }
    }, [1, 2, 3].map(d => /*#__PURE__*/React.createElement("div", {
      key: d,
      style: {
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: d <= lvl ? mvC : T.border
      }
    }))), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 9,
        color: T.dim
      }
    }, lvl === 1 ? "Beginner" : lvl === 2 ? "Intermediate" : "Advanced"), mv.pattern && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 9,
        color: T.dim,
        background: T.surface,
        borderRadius: 4,
        padding: "1px 5px",
        marginLeft: 2
      }
    }, mv.pattern), needsOtherEquip && /*#__PURE__*/React.createElement(Tag, {
      text: `Needs ${EQUIP_LABEL[mv.equipment[0]] || mv.equipment[0]}`,
      color: T.amber,
      xs: true
    }), sameF && /*#__PURE__*/React.createElement(Tag, {
      text: "SAME FIBER",
      color: T.emerald,
      xs: true
    }))), /*#__PURE__*/React.createElement("button", {
      onClick: () => selectMovement(mv),
      style: {
        flexShrink: 0,
        width: 36,
        height: 36,
        borderRadius: "50%",
        border: `2px solid ${mvC}`,
        background: mvC + "18",
        color: mvC,
        fontSize: 20,
        fontWeight: 700,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 1
      }
    }, "+")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexWrap: "wrap",
        gap: 3,
        marginBottom: 6
      }
    }, mv.muscles.map(m => /*#__PURE__*/React.createElement("span", {
      key: m,
      style: {
        fontSize: 9,
        fontWeight: 700,
        color: getMovementColor([m]),
        background: getMovementColor([m]) + "15",
        borderRadius: 4,
        padding: "2px 6px",
        border: `1px solid ${getMovementColor([m])}33`
      }
    }, m))), mv.cue && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: T.text,
        lineHeight: 1.5,
        padding: "6px 8px",
        background: T.surface,
        borderRadius: 6,
        marginBottom: 5,
        borderLeft: `2px solid ${mvC}44`
      }
    }, "💡 ", mv.cue), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: T.muted
      }
    }, mv.note), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexShrink: 0
      }
    }, /*#__PURE__*/React.createElement(Tag, {
      text: FIBER_LABEL[mv.fiber],
      color: FIBER_COLOR[mv.fiber],
      xs: true
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        fontWeight: 800,
        color: T.accent
      }
    }, plan.sets, "×", plan.reps)))));
  })))));
}

// ── LEARN ─────────────────────────────────────────────
function Learn({
  profile
}) {
  const [tab, setTab] = useState("volume");
  const [expandedSection, setExpandedSection] = useState(null);
  const [barTarget, setBarTarget] = useState("");
  const [barWeight, setBarWeight] = useState(45);
  const [timerSec, setTimerSec] = useState(null);
  const [timerRunning, setTimerRunning] = useState(false);

  // Bar weight calculator
  const PLATES = [45, 35, 25, 10, 5, 2.5];
  function calcPlates(target, bar) {
    const perSide = (target - bar) / 2;
    if (perSide < 0) return null;
    let remaining = perSide;
    const result = [];
    for (const p of PLATES) {
      const count = Math.floor(remaining / p);
      if (count > 0) {
        result.push({
          plate: p,
          count
        });
        remaining = Math.round((remaining - count * p) * 100) / 100;
      }
    }
    return {
      perSide,
      plates: result,
      remainder: remaining
    };
  }
  const calcResult = barTarget && !isNaN(Number(barTarget)) ? calcPlates(Number(barTarget), barWeight) : null;
  const SUPPS = [{
    name: "Creatine",
    dose: "5g",
    time: "AM",
    tier: 1,
    purpose: "ATP regeneration — direct strength output"
  }, {
    name: "Vitamin D3",
    dose: "5,000 IU",
    time: "AM",
    tier: 1,
    purpose: "Testosterone + immune — most people deficient"
  }, {
    name: "Vitamin K2 (MK-7)",
    dose: "200 mcg",
    time: "AM",
    tier: 1,
    purpose: "Directs calcium to bone, away from arteries"
  }, {
    name: "Zinc",
    dose: "15 mg",
    time: "AM",
    tier: 2,
    purpose: "LH signaling — testosterone precursor"
  }, {
    name: "Boron",
    dose: "3 mg",
    time: "AM",
    tier: 3,
    purpose: "SHBG reduction — increases free testosterone"
  }, {
    name: "Royal Jelly",
    dose: "500 mg",
    time: "AM",
    tier: 4,
    purpose: "Recovery + hormonal environment + BDNF"
  }, {
    name: "Bee Pollen",
    dose: "1,500 mg",
    time: "AM",
    tier: 3,
    purpose: "Anti-inflammatory + mild aromatase inhibition"
  }, {
    name: "Bamboo Extract",
    dose: "300 mg",
    time: "AM",
    tier: 4,
    purpose: "Connective tissue + joint integrity"
  }, {
    name: "Magnesium Glycinate",
    dose: "400 mg",
    time: "PM",
    tier: 2,
    purpose: "Deep sleep quality + cortisol reduction"
  }, {
    name: "Fish Oil (EPA+DHA)",
    dose: "3,600 mg",
    time: "PM",
    tier: 2,
    purpose: "Inflammation resolution + joint health"
  }, {
    name: "Zinc",
    dose: "15 mg",
    time: "PM",
    tier: 2,
    purpose: "Overnight testosterone synthesis"
  }, {
    name: "Glycine",
    dose: "3,000 mg",
    time: "PM",
    tier: 3,
    purpose: "Sleep architecture + collagen synthesis"
  }, {
    name: "Melatonin",
    dose: "1–3 mg",
    time: "PM",
    tier: 3,
    purpose: "Circadian correction — start at 1mg"
  }];
  const TIER_C = {
    1: T.emerald,
    2: T.steel,
    3: T.gold,
    4: T.amber
  };
  const TIER_L = {
    1: "Essential",
    2: "High Value",
    3: "Optimize",
    4: "Advanced"
  };
  const MUSCLES = [{
    m: "Chest",
    bias: "Fast",
    reps: "6–10 str / 8–15 hyp",
    sets: "12–16"
  }, {
    m: "Back",
    bias: "Mixed",
    reps: "6–10 rows / 10–15 pull",
    sets: "14–18"
  }, {
    m: "Quads",
    bias: "Mixed",
    reps: "6–10 squat / 12–15 leg",
    sets: "14–18"
  }, {
    m: "Hamstrings",
    bias: "Slow",
    reps: "8–10 RDL / 12–20 curls",
    sets: "12–16"
  }, {
    m: "Glutes",
    bias: "Fast",
    reps: "6–12",
    sets: "12–16"
  }, {
    m: "Lat Delt",
    bias: "Slow",
    reps: "15–20",
    sets: "10–14"
  }, {
    m: "Rear Delt",
    bias: "Slow",
    reps: "15–25",
    sets: "10–14"
  }, {
    m: "Triceps",
    bias: "Mixed",
    reps: "6–12",
    sets: "10–14"
  }, {
    m: "Biceps",
    bias: "Mixed",
    reps: "10–15",
    sets: "10–14"
  }, {
    m: "Calves",
    bias: "Slow",
    reps: "15–25",
    sets: "12–20"
  }];
  const PHASES = [{
    n: 1,
    l: "Recomp",
    mo: "Months 1–3",
    cal: "Maintenance",
    c: T.steel,
    desc: "Shift composition — less fat, same weight. Protein floor non-negotiable. Scale stays stable."
  }, {
    n: 2,
    l: "Lean Bulk",
    mo: "Months 4–6",
    cal: "+200–300 surplus",
    c: T.emerald,
    desc: "Add mass minimally. Scale trends up 0.5–1 lb/week. Only carbs change — never training."
  }, {
    n: 3,
    l: "Cut",
    mo: "Months 7–9",
    cal: "300–500 deficit",
    c: T.amber,
    desc: "Reveal muscle built in Phase 2. Training never changes — only calories."
  }, {
    n: 4,
    l: "Peak",
    mo: "Months 10–12",
    cal: "Maintenance",
    c: T.gold,
    desc: "Beat Phase 1 working weights on every major lift. The year compounds here."
  }];
  const VOLUME_SCIENCE = [{
    term: "MEV",
    full: "Minimum Effective Volume",
    color: T.steel,
    def: "The least amount of weekly training volume that reliably stimulates muscle growth for a given muscle group.",
    why: "Training below MEV produces little to no growth stimulus. Your muscles adapt to whatever demand you place on them — too little demand means no adaptation.",
    how: "Week 1 of each cycle. Start conservative. Establish your baseline performance before adding volume.",
    example: "If your chest MEV is 8 sets/week, doing 6 sets produces minimal growth. 8 sets starts the signal.",
    signal: "You finish sessions feeling like you could do significantly more. No real soreness. Strength doesn't improve."
  }, {
    term: "MAV",
    full: "Maximum Adaptive Volume",
    color: T.emerald,
    def: "The range of weekly sets that produces the fastest gains in muscle and strength before systemic fatigue starts to outpace the benefits.",
    why: "This is the sweet spot. Enough stress to force adaptation, not so much that recovery can't keep up. Most of your training should live here.",
    how: "Weeks 2–3 of each cycle. Add 10–20% sets vs Week 1. This is where you push.",
    example: "If MAV is 12–16 sets for chest, week 2 targets 13 sets, week 3 targets 15–16.",
    signal: "Sessions are challenging. Soreness is present but manageable. Strength is trending up cycle over cycle."
  }, {
    term: "MRV",
    full: "Maximum Recoverable Volume",
    color: T.amber,
    def: "The highest weekly set count you can handle and still fully recover before the next training session for that muscle group.",
    why: "Exceeding MRV means your body cannot repair the damage fast enough. Performance drops, injury risk rises, and progress stalls despite training harder.",
    how: "Week 3 peak only. Briefly touch MRV to maximize the deload supercompensation effect. Never sustain MRV.",
    example: "If MRV for chest is 20 sets, week 3 might reach 18–20. Week 4 drops to 50% for the deload.",
    signal: "Persistent joint soreness. Declining strength. Poor sleep. Lack of motivation. These are MRV warning signs."
  }];
  const SPLIT_SCIENCE = [{
    q: "Why every other day?",
    a: "Growth happens during rest, not during training. Training is the stimulus — it creates the demand signal. Recovery is when your body actually builds new muscle tissue and repairs connective tissue. The CNS (central nervous system) takes 48–72 hours to fully recover from a maximal strength session. Training before it recovers means lower output, higher injury risk, and accumulated fatigue that caps long-term progress."
  }, {
    q: "Why separate strength and hypertrophy phases?",
    a: "Strength days (1–6 reps) target fast-twitch fibers and CNS adaptations — they build the mass foundation. Hypertrophy days (12–20 reps) target slow-twitch fibers and metabolic stress — they build definition, shape, and serve as active CNS recovery from the heavy days. Together they develop every fiber type across the full rep spectrum. Running one without the other leaves half your muscle's development potential untapped."
  }, {
    q: "Why do the hypertrophy days follow strength days?",
    a: "The CNS recovers faster than the muscles. After 4 heavy strength sessions, your CNS is taxed but your muscles are ready to handle moderate load. Hypertrophy days provide exactly that — enough mechanical tension for growth stimulus, low enough CNS demand for active recovery. When you return to Day 1 strength work, your CNS is fully fresh. This is why you should set PRs every time you restart the strength phase."
  }, {
    q: "Why biceps with back and triceps with shoulders?",
    a: "Biceps are recruited heavily in every back pulling movement. Triceps are extremely synergistic with shoulder pressing. Pairing them means they get a pre-exhaustion stimulus from the compound work, then direct isolation to finish. More importantly — if you put triceps with back and biceps with shoulders, neither arm muscle gets adequate recovery. The current pairing ensures 48+ hours of rest for each arm muscle between sessions."
  }, {
    q: "What is a working set?",
    a: "A working set uses a weight where you physically cannot hit more reps than the upper bound of the given rep range. If the range is 1–6 and you could hit 7, that is a warm-up set. You need to add weight until the top of the range is your actual limit. Warm-up sets don't count toward your volume. Only working sets stimulate growth."
  }, {
    q: "How do I know if I'm progressing?",
    a: "Check your log. Compare this cycle's Week 1 working weights to last cycle's Week 1. If you hit more reps at the same load, or the same reps at higher load — you progressed. If weights are identical for 2+ cycles, something is wrong: protein deficit, insufficient sleep, too much volume, or not enough deload recovery."
  }, {
    q: "What happens if I miss a session?",
    a: "Pick up exactly where you left off. Don't double up. Don't try to compress two sessions into one. An extra rest day is never a problem — the Superhuman split is built to accommodate real life. The 16-day cycle doesn't reset because you missed one day. Simply resume on the next training day."
  }];
  const TABS = [{
    id: "volume",
    l: "MEV / MAV / MRV"
  }, {
    id: "split",
    l: "The Split"
  }, {
    id: "fiber",
    l: "Fiber Science"
  }, {
    id: "supps",
    l: "Supplements"
  }, {
    id: "calc",
    l: "Bar Calculator"
  }, {
    id: "year",
    l: "Year Plan"
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "20px 20px 120px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.14em",
      color: T.dim,
      marginBottom: 4
    }
  }, "THE SCIENCE"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 24,
      fontWeight: 800,
      color: T.bright
    }
  }, "Education"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.muted,
      marginTop: 3
    }
  }, "Everything you need to know to execute this plan with intention.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      marginBottom: 20,
      overflowX: "auto",
      paddingBottom: 2
    }
  }, TABS.map(t => /*#__PURE__*/React.createElement("button", {
    key: t.id,
    onClick: () => setTab(t.id),
    style: {
      flexShrink: 0,
      background: tab === t.id ? T.accentBg : "transparent",
      border: `1px solid ${tab === t.id ? T.accent : T.border}`,
      color: tab === t.id ? T.accent : T.muted,
      borderRadius: 20,
      padding: "7px 14px",
      fontSize: 11,
      fontWeight: tab === t.id ? 700 : 400,
      cursor: "pointer",
      letterSpacing: "0.02em"
    }
  }, t.l))), tab === "volume" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Card, {
    style: {
      background: T.goldBg,
      border: `1px solid ${T.goldDim}`,
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: T.accent,
      marginBottom: 5
    }
  }, "WHY THIS MATTERS"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.text,
      lineHeight: 1.7
    }
  }, "MEV, MAV, and MRV are the three volume landmarks that determine whether your training produces growth, maintains it, or breaks it down. Every set prescription in this plan is calibrated against these landmarks. Understanding them is what separates structured programming from random lifting.")), VOLUME_SCIENCE.map((v, i) => {
    const isOpen = expandedSection === v.term;
    return /*#__PURE__*/React.createElement("div", {
      key: v.term,
      style: {
        marginBottom: 10
      }
    }, /*#__PURE__*/React.createElement("div", {
      onClick: () => setExpandedSection(isOpen ? null : v.term),
      style: {
        background: T.card,
        border: `1px solid ${isOpen ? v.color + "44" : T.border}`,
        borderRadius: isOpen ? "12px 12px 0 0" : 12,
        padding: "14px 16px",
        cursor: "pointer",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 44,
        height: 44,
        borderRadius: 10,
        flexShrink: 0,
        background: v.color + "18",
        border: `1px solid ${v.color}44`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        fontWeight: 800,
        color: v.color
      }
    }, v.term), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 700,
        fontSize: 14,
        color: T.bright
      }
    }, v.full), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: T.muted,
        marginTop: 1
      }
    }, v.def.slice(0, 60), "…"))), /*#__PURE__*/React.createElement("span", {
      style: {
        color: T.dim,
        fontSize: 16,
        flexShrink: 0
      }
    }, isOpen ? "−" : "+")), isOpen && /*#__PURE__*/React.createElement("div", {
      style: {
        background: T.surface,
        border: `1px solid ${v.color}33`,
        borderTop: "none",
        borderRadius: "0 0 12px 12px",
        padding: "16px 16px 18px"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        color: T.text,
        lineHeight: 1.7,
        marginBottom: 14
      }
    }, v.def), [{
      label: "WHY IT EXISTS",
      text: v.why,
      c: v.color
    }, {
      label: "HOW TO USE IT",
      text: v.how,
      c: T.steel
    }, {
      label: "EXAMPLE",
      text: v.example,
      c: T.muted
    }, {
      label: "WARNING SIGNS",
      text: v.signal,
      c: T.amber
    }].map(s => /*#__PURE__*/React.createElement("div", {
      key: s.label,
      style: {
        marginBottom: 10,
        padding: "10px 12px",
        background: s.c + "0E",
        borderLeft: `3px solid ${s.c}`,
        borderRadius: "0 8px 8px 0"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9,
        fontWeight: 700,
        color: s.c,
        letterSpacing: "0.1em",
        marginBottom: 4
      }
    }, s.label), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        color: T.text,
        lineHeight: 1.6
      }
    }, s.text)))));
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement(Label, null, "How The 4-Week Wave Uses These Landmarks"), [{
    week: "Week 1",
    zone: "MEV",
    color: T.steel,
    rir: "2–3 RIR",
    sets: "Baseline",
    action: "Establish technique. No rushing. Set your baseline numbers."
  }, {
    week: "Week 2",
    zone: "MAV",
    color: T.emerald,
    rir: "1–2 RIR",
    sets: "+10–20%",
    action: "Add sets or load. Push into the growth zone."
  }, {
    week: "Week 3",
    zone: "MRV",
    color: T.amber,
    rir: "0–1 RIR",
    sets: "+15–30%",
    action: "Peak effort. Briefly touch the ceiling. Manage fatigue."
  }, {
    week: "Week 4",
    zone: "Deload",
    color: T.dim,
    rir: "3–4 RIR",
    sets: "50% / 60–70% load",
    action: "Supercompensation. Growth is cemented here — don't skip."
  }].map((w, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      gap: 10,
      padding: "10px 0",
      borderBottom: i < 3 ? `1px solid ${T.border}` : "none",
      alignItems: "flex-start"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 60,
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 700,
      color: T.bright
    }
  }, w.week), /*#__PURE__*/React.createElement(Tag, {
    text: w.zone,
    color: w.color,
    xs: true
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: T.muted,
      marginBottom: 2
    }
  }, w.rir, " · ", w.sets), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: T.text,
      lineHeight: 1.5
    }
  }, w.action)))))), tab === "split" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Card, {
    style: {
      background: T.goldBg,
      border: `1px solid ${T.goldDim}`,
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: T.accent,
      marginBottom: 5
    }
  }, "THE CORE LOGIC"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.text,
      lineHeight: 1.7
    }
  }, "The Superhuman Physique program is an 8-session, 16-day cycle. Every design decision — the rest days, the strength-before-hypertrophy order, the muscle pairings — has a specific physiological reason. This section explains all of them.")), /*#__PURE__*/React.createElement(Card, {
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement(Label, null, "The 16-Day Cycle Visualized"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 4
    }
  }, Array.from({
    length: 16
  }, (_, i) => {
    const day = i + 1;
    const isRest = day % 2 === 0;
    const sesh = SESSIONS_DATA[day];
    const phaseColor = sesh?.phase === "strength" ? T.crimson : T.steel;
    return /*#__PURE__*/React.createElement("div", {
      key: day,
      style: {
        width: "calc(12.5% - 4px)",
        aspectRatio: "1",
        borderRadius: 6,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: isRest ? T.surface : phaseColor + "18",
        border: `1px solid ${isRest ? T.border : phaseColor + "44"}`
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: isRest ? T.dim : phaseColor
      }
    }, day), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 7,
        color: isRest ? T.dim : phaseColor,
        textAlign: "center",
        lineHeight: 1.1,
        marginTop: 1
      }
    }, isRest ? "REST" : sesh?.phase === "strength" ? "STR" : "HYP"));
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 12,
      marginTop: 10,
      fontSize: 10
    }
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: T.crimson
    }
  }, "■"), " Strength (Days 1,3,5,7)"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: T.steel
    }
  }, "■"), " Hypertrophy (Days 9,11,13,15)"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: T.dim
    }
  }, "■"), " Rest"))), SPLIT_SCIENCE.map((s, i) => {
    const isOpen = expandedSection === `split-${i}`;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        marginBottom: 8
      }
    }, /*#__PURE__*/React.createElement("div", {
      onClick: () => setExpandedSection(isOpen ? null : `split-${i}`),
      style: {
        background: T.card,
        border: `1px solid ${isOpen ? T.accent + "44" : T.border}`,
        borderRadius: isOpen ? "10px 10px 0 0" : 10,
        padding: "13px 16px",
        cursor: "pointer",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        fontWeight: 600,
        color: T.bright
      }
    }, s.q), /*#__PURE__*/React.createElement("span", {
      style: {
        color: T.dim,
        fontSize: 16,
        flexShrink: 0
      }
    }, isOpen ? "−" : "+")), isOpen && /*#__PURE__*/React.createElement("div", {
      style: {
        background: T.surface,
        border: `1px solid ${T.accent}22`,
        borderTop: "none",
        borderRadius: "0 0 10px 10px",
        padding: "14px 16px"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        color: T.text,
        lineHeight: 1.75
      }
    }, s.a)));
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 20,
      padding: "10px 14px",
      background: T.surface,
      borderRadius: 8,
      border: `1px solid ${T.border}`,
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: T.dim,
      letterSpacing: "0.08em"
    }
  }, "PROGRAM FOUNDATION"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: T.muted,
      marginTop: 4,
      lineHeight: 1.5
    }
  }, "Built on the training principles of Ziad Mansour's split methodology. Expanded, adapted, and made your own.")), tab === "fiber" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Card, {
    style: {
      background: T.goldBg,
      border: `1px solid ${T.goldDim}`,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: T.accent,
      marginBottom: 5
    }
  }, "CORE PRINCIPLE"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.text,
      lineHeight: 1.7
    }
  }, "Every rep range in this plan is determined by fiber type biology. Fast-twitch fibers are larger and drive mass. Slow-twitch drive definition. Training both the same way is the most common programming mistake in existence.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 8,
      marginBottom: 16
    }
  }, [{
    type: "Fast-Twitch (Type II)",
    reps: "1–12",
    size: "Larger — primary mass driver",
    recover: "Slower — needs full rest",
    energy: "Anaerobic",
    color: T.crimson
  }, {
    type: "Slow-Twitch (Type I)",
    reps: "15–25",
    size: "Smaller — definition + endurance",
    recover: "Faster",
    energy: "Aerobic",
    color: T.steel
  }].map(f => /*#__PURE__*/React.createElement(Card, {
    key: f.type,
    style: {
      border: `1px solid ${f.color}30`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: f.color,
      marginBottom: 8
    }
  }, f.type), [["Rep range", f.reps], ["Role", f.size], ["Recovery", f.recover], ["Energy", f.energy]].map(([k, v]) => /*#__PURE__*/React.createElement("div", {
    key: k,
    style: {
      display: "flex",
      justifyContent: "space-between",
      fontSize: 11,
      marginBottom: 4,
      flexWrap: "wrap",
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: T.dim
    }
  }, k), /*#__PURE__*/React.createElement("span", {
    style: {
      color: T.text,
      fontWeight: 600,
      textAlign: "right",
      maxWidth: 120
    }
  }, v)))))), /*#__PURE__*/React.createElement(Label, null, "Muscle Group Fiber Map"), MUSCLES.map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: m.m,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "9px 0",
      borderBottom: i < MUSCLES.length - 1 ? `1px solid ${T.border}` : "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 72,
      fontSize: 13,
      fontWeight: 600,
      color: T.bright,
      flexShrink: 0
    }
  }, m.m), /*#__PURE__*/React.createElement(Tag, {
    text: m.bias,
    color: m.bias === "Fast" ? T.crimson : m.bias === "Slow" ? T.steel : T.gold
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      fontSize: 11,
      color: T.muted
    }
  }, m.reps), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: T.accent,
      fontWeight: 600,
      flexShrink: 0,
      whiteSpace: "nowrap"
    }
  }, m.sets))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Tempo — The Most Ignored Variable"), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.muted,
      lineHeight: 1.6,
      marginBottom: 12
    }
  }, "Tempo controls which fibers are recruited and how much mechanical tension accumulates. Rushing the eccentric (lowering) phase is the single most common way lifters leave growth on the table."), [{
    phase: "Eccentric (lowering)",
    tempo: "2–4 seconds",
    why: "Creates the most muscle damage and mechanical tension — the primary hypertrophy driver.",
    c: T.crimson
  }, {
    phase: "Isometric (bottom hold)",
    tempo: "0–2 seconds",
    why: "Eliminates momentum. Forces the muscle to generate force from a dead stop.",
    c: T.amber
  }, {
    phase: "Concentric (lifting)",
    tempo: "Explosive intent",
    why: "Fast concentric recruits maximum fast-twitch fibers regardless of actual bar speed.",
    c: T.emerald
  }, {
    phase: "Peak contraction",
    tempo: "1–2s squeeze",
    why: "Critical for slow-twitch muscles: calves, rear delts, lateral delts, biceps.",
    c: T.steel
  }].map((t, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      padding: "8px 0",
      borderBottom: i < 3 ? `1px solid ${T.border}` : "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 3
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      color: T.bright
    }
  }, t.phase), /*#__PURE__*/React.createElement(Tag, {
    text: t.tempo,
    color: t.c,
    xs: true
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: T.muted,
      lineHeight: 1.5
    }
  }, t.why)))))), tab === "supps" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Card, {
    style: {
      background: T.goldBg,
      border: `1px solid ${T.goldDim}`,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: T.accent,
      marginBottom: 5
    }
  }, "FOUNDATION RULE"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.text,
      lineHeight: 1.7
    }
  }, "Supplements optimize a system that is already working. Creatine does not fix a protein deficit. Magnesium does not fix poor sleep hygiene. Build the foundation first — then stack on top.")), ["AM", "PM"].map(timing => /*#__PURE__*/React.createElement("div", {
    key: timing,
    style: {
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.12em",
      color: timing === "AM" ? T.accent : T.steel,
      marginBottom: 10
    }
  }, timing === "AM" ? "MORNING — WITH BREAKFAST" : "EVENING — BEFORE SLEEP"), SUPPS.filter(s => s.time === timing).map((s, i) => {
    const key = `supp-${timing}-${i}`;
    const isOpen = expandedSection === key;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        marginBottom: 7
      }
    }, /*#__PURE__*/React.createElement("div", {
      onClick: () => setExpandedSection(isOpen ? null : key),
      style: {
        background: T.card,
        border: `1px solid ${isOpen ? TIER_C[s.tier] + "44" : T.border}`,
        borderRadius: isOpen ? "9px 9px 0 0" : 9,
        padding: "11px 14px",
        cursor: "pointer",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 600,
        fontSize: 13,
        color: T.bright
      }
    }, s.name), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: T.muted,
        marginTop: 2
      }
    }, s.purpose)), /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "right",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 4
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        fontWeight: 700,
        color: T.accent
      }
    }, s.dose), /*#__PURE__*/React.createElement(Tag, {
      text: TIER_L[s.tier],
      color: TIER_C[s.tier],
      xs: true
    }))), isOpen && /*#__PURE__*/React.createElement("div", {
      style: {
        background: T.surface,
        border: `1px solid ${TIER_C[s.tier]}22`,
        borderTop: "none",
        borderRadius: "0 0 9px 9px",
        padding: "12px 14px"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: T.text,
        lineHeight: 1.7
      }
    }, s.name === "Creatine" && "Stored in muscle as phosphocreatine (PCr). During 1–6 rep strength sets, PCr donates a phosphate to ADP to regenerate ATP. More creatine = more ATP = more power sustained = more reps at peak output. Saturates muscle stores over ~28 days of daily use.", s.name === "Vitamin D3" && "A fat-soluble secosteroid hormone precursor. Active form (calcitriol) binds receptors in Leydig cells where testosterone is produced. Deficiency directly caps testosterone output. Most people training indoors are deficient year-round.", s.name === "Vitamin K2 (MK-7)" && "Activates osteocalcin and matrix Gla protein. These two proteins direct calcium into bone matrix and prevent arterial calcification. Without K2, elevated calcium from D3 supplementation can deposit in arteries. MK-7 form has a 72-hour half-life — once daily dosing is sufficient.", s.name === "Zinc" && "Essential cofactor for luteinizing hormone (LH) activity — the pituitary signal that tells Leydig cells to produce testosterone. Deficiency from sweat losses is extremely common in training athletes. Split AM/PM to maintain stable serum levels.", s.name === "Boron" && "Inhibits sex hormone-binding globulin (SHBG) — the protein that binds testosterone and renders it biologically inactive. 6 mg/day produces a 28% reduction in SHBG and 29% increase in free testosterone within one week in human trials.", s.name === "Royal Jelly" && "Contains 10-HDA (10-hydroxy-2-decenoic acid) — unique to royal jelly, found nowhere else in nature. Reduces pro-inflammatory cytokines post-training (recovery), weakly stimulates testosterone biosynthesis (hormonal), and promotes BDNF neurogenesis (cognitive). Use freeze-dried capsules only — fresh degrades rapidly.", s.name === "Bee Pollen" && "Contains flavonoids (quercetin, kaempferol) that act as natural aromatase inhibitors — reducing the conversion of testosterone to estrogen. Also provides anti-inflammatory antioxidant activity for recovery. Start at 250 mg and build up if you have any pollen allergies.", s.name === "Bamboo Extract" && "One of the richest plant sources of bioavailable orthosilicic acid. Silica is a structural cofactor in collagen synthesis — it accelerates cross-linking of collagen fibers in tendons, ligaments, and cartilage. Does NOT build muscle directly — it protects the connective tissue that lets you train heavy consistently for years.", s.name === "Magnesium Glycinate" && "Activates the parasympathetic nervous system and binds GABA receptors — the same mechanism as sleep medications, without dependency. Glycinate form bound to glycine which has independent sleep benefits. Improves slow-wave deep sleep where growth hormone secretion is highest.", s.name === "Fish Oil (EPA+DHA)" && "EPA and DHA replace pro-inflammatory omega-6 fatty acids in cell membranes. Heavy training generates necessary inflammation for adaptation — but chronic unresolved inflammation blunts recovery and suppresses testosterone. 3,600 mg refers to combined EPA+DHA content, not total fish oil weight. Check your label.", s.name === "Glycine" && "Inhibitory neurotransmitter that lowers core body temperature 0.3–0.5°C — the key trigger for deep sleep onset. Also the primary amino acid in collagen — supports joint and connective tissue recovery. Synergistic with magnesium glycinate through independent sleep pathways.", s.name === "Melatonin" && "Signals the circadian system that it is time to sleep — doesn't cause sedation directly. Effective dose is 0.3–1 mg. The common 5–10 mg doses in stores are 10–30× higher than needed and suppress your natural melatonin production over time. Start at 1 mg. Only go to 3 mg if 1 mg is insufficient after 2 weeks.")));
  })))), tab === "calc" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Card, {
    style: {
      background: T.goldBg,
      border: `1px solid ${T.goldDim}`,
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: T.accent,
      marginBottom: 5
    }
  }, "HOW TO USE"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.text,
      lineHeight: 1.7
    }
  }, "Enter your target total weight. The calculator shows exactly which plates to load on each side of the bar. Standard bar = 45 lbs. EZ bar = 25 lbs. Smith machine bar = 15–25 lbs depending on your gym.")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Bar Weight"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      flexWrap: "wrap"
    }
  }, [{
    w: 45,
    l: "Standard Bar (45 lbs)"
  }, {
    w: 35,
    l: "Trap Bar (35 lbs)"
  }, {
    w: 25,
    l: "EZ Bar (25 lbs)"
  }, {
    w: 15,
    l: "Smith / Light (15 lbs)"
  }].map(b => /*#__PURE__*/React.createElement("button", {
    key: b.w,
    onClick: () => setBarWeight(b.w),
    style: {
      background: barWeight === b.w ? T.accentBg : T.card,
      border: `1px solid ${barWeight === b.w ? T.accent : T.border}`,
      color: barWeight === b.w ? T.accent : T.muted,
      borderRadius: 8,
      padding: "7px 12px",
      fontSize: 11,
      fontWeight: barWeight === b.w ? 700 : 400,
      cursor: "pointer"
    }
  }, b.l)))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Target Total Weight (lbs)"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    placeholder: "e.g. 225",
    value: barTarget,
    onChange: e => setBarTarget(e.target.value),
    style: {
      width: "100%",
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: 8,
      padding: "12px 14px",
      color: T.bright,
      fontSize: 18,
      fontWeight: 700,
      outline: "none",
      fontFamily: "inherit",
      boxSizing: "border-box"
    }
  })), calcResult && /*#__PURE__*/React.createElement(Card, {
    glow: true,
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: T.dim,
      letterSpacing: "0.08em"
    }
  }, "TOTAL WEIGHT"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 28,
      fontWeight: 700,
      color: T.accent
    }
  }, barTarget, " lbs")), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "right"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: T.dim,
      letterSpacing: "0.08em"
    }
  }, "PER SIDE"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 24,
      fontWeight: 700,
      color: T.bright
    }
  }, calcResult.perSide, " lbs"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      marginBottom: 14,
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 3,
      alignItems: "center",
      flexDirection: "row-reverse"
    }
  }, calcResult.plates.flatMap(p => Array.from({
    length: p.count
  }, (_, ci) => /*#__PURE__*/React.createElement("div", {
    key: `L-${p.plate}-${ci}`,
    style: {
      width: p.plate >= 45 ? 16 : p.plate >= 25 ? 14 : p.plate >= 10 ? 12 : p.plate >= 5 ? 10 : 8,
      height: p.plate >= 45 ? 56 : p.plate >= 25 ? 48 : p.plate >= 10 ? 40 : p.plate >= 5 ? 32 : 26,
      background: p.plate >= 45 ? T.crimson : p.plate >= 25 ? T.amber : p.plate >= 10 ? T.gold : p.plate >= 5 ? T.steel : T.emerald,
      borderRadius: 2,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      writingMode: "vertical-rl",
      fontSize: 8,
      fontWeight: 700,
      color: T.bg,
      flexShrink: 0
    }
  }, p.plate)))), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 60,
      height: 10,
      background: T.muted,
      borderRadius: 3,
      flexShrink: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 8,
      color: T.bg,
      fontWeight: 700
    }
  }, barWeight), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 3,
      alignItems: "center"
    }
  }, calcResult.plates.flatMap(p => Array.from({
    length: p.count
  }, (_, ci) => /*#__PURE__*/React.createElement("div", {
    key: `R-${p.plate}-${ci}`,
    style: {
      width: p.plate >= 45 ? 16 : p.plate >= 25 ? 14 : p.plate >= 10 ? 12 : p.plate >= 5 ? 10 : 8,
      height: p.plate >= 45 ? 56 : p.plate >= 25 ? 48 : p.plate >= 10 ? 40 : p.plate >= 5 ? 32 : 26,
      background: p.plate >= 45 ? T.crimson : p.plate >= 25 ? T.amber : p.plate >= 10 ? T.gold : p.plate >= 5 ? T.steel : T.emerald,
      borderRadius: 2,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      writingMode: "vertical-rl",
      fontSize: 8,
      fontWeight: 700,
      color: T.bg,
      flexShrink: 0
    }
  }, p.plate))))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: T.dim,
      letterSpacing: "0.08em",
      marginBottom: 8
    }
  }, "PLATES PER SIDE"), calcResult.plates.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.muted
    }
  }, "Bar only — no plates needed."), calcResult.plates.map((p, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "6px 0",
      borderBottom: i < calcResult.plates.length - 1 ? `1px solid ${T.border}` : "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 28,
      height: 28,
      borderRadius: 4,
      background: p.plate >= 45 ? T.crimson : p.plate >= 25 ? T.amber : p.plate >= 10 ? T.gold : p.plate >= 5 ? T.steel : T.emerald,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 11,
      fontWeight: 700,
      color: T.bg
    }
  }, p.plate), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: T.bright
    }
  }, p.plate, " lb plate")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      fontWeight: 700,
      color: T.accent
    }
  }, "× ", p.count))), calcResult.remainder > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      padding: "6px 10px",
      background: T.crimsonBg,
      border: `1px solid ${T.crimson}33`,
      borderRadius: 6,
      fontSize: 12,
      color: T.crimson
    }
  }, "⚠ ", calcResult.remainder, " lbs unaccounted — round to nearest available plate."))), barTarget && calcResult === null && /*#__PURE__*/React.createElement(Card, {
    style: {
      background: T.crimsonBg,
      border: `1px solid ${T.crimson}33`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.crimson
    }
  }, "Target weight is less than the bar. Enter a weight above ", barWeight, " lbs.")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Quick Load — Common Working Sets"), [{
    lift: "Bench Press",
    weight: 135
  }, {
    lift: "Bench Press",
    weight: 185
  }, {
    lift: "Back Squat",
    weight: 225
  }, {
    lift: "Back Squat",
    weight: 315
  }, {
    lift: "Deadlift",
    weight: 275
  }, {
    lift: "Deadlift",
    weight: 405
  }, {
    lift: "Military Press",
    weight: 95
  }, {
    lift: "Military Press",
    weight: 135
  }].map((q, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    onClick: () => setBarTarget(String(q.weight)),
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      background: T.card,
      border: `1px solid ${T.border}`,
      borderRadius: 8,
      padding: "6px 12px",
      fontSize: 11,
      cursor: "pointer",
      color: T.muted,
      margin: "0 6px 6px 0"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: T.dim
    }
  }, q.lift), /*#__PURE__*/React.createElement("span", {
    style: {
      color: T.accent,
      fontWeight: 700
    }
  }, q.weight, " lbs"))))), tab === "year" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Card, {
    style: {
      background: T.goldBg,
      border: `1px solid ${T.goldDim}`,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: T.accent,
      marginBottom: 5
    }
  }, "THE LOGIC"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.text,
      lineHeight: 1.7
    }
  }, "Recomp before bulk. Bulk before cut. Peak last. This sequence ensures you're building on a lean, optimized base — not adding fat on top of fat or cutting before you've built anything worth revealing.")), PHASES.map(p => /*#__PURE__*/React.createElement(Card, {
    key: p.n,
    style: {
      marginBottom: 10,
      border: `1px solid ${p.c}${profile?.goal === p.id ? "66" : "30"}`,
      background: profile?.goal === p.id ? p.c + "0E" : T.card
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 12,
      alignItems: "flex-start"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 34,
      height: 34,
      borderRadius: "50%",
      flexShrink: 0,
      background: p.c + "18",
      border: `2px solid ${p.c}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 13,
      fontWeight: 700,
      color: p.c
    }
  }, p.n), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 7,
      alignItems: "center",
      marginBottom: 3,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      fontSize: 15,
      color: T.bright
    }
  }, p.l), /*#__PURE__*/React.createElement(Tag, {
    text: p.mo,
    color: p.c
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: p.c,
      marginBottom: 5
    }
  }, "Calories: ", p.cal), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.muted,
      lineHeight: 1.5
    }
  }, p.desc))))), /*#__PURE__*/React.createElement(Card, {
    style: {
      marginTop: 6,
      background: T.steelBg,
      border: `1px solid ${T.steel}33`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: T.steel,
      marginBottom: 6
    }
  }, "THE CARDINAL RULE"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.text,
      lineHeight: 1.7
    }
  }, "Training and cardio NEVER change between phases. Only calories change. Dropping training volume to lose fat is how you lose muscle instead of fat. Your body composition is determined in the kitchen — your muscle is preserved in the gym."))));
}

// ── PROGRESS ─────────────────────────────────────────

// ── MEDITATION CARD ───────────────────────────────────
function MeditationCard({
  session,
  onComplete
}) {
  const [active, setActive] = useState(false);
  const [done, setDone] = useState(false);
  const s = session;
  return /*#__PURE__*/React.createElement(Card, {
    style: {
      marginBottom: 10,
      border: `1px solid ${active ? T.violet : done ? T.emerald : T.border}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: () => setActive(!active),
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      fontSize: 13,
      color: done ? T.emerald : T.bright
    }
  }, s.title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: T.muted,
      marginTop: 2
    }
  }, s.desc)), /*#__PURE__*/React.createElement("div", {
    style: {
      flexShrink: 0,
      display: "flex",
      gap: 8,
      alignItems: "center"
    }
  }, done && /*#__PURE__*/React.createElement(Tag, {
    text: "DONE",
    color: T.emerald,
    xs: true
  }), /*#__PURE__*/React.createElement(Tag, {
    text: `${s.mins} min`,
    color: T.violet,
    xs: true
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      color: T.dim,
      fontSize: 14
    }
  }, active ? "−" : "+"))), active && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      borderTop: `1px solid ${T.border}`,
      paddingTop: 12
    },
    onClick: e => e.stopPropagation()
  }, s.steps.map((step, si) => /*#__PURE__*/React.createElement("div", {
    key: si,
    style: {
      display: "flex",
      gap: 10,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 20,
      height: 20,
      borderRadius: "50%",
      background: T.violet + "22",
      border: `1px solid ${T.violet}44`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 10,
      fontWeight: 700,
      color: T.violet,
      flexShrink: 0
    }
  }, si + 1), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: T.text,
      lineHeight: 1.6
    }
  }, step))), !done && /*#__PURE__*/React.createElement(Btn, {
    style: {
      width: "100%",
      marginTop: 8
    },
    onClick: () => {
      setDone(true);
      onComplete();
    }
  }, "✓ Complete ", s.mins, "-Min Session")));
}

// ── BODY COMP CALCULATOR ─────────────────────────────
function calcBodyFatPct(measurements) {
  const {
    height,
    waist,
    neck,
    hip,
    sex
  } = measurements;
  const h = parseFloat(height),
    w = parseFloat(waist),
    n = parseFloat(neck),
    hp = parseFloat(hip);
  if (!h || !w || !n) return null;
  let pct;
  if (sex === "male") {
    pct = 86.010 * Math.log10(w - n) - 70.041 * Math.log10(h) + 36.76;
  } else {
    if (!hp) return null;
    pct = 163.205 * Math.log10(w + hp - n) - 97.684 * Math.log10(h) - 78.387;
  }
  return Math.max(3, Math.min(60, pct));
}
function bfCategory(pct) {
  if (pct == null) return {
    color: T.dim,
    label: ""
  };
  if (pct < 10) return {
    color: T.steel,
    label: "Essential Fat"
  };
  if (pct < 20) return {
    color: T.emerald,
    label: "Athletic"
  };
  if (pct < 25) return {
    color: T.amber,
    label: "Fitness"
  };
  if (pct < 32) return {
    color: T.amber,
    label: "Average"
  };
  return {
    color: T.crimson,
    label: "Above Average"
  };
}

// BMI — CDC standard imperial formula: weight(lb) / height(in)^2 * 703
function calcBMI(weightLbs, heightIn) {
  const w = parseFloat(weightLbs),
    h = parseFloat(heightIn);
  if (!w || !h) return null;
  return w * 703 / (h * h);
}
function bmiCategory(bmi) {
  if (bmi == null) return {
    color: T.dim,
    label: ""
  };
  if (bmi < 18.5) return {
    color: T.steel,
    label: "Underweight"
  };
  if (bmi < 25) return {
    color: T.emerald,
    label: "Healthy Range"
  };
  if (bmi < 30) return {
    color: T.amber,
    label: "Overweight"
  };
  return {
    color: T.crimson,
    label: "Obese"
  };
}

// FFMI — Fat-Free Mass Index (Kouri et al. 1995). Unlike BMI, this isolates
// lean mass from fat, so it actually measures muscularity, not just size.
// Normalized to 1.8m reference height so different heights compare fairly.
function calcFFMI(weightLbs, heightIn, bfPct) {
  const w = parseFloat(weightLbs),
    h = parseFloat(heightIn);
  if (!w || !h || bfPct == null) return null;
  const heightM = h * 0.0254;
  const weightKg = w * 0.453592;
  const leanKg = weightKg * (1 - bfPct / 100);
  const ffmi = leanKg / (heightM * heightM);
  const normalized = ffmi + 6.1 * (1.8 - heightM);
  return {
    raw: ffmi,
    normalized
  };
}
function ffmiCategory(normFFMI, sex = "male") {
  if (normFFMI == null) return {
    color: T.dim,
    label: ""
  };
  // Women's natural FFMI distribution sits ~3-5 points lower than men's
  const v = sex === "female" ? normFFMI + 4 : normFFMI;
  if (v < 18) return {
    color: T.steel,
    label: "Average"
  };
  if (v < 20) return {
    color: T.amber,
    label: "Above Average"
  };
  if (v < 22) return {
    color: T.emerald,
    label: "Athletic"
  };
  if (v < 23) return {
    color: T.accent,
    label: "Excellent"
  };
  if (v < 25) return {
    color: T.gold,
    label: "Elite Natural"
  };
  return {
    color: T.crimson,
    label: "Approaching/Exceeding Natural Limit"
  };
}
function BodyCompCalculator({
  currentWeight,
  profileGoal = "recomp",
  profileHeight = "",
  uid = null,
  bodyCompLog: bodyCompLogProp,
  setBodyCompLog: setBodyCompLogProp
}) {
  const [bf, setBf] = useState({
    height: profileHeight,
    waist: "",
    neck: "",
    hip: "",
    sex: "male"
  });
  const [_bodyCompLog, _setBodyCompLog] = usePersistedState(STORAGE_KEYS.BODYCOMP_LOG, []);
  const bodyCompLog = bodyCompLogProp !== undefined ? bodyCompLogProp : _bodyCompLog;
  const setBodyCompLog = setBodyCompLogProp || _setBodyCompLog;
  const [selectedEntry, setSelectedEntry] = useState(null);
  const sorted = [...bodyCompLog].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1] || null;
  const first = sorted[0] || null;
  const hasHistory = sorted.length > 0;

  // BMI uses the height on file (profile or last logged measurement) + current bodyweight
  const bmiHeight = profileHeight || latest?.measurements?.height || bf.height;
  const bmi = calcBMI(currentWeight, bmiHeight);
  const bmiCat = bmiCategory(bmi);
  const ffmiResult = latest ? calcFFMI(currentWeight, bmiHeight, latest.pct) : null;
  const ffmiCat = ffmiResult ? ffmiCategory(ffmiResult.normalized, bf.sex) : null;
  function logBodyComp() {
    const pct = calcBodyFatPct(bf);
    if (pct == null) return;
    const fatLbs = pct / 100 * currentWeight;
    const leanLbs = currentWeight - fatLbs;
    const muscleLbs = leanLbs * 0.85;
    const today = new Date().toISOString().slice(0, 10);
    const entry = {
      date: today,
      dateLabel: new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "2-digit"
      }),
      pct: parseFloat(pct.toFixed(1)),
      weight: currentWeight,
      fatLbs: parseFloat(fatLbs.toFixed(1)),
      leanLbs: parseFloat(leanLbs.toFixed(1)),
      muscleLbs: parseFloat(muscleLbs.toFixed(1)),
      measurements: {
        ...bf
      }
    };
    setBodyCompLog(prev => {
      const filtered = prev.filter(e => e.date !== today);
      return [...filtered, entry];
    });
    if (uid) fsSet(uid, "bodyCompLog", today, entry);
    setBf({
      height: "",
      waist: "",
      neck: "",
      hip: "",
      sex: bf.sex
    });
  }
  const cat = bfCategory(latest?.pct);

  // Change since first entry (or since last entry if only 2)
  const pctChange = hasHistory && sorted.length > 1 ? latest.pct - first.pct : null;
  const muscleChange = hasHistory && sorted.length > 1 ? latest.muscleLbs - first.muscleLbs : null;
  const fatChange = hasHistory && sorted.length > 1 ? latest.fatLbs - first.fatLbs : null;

  // Goal-relative interpretation
  const goalFeedback = (() => {
    if (pctChange == null) return null;
    const losingFat = fatChange < -0.3;
    const gainingMuscle = muscleChange > 0.3;
    const losingMuscle = muscleChange < -0.3;
    const gainingFat = fatChange > 0.3;
    if (profileGoal === "cut") {
      if (losingFat && !losingMuscle) return {
        ok: true,
        text: "On track — losing fat while holding muscle. This is exactly what a cut should look like."
      };
      if (losingFat && losingMuscle) return {
        ok: false,
        text: "Losing fat, but muscle is dropping too. Check protein intake and consider a smaller deficit."
      };
      if (!losingFat) return {
        ok: false,
        text: "Fat loss has stalled. Tighten the deficit or check adherence."
      };
    }
    if (profileGoal === "bulk") {
      if (gainingMuscle && !gainingFat) return {
        ok: true,
        text: "Clean gain — muscle is up without meaningful fat gain. Keep this pace."
      };
      if (gainingMuscle && gainingFat) return {
        ok: false,
        text: "Gaining both muscle and fat. Normal in a bulk, but watch the fat gain rate."
      };
      if (!gainingMuscle && gainingFat) return {
        ok: false,
        text: "Gaining fat without muscle gain — surplus may be too aggressive or training volume too low."
      };
    }
    if (profileGoal === "recomp" || profileGoal === "peak") {
      if (losingFat && gainingMuscle) return {
        ok: true,
        text: "Ideal recomp signal — simultaneous fat loss and muscle gain."
      };
      if (losingFat && !gainingMuscle) return {
        ok: true,
        text: "Fat is trending down. Muscle is holding steady — solid recomp progress."
      };
      if (!losingFat && gainingMuscle) return {
        ok: true,
        text: "Muscle is up. Fat hasn't moved yet — give it more time or tighten nutrition slightly."
      };
      return {
        ok: false,
        text: "No clear movement yet. Stay consistent — composition change is slower than the scale."
      };
    }
    return null;
  })();
  return /*#__PURE__*/React.createElement(Card, {
    style: {
      marginBottom: 14,
      border: `1px solid ${T.steel}33`
    }
  }, /*#__PURE__*/React.createElement(Label, {
    color: T.steel
  }, "Body Composition"), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "8px 12px",
      background: T.steelBg,
      borderRadius: 8,
      marginBottom: 14,
      fontSize: 12,
      color: T.text,
      lineHeight: 1.6
    }
  }, "U.S. Navy formula — neck, waist, height. ±3–4% accuracy. Log monthly — composition changes slower than bodyweight."), !hasHistory ? /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "20px 16px",
      textAlign: "center",
      border: `1px dashed ${T.border}`,
      borderRadius: 10,
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 24,
      marginBottom: 6
    }
  }, "📐"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 700,
      color: T.muted
    }
  }, "No measurements logged yet"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: T.dim,
      marginTop: 3
    }
  }, "Take your first measurement below to start tracking")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 48,
      fontWeight: 800,
      color: cat.color,
      letterSpacing: "-0.03em",
      lineHeight: 1
    }
  }, latest.pct, "%"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: cat.color,
      fontWeight: 700,
      marginTop: 4,
      letterSpacing: "0.08em"
    }
  }, cat.label), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: "10px 0 4px",
      position: "relative",
      height: 6,
      borderRadius: 3,
      overflow: "hidden",
      background: `linear-gradient(90deg,${T.steel},${T.emerald},${T.amber},${T.crimson})`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: -2,
      left: `${Math.min(latest.pct * 1.8, 98)}%`,
      width: 10,
      height: 10,
      borderRadius: "50%",
      background: T.bright,
      border: `2px solid ${cat.color}`,
      transform: "translateX(-50%)"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      fontSize: 8,
      color: T.dim,
      marginTop: 2
    }
  }, /*#__PURE__*/React.createElement("span", null, "5%"), /*#__PURE__*/React.createElement("span", null, "10%"), /*#__PURE__*/React.createElement("span", null, "20%"), /*#__PURE__*/React.createElement("span", null, "30%"), /*#__PURE__*/React.createElement("span", null, "40%+")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: T.dim,
      marginTop: 6
    }
  }, "Last logged ", latest.dateLabel)), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      fontWeight: 700,
      color: T.dim,
      letterSpacing: "0.08em",
      marginBottom: 8
    }
  }, "CURRENT COMPOSITION"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: 8
    }
  }, [{
    l: "Muscle Mass",
    v: `${latest.muscleLbs}`,
    sub: "lbs",
    c: T.emerald
  }, {
    l: "Lean Mass",
    v: `${latest.leanLbs}`,
    sub: "lbs",
    c: T.steel
  }, {
    l: "Fat Mass",
    v: `${latest.fatLbs}`,
    sub: "lbs",
    c: T.amber
  }].map(s => /*#__PURE__*/React.createElement("div", {
    key: s.l,
    style: {
      textAlign: "center",
      padding: "10px 4px",
      background: s.c + "0E",
      border: `1px solid ${s.c}33`,
      borderRadius: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 17,
      fontWeight: 800,
      color: s.c
    }
  }, s.v, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      fontWeight: 600
    }
  }, " ", s.sub)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 8,
      color: T.dim,
      marginTop: 3,
      textTransform: "uppercase",
      letterSpacing: "0.04em"
    }
  }, s.l))))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: T.dim,
      marginBottom: 6,
      lineHeight: 1.4
    }
  }, "BMI measures size, FFMI measures muscle — together they tell the full story"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 8,
      marginBottom: 14
    }
  }, bmi != null && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "10px 12px",
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18,
      fontWeight: 800,
      color: bmiCat.color
    }
  }, bmi.toFixed(1)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9,
      color: T.dim,
      letterSpacing: "0.04em"
    }
  }, "BMI")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      fontWeight: 700,
      color: bmiCat.color,
      marginTop: 2
    }
  }, bmiCat.label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: T.dim,
      lineHeight: 1.4,
      marginTop: 4
    }
  }, "Ignores muscle — FFMI →")), ffmiResult != null && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "10px 12px",
      background: T.emeraldBg,
      border: `1px solid ${T.emerald}33`,
      borderRadius: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18,
      fontWeight: 800,
      color: ffmiCat.color
    }
  }, ffmiResult.normalized.toFixed(1)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9,
      color: T.dim,
      letterSpacing: "0.04em"
    }
  }, "FFMI")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      fontWeight: 700,
      color: ffmiCat.color,
      marginTop: 2
    }
  }, ffmiCat.label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: T.dim,
      lineHeight: 1.4,
      marginTop: 4
    }
  }, "Muscle relative to height — what BMI misses"))), pctChange !== null && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: 8,
      marginBottom: 14
    }
  }, [{
    l: "Body Fat",
    v: `${pctChange > 0 ? "+" : ""}${pctChange.toFixed(1)}%`,
    c: pctChange <= 0 ? T.emerald : T.amber
  }, {
    l: "Muscle Mass",
    v: `${muscleChange > 0 ? "+" : ""}${muscleChange.toFixed(1)} lbs`,
    c: muscleChange >= 0 ? T.emerald : T.crimson
  }, {
    l: "Fat Mass",
    v: `${fatChange > 0 ? "+" : ""}${fatChange.toFixed(1)} lbs`,
    c: fatChange <= 0 ? T.emerald : T.amber
  }].map(s => /*#__PURE__*/React.createElement("div", {
    key: s.l,
    style: {
      textAlign: "center",
      padding: "8px 4px",
      background: s.c + "0E",
      border: `1px solid ${s.c}33`,
      borderRadius: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 800,
      color: s.c
    }
  }, s.v), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 8,
      color: T.dim,
      marginTop: 2,
      textTransform: "uppercase",
      letterSpacing: "0.04em"
    }
  }, s.l)))), goalFeedback && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "10px 12px",
      marginBottom: 14,
      background: goalFeedback.ok ? T.emeraldBg : T.amberBg,
      border: `1px solid ${goalFeedback.ok ? T.emerald : T.amber}44`,
      borderRadius: 8,
      fontSize: 12,
      color: T.text,
      lineHeight: 1.6,
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", null, goalFeedback.ok ? "✓" : "⚠"), /*#__PURE__*/React.createElement("span", null, goalFeedback.text)), sorted.length > 1 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      fontWeight: 700,
      color: T.dim,
      letterSpacing: "0.08em",
      marginBottom: 8
    }
  }, "BODY FAT % TREND"), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      height: 70
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-end",
      gap: 4,
      height: "100%"
    }
  }, (() => {
    const pcts = sorted.map(e => e.pct);
    const max = Math.max(...pcts) + 1;
    const min = Math.min(...pcts) - 1;
    return sorted.map((e, i) => {
      const h = (e.pct - min) / (max - min) * 60 + 6;
      const isSel = selectedEntry === i;
      return /*#__PURE__*/React.createElement("div", {
        key: i,
        onClick: () => setSelectedEntry(isSel ? null : i),
        style: {
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          cursor: "pointer"
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          width: "100%",
          maxWidth: 28,
          borderRadius: "3px 3px 0 0",
          height: h,
          background: isSel ? T.accent : T.steel,
          transition: "background 0.15s"
        }
      }));
    });
  })())), selectedEntry !== null && sorted[selectedEntry] && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      padding: "8px 12px",
      background: T.accentBg,
      border: `1px solid ${T.accent}33`,
      borderRadius: 8,
      display: "flex",
      justifyContent: "space-between",
      fontSize: 11
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: T.muted
    }
  }, sorted[selectedEntry].dateLabel), /*#__PURE__*/React.createElement("span", {
    style: {
      color: T.bright,
      fontWeight: 700
    }
  }, sorted[selectedEntry].pct, "% · ", sorted[selectedEntry].muscleLbs, " lbs muscle")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: T.dim,
      marginTop: 6
    }
  }, sorted[0].dateLabel, " → ", sorted[sorted.length - 1].dateLabel, " · tap a bar for detail"))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: hasHistory ? `1px solid ${T.border}` : "none",
      paddingTop: hasHistory ? 14 : 0
    }
  }, /*#__PURE__*/React.createElement(Label, null, hasHistory ? "Log New Measurement" : "Take Your First Measurement"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      marginBottom: 12
    }
  }, ["male", "female"].map(s => /*#__PURE__*/React.createElement("button", {
    key: s,
    onClick: () => setBf(p => ({
      ...p,
      sex: s
    })),
    style: {
      flex: 1,
      padding: "8px 0",
      borderRadius: 8,
      cursor: "pointer",
      background: bf.sex === s ? T.steel + "22" : "transparent",
      border: `1px solid ${bf.sex === s ? T.steel : T.border}`,
      color: bf.sex === s ? T.steel : T.muted,
      fontSize: 12,
      fontWeight: 700
    }
  }, s.charAt(0).toUpperCase() + s.slice(1)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 8,
      marginBottom: 12
    }
  }, [{
    key: "height",
    label: "Height (inches)",
    ph: "70"
  }, {
    key: "neck",
    label: "Neck (inches)",
    ph: "15.5"
  }, {
    key: "waist",
    label: "Waist (inches)",
    ph: "32"
  }, ...(bf.sex === "female" ? [{
    key: "hip",
    label: "Hip (inches)",
    ph: "38"
  }] : [])].map(field => /*#__PURE__*/React.createElement("div", {
    key: field.key
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: T.dim,
      letterSpacing: "0.08em",
      marginBottom: 4,
      textTransform: "uppercase"
    }
  }, field.label), /*#__PURE__*/React.createElement("input", {
    type: "number",
    placeholder: field.ph,
    value: bf[field.key] || "",
    onChange: e => setBf(p => ({
      ...p,
      [field.key]: e.target.value
    })),
    style: {
      width: "100%",
      background: T.surface,
      border: `1px solid ${bf[field.key] ? T.steel : T.border}`,
      borderRadius: 8,
      padding: "10px 12px",
      color: T.bright,
      fontSize: 15,
      fontWeight: 700,
      outline: "none",
      fontFamily: "inherit",
      textAlign: "center",
      boxSizing: "border-box"
    }
  })))), /*#__PURE__*/React.createElement(Btn, {
    style: {
      width: "100%"
    },
    onClick: logBodyComp
  }, hasHistory ? "Log Measurement" : "Calculate & Save"), hasHistory && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: T.dim,
      textAlign: "center",
      marginTop: 8
    }
  }, sorted.length, " measurement", sorted.length !== 1 ? "s" : "", " logged · recommended every 3-4 weeks")));
}

// ── MACRO CALCULATOR ─────────────────────────────────
const ACTIVITY_LEVELS = [{
  id: "sedentary",
  label: "Sedentary",
  mult: 1.2,
  sub: "Desk job, no exercise"
}, {
  id: "light",
  label: "Light",
  mult: 1.375,
  sub: "1–3x/week light activity"
}, {
  id: "moderate",
  label: "Moderate",
  mult: 1.55,
  sub: "3–5x/week training"
}, {
  id: "active",
  label: "Active",
  mult: 1.725,
  sub: "6–7x/week hard training"
}, {
  id: "veryactive",
  label: "Very Active",
  mult: 1.9,
  sub: "2x/day training"
}];
const MACRO_GOALS = [{
  id: "recomp",
  label: "Recomp",
  calAdj: 0,
  proteinMult: 1.3,
  sub: "+0 cal (maintenance)"
}, {
  id: "bulk",
  label: "Lean Bulk",
  calAdj: +250,
  proteinMult: 1.2,
  sub: "+250 cal surplus"
}, {
  id: "cut",
  label: "Cut",
  calAdj: -350,
  proteinMult: 1.5,
  sub: "−350 cal deficit"
}, {
  id: "peak",
  label: "Peak",
  calAdj: 0,
  proteinMult: 1.4,
  sub: "Maintenance + performance"
}];
function MacroCalculator({
  currentWeight,
  defaultGoal = "recomp"
}) {
  const [macroGoal, setMacroGoal] = useState(defaultGoal);
  const [inputs, setInputs] = useState({
    weight: String(Math.round(currentWeight)),
    heightIn: "70",
    age: "28",
    sex: "male",
    activity: "moderate"
  });
  const [result, setResult] = useState(null);
  function calcMacros() {
    const w_kg = parseFloat(inputs.weight) * 0.453592;
    const h_cm = parseFloat(inputs.heightIn) * 2.54;
    const age = parseFloat(inputs.age);
    const bmr = inputs.sex === "male" ? 10 * w_kg + 6.25 * h_cm - 5 * age + 5 : 10 * w_kg + 6.25 * h_cm - 5 * age - 161;
    const mult = ACTIVITY_LEVELS.find(a => a.id === inputs.activity)?.mult || 1.55;
    const tdee = Math.round(bmr * mult);
    const goal = MACRO_GOALS.find(g => g.id === macroGoal);
    const total = tdee + (goal?.calAdj || 0);
    const prot = Math.round(parseFloat(inputs.weight) * (goal?.proteinMult || 1.3));
    const fat = Math.round(total * 0.25 / 9);
    const carb = Math.max(0, Math.round((total - prot * 4 - fat * 9) / 4));
    const pp = Math.round(prot * 4 / total * 100);
    const fp = Math.round(fat * 9 / total * 100);
    const cp = 100 - pp - fp;
    setResult({
      bmr: Math.round(bmr),
      tdee,
      total,
      prot,
      fat,
      carb,
      pp,
      fp,
      cp,
      calAdj: goal?.calAdj || 0,
      goalLabel: goal?.label
    });
  }
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Card, {
    style: {
      background: T.emeraldBg,
      border: `1px solid ${T.emerald}33`,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: T.emerald,
      marginBottom: 5
    }
  }, "MACRO CALCULATOR"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: T.text,
      lineHeight: 1.6
    }
  }, "Mifflin-St Jeor BMR × activity multiplier = TDEE. Protein is calculated first from bodyweight — never compromised. Carbs fill the remaining calories.")), /*#__PURE__*/React.createElement(Label, null, "Phase Goal"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 6,
      marginBottom: 14
    }
  }, MACRO_GOALS.map(g => /*#__PURE__*/React.createElement("button", {
    key: g.id,
    onClick: () => setMacroGoal(g.id),
    style: {
      padding: "10px 12px",
      borderRadius: 10,
      cursor: "pointer",
      textAlign: "left",
      background: macroGoal === g.id ? T.emerald + "18" : T.card,
      border: `1px solid ${macroGoal === g.id ? T.emerald : T.border}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 700,
      color: macroGoal === g.id ? T.emerald : T.bright
    }
  }, g.label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: T.dim,
      marginTop: 2
    }
  }, g.sub)))), /*#__PURE__*/React.createElement(Label, null, "Your Stats"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 8,
      marginBottom: 10
    }
  }, [{
    key: "weight",
    label: "Weight (lbs)",
    ph: "185"
  }, {
    key: "heightIn",
    label: "Height (in)",
    ph: "70"
  }, {
    key: "age",
    label: "Age",
    ph: "28"
  }].map(f => /*#__PURE__*/React.createElement("div", {
    key: f.key
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: T.dim,
      letterSpacing: "0.08em",
      marginBottom: 4,
      textTransform: "uppercase"
    }
  }, f.label), /*#__PURE__*/React.createElement("input", {
    type: "number",
    placeholder: f.ph,
    value: inputs[f.key],
    onChange: e => setInputs(p => ({
      ...p,
      [f.key]: e.target.value
    })),
    style: {
      width: "100%",
      background: T.surface,
      border: `1px solid ${inputs[f.key] ? T.emerald : T.border}`,
      borderRadius: 8,
      padding: "10px 12px",
      color: T.bright,
      fontSize: 15,
      fontWeight: 700,
      outline: "none",
      fontFamily: "inherit",
      textAlign: "center",
      boxSizing: "border-box"
    }
  }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: T.dim,
      letterSpacing: "0.08em",
      marginBottom: 4,
      textTransform: "uppercase"
    }
  }, "Sex"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 4
    }
  }, ["male", "female"].map(s => /*#__PURE__*/React.createElement("button", {
    key: s,
    onClick: () => setInputs(p => ({
      ...p,
      sex: s
    })),
    style: {
      flex: 1,
      padding: "10px 4px",
      borderRadius: 8,
      cursor: "pointer",
      fontSize: 11,
      fontWeight: 700,
      background: inputs.sex === s ? T.steel + "22" : "transparent",
      border: `1px solid ${inputs.sex === s ? T.steel : T.border}`,
      color: inputs.sex === s ? T.steel : T.muted
    }
  }, s.charAt(0).toUpperCase() + s.slice(1)))))), /*#__PURE__*/React.createElement(Label, null, "Activity Level"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 5,
      marginBottom: 14
    }
  }, ACTIVITY_LEVELS.map(a => /*#__PURE__*/React.createElement("button", {
    key: a.id,
    onClick: () => setInputs(p => ({
      ...p,
      activity: a.id
    })),
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "10px 14px",
      borderRadius: 10,
      cursor: "pointer",
      textAlign: "left",
      background: inputs.activity === a.id ? T.steel + "18" : "transparent",
      border: `1px solid ${inputs.activity === a.id ? T.steel : T.border}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 700,
      color: inputs.activity === a.id ? T.steel : T.bright
    }
  }, a.label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: T.dim
    }
  }, a.sub)))), /*#__PURE__*/React.createElement(Btn, {
    style: {
      width: "100%",
      marginBottom: 16
    },
    onClick: calcMacros
  }, "Calculate My Macros"), result && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: 8,
      marginBottom: 12
    }
  }, [{
    l: "BMR",
    v: result.bmr,
    sub: "base rate",
    c: T.dim
  }, {
    l: "TDEE",
    v: result.tdee,
    sub: "daily burn",
    c: T.steel
  }, {
    l: "Target",
    v: result.total,
    sub: "daily calories",
    c: T.emerald
  }].map(s => /*#__PURE__*/React.createElement(Card, {
    key: s.l,
    style: {
      padding: "10px 8px",
      textAlign: "center",
      background: s.c + "0E",
      border: `1px solid ${s.c}22`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 20,
      fontWeight: 800,
      color: s.c
    }
  }, s.v), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: T.dim,
      marginTop: 2,
      letterSpacing: "0.05em",
      textTransform: "uppercase"
    }
  }, s.l), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 8,
      color: T.dim
    }
  }, s.sub)))), result.calAdj !== 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "6px 12px",
      marginBottom: 12,
      background: result.calAdj > 0 ? T.amberBg : T.steelBg,
      border: `1px solid ${result.calAdj > 0 ? T.amber : T.steel}33`,
      borderRadius: 8,
      fontSize: 11,
      color: T.text
    }
  }, "TDEE ", result.calAdj > 0 ? "+" : "", result.calAdj, " cal — ", result.goalLabel, " phase adjustment"), /*#__PURE__*/React.createElement(Label, null, "Daily Macro Targets"), [{
    m: "Protein",
    c: T.crimson,
    g: result.prot,
    p: result.pp,
    cal: result.prot * 4,
    note: "Priority #1. Never compromise regardless of phase."
  }, {
    m: "Carbs",
    c: T.amber,
    g: result.carb,
    p: result.cp,
    cal: result.carb * 4,
    note: "Primary fuel. Adjust first when scaling calories up or down."
  }, {
    m: "Fat",
    c: T.steel,
    g: result.fat,
    p: result.fp,
    cal: result.fat * 9,
    note: "Hormone production. Never go below 20% of calories."
  }].map(m => /*#__PURE__*/React.createElement(Card, {
    key: m.m,
    style: {
      marginBottom: 8,
      border: `1px solid ${m.c}33`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 10,
      height: 10,
      borderRadius: "50%",
      background: m.c,
      boxShadow: `0 0 6px ${m.c}88`
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      fontWeight: 700,
      color: T.bright
    }
  }, m.m)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: T.muted
    }
  }, m.cal, " cal"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 22,
      fontWeight: 800,
      color: m.c
    }
  }, m.g, "g"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: T.dim
    }
  }, m.p, "%"))), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 4,
      background: T.border,
      borderRadius: 2,
      marginBottom: 6,
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: "100%",
      background: m.c,
      borderRadius: 2,
      width: `${m.p}%`,
      boxShadow: `0 0 8px ${m.c}66`,
      transition: "width 0.6s cubic-bezier(0.34,1.56,0.64,1)"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: T.dim,
      lineHeight: 1.4
    }
  }, m.note))), /*#__PURE__*/React.createElement(Card, {
    style: {
      marginTop: 4
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Meal Timing"), [{
    time: "Pre-workout",
    macro: `${Math.round(result.carb * 0.25)}g carbs · ${Math.round(result.prot * 0.2)}g protein`,
    note: "1–2 hrs before"
  }, {
    time: "Post-workout",
    macro: `${Math.round(result.carb * 0.3)}g carbs · ${Math.round(result.prot * 0.3)}g protein`,
    note: "Within 60 min"
  }, {
    time: "Before bed",
    macro: `${Math.round(result.prot * 0.2)}g protein · fats`,
    note: "Overnight MPS"
  }, {
    time: "Other meals",
    macro: "Distribute remaining across 2–3 meals",
    note: "Every 3–5 hours"
  }].map((t, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 10,
      padding: "8px 0",
      borderBottom: i < 3 ? `1px solid ${T.border}` : "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 700,
      color: T.bright,
      flexShrink: 0,
      width: 100
    }
  }, t.time), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "right"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: T.accent,
      fontWeight: 600
    }
  }, t.macro), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: T.dim
    }
  }, t.note)))))));
}
function Progress({
  profile,
  sessionLogs = {},
  supplementLog = {},
  setSupplementLog = () => {},
  uid = null,
  weightLog: weightLogProp,
  setWeightLog: setWeightLogProp,
  recoveryLog: recoveryLogProp,
  setRecoveryLog: setRecoveryLogProp,
  bodyCompLog: bodyCompLogProp,
  setBodyCompLog: setBodyCompLogProp
}) {
  const [activeSection, setActiveSection] = useState("strength");
  const [activeLift, setActiveLift] = useState("bench");
  const [selectedBar, setSelectedBar] = useState(null);
  const [selectedMuscle, setSelectedMuscle] = useState(null);
  const [selectedWeighIn, setSelectedWeighIn] = useState(null);
  const [selectedMovement, setSelectedMovement] = useState(null);
  const [movementSearch, setMovementSearch] = useState("");
  const [movementMuscleFilter, setMovementMuscleFilter] = useState("ALL");
  const [showAddForm, setShowAddForm] = useState(false);
  const [customLib, setCustomLib] = usePersistedState(STORAGE_KEYS.SESSION_LOGS + "_mvlib", []);
  const [newMov, setNewMov] = useState({
    name: "",
    muscles: [],
    fiber: "mixed",
    equipment: ["full"],
    note: ""
  });
  // Use props from App() if provided (Firestore-synced), otherwise fall back to local state
  const [_weightLog, _setWeightLog] = usePersistedState(STORAGE_KEYS.WEIGHT_LOG, DEFAULT_WEIGHT_LOG);
  const weightLog = weightLogProp !== undefined ? weightLogProp : _weightLog;
  const setWeightLog = setWeightLogProp || _setWeightLog;
  const [newWeight, setNewWeight] = useState("");
  const [recovery, setRecovery] = useState({
    sleep: "",
    soreness: "",
    energy: ""
  });
  const [_recoveryLog, _setRecoveryLog] = usePersistedState(STORAGE_KEYS.RECOVERY_LOG, DEFAULT_RECOVERY_LOG);
  const recoveryLog = recoveryLogProp !== undefined ? recoveryLogProp : _recoveryLog;
  const setRecoveryLog = setRecoveryLogProp || _setRecoveryLog;
  // bodyCompLog for export — use prop if provided
  const [_bodyCompLogForExport] = usePersistedState(STORAGE_KEYS.BODYCOMP_LOG, []);
  const bodyCompLogForExport = bodyCompLogProp !== undefined ? bodyCompLogProp : _bodyCompLogForExport;

  // ── LIFT TRACKING — mapped to real exercise IDs ──────────────
  // Map lift picker → library IDs (primary movement per lift slot)
  const LIFTS_MAP = {
    bench: {
      label: "Bench Press",
      exIds: ["c1", "c2", "c5"],
      strDay: 3,
      hypDay: 11
    },
    squat: {
      label: "Back Squat",
      exIds: ["l1", "l2", "l3"],
      strDay: 1,
      hypDay: 9
    },
    ohp: {
      label: "Military Press",
      exIds: ["s1", "s2", "s3"],
      strDay: 7,
      hypDay: 15
    },
    deadlift: {
      label: "Deadlift",
      exIds: ["b1", "b2", "b15"],
      strDay: 5,
      hypDay: null
    }
  };

  // Build chart data from real sessionLogs for the active lift
  const activeLiftMeta = LIFTS_MAP[activeLift];
  const liftHistory = useMemo(() => {
    const allData = [];
    activeLiftMeta.exIds.forEach(id => {
      getLiftHistory(sessionLogs, id).forEach(entry => {
        allData.push(entry);
      });
    });
    // Sort by date and deduplicate by cycle+phase (keep highest weight)
    const byKey = {};
    allData.forEach(e => {
      const key = `${e.cycle}-${e.phase}`;
      if (!byKey[key] || e.w > byKey[key].w) byKey[key] = e;
    });
    return Object.values(byKey).sort((a, b) => a.cycle !== b.cycle ? a.cycle - b.cycle : a.phase.localeCompare(b.phase));
  }, [sessionLogs, activeLift]);

  // Fallback empty chart message
  const hasLiftData = liftHistory.length > 0;

  // Derived: separate str vs hyp lines for dual-line chart
  const strData = liftHistory.filter(d => d.phase === "str");
  const hypData = liftHistory.filter(d => d.phase === "hyp");
  const hasHyp = hypData.length > 0;
  const allWeights = liftHistory.map(d => d.w);
  const liftMax = allWeights.length ? Math.max(...allWeights) : 200;
  const liftMin = allWeights.length ? Math.min(...allWeights) - 15 : 100;
  const strPR = strData.length ? Math.max(...strData.map(d => d.w)) : null;
  const strGain = strData.length > 1 ? strData[strData.length - 1].w - strData[0].w : 0;
  const hypPR = hasHyp ? Math.max(...hypData.map(d => d.w)) : null;

  // Volume computed from last 7 days of sessionLogs
  const VOLUME = useMemo(() => {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const weekLogs = Object.entries(sessionLogs).filter(([date]) => date >= cutoff).map(([, log]) => log);
    const setsByMuscle = {};
    weekLogs.forEach(dayLog => {
      Object.entries(dayLog.sets || {}).forEach(([exId, sets]) => {
        const mv = LIBRARY.find(m => m.id === exId);
        if (!mv) return;
        mv.muscles.forEach(muscle => {
          setsByMuscle[muscle] = (setsByMuscle[muscle] || 0) + sets.length;
        });
      });
    });
    return Object.entries(MUSCLE_MRV).map(([muscle, mrv]) => ({
      muscle,
      current: setsByMuscle[muscle] || 0,
      mrv,
      mev: Math.round(mrv * 0.44)
    })).filter(v => v.current > 0 || v.mrv >= 10);
  }, [sessionLogs]);

  // liftData kept as alias for history list (all entries)
  const liftData = liftHistory; // live from sessionLogs
  // Export state
  const [showExport, setShowExport] = useState(false);
  const [exportMsg, setExportMsg] = useState("");

  // 7-day rolling average
  // ── EXPORT FUNCTIONS ─────────────────────────────
  function exportData(format) {
    const bcSorted = [...bodyCompLogForExport].sort((a, b) => a.date.localeCompare(b.date));
    if (format === "csv") {
      const rows = [["Lift", "Phase", "Cycle", "Date", "Weight (lbs)", "Reps", "Est 1RM"], ...Object.keys(LIFTS_MAP).flatMap(key => getLiftHistory(sessionLogs, LIFTS_MAP[key].exIds[0]).map(d => [LIFTS_MAP[key].label, d.phase === "str" ? "Strength" : "Hypertrophy", d.cycle, d.date, d.w, d.r, Math.round(d.w * (1 + d.r / 30))])), [], ["Date", "Bodyweight (lbs)", "7-Day Avg"], ...weightLog.map((d, i) => [d.day, d.w, rolling7[i]]), [], ["Date", "Sleep (hrs)", "Soreness (1-10)", "Energy (1-10)"], ...recoveryLog.map(r => [r.date, r.sleep, r.soreness, r.energy]), [], ["Date", "Body Fat %", "BMI", "FFMI (Normalized)", "Fat Mass (lbs)", "Lean Mass (lbs)", "Muscle Mass (lbs)"], ...bcSorted.map(e => {
        const eHeight = e.measurements?.height;
        const eFfmi = calcFFMI(e.weight, eHeight, e.pct);
        return [e.dateLabel, e.pct, calcBMI(e.weight, eHeight)?.toFixed(1) || "—", eFfmi ? eFfmi.normalized.toFixed(1) : "—", e.fatLbs, e.leanLbs, e.muscleLbs];
      })];
      const csv = rows.map(r => r.join(",")).join("\n");
      const blob = new Blob([csv], {
        type: "text/csv"
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "superhuman_progress.csv";
      a.click();
      URL.revokeObjectURL(url);
      setExportMsg("✓ CSV downloaded — open in Excel, Google Sheets, or Numbers.");
      setTimeout(() => setExportMsg(""), 4000);
    } else {
      // PDF — build printable HTML and open in new tab
      const tableStyle = `border-collapse:collapse;width:100%;margin-bottom:24px;font-size:11px;`;
      const thStyle = `background:#1A1A2E;color:#fff;padding:6px 10px;text-align:left;`;
      const tdStyle = `padding:5px 10px;border-bottom:1px solid #eee;`;
      let html = `<html><head><title>Superhuman Physique — Progress Report</title>
        <style>body{font-family:Arial,sans-serif;padding:32px;color:#1a1a1a;max-width:900px;margin:0 auto;}
        h1{color:#1A1A2E;} h2{color:#C9A84C;font-size:14px;margin-top:24px;}
        @media print{button{display:none;}}</style></head><body>
        <h1>Superhuman Physique — Progress Report</h1>
        <p style="color:#888">Generated ${new Date().toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      })}</p>
        <button onclick="window.print()" style="background:#C9A84C;color:#fff;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:13px;margin-bottom:24px;">🖨 Print / Save as PDF</button>`;
      Object.keys(LIFTS_MAP).forEach(key => {
        const lift = LIFTS_MAP[key];
        const liftData = getLiftHistory(sessionLogs, lift.exIds[0]);
        if (liftData.length === 0) return;
        html += `<h2>${lift.label}</h2><table style="${tableStyle}">
          <tr>${["Phase", "Cycle", "Date", "Weight", "Reps", "Est 1RM"].map(h => `<th style="${thStyle}">${h}</th>`).join("")}</tr>
          ${liftData.map(d => `<tr>
            <td style="${tdStyle}">${d.phase === "str" ? "Strength" : "Hypertrophy"}</td>
            <td style="${tdStyle}">Cycle ${d.cycle}</td>
            <td style="${tdStyle}">${d.date}</td>
            <td style="${tdStyle}">${d.w} lbs</td>
            <td style="${tdStyle}">× ${d.r}</td>
            <td style="${tdStyle}">${Math.round(d.w * (1 + d.r / 30))} lbs</td>
          </tr>`).join("")}</table>`;
      });
      html += `<h2>Bodyweight Log</h2><table style="${tableStyle}">
        <tr>${["Date", "Weight (lbs)", "7-Day Avg"].map(h => `<th style="${thStyle}">${h}</th>`).join("")}</tr>
        ${weightLog.map((d, i) => `<tr>
          <td style="${tdStyle}">${d.day}</td>
          <td style="${tdStyle}">${d.w}</td>
          <td style="${tdStyle}">${rolling7[i]}</td>
        </tr>`).join("")}</table>`;
      html += `<h2>Recovery Log</h2><table style="${tableStyle}">
        <tr>${["Date", "Sleep", "Soreness", "Energy"].map(h => `<th style="${thStyle}">${h}</th>`).join("")}</tr>
        ${recoveryLog.map(r => `<tr>
          <td style="${tdStyle}">${r.date}</td>
          <td style="${tdStyle}">${r.sleep} hrs</td>
          <td style="${tdStyle}">${r.soreness}/10</td>
          <td style="${tdStyle}">${r.energy}/10</td>
        </tr>`).join("")}</table>`;
      if (bcSorted.length > 0) {
        html += `<h2>Body Composition</h2><table style="${tableStyle}">
          <tr>${["Date", "Body Fat %", "BMI", "FFMI", "Fat Mass", "Lean Mass", "Muscle Mass"].map(h => `<th style="${thStyle}">${h}</th>`).join("")}</tr>
          ${bcSorted.map(e => {
          const eHeight = e.measurements?.height;
          const eBmi = calcBMI(e.weight, eHeight);
          const eFfmi = calcFFMI(e.weight, eHeight, e.pct);
          return `<tr>
            <td style="${tdStyle}">${e.dateLabel}</td>
            <td style="${tdStyle}">${e.pct}%</td>
            <td style="${tdStyle}">${eBmi != null ? eBmi.toFixed(1) : "—"}</td>
            <td style="${tdStyle}">${eFfmi ? eFfmi.normalized.toFixed(1) : "—"}</td>
            <td style="${tdStyle}">${e.fatLbs} lbs</td>
            <td style="${tdStyle}">${e.leanLbs} lbs</td>
            <td style="${tdStyle}">${e.muscleLbs} lbs</td>
          </tr>`;
        }).join("")}</table>`;
      }
      html += `</body></html>`;
      const win = window.open("", "_blank");
      if (win) {
        win.document.write(html);
        win.document.close();
        setExportMsg("✓ PDF report opened in new tab — use Print > Save as PDF.");
      } else {
        setExportMsg("⚠ Pop-up blocked. Allow pop-ups to export PDF.");
      }
      setTimeout(() => setExportMsg(""), 5000);
    }
  }
  const rolling7 = weightLog.map((_, i) => {
    const slice = weightLog.slice(Math.max(0, i - 6), i + 1);
    return (slice.reduce((a, b) => a + b.w, 0) / slice.length).toFixed(1);
  });
  const wMax = weightLog.length ? Math.max(...weightLog.map(d => d.w)) + 1 : 200;
  const wMin = weightLog.length ? Math.min(...weightLog.map(d => d.w)) - 1 : 150;
  const avgRecovery = recoveryLog.length ? (recoveryLog.reduce((a, b) => a + b.energy, 0) / recoveryLog.length).toFixed(1) : "—";
  const avgSleep = recoveryLog.length ? (recoveryLog.reduce((a, b) => a + b.sleep, 0) / recoveryLog.length).toFixed(1) : "—";
  const SECTIONS = [{
    id: "strength",
    label: "Strength"
  }, {
    id: "body",
    label: "Body Comp"
  }, {
    id: "macros",
    label: "Macros"
  }, {
    id: "volume",
    label: "Volume"
  }, {
    id: "recovery",
    label: "Recovery"
  }, {
    id: "movements",
    label: "Movements"
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "20px 20px 120px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.14em",
      color: T.dim,
      marginBottom: 4
    }
  }, "TRACKING"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 24,
      fontWeight: 800,
      color: T.bright
    }
  }, "Progress")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4,1fr)",
      gap: 6,
      marginBottom: 16
    }
  }, [{
    l: "Sessions",
    v: String(getDerivedHistory(sessionLogs).length),
    c: T.accent
  }, {
    l: "PRs",
    v: String(countPRs(sessionLogs)),
    c: T.gold
  }, {
    l: "Phase",
    v: GOALS.find(g => g.id === profile?.goal)?.label || "Recomp",
    c: GOALS.find(g => g.id === profile?.goal)?.color || T.steel
  }, {
    l: "Streak",
    v: `${getStreak(sessionLogs)} days`,
    c: T.emerald
  }].map(s => /*#__PURE__*/React.createElement(Card, {
    key: s.l,
    style: {
      padding: "10px 6px",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 18,
      fontWeight: 700,
      color: s.c
    }
  }, s.v), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: T.dim,
      letterSpacing: "0.05em",
      marginTop: 2
    }
  }, s.l)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 5,
      marginBottom: 16,
      overflowX: "auto"
    }
  }, SECTIONS.map(s => /*#__PURE__*/React.createElement("button", {
    key: s.id,
    onClick: () => setActiveSection(s.id),
    style: {
      flexShrink: 0,
      background: activeSection === s.id ? T.accentBg : "transparent",
      border: `1px solid ${activeSection === s.id ? T.accent : T.border}`,
      color: activeSection === s.id ? T.accent : T.muted,
      borderRadius: 20,
      padding: "7px 14px",
      fontSize: 11,
      fontWeight: activeSection === s.id ? 700 : 400,
      cursor: "pointer"
    }
  }, s.label))), activeSection === "strength" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 5,
      marginBottom: 14,
      flexWrap: "wrap"
    }
  }, Object.entries(LIFTS_MAP).map(([id, l]) => /*#__PURE__*/React.createElement("button", {
    key: id,
    onClick: () => {
      setActiveLift(id);
      setSelectedBar(null);
    },
    style: {
      background: activeLift === id ? T.crimson + "18" : "transparent",
      border: `1px solid ${activeLift === id ? T.crimson : T.border}`,
      color: activeLift === id ? T.crimson : T.muted,
      borderRadius: 8,
      padding: "5px 12px",
      fontSize: 12,
      fontWeight: activeLift === id ? 700 : 400,
      cursor: "pointer"
    }
  }, l.label))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement(Card, {
    style: {
      flex: 1,
      padding: 12,
      background: T.crimson + "12",
      border: `1px solid ${T.crimson}33`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: T.crimson,
      fontWeight: 700,
      letterSpacing: "0.08em"
    }
  }, "STRENGTH PR"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 22,
      fontWeight: 700,
      color: T.bright
    }
  }, strPR ? strPR + " lbs" : "Log a session"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: T.muted
    }
  }, "+", strGain, " lbs gained")), hasHyp && /*#__PURE__*/React.createElement(Card, {
    style: {
      flex: 1,
      padding: 12,
      background: T.steelBg,
      border: `1px solid ${T.steel}33`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: T.steel,
      fontWeight: 700,
      letterSpacing: "0.08em"
    }
  }, "HYPERTROPHY PR"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 22,
      fontWeight: 700,
      color: T.bright
    }
  }, hypPR, " lbs"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: T.muted
    }
  }, "working weight"))), !hasLiftData ? /*#__PURE__*/React.createElement(Card, {
    style: {
      marginBottom: 14,
      padding: "32px 20px",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 28,
      marginBottom: 8
    }
  }, "📊"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 700,
      color: T.muted,
      marginBottom: 4
    }
  }, "No lift data yet"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: T.dim,
      lineHeight: 1.5
    }
  }, "Complete sessions and log sets — your chart builds automatically")) : /*#__PURE__*/React.createElement(Card, {
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement(Label, null, activeLiftMeta.label, " — Strength vs Hypertrophy"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      fontSize: 10
    }
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: T.crimson
    }
  }, "■"), " Strength"), hasHyp && /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: T.steel
    }
  }, "■"), " Hypertrophy"))), (() => {
    const cycles = [...new Set(activeLiftMeta.data.map(d => d.cycle))];
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "flex-end",
        gap: 6,
        height: 90,
        marginBottom: 8
      }
    }, cycles.map((cyc, ci) => {
      const s = strData.find(d => d.cycle === cyc);
      const h = hypData.find(d => d.cycle === cyc);
      const isSelStr = s && selectedBar === `${activeLift}-str-${cyc}`;
      const isSelHyp = h && selectedBar === `${activeLift}-hyp-${cyc}`;
      return /*#__PURE__*/React.createElement("div", {
        key: cyc,
        style: {
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 7,
          color: T.gold,
          visibility: s?.w === strPR ? "visible" : "hidden"
        }
      }, "PR"), /*#__PURE__*/React.createElement("div", {
        style: {
          width: "100%",
          display: "flex",
          gap: 1,
          alignItems: "flex-end",
          height: 72
        }
      }, s && /*#__PURE__*/React.createElement("div", {
        onClick: () => setSelectedBar(isSelStr ? null : `${activeLift}-str-${cyc}`),
        style: {
          flex: 1,
          borderRadius: "2px 2px 0 0",
          background: isSelStr ? T.bright : s.w === strPR ? T.gold : T.crimson + "99",
          height: `${(s.w - liftMin) / (liftMax - liftMin) * 68 + 4}px`,
          cursor: "pointer",
          transition: "all 0.2s",
          outline: isSelStr ? `1px solid ${T.gold}` : "none"
        }
      }), h && hasHyp && /*#__PURE__*/React.createElement("div", {
        onClick: () => setSelectedBar(isSelHyp ? null : `${activeLift}-hyp-${cyc}`),
        style: {
          flex: 1,
          borderRadius: "2px 2px 0 0",
          background: isSelHyp ? T.bright : T.steel + "99",
          height: `${(h.w - liftMin) / (liftMax - liftMin) * 68 + 4}px`,
          cursor: "pointer",
          transition: "all 0.2s",
          outline: isSelHyp ? `1px solid ${T.steel}` : "none"
        }
      })), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 8,
          color: T.dim
        }
      }, "C", cyc));
    }));
  })(), selectedBar !== null && (() => {
    const isStr = String(selectedBar).includes("-str-");
    const isHyp = String(selectedBar).includes("-hyp-");
    const cyc = selectedBar ? parseInt(String(selectedBar).split("-").pop()) : null;
    const d = isStr ? strData.find(x => x.cycle === cyc) : isHyp ? hypData.find(x => x.cycle === cyc) : null;
    if (!d) return null;
    const allSame = isStr ? strData : hypData;
    const idx = allSame.findIndex(x => x.cycle === cyc);
    const prev = idx > 0 ? allSame[idx - 1] : null;
    const delta = prev ? d.w - prev.w : null;
    const phaseColor = isStr ? T.crimson : T.steel;
    const phaseLabel = isStr ? "STRENGTH" : "HYPERTROPHY";
    return /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "12px 14px",
        background: phaseColor + "12",
        border: `1px solid ${phaseColor}33`,
        borderRadius: 8,
        marginBottom: 8
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: phaseColor,
        letterSpacing: "0.08em"
      }
    }, phaseLabel, " · ", d.date), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10,
        color: T.dim
      }
    }, " · Cycle ", cyc)), d.w === strPR && isStr && /*#__PURE__*/React.createElement(Tag, {
      text: "STR PR",
      color: T.gold,
      xs: true
    }), d.w === hypPR && isHyp && /*#__PURE__*/React.createElement(Tag, {
      text: "HYP PR",
      color: T.steel,
      xs: true
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 0
      }
    }, [{
      l: "Weight",
      v: `${d.w} lbs`
    }, {
      l: "Reps",
      v: `${d.r}`
    }, {
      l: "Est 1RM",
      v: `${Math.round(d.w * (1 + d.r / 30))} lbs`
    }, {
      l: "vs Prev",
      v: delta !== null ? `${delta >= 0 ? "+" : ""}${delta} lbs` : "—"
    }].map((s, i) => /*#__PURE__*/React.createElement("div", {
      key: s.l,
      style: {
        flex: 1,
        textAlign: "center",
        borderRight: i < 3 ? `1px solid ${phaseColor}22` : "none"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 14,
        fontWeight: 700,
        color: T.bright
      }
    }, s.v), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9,
        color: T.muted,
        marginTop: 1
      }
    }, s.l)))));
  })(), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      fontSize: 10,
      color: T.dim
    }
  }, /*#__PURE__*/React.createElement("span", null, "Tap any bar · C = Cycle number"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: T.gold
    }
  }, "Gold = PR"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    size: "sm",
    style: {
      flex: 1
    },
    onClick: () => exportData("csv")
  }, "⬇ Export CSV"), /*#__PURE__*/React.createElement(Btn, {
    variant: "outline",
    size: "sm",
    style: {
      flex: 1
    },
    onClick: () => exportData("pdf")
  }, "⬇ Export PDF")), exportMsg && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "8px 14px",
      background: T.emeraldBg,
      border: `1px solid ${T.emerald}33`,
      borderRadius: 8,
      fontSize: 12,
      color: T.emerald,
      marginBottom: 14
    }
  }, exportMsg), /*#__PURE__*/React.createElement(Label, null, "Complete History — ", activeLiftMeta.label), liftData.slice().reverse().map((d, i) => {
    const allSame = d.phase === "str" ? strData : hypData;
    const origIdx = allSame.findIndex(x => x.cycle === d.cycle && x.phase === d.phase);
    const prev = origIdx > 0 ? allSame[origIdx - 1] : null;
    const delta = prev ? d.w - prev.w : null;
    const e1rm = Math.round(d.w * (1 + d.r / 30));
    const phaseColor = d.phase === "str" ? T.crimson : T.steel;
    const selKey = `${activeLift}-${d.phase}-${d.cycle}`;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      onClick: () => setSelectedBar(selectedBar === selKey ? null : selKey),
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "10px 12px",
        marginBottom: 6,
        background: selectedBar === selKey ? phaseColor + "12" : T.card,
        border: `1px solid ${selectedBar === selKey ? phaseColor + "44" : T.border}`,
        borderRadius: 8,
        cursor: "pointer"
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6
      }
    }, /*#__PURE__*/React.createElement(Tag, {
      text: d.phase === "str" ? "STR" : "HYP",
      color: phaseColor,
      xs: true
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        color: T.bright
      }
    }, "Cycle ", d.cycle, " · ", d.date)), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: T.muted,
        marginTop: 2
      }
    }, "Est. 1RM: ", e1rm, " lbs", d.phase === "hyp" && " · Hypertrophy working weight")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        alignItems: "center"
      }
    }, delta !== null && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        fontWeight: 700,
        color: delta > 0 ? T.emerald : delta < 0 ? T.crimson : T.dim
      }
    }, delta > 0 ? "+" : "", delta), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 14,
        fontWeight: 700,
        color: T.bright
      }
    }, d.w, " lbs"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: T.muted
      }
    }, "×", d.r), d.w === strPR && d.phase === "str" && /*#__PURE__*/React.createElement(Tag, {
      text: "PR",
      color: T.gold,
      xs: true
    })));
  })), activeSection === "body" && /*#__PURE__*/React.createElement(React.Fragment, null, weightLog.length === 0 ? /*#__PURE__*/React.createElement(Card, {
    style: {
      marginBottom: 14,
      padding: "28px 20px",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 28,
      marginBottom: 8
    }
  }, "⚖️"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 700,
      color: T.muted,
      marginBottom: 4
    }
  }, "No weigh-ins logged yet"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: T.dim,
      lineHeight: 1.5
    }
  }, "Log your first weight below to start tracking your trend")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: 8,
      marginBottom: 14,
      width: "100%"
    }
  }, [{
    l: "Current",
    v: `${weightLog[weightLog.length - 1].w} lbs`,
    c: T.bright
  }, {
    l: "7-day avg",
    v: `${rolling7[rolling7.length - 1]} lbs`,
    c: T.accent
  }, {
    l: "Change",
    v: `${(weightLog[weightLog.length - 1].w - weightLog[0].w).toFixed(1)} lbs`,
    c: weightLog[weightLog.length - 1].w - weightLog[0].w <= 0 ? T.emerald : T.amber
  }].map(s => /*#__PURE__*/React.createElement(Card, {
    key: s.l,
    style: {
      padding: 12,
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 18,
      fontWeight: 800,
      color: s.c
    }
  }, s.v), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: T.dim,
      marginTop: 3,
      letterSpacing: "0.06em",
      textTransform: "uppercase"
    }
  }, s.l)))), /*#__PURE__*/React.createElement(Card, {
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Bodyweight Trend — Daily + 7-Day Avg"), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      height: 80,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-end",
      gap: 2,
      height: "100%",
      position: "absolute",
      inset: 0
    }
  }, weightLog.map((d, i) => {
    const h = (d.w - wMin) / (wMax - wMin) * 72 + 4;
    const isSel = selectedWeighIn === i;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      onClick: () => setSelectedWeighIn(isSel ? null : i),
      style: {
        flex: 1,
        borderRadius: "2px 2px 0 0",
        background: isSel ? T.accent : T.border,
        height: h,
        cursor: "pointer",
        transition: "background 0.15s"
      }
    });
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-end",
      gap: 2,
      height: "100%",
      position: "absolute",
      inset: 0,
      pointerEvents: "none"
    }
  }, rolling7.map((avg, i) => {
    const pct = (Number(avg) - wMin) / (wMax - wMin);
    const bottom = pct * 72 + 4;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        flex: 1,
        position: "relative"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        bottom: bottom - 3,
        left: "50%",
        transform: "translateX(-50%)",
        width: 5,
        height: 5,
        borderRadius: "50%",
        background: T.emerald
      }
    }));
  }))), selectedWeighIn !== null && weightLog[selectedWeighIn] && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "10px 14px",
      background: T.accentBg,
      border: `1px solid ${T.accent}33`,
      borderRadius: 8,
      marginBottom: 8,
      display: "flex",
      gap: 0
    }
  }, [{
    l: "Date",
    v: weightLog[selectedWeighIn].day
  }, {
    l: "Weight",
    v: `${weightLog[selectedWeighIn].w} lbs`
  }, {
    l: "7-day avg",
    v: `${rolling7[selectedWeighIn]} lbs`
  }, {
    l: "vs Prev",
    v: selectedWeighIn > 0 ? `${(weightLog[selectedWeighIn].w - weightLog[selectedWeighIn - 1].w).toFixed(1)} lbs` : "—"
  }].map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: s.l,
    style: {
      flex: 1,
      textAlign: "center",
      borderRight: i < 3 ? `1px solid ${T.accent}22` : "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 700,
      color: T.bright
    }
  }, s.v), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: T.muted,
      marginTop: 1
    }
  }, s.l)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      fontSize: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: T.dim
    }
  }, "Tap any bar · ", weightLog[0].day, " → ", weightLog[weightLog.length - 1].day), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: T.muted
    }
  }, "▮ Daily"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: T.emerald
    }
  }, "● 7-day avg"))))), /*#__PURE__*/React.createElement(Card, {
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Log Today's Weight"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "number",
    placeholder: "e.g. 183.5",
    "aria-label": "Today's bodyweight in pounds",
    value: newWeight,
    onChange: e => setNewWeight(e.target.value),
    style: {
      flex: 1,
      background: T.surface,
      border: `1px solid ${newWeight ? T.emerald : T.border}`,
      borderRadius: 8,
      padding: "10px 12px",
      color: T.bright,
      fontSize: 16,
      fontWeight: 700,
      outline: "none",
      fontFamily: "inherit"
    }
  }), /*#__PURE__*/React.createElement(Btn, {
    onClick: () => {
      if (newWeight) {
        const today = new Date().toLocaleDateString("en-US", {
          month: "short",
          day: "numeric"
        });
        const entry = {
          day: today,
          w: parseFloat(newWeight)
        };
        setWeightLog(prev => [...prev, entry]);
        if (uid) fsSet(uid, "weightLog", today, entry);
        setNewWeight("");
      }
    }
  }, "Log"))), /*#__PURE__*/React.createElement(Label, {
    color: T.steel
  }, "Body Composition Estimator"), /*#__PURE__*/React.createElement(Card, {
    style: {
      marginBottom: 14,
      border: `1px solid ${T.steel}33`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "8px 12px",
      background: T.steelBg,
      borderRadius: 8,
      marginBottom: 14,
      fontSize: 12,
      color: T.text,
      lineHeight: 1.6
    }
  }, "Uses the U.S. Navy body fat formula — neck, waist, and height measurements. ±3–4% accuracy vs DEXA. Track the trend, not the absolute number.")), /*#__PURE__*/React.createElement(BodyCompCalculator, {
    currentWeight: weightLog.length > 0 ? weightLog[weightLog.length - 1].w : parseFloat(profile?.weight) || 185,
    profileGoal: profile?.goal || "recomp",
    profileHeight: profile?.height || "",
    bodyCompLog: bodyCompLogForExport,
    setBodyCompLog: setBodyCompLogProp || (() => {}),
    uid: uid
  })), activeSection === "macros" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(MacroCalculator, {
    currentWeight: weightLog.length > 0 ? weightLog[weightLog.length - 1].w : parseFloat(profile?.weight) || 185,
    defaultGoal: profile?.goal || "recomp"
  })), activeSection === "volume" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Card, {
    style: {
      background: T.goldBg,
      border: `1px solid ${T.goldDim}`,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: T.accent,
      marginBottom: 5
    }
  }, "THIS WEEK'S VOLUME"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.text,
      lineHeight: 1.6
    }
  }, "Green = within MAV. Amber = approaching MRV (back off). Red = exceeded MRV (deload this muscle next session).")), VOLUME.map(v => {
    const mevPct = v.mev / v.mrv * 100;
    const curPct = Math.min(v.current / v.mrv * 100, 100);
    const color = curPct < mevPct * 1.2 ? T.steel : curPct < 80 ? T.emerald : curPct < 95 ? T.amber : T.crimson;
    const status = curPct < mevPct * 1.2 ? "Below MEV" : curPct < 80 ? "In MAV" : curPct < 95 ? "Near MRV" : "Exceeded MRV";
    const isSel = selectedMuscle === v.muscle;
    // Mock per-session contributions — production: derived from logged sets
    const contributions = [{
      session: "Day 1 — Strength",
      sets: Math.ceil(v.current * 0.55),
      date: "Jun 8"
    }, {
      session: "Day 9 — Hypertrophy",
      sets: Math.floor(v.current * 0.45),
      date: "Jun 1"
    }];
    return /*#__PURE__*/React.createElement("div", {
      key: v.muscle,
      onClick: () => setSelectedMuscle(isSel ? null : v.muscle),
      style: {
        marginBottom: 10,
        padding: "10px 12px",
        borderRadius: 10,
        cursor: "pointer",
        transition: "all 0.15s",
        background: isSel ? T.surface : "transparent",
        border: `1px solid ${isSel ? color + "44" : "transparent"}`
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 4
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 13,
        fontWeight: 600,
        color: T.bright
      }
    }, v.muscle), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        alignItems: "center"
      }
    }, /*#__PURE__*/React.createElement(Tag, {
      text: status,
      color: color,
      xs: true
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        fontWeight: 700,
        color
      }
    }, v.current, "/", v.mrv, " sets"))), /*#__PURE__*/React.createElement("div", {
      style: {
        position: "relative",
        height: 7,
        background: T.border,
        borderRadius: 4,
        overflow: "hidden"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        left: `${mevPct}%`,
        top: -2,
        width: 1,
        height: 10,
        background: T.dim
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        height: "100%",
        borderRadius: 3,
        background: color,
        width: `${curPct}%`,
        transition: "width 0.4s"
      }
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        fontSize: 9,
        color: T.dim,
        marginTop: 2
      }
    }, /*#__PURE__*/React.createElement("span", null, "MEV: ", v.mev), /*#__PURE__*/React.createElement("span", null, "MRV: ", v.mrv)), isSel && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 10,
        borderTop: `1px solid ${T.border}`,
        paddingTop: 10
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: T.dim,
        letterSpacing: "0.08em",
        marginBottom: 6
      }
    }, "SET SOURCES THIS WEEK"), contributions.map((c, ci) => /*#__PURE__*/React.createElement("div", {
      key: ci,
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "6px 0",
        borderBottom: ci < contributions.length - 1 ? `1px solid ${T.border}` : "none"
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: T.text
      }
    }, c.session), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: T.dim
      }
    }, c.date)), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 13,
        fontWeight: 700,
        color
      }
    }, c.sets, " sets"))), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 8,
        padding: "7px 10px",
        background: color + "12",
        borderRadius: 6,
        fontSize: 11,
        color: T.text,
        lineHeight: 1.5
      }
    }, status === "Exceeded MRV" && "Reduce sets next session — this muscle cannot recover at current volume.", status === "Near MRV" && "At the ceiling. Don't add sets until after the next deload.", status === "In MAV" && "Optimal training zone. Maintain or add 1–2 sets in Week 2–3.", status === "Below MEV" && "Not enough stimulus to grow. Add sets or check if you're skipping exercises.")));
  })), activeSection === "recovery" && /*#__PURE__*/React.createElement(React.Fragment, null, recoveryLog.length === 0 && /*#__PURE__*/React.createElement(Card, {
    style: {
      marginBottom: 14,
      padding: "24px 20px",
      textAlign: "center",
      border: `1px dashed ${T.border}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 26,
      marginBottom: 8
    }
  }, "🛌"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 700,
      color: T.muted,
      marginBottom: 4
    }
  }, "No check-ins yet"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: T.dim,
      lineHeight: 1.5
    }
  }, "Log your sleep, soreness, and energy below to start tracking recovery trends")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: 8,
      marginBottom: 14
    }
  }, [{
    l: "Avg Sleep",
    v: `${avgSleep} hrs`,
    c: Number(avgSleep) >= 7.5 ? T.emerald : T.amber
  }, {
    l: "Avg Energy",
    v: `${avgRecovery}/10`,
    c: Number(avgRecovery) >= 7 ? T.emerald : T.amber
  }, {
    l: "Check-ins",
    v: recoveryLog.length,
    c: T.steel
  }].map(s => /*#__PURE__*/React.createElement(Card, {
    key: s.l,
    style: {
      padding: 12,
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 17,
      fontWeight: 700,
      color: s.c
    }
  }, s.v), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: T.dim,
      marginTop: 4,
      letterSpacing: "0.06em"
    }
  }, s.l)))), Number(avgRecovery) < 6 && /*#__PURE__*/React.createElement(Card, {
    style: {
      background: T.crimsonBg,
      border: `1px solid ${T.crimson}44`,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: T.crimson,
      marginBottom: 4
    }
  }, "⚠ DELOAD SIGNAL"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.text
    }
  }, "Average energy below 6/10 over recent sessions. Consider scheduling a deload week — 50% sets, 60–70% load.")), /*#__PURE__*/React.createElement(Card, {
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Log Today's Recovery"), [{
    id: "sleep",
    label: "Sleep (hours)",
    placeholder: "7.5",
    max: 12,
    step: 0.5
  }, {
    id: "soreness",
    label: "Soreness (1–10)",
    placeholder: "4",
    max: 10,
    step: 1
  }, {
    id: "energy",
    label: "Energy (1–10)",
    placeholder: "7",
    max: 10,
    step: 1
  }].map(f => /*#__PURE__*/React.createElement("div", {
    key: f.id,
    style: {
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: T.dim,
      marginBottom: 4
    }
  }, f.label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "number",
    placeholder: f.placeholder,
    min: 0,
    max: f.max,
    step: f.step,
    value: recovery[f.id],
    onChange: e => setRecovery(prev => ({
      ...prev,
      [f.id]: e.target.value
    })),
    style: {
      flex: 1,
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: 8,
      padding: "9px 12px",
      color: T.bright,
      fontSize: 13,
      outline: "none",
      fontFamily: "inherit"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 80,
      height: 6,
      background: T.border,
      borderRadius: 3
    }
  }, recovery[f.id] && /*#__PURE__*/React.createElement("div", {
    style: {
      height: "100%",
      borderRadius: 3,
      width: `${Number(recovery[f.id]) / (f.id === "sleep" ? 12 : 10) * 100}%`,
      background: f.id === "soreness" ? Number(recovery[f.id]) > 6 ? T.crimson : T.emerald : Number(recovery[f.id]) > 5 ? T.emerald : T.amber
    }
  }))))), /*#__PURE__*/React.createElement(Btn, {
    style: {
      width: "100%"
    },
    onClick: () => {
      if (recovery.sleep && recovery.soreness && recovery.energy) {
        const today = new Date().toLocaleDateString("en-US", {
          month: "short",
          day: "numeric"
        });
        const entry = {
          date: today,
          sleep: Number(recovery.sleep),
          soreness: Number(recovery.soreness),
          energy: Number(recovery.energy)
        };
        setRecoveryLog(prev => [entry, ...prev]);
        if (uid) fsSet(uid, "recoveryLog", today, entry);
        setRecovery({
          sleep: "",
          soreness: "",
          energy: ""
        });
      }
    }
  }, "Save Check-In")), /*#__PURE__*/React.createElement(Label, null, "Recovery History"), recoveryLog.map((r, i) => {
    const energyC = r.energy >= 7 ? T.emerald : r.energy >= 5 ? T.amber : T.crimson;
    const sleepC = r.sleep >= 7.5 ? T.emerald : r.sleep >= 6 ? T.amber : T.crimson;
    return /*#__PURE__*/React.createElement(Card, {
      key: i,
      style: {
        marginBottom: 7
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 6
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        color: T.bright
      }
    }, r.date), /*#__PURE__*/React.createElement(Tag, {
      text: r.energy >= 7 ? "Good Recovery" : r.energy >= 5 ? "Moderate" : "Low — Monitor",
      color: energyC,
      xs: true
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 16
      }
    }, [{
      l: "Sleep",
      v: `${r.sleep}h`,
      c: sleepC
    }, {
      l: "Soreness",
      v: `${r.soreness}/10`,
      c: r.soreness <= 4 ? T.emerald : r.soreness <= 6 ? T.amber : T.crimson
    }, {
      l: "Energy",
      v: `${r.energy}/10`,
      c: energyC
    }].map(s => /*#__PURE__*/React.createElement("div", {
      key: s.l
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 9,
        color: T.dim
      }
    }, s.l), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 14,
        fontWeight: 700,
        color: s.c
      }
    }, s.v)))));
  })), activeSection === "movements" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.muted
    }
  }, LIBRARY.length + customLib.length, " movements · tap to see history")), /*#__PURE__*/React.createElement(Btn, {
    size: "sm",
    onClick: () => setShowAddForm(!showAddForm)
  }, showAddForm ? "✕ Cancel" : "+ Custom Movement")), showAddForm && /*#__PURE__*/React.createElement(Card, {
    style: {
      marginBottom: 16,
      border: `1px solid ${T.accent}44`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 700,
      color: T.accent,
      marginBottom: 12
    }
  }, "Add Custom Movement"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Movement Name"), /*#__PURE__*/React.createElement("input", {
    placeholder: "e.g. Reverse Nordic Curl",
    value: newMov.name,
    onChange: e => setNewMov(p => ({
      ...p,
      name: e.target.value
    })),
    style: {
      width: "100%",
      background: T.surface,
      border: `1px solid ${newMov.name ? T.emerald : T.border}`,
      borderRadius: 7,
      padding: "10px 12px",
      color: T.bright,
      fontSize: 13,
      outline: "none",
      fontFamily: "inherit",
      boxSizing: "border-box"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Fiber Type"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6
    }
  }, [{
    id: "fast",
    label: "Fast-Twitch",
    sub: "1–12 reps",
    color: T.crimson
  }, {
    id: "mixed",
    label: "Mixed",
    sub: "6–15 reps",
    color: T.gold
  }, {
    id: "slow",
    label: "Slow-Twitch",
    sub: "15–25 reps",
    color: T.steel
  }].map(f => /*#__PURE__*/React.createElement("button", {
    key: f.id,
    onClick: () => setNewMov(p => ({
      ...p,
      fiber: f.id
    })),
    style: {
      flex: 1,
      padding: "12px 4px",
      borderRadius: 8,
      cursor: "pointer",
      border: "none",
      textAlign: "center",
      background: newMov.fiber === f.id ? f.color + "22" : T.surface,
      outline: `1px solid ${newMov.fiber === f.id ? f.color : T.border}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 700,
      color: newMov.fiber === f.id ? f.color : T.muted
    }
  }, f.label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: T.dim,
      marginTop: 2
    }
  }, f.sub))))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Primary Muscles (select all that apply)"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 5
    }
  }, ["Chest", "Upper Chest", "Lats", "Mid Back", "Lower Back", "Quads", "Hamstrings", "Glutes", "Glute Med", "Calves (Soleus)", "Calves (Gastrocnemius)", "Front Delt", "Lateral Delt", "Rear Delt", "Traps", "Triceps", "Triceps (Long Head)", "Biceps", "Biceps (Long Head)", "Brachialis", "Brachioradialis", "Adductors", "Abductors", "Abs", "Obliques", "Core (stability)", "Rotator Cuff"].map(m => {
    const sel = newMov.muscles.includes(m);
    return /*#__PURE__*/React.createElement("button", {
      key: m,
      onClick: () => setNewMov(p => ({
        ...p,
        muscles: sel ? p.muscles.filter(x => x !== m) : [...p.muscles, m]
      })),
      style: {
        padding: "4px 10px",
        borderRadius: 12,
        cursor: "pointer",
        background: sel ? T.violet + "22" : "transparent",
        border: `1px solid ${sel ? T.violet : T.border}`,
        color: sel ? T.violet : T.dim,
        fontSize: 11,
        fontWeight: sel ? 700 : 400
      }
    }, m);
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Equipment Needed"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      flexWrap: "wrap"
    }
  }, ["full", "home", "barbell", "minimal"].map(eq => {
    const sel = newMov.equipment.includes(eq);
    return /*#__PURE__*/React.createElement("button", {
      key: eq,
      onClick: () => setNewMov(p => ({
        ...p,
        equipment: sel ? p.equipment.filter(x => x !== eq) : [...p.equipment, eq]
      })),
      style: {
        padding: "5px 12px",
        borderRadius: 8,
        cursor: "pointer",
        background: sel ? T.accentBg : "transparent",
        border: `1px solid ${sel ? T.accent : T.border}`,
        color: sel ? T.accent : T.dim,
        fontSize: 11,
        fontWeight: sel ? 700 : 400
      }
    }, EQUIP_LABEL[eq]);
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Coaching Note (optional)"), /*#__PURE__*/React.createElement("input", {
    placeholder: "e.g. Full stretch at bottom. Control the eccentric.",
    value: newMov.note,
    onChange: e => setNewMov(p => ({
      ...p,
      note: e.target.value
    })),
    style: {
      width: "100%",
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: 7,
      padding: "10px 12px",
      color: T.bright,
      fontSize: 13,
      outline: "none",
      fontFamily: "inherit",
      boxSizing: "border-box"
    }
  })), newMov.fiber && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12,
      padding: "8px 12px",
      background: FIBER_COLOR[newMov.fiber] + "12",
      border: `1px solid ${FIBER_COLOR[newMov.fiber]}22`,
      borderRadius: 7
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: FIBER_COLOR[newMov.fiber],
      fontWeight: 700,
      letterSpacing: "0.08em",
      marginBottom: 2
    }
  }, "AUTO-ASSIGNED REP RANGES"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: T.muted
    }
  }, "Strength day: ", getRepsForFiber(newMov.fiber, "strength").sets, "×", getRepsForFiber(newMov.fiber, "strength").reps, "\xA0·\xA0 Hypertrophy day: ", getRepsForFiber(newMov.fiber, "hypertrophy").sets, "×", getRepsForFiber(newMov.fiber, "hypertrophy").reps)), /*#__PURE__*/React.createElement(Btn, {
    style: {
      width: "100%"
    },
    disabled: !newMov.name || newMov.muscles.length === 0,
    onClick: () => {
      const id = `custom-${Date.now()}`;
      const entry = {
        ...newMov,
        id,
        custom: true
      };
      setCustomLib(prev => [...prev, entry]);
      setNewMov({
        name: "",
        muscles: [],
        fiber: "mixed",
        equipment: ["full"],
        note: ""
      });
      setShowAddForm(false);
    }
  }, "Save Movement to Library")), /*#__PURE__*/React.createElement("input", {
    placeholder: "Search movements...",
    value: movementSearch,
    onChange: e => setMovementSearch(e.target.value),
    style: {
      width: "100%",
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: 8,
      padding: "10px 14px",
      color: T.bright,
      fontSize: 13,
      outline: "none",
      fontFamily: "inherit",
      boxSizing: "border-box",
      marginBottom: 10
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 5,
      overflowX: "auto",
      paddingBottom: 4,
      marginBottom: 14
    }
  }, ["ALL", "Chest", "Back", "Legs", "Shoulders", "Arms", "Core"].map(f => /*#__PURE__*/React.createElement("button", {
    key: f,
    onClick: () => setMovementMuscleFilter(f),
    style: {
      flexShrink: 0,
      background: movementMuscleFilter === f ? T.accentBg : "transparent",
      border: `1px solid ${movementMuscleFilter === f ? T.accent : T.border}`,
      color: movementMuscleFilter === f ? T.accent : T.muted,
      borderRadius: 16,
      padding: "5px 12px",
      fontSize: 11,
      fontWeight: movementMuscleFilter === f ? 700 : 400,
      cursor: "pointer"
    }
  }, f))), [...LIBRARY, ...customLib].filter(m => {
    const matchSearch = !movementSearch || m.name.toLowerCase().includes(movementSearch.toLowerCase()) || m.muscles.some(mu => mu.toLowerCase().includes(movementSearch.toLowerCase()));
    const MUSCLE_GROUPS = {
      "Chest": ["Chest", "Upper Chest"],
      "Back": ["Lats", "Mid Back", "Lower Back", "Traps"],
      "Legs": ["Quads", "Hamstrings", "Glutes", "Glute Med", "Calves (Soleus)", "Calves (Gastrocnemius)", "Adductors", "Abductors"],
      "Shoulders": ["Front Delt", "Lateral Delt", "Rear Delt", "Rotator Cuff"],
      "Arms": ["Biceps", "Biceps (Long Head)", "Brachialis", "Brachioradialis", "Triceps", "Triceps (Long Head)"],
      "Core": ["Abs", "Obliques", "Core (stability)", "Core (rotational)"]
    };
    const matchMuscle = movementMuscleFilter === "ALL" || m.muscles.some(mu => (MUSCLE_GROUPS[movementMuscleFilter] || []).includes(mu));
    return matchSearch && matchMuscle;
  }).map(mv => {
    const isSel = selectedMovement === mv.id;
    // Real history from logged sessions — most recent first
    const realHistory = getLiftHistory(sessionLogs, mv.id);
    const mockHistory = realHistory.length > 0 ? realHistory.slice().reverse().map(h => ({
      cycle: h.cycle,
      date: h.date,
      w: h.w,
      r: h.r
    })) : null;
    const hasHistory = !!mockHistory;
    const hMax = hasHistory ? Math.max(...mockHistory.map(h => h.w)) : 0;
    const hMin = hasHistory ? Math.min(...mockHistory.map(h => h.w)) - 10 : 0;
    const pr = hasHistory ? hMax : null;
    return /*#__PURE__*/React.createElement("div", {
      key: mv.id,
      style: {
        marginBottom: 8
      }
    }, (() => {
      const mvC = getMovementColor(mv.muscles);
      return /*#__PURE__*/React.createElement("div", {
        onClick: () => setSelectedMovement(isSel ? null : mv.id),
        style: {
          background: isSel ? mvC + "12" : T.card,
          borderLeft: `3px solid ${isSel ? mvC : mvC + "66"}`,
          border: `1px solid ${isSel ? mvC + "55" : T.border}`,
          borderRadius: isSel ? "10px 10px 0 0" : 10,
          padding: "12px 14px",
          cursor: "pointer",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          flex: 1
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 7,
          marginBottom: 4,
          flexWrap: "wrap"
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: mvC,
          flexShrink: 0
        }
      }), /*#__PURE__*/React.createElement("span", {
        style: {
          fontWeight: 700,
          fontSize: 14,
          color: isSel ? mvC : T.bright
        }
      }, mv.name), mv.custom && /*#__PURE__*/React.createElement(Tag, {
        text: "CUSTOM",
        color: T.violet,
        xs: true
      }), hasHistory && /*#__PURE__*/React.createElement(Tag, {
        text: "HISTORY",
        color: T.emerald,
        xs: true
      })), /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          flexWrap: "wrap",
          gap: 4
        }
      }, mv.muscles.slice(0, 3).map(m => /*#__PURE__*/React.createElement(Tag, {
        key: m,
        text: m,
        color: getMovementColor([m]),
        xs: true
      })), mv.muscles.length > 3 && /*#__PURE__*/React.createElement(Tag, {
        text: `+${mv.muscles.length - 3}`,
        color: T.dim,
        xs: true
      }))), /*#__PURE__*/React.createElement("div", {
        style: {
          flexShrink: 0,
          textAlign: "right"
        }
      }, /*#__PURE__*/React.createElement(Tag, {
        text: FIBER_LABEL[mv.fiber],
        color: FIBER_COLOR[mv.fiber]
      }), pr && /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 11,
          color: T.gold,
          fontWeight: 700,
          marginTop: 4
        }
      }, "PR: ", pr, " lbs")));
    })(), isSel && /*#__PURE__*/React.createElement("div", {
      style: {
        background: T.surface,
        border: `1px solid ${getMovementColor(mv.muscles)}33`,
        borderTop: "none",
        borderRadius: "0 0 10px 10px",
        padding: "14px 14px 16px"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        marginBottom: 12
      }
    }, ["strength", "hypertrophy"].map(ph => {
      const plan = getRepsForFiber(mv.fiber, ph);
      return /*#__PURE__*/React.createElement("div", {
        key: ph,
        style: {
          flex: 1,
          padding: "7px 10px",
          background: ph === "strength" ? T.crimson + "12" : T.steel + "12",
          borderRadius: 7,
          textAlign: "center"
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 9,
          color: ph === "strength" ? T.crimson : T.steel,
          fontWeight: 700,
          letterSpacing: "0.08em",
          marginBottom: 2
        }
      }, ph.toUpperCase()), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 14,
          fontWeight: 700,
          color: T.bright
        }
      }, plan.sets, "×", plan.reps), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 9,
          color: T.dim
        }
      }, plan.rest));
    })), !hasHistory && /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "center",
        padding: "20px 0",
        color: T.dim,
        fontSize: 13
      }
    }, "No history yet. Log this movement in a session to start tracking."), hasHistory && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: T.dim,
        letterSpacing: "0.08em",
        marginBottom: 8
      }
    }, "PROGRESSION CHART"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "flex-end",
        gap: 6,
        height: 60,
        marginBottom: 8
      }
    }, mockHistory.slice().reverse().map((h, idx) => {
      const barH = (h.w - hMin) / (hMax - hMin) * 52 + 6;
      const isPR = h.w === hMax;
      return /*#__PURE__*/React.createElement("div", {
        key: idx,
        style: {
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2
        }
      }, isPR && /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 7,
          color: T.gold,
          fontWeight: 700
        }
      }, "PR"), !isPR && /*#__PURE__*/React.createElement("div", {
        style: {
          height: 10
        }
      }), /*#__PURE__*/React.createElement("div", {
        style: {
          width: "100%",
          borderRadius: "2px 2px 0 0",
          background: isPR ? T.gold : T.border,
          height: barH,
          transition: "height 0.3s"
        }
      }), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 7,
          color: T.dim,
          textAlign: "center"
        }
      }, h.date.split(" ")[1]));
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: T.dim,
        letterSpacing: "0.08em",
        marginBottom: 6
      }
    }, "SESSION LOG"), mockHistory.map((h, idx) => {
      const prev = idx < mockHistory.length - 1 ? mockHistory[idx + 1] : null;
      const delta = prev ? h.w - prev.w : null;
      return /*#__PURE__*/React.createElement("div", {
        key: idx,
        style: {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "7px 0",
          borderBottom: idx < mockHistory.length - 1 ? `1px solid ${T.border}` : "none"
        }
      }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 12,
          color: T.text
        }
      }, h.date), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 10,
          color: T.dim
        }
      }, "Est. 1RM: ", Math.round(h.w * (1 + h.r / 30)), " lbs")), /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          gap: 10,
          alignItems: "center"
        }
      }, delta !== null && /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 11,
          fontWeight: 700,
          color: delta > 0 ? T.emerald : delta < 0 ? T.crimson : T.dim
        }
      }, delta > 0 ? "+" : "", delta), /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 14,
          fontWeight: 700,
          color: T.bright
        }
      }, h.w, " lbs"), /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 11,
          color: T.muted
        }
      }, "× ", h.r), h.w === hMax && /*#__PURE__*/React.createElement(Tag, {
        text: "PR",
        color: T.gold,
        xs: true
      })));
    }))));
  })));
}

// ── ROOT APP ──────────────────────────────────────────
// ── AUTH SCREEN ───────────────────────────────────────────────
// Shown when Firebase is configured and user is not signed in.
// If Firebase is not configured (no window._fbAuth), this is skipped entirely.
function AuthScreen({
  onAuth
}) {
  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function handleSubmit() {
    if (!email || !password) {
      setError("Enter email and password.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const auth = fbAuth();
      let cred;
      if (mode === "signup") {
        cred = await auth.createUserWithEmailAndPassword(email, password);
      } else {
        cred = await auth.signInWithEmailAndPassword(email, password);
      }
      onAuth(cred.user);
    } catch (e) {
      setError(e.message.replace("Firebase: ", "").replace("(auth/", "").replace(").", "").trim());
    } finally {
      setLoading(false);
    }
  }
  async function handleGoogle() {
    setLoading(true);
    setError("");
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const cred = await fbAuth().signInWithPopup(provider);
      onAuth(cred.user);
    } catch (e) {
      setError(e.message.replace("Firebase: ", "").trim());
      setLoading(false);
    }
  }
  const inputStyle = {
    width: "100%",
    background: "#111",
    border: `1px solid #2A2A2A`,
    borderRadius: 10,
    padding: "14px 16px",
    color: "#F9FAFB",
    fontSize: 15,
    outline: "none",
    fontFamily: "inherit",
    boxSizing: "border-box",
    marginBottom: 10
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: "100vh",
      background: "#000",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "32px 24px",
      fontFamily: "'Inter',system-ui,sans-serif"
    }
  }, /*#__PURE__*/React.createElement("style", null, `html,body,#root{background:#000;margin:0;padding:0;}
        *{box-sizing:border-box;}`), /*#__PURE__*/React.createElement("div", {
    style: {
      width: "100%",
      maxWidth: 380
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      marginBottom: 36
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 32,
      marginBottom: 12
    }
  }, "⚡"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 28,
      fontWeight: 800,
      color: "#F9FAFB",
      letterSpacing: "-0.03em"
    }
  }, "Superhuman Physique"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "#6B7280",
      marginTop: 6
    }
  }, mode === "signup" ? "Create your account to get started" : "Welcome back")), /*#__PURE__*/React.createElement("button", {
    onClick: handleGoogle,
    disabled: loading,
    style: {
      width: "100%",
      background: "#1A1A1A",
      border: "1px solid #2A2A2A",
      borderRadius: 10,
      padding: "13px 16px",
      color: "#F9FAFB",
      fontSize: 14,
      fontWeight: 600,
      cursor: "pointer",
      marginBottom: 16,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18
    }
  }, "G"), " Continue with Google"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      height: 1,
      background: "#2A2A2A"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "#6B7280"
    }
  }, "or"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      height: 1,
      background: "#2A2A2A"
    }
  })), /*#__PURE__*/React.createElement("input", {
    type: "email",
    placeholder: "Email address",
    value: email,
    onChange: e => setEmail(e.target.value),
    style: inputStyle,
    "aria-label": "Email address"
  }), /*#__PURE__*/React.createElement("input", {
    type: "password",
    placeholder: "Password (min 6 characters)",
    value: password,
    onChange: e => setPassword(e.target.value),
    style: inputStyle,
    "aria-label": "Password",
    onKeyDown: e => e.key === "Enter" && handleSubmit()
  }), error && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "#EF4444",
      marginBottom: 12,
      padding: "8px 12px",
      background: "#EF444415",
      borderRadius: 8
    }
  }, error), /*#__PURE__*/React.createElement("button", {
    onClick: handleSubmit,
    disabled: loading,
    style: {
      width: "100%",
      background: "#F1F5F9",
      color: "#000",
      border: "none",
      borderRadius: 10,
      padding: "15px",
      fontSize: 15,
      fontWeight: 800,
      cursor: loading ? "wait" : "pointer",
      marginBottom: 14
    }
  }, loading ? "..." : mode === "signup" ? "Create Account" : "Sign In"), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      fontSize: 13,
      color: "#6B7280"
    }
  }, mode === "signup" ? "Already have an account? " : "New here? ", /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setMode(m => m === "signin" ? "signup" : "signin");
      setError("");
    },
    style: {
      background: "none",
      border: "none",
      color: "#F1F5F9",
      cursor: "pointer",
      fontWeight: 600,
      fontSize: 13
    }
  }, mode === "signup" ? "Sign in" : "Create account")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 24,
      fontSize: 11,
      color: "#4B5563",
      textAlign: "center",
      lineHeight: 1.5
    }
  }, "Your data syncs across devices and is stored securely in Firebase.")));
}
function App() {
  // ── FIREBASE AUTH STATE ──────────────────────────────────────
  const [currentUser, setCurrentUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false); // true once we know auth status

  useEffect(() => {
    const auth = fbAuth();
    if (!auth) {
      setAuthChecked(true);
      return;
    } // no Firebase — skip
    const unsub = auth.onAuthStateChanged(user => {
      setCurrentUser(user || null);
      setAuthChecked(true);
    });
    return unsub;
  }, []);

  // ── FIRESTORE DATA LOAD — fires when user signs in ───────────
  useEffect(() => {
    if (!currentUser) return;
    const uid = currentUser.uid;
    async function loadFromFirestore() {
      // Load all collections in parallel
      const [profileDoc, sessLogs, wLog, rLog, suppLog, templates, cWorkouts, bcLog] = await Promise.all([fsLoadDoc(uid, "profile", "data"), fsLoadCol(uid, "sessionLogs"), fsLoadCol(uid, "weightLog"), fsLoadCol(uid, "recoveryLog"), fsLoadCol(uid, "supplementLog"), fsLoadCol(uid, "savedTemplates"), fsLoadCol(uid, "customWorkouts"), fsLoadCol(uid, "bodyCompLog")]);

      // Profile
      if (profileDoc && profileDoc.goal) {
        const {
          id: _id,
          _updatedAt,
          ...p
        } = profileDoc;
        setProfile(p);
        storageSet(STORAGE_KEYS.PROFILE, p);
      }
      // Session logs — array → object keyed by date
      if (sessLogs?.length) {
        const obj = sessLogs.reduce((acc, d) => {
          const {
            id,
            _updatedAt,
            ...rest
          } = d;
          return {
            ...acc,
            [id]: rest
          };
        }, {});
        setSessionLogs(obj);
        storageSet(STORAGE_KEYS.SESSION_LOGS, obj);
      }
      // Weight log — array of {day, w}
      if (wLog?.length) {
        const sorted = wLog.map(({
          id,
          _updatedAt,
          ...d
        }) => d).sort((a, b) => a.day?.localeCompare(b.day));
        setWeightLog(sorted);
        storageSet(STORAGE_KEYS.WEIGHT_LOG, sorted);
      }
      // Recovery log
      if (rLog?.length) {
        const sorted = rLog.map(({
          id,
          _updatedAt,
          ...d
        }) => d).sort((a, b) => b.date?.localeCompare(a.date));
        setRecoveryLog(sorted);
        storageSet(STORAGE_KEYS.RECOVERY_LOG, sorted);
      }
      // Supplement log — array → object keyed by date
      if (suppLog?.length) {
        const obj = suppLog.reduce((acc, d) => {
          const {
            id,
            _updatedAt,
            ...rest
          } = d;
          return {
            ...acc,
            [id]: rest
          };
        }, {});
        setSupplementLog(obj);
        storageSet(STORAGE_KEYS.SUPPLEMENT_LOG, obj);
      }
      // Saved templates — array → object keyed by cycleDay
      if (templates?.length) {
        const obj = templates.reduce((acc, d) => {
          const {
            id,
            _updatedAt,
            ...rest
          } = d;
          return {
            ...acc,
            [id]: rest
          };
        }, {});
        setSavedTemplates(obj);
        storageSet(STORAGE_KEYS.SAVED_TEMPLATES, obj);
      }
      // Custom workouts
      if (cWorkouts?.length) {
        const wks = cWorkouts.map(({
          id: _id,
          _updatedAt,
          ...d
        }) => d);
        setCustomWorkouts(wks.length ? wks : DEFAULT_CUSTOM_WORKOUTS);
        storageSet(STORAGE_KEYS.CUSTOM_WORKOUTS, wks);
      }
      // Body comp log
      if (bcLog?.length) {
        const sorted = bcLog.map(({
          id,
          _updatedAt,
          ...d
        }) => d).sort((a, b) => a.date?.localeCompare(b.date));
        setBodyCompLog(sorted);
        storageSet(STORAGE_KEYS.BODYCOMP_LOG, sorted);
      }
    }
    loadFromFirestore();
  }, [currentUser]); // eslint-disable-line

  // ── HYDRATION STATE ──────────────────────────────────────────
  // window.storage (artifact API) is async — we need to load from it
  // before deciding whether to show onboarding or the app.
  const [hydrated, setHydrated] = useState(false);

  // ── PERSISTED STATE — survives refresh, Firebase-ready ──────
  const [profile, setProfile] = usePersistedState(STORAGE_KEYS.PROFILE, null);
  const [savedTemplates, setSavedTemplates] = usePersistedState(STORAGE_KEYS.SAVED_TEMPLATES, {});
  const [customWorkouts, setCustomWorkouts] = usePersistedState(STORAGE_KEYS.CUSTOM_WORKOUTS, DEFAULT_CUSTOM_WORKOUTS);
  const [sessionLogs, setSessionLogs] = usePersistedState(STORAGE_KEYS.SESSION_LOGS, {});
  const [supplementLog, setSupplementLog] = usePersistedState(STORAGE_KEYS.SUPPLEMENT_LOG, {});
  const [weightLog, setWeightLog] = usePersistedState(STORAGE_KEYS.WEIGHT_LOG, DEFAULT_WEIGHT_LOG);
  const [recoveryLog, setRecoveryLog] = usePersistedState(STORAGE_KEYS.RECOVERY_LOG, DEFAULT_RECOVERY_LOG);
  const [bodyCompLog, setBodyCompLog] = usePersistedState(STORAGE_KEYS.BODYCOMP_LOG, []);

  // ── ASYNC HYDRATION FROM window.storage ──────────────────────
  // On first mount, load all persisted data from window.storage (artifact API).
  // This runs once, populates _memStore and state, then sets hydrated=true.
  useEffect(() => {
    async function hydrate() {
      if (!window.storage) {
        setHydrated(true);
        return;
      }
      try {
        const keys = Object.values(STORAGE_KEYS);
        await Promise.all(keys.map(async k => {
          const result = await storageLoadAsync(k);
          if (result != null) {
            _memStore[k] = result;
            // Push to localStorage too for getStreak/getCurrentCycleDay calls
            try {
              localStorage.setItem(k, JSON.stringify(result));
            } catch {}
          }
        }));
        // Now re-read profile and session logs from warmed cache
        const p = _memStore[STORAGE_KEYS.PROFILE] || null;
        const sl = _memStore[STORAGE_KEYS.SESSION_LOGS] || {};
        const st = _memStore[STORAGE_KEYS.SAVED_TEMPLATES] || {};
        const cw = _memStore[STORAGE_KEYS.CUSTOM_WORKOUTS] || DEFAULT_CUSTOM_WORKOUTS;
        const sup = _memStore[STORAGE_KEYS.SUPPLEMENT_LOG] || {};
        if (p) {
          setProfile(p);
          setSavedTemplates(st);
          setCustomWorkouts(cw);
          setSessionLogs(sl);
          setSupplementLog(sup);
        }
      } catch {}
      setHydrated(true);
    }
    hydrate();
  }, []); // eslint-disable-line

  // ── SESSION STATE — resets each app load (intentional) ──────
  const [booted, setBooted] = useState(() => {
    const p = storageGet(STORAGE_KEYS.PROFILE, null);
    return !!(p && p.goal && p.weight); // only skip onboarding if profile is complete
  });
  const [tab, setTab] = useState("home");
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [cycleDay, setCycleDay] = useState(() => getCurrentCycleDay(storageGet(STORAGE_KEYS.SESSION_LOGS, {})));

  // Once hydrated, sync booted and cycleDay with what we loaded
  useEffect(() => {
    if (!hydrated) return;
    const p = _memStore[STORAGE_KEYS.PROFILE] || null;
    if (p && p.goal && p.weight) {
      setBooted(true);
      setCycleDay(getCurrentCycleDay(_memStore[STORAGE_KEYS.SESSION_LOGS] || {}));
    }
  }, [hydrated]);

  // ── SINGLE SOURCE OF TRUTH ────────────────────────────────
  useEffect(() => {
    const computed = getCurrentCycleDay(sessionLogs);
    setCycleDay(computed);
  }, [sessionLogs]);

  // ── BOOT FROM FIRESTORE ───────────────────────────────────
  // When profile arrives from Firestore (async, after sign-in),
  // mark the app as booted so onboarding is skipped.
  useEffect(() => {
    if (profile && profile.goal && profile.weight) {
      setBooted(true);
    }
  }, [profile]);

  // ── LOADING SCREEN ────────────────────────────────────────
  // Show briefly while async hydration runs (usually <100ms)
  if (!hydrated || !authChecked) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        background: T.bg,
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 16
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 28
      }
    }, "⚡"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 14,
        color: T.dim,
        fontFamily: "'Inter',system-ui,sans-serif"
      }
    }, "Loading..."));
  }

  // ── AUTH GATE ──────────────────────────────────────────────────
  // If Firebase is configured (window._fbAuth exists) and user isn't
  // signed in, show the auth screen. If Firebase isn't configured
  // (local/Hosting-only mode), skip auth entirely.
  if (fbAuth() && !currentUser) {
    return /*#__PURE__*/React.createElement(AuthScreen, {
      onAuth: user => setCurrentUser(user)
    });
  }
  const NAV = [{
    id: "home",
    label: "Home",
    icon: "⚡"
  }, {
    id: "session",
    label: "Train",
    icon: "🏋️"
  }, {
    id: "progress",
    label: "Track",
    icon: "📊"
  }, {
    id: "learn",
    label: "Learn",
    icon: "📖"
  }];
  if (!booted || !profile?.goal) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        background: T.bg,
        minHeight: "100vh",
        color: T.text,
        fontFamily: "'Inter',system-ui,sans-serif",
        maxWidth: 480,
        margin: "0 auto",
        position: "relative",
        overflowX: "hidden"
      }
    }, /*#__PURE__*/React.createElement("style", null, `
        html,body,#root{background:#000000;margin:0;padding:0;}
        *{-webkit-tap-highlight-color:transparent;box-sizing:border-box;}
        input[type=number]{-moz-appearance:textfield;}
        input[type=number]::-webkit-outer-spin-button,
        input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}
        ::-webkit-scrollbar{width:3px;height:3px;}
        ::-webkit-scrollbar-track{background:transparent;}
        ::-webkit-scrollbar-thumb{background:#2A2A2A;border-radius:3px;}
        ::selection{background:#F1F5F922;color:#F9FAFB;}
        @keyframes prPulse{0%{transform:scale(0.5);opacity:0}60%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
      `), /*#__PURE__*/React.createElement(Onboarding, {
      onComplete: p => {
        setProfile(p);
        setBooted(true);
        storageSet(STORAGE_KEYS.PROFILE, p);
        if (currentUser) fsSet(currentUser.uid, "profile", "data", p);
      }
    }));
  }
  const sessionMeta = SESSIONS_DATA[cycleDay];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: T.bg,
      minHeight: "100vh",
      color: T.text,
      fontFamily: "'Inter',system-ui,sans-serif",
      maxWidth: 480,
      margin: "0 auto",
      WebkitFontSmoothing: "antialiased",
      MozOsxFontSmoothing: "grayscale",
      position: "relative",
      overflowX: "hidden"
    }
  }, /*#__PURE__*/React.createElement("style", null, `
        html,body,#root{background:#000000;margin:0;padding:0;}
        *{-webkit-tap-highlight-color:transparent;box-sizing:border-box;}
        input[type=number]{-moz-appearance:textfield;}
        input[type=number]::-webkit-outer-spin-button,
        input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}
        ::-webkit-scrollbar{width:3px;height:3px;}
        ::-webkit-scrollbar-track{background:transparent;}
        ::-webkit-scrollbar-thumb{background:#2A2A2A;border-radius:3px;}
        ::selection{background:#F1F5F922;color:#F9FAFB;}
        @keyframes prPulse{0%{transform:scale(0.5);opacity:0}60%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
      `), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "sticky",
      top: 0,
      zIndex: 30,
      background: "rgba(0,0,0,0.92)",
      backdropFilter: "blur(12px)",
      borderBottom: `1px solid ${T.border}`,
      padding: "10px 20px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      width: "100%",
      boxSizing: "border-box"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      fontWeight: 800,
      letterSpacing: "0.22em",
      color: T.accent,
      opacity: 0.9
    }
  }, "SUPERHUMAN PHYSIQUE"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: T.dim,
      marginTop: 1,
      letterSpacing: "0.02em"
    }
  }, "Day ", cycleDay, sessionMeta ? ` · ${sessionMeta.label} — ${sessionMeta.phase === "strength" ? "Strength" : "Hypertrophy"}` : " · Rest")), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: () => setShowSettingsMenu(!showSettingsMenu),
    style: {
      width: 34,
      height: 34,
      borderRadius: "50%",
      cursor: "pointer",
      background: `linear-gradient(135deg, ${T.accent}22, ${T.steel}22)`,
      border: `1.5px solid ${T.accent}66`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 13,
      fontWeight: 800,
      color: T.accent,
      boxShadow: `0 0 12px ${T.accent}22`
    }
  }, profile?.name ? profile.name.charAt(0).toUpperCase() : "SP"), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      bottom: 1,
      right: 1,
      width: 8,
      height: 8,
      borderRadius: "50%",
      background: T.emerald,
      border: `1.5px solid ${T.bg}`,
      boxShadow: `0 0 6px ${T.emerald}88`
    }
  }), showSettingsMenu && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    onClick: () => setShowSettingsMenu(false),
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 90
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: 42,
      right: 0,
      zIndex: 91,
      background: T.surface,
      border: `1px solid ${T.borderHi}`,
      borderRadius: 12,
      padding: 8,
      minWidth: 200,
      boxShadow: "0 8px 32px rgba(0,0,0,0.6)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "8px 10px",
      fontSize: 11,
      fontWeight: 700,
      color: T.dim,
      letterSpacing: "0.06em"
    }
  }, profile?.name || "ACCOUNT", currentUser?.email && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: T.dim,
      fontWeight: 400,
      marginTop: 2
    }
  }, currentUser.email)), fbAuth() && currentUser && /*#__PURE__*/React.createElement("button", {
    onClick: async () => {
      setShowSettingsMenu(false);
      await fbAuth().signOut();
      setCurrentUser(null);
    },
    style: {
      width: "100%",
      textAlign: "left",
      padding: "10px 10px",
      background: "none",
      border: "none",
      borderRadius: 8,
      color: T.muted,
      fontSize: 13,
      fontWeight: 600,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, "↪ Sign Out"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setShowSettingsMenu(false);
      setShowResetConfirm(true);
    },
    style: {
      width: "100%",
      textAlign: "left",
      padding: "10px 10px",
      background: "none",
      border: "none",
      borderRadius: 8,
      color: T.crimson,
      fontSize: 13,
      fontWeight: 600,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, "⚠ Reset Profile & Data"))))), showResetConfirm && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 100,
      background: "rgba(0,0,0,0.75)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: T.surface,
      border: `1px solid ${T.crimson}44`,
      borderRadius: 16,
      padding: 24,
      maxWidth: 340,
      width: "100%"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 32,
      textAlign: "center",
      marginBottom: 12
    }
  }, "⚠️"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 17,
      fontWeight: 800,
      color: T.bright,
      textAlign: "center",
      marginBottom: 8
    }
  }, "Reset everything?"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: T.muted,
      textAlign: "center",
      lineHeight: 1.6,
      marginBottom: 20
    }
  }, "This permanently deletes your profile, all logged sessions, saved workouts, weight history, and recovery logs. This cannot be undone."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Btn, {
    variant: "ghost",
    style: {
      flex: 1
    },
    onClick: () => setShowResetConfirm(false)
  }, "Cancel"), /*#__PURE__*/React.createElement(Btn, {
    variant: "danger",
    style: {
      flex: 1
    },
    onClick: () => {
      Object.values(STORAGE_KEYS).forEach(k => storageClear(k));
      try {
        localStorage.removeItem("sp_version");
      } catch {}
      try {
        sessionStorage.removeItem("sp_version");
      } catch {}
      // Clear Firestore if user is signed in
      if (currentUser) {
        const uid = currentUser.uid;
        const cols = ["profile", "sessionLogs", "weightLog", "recoveryLog", "supplementLog", "savedTemplates", "customWorkouts", "bodyCompLog"];
        cols.forEach(col => {
          window._fbDb?.collection("users").doc(uid).collection(col).get().then(s => s.docs.forEach(d => d.ref.delete())).catch(() => {});
        });
      }
      setProfile(null);
      setBooted(false);
      setSavedTemplates({});
      setCustomWorkouts(DEFAULT_CUSTOM_WORKOUTS);
      setSessionLogs({});
      setSupplementLog({});
      setShowResetConfirm(false);
    }
  }, "Delete Everything")))), tab === "home" && /*#__PURE__*/React.createElement(Dashboard, {
    profile: profile,
    setTab: setTab,
    setCycleDay: setCycleDay,
    cycleDay: cycleDay,
    supplementLog: supplementLog,
    setSupplementLog: setSupplementLog,
    sessionLogs: sessionLogs,
    uid: currentUser?.uid
  }), tab === "session" && /*#__PURE__*/React.createElement(Session, {
    profile: profile,
    cycleDay: cycleDay,
    setTab: setTab,
    savedTemplates: savedTemplates,
    setSavedTemplates: setSavedTemplates,
    customWorkouts: customWorkouts,
    setCustomWorkouts: setCustomWorkouts,
    sessionLogs: sessionLogs,
    setSessionLogs: setSessionLogs,
    uid: currentUser?.uid
  }), tab === "learn" && /*#__PURE__*/React.createElement(Learn, {
    profile: profile
  }), tab === "progress" && /*#__PURE__*/React.createElement(Progress, {
    profile: profile,
    sessionLogs: sessionLogs,
    supplementLog: supplementLog,
    setSupplementLog: setSupplementLog,
    weightLog: weightLog,
    setWeightLog: setWeightLog,
    recoveryLog: recoveryLog,
    setRecoveryLog: setRecoveryLog,
    bodyCompLog: bodyCompLog,
    setBodyCompLog: setBodyCompLog,
    uid: currentUser?.uid
  }), /*#__PURE__*/React.createElement("div", {
    role: "navigation",
    "aria-label": "Main navigation",
    style: {
      position: "fixed",
      bottom: 0,
      left: "50%",
      transform: "translateX(-50%)",
      width: "100%",
      maxWidth: 480,
      zIndex: 20,
      background: "rgba(10,10,10,0.95)",
      backdropFilter: "blur(16px)",
      borderTop: `1px solid ${T.border}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex"
    }
  }, NAV.map(n => {
    const active = tab === n.id;
    return /*#__PURE__*/React.createElement("button", {
      key: n.id,
      onClick: () => setTab(n.id),
      style: {
        flex: 1,
        padding: "10px 0 12px",
        background: "none",
        border: "none",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        position: "relative",
        transition: "opacity 0.15s"
      }
    }, active && /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        top: 6,
        width: 40,
        height: 28,
        borderRadius: 10,
        background: T.accent + "14",
        border: `1px solid ${T.accent}22`
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 16,
        position: "relative",
        zIndex: 1,
        filter: active ? "none" : "grayscale(0.3) opacity(0.6)"
      }
    }, n.icon), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 9,
        fontWeight: active ? 800 : 400,
        color: active ? T.accent : T.dim,
        letterSpacing: "0.05em",
        position: "relative",
        zIndex: 1
      }
    }, n.label), active && /*#__PURE__*/React.createElement("div", {
      style: {
        position: "absolute",
        bottom: 0,
        width: 20,
        height: 2,
        background: T.accent,
        borderRadius: "1px 1px 0 0"
      }
    }));
  }))));
}