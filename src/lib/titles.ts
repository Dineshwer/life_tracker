/** Level title ladder, shared by the Character screen and the Today hero emblem. */
export const TITLES: [number, string, string][] = [
  [1, 'Seedling', 'Small, green, and already reaching.'],
  [3, 'Sapling', 'Bending, not breaking.'],
  [5, 'Rooted', 'The ground knows your name.'],
  [8, 'Branching', 'Every habit, a new limb.'],
  [12, 'Canopy', 'Others find shade in what you built.'],
];
export const titleFor = (lv: number) => [...TITLES].reverse().find((t) => lv >= t[0]) ?? TITLES[0];
export const bandFor = (lv: number) => Math.max(1, TITLES.findIndex((t) => t[1] === titleFor(lv)[1]) + 1);
