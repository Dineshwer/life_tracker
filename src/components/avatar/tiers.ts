/* Shared unlock thresholds and wording. gear.ts uses the thresholds to decide what to build;
   the Character screen uses the same numbers and labels to explain what each stat has unlocked. */
export const MIND_TIERS = [2, 5, 9];        // stat level at which tier 1, 2, 3 of the Mind props appear
export const SKILL_TIERS = [2, 5, 9];
export const DISC_TIERS = [2, 5, 9];
export const STREAK_TIERS = [3, 7, 14, 30]; // consecutive days: tier 1..4 of the streak glow

/** how many thresholds a value has reached: 0..thresholds.length */
export const tierOf = (v: number, thresholds: number[]) => thresholds.filter((t) => v >= t).length;

/** band names, index 0 = band 1 (same as lib/titles) */
export const BAND_NAMES = ['Seedling', 'Sapling', 'Rooted', 'Branching', 'Canopy'];

/** outfit and silhouette by overall band 1..5 (cumulative: each band keeps the earlier pieces) */
export const BAND_GEAR = [
  'Plain clothes',
  'Peasant outfit, scarf and a staff',
  'Ranger outfit, short mantle, bracers and a carved staff',
  'Big pauldrons, chest plate, full cape, circlet, sword and rune marks',
  'Gold armour, laurel crown, light wings, an ornate weapon and an aura',
];
/** ground scenery by band */
export const BAND_SETTING = ['Bare ground', 'Grass and a lantern', 'A campfire', 'Standing stones and a banner', 'A great tree and throne arch'];
/** companion by band (index 0 = none) */
export const BAND_COMPANION = ['None yet', 'None yet', 'A wisp', 'A bird', 'A firebird'];

/** what each tier of each stat adds, index 0 = nothing yet */
export const MIND_UNLOCKS = ['Nothing yet', 'A floating tome', 'Two tomes and a halo', 'Orbiting tomes, halo and star charts'];
export const SKILL_UNLOCKS = ['Nothing yet', 'A holo tablet in the left hand', 'A larger tablet with running code', 'Tablet, code panels and tool belt'];
export const DISC_UNLOCKS = ['Nothing yet', 'One rune ring at the feet', 'Two rune rings and knee guards', 'Three rune rings and a rune belt'];
export const BODY_UNLOCKS = (lv: number) => (lv < 3 ? 'Lean build' : lv < 6 ? 'Athletic build' : lv < 10 ? 'Strong build' : 'Powerful build');
export const STREAK_UNLOCKS = ['Cold', 'Warm sparks at the feet', 'A flame ring', 'A rising fire', 'Blazing aura'];

/** one-line caption shown when the overall level crosses into a new band (index 0 = band 1) */
export const BAND_UNLOCK_LINE = [
  'Seedling: where it starts',
  'Sapling: peasant outfit, scarf and a staff',
  'Rooted: ranger outfit, a campfire and a wisp',
  'Branching: new armour unlocked',
  'Canopy: gold armour, wings and a great tree',
];
