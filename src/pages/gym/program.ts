import type { Unit } from './lib';

/** The 12-week program from GYM_PLAN.md as data. `demo` is a key into public/demos/manifest.json. */
export interface ProgEx { name: string; sets: number; reps: number; unit: Unit; text?: string; note?: string; demo?: string; one?: boolean }
export interface ProgDay { dow: number; name: string; kind: 'workout' | 'mobility' | 'free'; blurb: string; exercises: ProgEx[] }

const ex = (name: string, sets: number, reps: number, unit: Unit, demo?: string, text?: string, note?: string, one?: boolean): ProgEx => ({ name, sets, reps, unit, demo, text, note, one });

export const PROGRAM: ProgDay[] = [
  { dow: 1, name: 'Push', kind: 'workout', blurb: 'Bench heavy, then chest, shoulders and arms. Flying push-ups first while fresh.', exercises: [
    ex('Flying push-up power reps', 3, 3, 'bw', 'clap_pushup', '3 × 3', 'Explosive, stop before form breaks. Do these first.'),
    ex('Planche lean', 2, 20, 'sec', 'planche_lean', '2 × 15–20 s', 'Light touch only. Stop on wrist pain or elbow tingling.'),
    ex('Bench press', 4, 5, 'kg', 'bench', '4 × 5 · start ~35 kg', '3 s lowering, elbows about 45°, 2–3 reps left.'),
    ex('Incline dumbbell press', 3, 9, 'kg', 'incline_db', '3 × 8–10'),
    ex('Cable lateral raise', 3, 13, 'kg', 'lateral', '3 × 12–15', 'Slow, feel the side delt (mind-muscle).'),
    ex('Overhead press', 3, 7, 'kg', 'ohp', '3 × 6–8 · bar 20 kg or 10 kg dumbbells'),
    ex('Triceps pushdown', 3, 11, 'kg', 'pushdown', '3 × 10–12'),
    ex('Cable fly', 3, 12, 'kg', 'cable_fly', '3 × 12'),
    ex('Dips', 3, 7, 'bw', 'dips', '3 × 6–8', "Today's one exercise. Skip if the elbow tingles.", true),
  ] },
  { dow: 2, name: 'Pull', kind: 'workout', blurb: 'Pull-ups and muscle-up work, then back and biceps.', exercises: [
    ex('Pull-up', 5, 2, 'bw', 'pullup', '5 × 1–2', "Today's one exercise. Clean reps, full hang.", true),
    ex('Pull-up negative', 3, 3, 'bw', 'pullup', '3 × 3', '5 s lowering.'),
    ex('Explosive pull-up', 3, 2, 'bw', 'explosive_pullup', '3 × 2', 'Pull toward the chest.'),
    ex('Chest-supported row', 3, 9, 'kg', 'chest_row', '3 × 8–10'),
    ex('Rear delt fly', 3, 13, 'kg', 'rear_delt', '3 × 12–15'),
    ex('Cable curl', 3, 11, 'kg', 'cable_curl', '3 × 10–12', 'Slow, mind-muscle.'),
    ex('Hammer curl', 2, 10, 'kg', 'hammer', '2 × 10'),
    ex('One-arm chin-up negative', 1, 2, 'bw', 'oac_negative', '1 × 2', 'Very slow. Elbow tendons work hard here.'),
    ex('Muscle-up transition drill', 2, 3, 'bw', 'mu_transition', '2 × 3'),
    ex('Dead hang', 2, 30, 'sec', 'bar_hang', '2 × 30 s'),
    ex('Fingertip hang', 2, 10, 'sec', 'finger_hang', '2 × 10 s'),
  ] },
  { dow: 3, name: 'Mobility: hips and back', kind: 'mobility', blurb: '35 min. Open the Mobility tab for the full routine, then keep the one exercise easy.', exercises: [
    ex('Split squat', 3, 8, 'bw', 'split_squat', '3 × 8 each leg', "Today's one exercise, easy effort (or a light RDL).", true),
  ] },
  { dow: 4, name: 'Deadlift + legs', kind: 'workout', blurb: 'Deadlift heavy, then legs. Finish with hip mobility.', exercises: [
    ex('Deadlift', 4, 4, 'kg', 'deadlift', '4 × 4 · start ~60 kg', 'Add 2.5 kg when every set is clean with 2 reps left.'),
    ex('Back squat', 4, 6, 'kg', 'squat', '4 × 6', 'Week 1: find a weight with 2–3 reps left.'),
    ex('Romanian deadlift', 3, 8, 'kg', 'rdl', '3 × 8', "Today's one exercise.", true),
    ex('Seated leg curl', 3, 11, 'kg', 'leg_curl', '3 × 10–12'),
    ex('Bulgarian split squat', 3, 8, 'kg', 'split_squat', '3 × 8 each leg'),
    ex('Standing calf raise', 3, 12, 'kg', 'calf', '3 × 12', '3 s lowering (tendon work).'),
    ex('Nordic lowering', 2, 4, 'bw', 'nordic', '2 × 3–4 (from week 3)', 'Slow lowering, hamstring tendon work.'),
  ] },
  { dow: 5, name: 'Upper pump + skills', kind: 'workout', blurb: 'Handstand and planche work, then shoulders, arms and chest. Keep pulling light after Thursday.', exercises: [
    ex('Wall handstand hold', 5, 18, 'sec', 'wall_handstand', '5 × 15–20 s'),
    ex('Pike push-up', 4, 6, 'bw', 'pike_pushup', '4 × 5–8', "Today's one exercise. On parallettes.", true),
    ex('Pseudo-planche push-up', 3, 5, 'bw', 'pppu', '3 × 5'),
    ex('Planche lean', 3, 20, 'sec', 'planche_lean', '3 × 20 s'),
    ex('Frog stand', 3, 20, 'sec', 'frog_stand', '3 × 20 s'),
    ex('Incline dumbbell press', 3, 11, 'kg', 'incline_db', '3 × 10–12'),
    ex('Cable lateral raise', 3, 13, 'kg', 'lateral', '3 × 12–15'),
    ex('Rear delt fly', 3, 13, 'kg', 'rear_delt', '3 × 12–15'),
    ex('Cable curl', 3, 13, 'kg', 'cable_curl', '3 × 12–15'),
    ex('Overhead cable triceps extension', 3, 13, 'kg', 'oh_triceps', '3 × 12–15'),
  ] },
  { dow: 6, name: 'Free day', kind: 'free', blurb: 'Your choice: home dumbbells, skills, a run, a sport. The one exercise is the minimum.', exercises: [] },
  { dow: 0, name: 'Mobility: shoulders and spine', kind: 'mobility', blurb: '35 min. Open the Mobility tab for the full routine, then keep the one exercise easy.', exercises: [
    ex('Inverted row', 4, 10, 'bw', 'inv_row', '4 × 8–12', "Today's one exercise, easy effort (or easy push-ups).", true),
  ] },
];

/** Cardio the user can add whenever; never required. */
export const CARDIO = [
  { id: 'zone2', name: 'Easy run or run-walk (zone 2)', minutes: 20, demo: undefined },
  { id: 'intervals', name: 'Intervals: 4 × 200–400 m, walk between', minutes: 20, demo: undefined },
  { id: 'rope', name: 'Jump rope', minutes: 10, demo: 'jump_rope' },
  { id: 'incline', name: 'Incline walk', minutes: 25, demo: undefined },
  { id: 'rower', name: 'Rower or air bike', minutes: 15, demo: undefined },
] as const;

// ---------------------------------------------------------------- mobility

export interface MobItem { name: string; dose: string; demo?: string; src: string; note?: string }
export interface MobRoutine { id: string; name: string; when: string; minutes: number; blurb: string; items: MobItem[] }

const WR = 'Wrestler mobility reel', TK = 'Tim Kuijsters', GL = 'Glute-length reel', BC = 'Brett Contreras reel', MW = 'Morning warm-up reel', PL = 'Plan';

export const MOBILITY: MobRoutine[] = [
  { id: 'primer', name: 'Daily primer', when: 'Every day, before training', minutes: 10, blurb: 'Loosens the back and hips and preps wrists and shoulders. Dynamic only: static holds go after lifting.', items: [
    { name: 'Arm circles and hip circles', dose: '30 s each', demo: 'arm_circles', src: MW, note: 'Loosen joints and spine, get rid of sleep stiffness.' },
    { name: 'Cat-cow', dose: '10 slow reps', demo: 'cat_cow', src: MW },
    { name: 'Thoracic rotation (open book)', dose: '8 each side', demo: 'thoracic_rot', src: PL },
    { name: 'Hip 90/90 transitions', dose: '8 each way', demo: 'hip_9090', src: WR, note: 'Feels intense. Stay in a range you control.' },
    { name: 'Hip flexor stretch', dose: '45 s each side', demo: 'hip_flexor', src: PL, note: 'Squeeze the glute on the back leg (helps the pelvic tilt).' },
    { name: 'Deep squat hold at the wall', dose: '60 s', demo: 'deep_squat_wall', src: TK },
    { name: 'Wrist prep', dose: '2 min', demo: 'wrist_prep', src: PL, note: 'Circles, palm lifts, finger extensions.' },
    { name: 'Bar hang', dose: '30–60 s', demo: 'bar_hang', src: PL, note: 'Decompresses the spine and opens the shoulders.' },
    { name: 'Spinal locomotion', dose: '15 s', demo: 'spinal_loco', src: TK },
    { name: 'Coiling core', dose: '5 reps each side', demo: 'coiling_core', src: TK },
  ] },
  { id: 'wrestler', name: 'Wrestler mobility routine', when: 'Wed or any warm-up', minutes: 8, blurb: 'The routine from the Russian wrestler reel. Start with easy ranges: it looks harder than it is.', items: [
    { name: 'Hand walkouts', dose: '2 × 6', demo: 'walkout', src: WR, note: 'Walk out to plank, then walk yourself back up.' },
    { name: 'Hamstring lunges', dose: '2 × 6 each side', demo: 'hamstring_lunge', src: WR, note: 'Try to bring chest toward the knee. Do not force it.' },
    { name: '90/90s', dose: '2 × 8', demo: 'hip_9090', src: WR },
    { name: 'Kick-throughs', dose: '2 × 10', demo: 'kick_through', src: WR, note: 'Go as fast as you can with control.' },
  ] },
  { id: 'wed', name: 'Mobility day: hips and back', when: 'Wednesday', minutes: 35, blurb: 'The long session for your tight back and hips. Do the daily primer first. Hold stretches 60–90 s: strong pull, not pain.', items: [
    { name: 'Hamstring lunges and walkouts', dose: '2 × 6', demo: 'hamstring_lunge', src: WR },
    { name: 'Hip 90/90 transitions', dose: '2 × 8', demo: 'hip_9090', src: WR },
    { name: 'Pigeon pose', dose: '90 s each side', demo: 'pigeon', src: PL },
    { name: 'Hip flexor with glute squeeze', dose: '60 s each side', demo: 'hip_flexor', src: PL },
    { name: 'Lengthened glute work', dose: '2 × 8 each side', demo: 'lengthened_glute', src: GL, note: 'Start with hand support, then slowly let the leg reach further back. Strong in the long position.' },
    { name: 'Toe-tuck sit and crawling', dose: '3 × 30 s', demo: 'toe_tuck', src: BC, note: 'Trains the foot-to-glute line.' },
    { name: 'Hamstring stretch', dose: '60 s each side', demo: 'hamstring', src: PL },
    { name: 'Standing pancake (hinge)', dose: '3 × 45 s', demo: 'pancake', src: TK },
    { name: 'Deep squat hold at the wall', dose: '2 × 60 s', demo: 'deep_squat_wall', src: TK },
    { name: 'Bar hang', dose: '60–90 s', demo: 'bar_hang', src: PL },
  ] },
  { id: 'sun', name: 'Mobility day: shoulders and spine', when: 'Sunday', minutes: 35, blurb: 'Opens the shoulders, spine and wrists for handstand, planche and the bridge. Do the daily primer first. Do not force end range.', items: [
    { name: 'Chest and shoulder stretch', dose: '60 s each side', demo: 'chest_stretch', src: PL },
    { name: 'Wall bridge', dose: '3 × 20 s', demo: 'wall_bridge', src: TK, note: 'Hands on a wall or bench, not the floor, until your shoulders open up.' },
    { name: 'Skin-the-cat and German hang', dose: '3 × 5 s', demo: 'german_hang', src: TK, note: 'Start with feet on the floor. Never hang in the full German hang before your shoulders are ready.' },
    { name: 'Cross-reach bridge', dose: '2 × 8 each side', demo: 'cross_bridge', src: TK },
    { name: 'Seiza and sissy squat', dose: '3 × 8–10', demo: 'seiza', src: TK, note: 'Knee tendon work: go slowly and use a support.' },
    { name: 'Spinal locomotion', dose: '3 × 15 s', demo: 'spinal_loco', src: TK },
    { name: 'Coiling core', dose: '2 × 6 each side', demo: 'coiling_core', src: TK },
    { name: 'Wrist prep and frog stand', dose: '3 × 20 s', demo: 'frog_stand', src: PL },
    { name: "Child's pose", dose: '60 s', demo: 'childs', src: PL },
  ] },
  { id: 'post', name: 'After-workout stretch', when: 'After every workout', minutes: 3, blurb: 'Static stretch for what you just worked. Soreness is fine. Tightness is not.', items: [
    { name: 'Chest and shoulder stretch', dose: '45 s', demo: 'chest_stretch', src: PL },
    { name: 'Hamstring stretch', dose: '45 s', demo: 'hamstring', src: PL },
    { name: 'Hip flexor stretch', dose: '45 s each side', demo: 'hip_flexor', src: PL },
    { name: "Child's pose", dose: '45 s', demo: 'childs', src: PL },
  ] },
  { id: 'eve', name: 'Evening flexibility holds', when: 'Every evening, while watching something', minutes: 10, blurb: 'Where "extremely flexible" comes from. Long, easy holds of 60–120 s. Rotate the focus each night.', items: [
    { name: 'Front and middle splits', dose: '2 × 90 s', demo: 'splits', src: PL },
    { name: 'Standing pancake / butterfly', dose: '2 × 90 s', demo: 'butterfly_s', src: TK },
    { name: 'Pigeon pose', dose: '90 s each side', demo: 'pigeon', src: PL },
    { name: 'Groin stretch', dose: '90 s', demo: 'groin', src: PL },
    { name: 'Wall bridge', dose: '2 × 20 s', demo: 'wall_bridge', src: TK },
  ] },
  { id: 'posture', name: 'Pelvic tilt fix', when: 'Add to the primer 3 days a week', minutes: 6, blurb: 'From the glute and posterior-chain reels, for the anterior pelvic tilt.', items: [
    { name: 'Hip flexor stretch with glute squeeze', dose: '45 s each side', demo: 'hip_flexor', src: GL },
    { name: 'Glute bridge', dose: '2 × 12', demo: 'glute_bridge', src: BC },
    { name: 'Dead bug', dose: '2 × 8 each side', demo: 'dead_bug', src: PL, note: 'Keep the lower back flat to the floor.' },
    { name: 'Toe-tuck sit and crawling', dose: '2 × 30 s', demo: 'toe_tuck', src: BC },
  ] },
];

// ---------------------------------------------------------------- skill ladders

export interface SkillStep { name: string; gate: string; demo?: string }
export interface Skill { id: string; name: string; goal: string; steps: SkillStep[] }
export const SKILLS: Skill[] = [
  { id: 'planche', name: 'Planche', goal: 'Planche and planche push-up (a multi-year goal)', steps: [
    { name: 'Planche lean', gate: '3 × 30 s, arms locked, shoulders well forward of the hands', demo: 'planche_lean' },
    { name: 'Pseudo-planche push-up', gate: '3 × 10 clean with a deep lean', demo: 'pppu' },
    { name: 'Frog stand', gate: '30 s hold', demo: 'frog_stand' },
    { name: 'Tuck planche', gate: '10–15 s hold', demo: 'tuck_planche' },
    { name: 'Advanced tuck planche', gate: '10 s hold, then straddle' },
    { name: 'Planche push-ups', gate: 'Tuck, advanced tuck, straddle, then full' },
  ] },
  { id: 'mu', name: 'Muscle-up', goal: 'A clean muscle-up', steps: [
    { name: '8 clean pull-ups', gate: 'Strict, full range', demo: 'pullup' },
    { name: 'Chest-to-bar / explosive pull-ups', gate: '5 reps to the chest', demo: 'explosive_pullup' },
    { name: 'Transition drills and negatives', gate: '3 × 3', demo: 'mu_transition' },
    { name: 'Banded muscle-up', gate: '3 clean' },
    { name: 'Clean muscle-up', gate: 'Strict, no kip' },
  ] },
  { id: 'oap', name: 'One-arm pull-up', goal: 'A one-arm pull-up', steps: [
    { name: 'Weighted pull-ups', gate: '+25% bodyweight for 5', demo: 'pullup' },
    { name: 'Archer pull-ups', gate: '3 × 5 each side' },
    { name: 'One-arm negatives', gate: '5 s lowering, 3 × 3', demo: 'oac_negative' },
    { name: 'One-arm pull-up', gate: 'One clean rep' },
  ] },
  { id: 'hspu', name: 'Handstand push-up', goal: 'Handstand and handstand push-up', steps: [
    { name: 'Pike push-up', gate: '4 × 8 on parallettes', demo: 'pike_pushup' },
    { name: 'Wall handstand hold', gate: '30 s, belly to the wall', demo: 'wall_handstand' },
    { name: 'Wall handstand push-up', gate: '3 × 3', demo: 'hspu' },
    { name: 'Freestanding handstand', gate: '10 s' },
  ] },
  { id: 'fly', name: 'Flying push-up', goal: 'Flying (superman) push-up', steps: [
    { name: 'Clap push-up', gate: '3 × 5', demo: 'plyo_pushup' },
    { name: 'Explosive push-up', gate: 'Hands clearly leave the floor', demo: 'clap_pushup' },
    { name: 'Flying push-up', gate: 'Hands and feet leave, body in a line' },
  ] },
];

// ---------------------------------------------------------------- 12-week targets

export interface WeekTarget { wk: number; phase: string; bench: string; deadlift: string; note: string }
export const TARGETS: WeekTarget[] = [
  { wk: 1, phase: 'Baseline', bench: '4 × 5 @ 35', deadlift: '4 × 4 @ 60', note: 'Find squat and overhead-press weights. Test max reps.' },
  { wk: 2, phase: 'Base', bench: '4 × 5 @ 37.5', deadlift: '4 × 4 @ 65', note: 'Add reps first.' },
  { wk: 3, phase: 'Base', bench: '4 × 5 @ 40', deadlift: '4 × 4 @ 70', note: 'Nordic lowering starts.' },
  { wk: 4, phase: 'Deload + mini-test', bench: '3 × 5 @ 35', deadlift: '3 × 4 @ 60', note: '60% volume. Test pull-ups, push-ups and plank.' },
  { wk: 5, phase: 'Strength', bench: '4 × 5 @ 40', deadlift: '4 × 4 @ 72.5', note: '' },
  { wk: 6, phase: 'Strength', bench: '4 × 5 @ 42.5', deadlift: '4 × 3 @ 77.5', note: '' },
  { wk: 7, phase: 'Strength', bench: '4 × 4 @ 45', deadlift: '4 × 3 @ 82.5', note: '' },
  { wk: 8, phase: 'Deload + mini-test', bench: '3 × 4 @ 40', deadlift: '3 × 3 @ 70', note: '60% volume. Re-test.' },
  { wk: 9, phase: 'Peak', bench: '4 × 4 @ 45', deadlift: '4 × 3 @ 85', note: '' },
  { wk: 10, phase: 'Peak', bench: '4 × 3 @ 47.5', deadlift: '4 × 2 @ 92.5', note: '' },
  { wk: 11, phase: 'Peak', bench: '3 × 3 @ 50', deadlift: '3 × 2 @ 97.5', note: '' },
  { wk: 12, phase: 'Test week', bench: 'Work to a 3-rep max', deadlift: 'Work to a 3-rep max', note: 'Re-test everything.' },
];
