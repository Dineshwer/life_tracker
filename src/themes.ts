/** Theme registry. Each skin has a CSS file in src/styles/skins/<id>.css defining BOTH modes. */

export type Mode = 'dark' | 'light';
export type SkinGroup = 'calm' | 'bold' | 'artistic';

export interface Skin {
  id: string;
  name: string;
  tagline: string;
  group: SkinGroup;
  /** mode a skin is designed in; selecting the skin switches to it */
  nativeMode: Mode;
  /** Google Fonts `family=` fragments, joined into one css2 URL */
  fonts: string[];
}

export const SKINS: Skin[] = [
  { id: 'canopy', name: 'Canopy', tagline: 'Forest night, glow and depth', group: 'calm', nativeMode: 'dark',
    fonts: ['Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,300..650,0..100,0..1;1,9..144,300..650,0..100,0..1', 'Figtree:wght@300..750', 'Geist+Mono:wght@400;500'] },
  { id: 'paper', name: 'Paper', tagline: 'A printed daily planner', group: 'calm', nativeMode: 'light',
    fonts: ['Young+Serif', 'Karla:ital,wght@0,400;0,500;0,700;1,400', 'Caveat:wght@600', 'Geist+Mono:wght@400;500'] },
  { id: 'grimoire', name: 'Grimoire', tagline: 'RPG quest log in gold and leather', group: 'bold', nativeMode: 'dark',
    fonts: ['Cinzel:wght@500;700', 'Crimson+Pro:ital,wght@0,400;0,600;1,400', 'Geist+Mono:wght@400;500'] },
  { id: 'pop', name: 'Pop', tagline: 'Loud blocks, thick outlines', group: 'bold', nativeMode: 'light',
    fonts: ['Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800', 'Geist+Mono:wght@400;500'] },
  { id: 'arcade', name: 'Arcade', tagline: 'Neon HUD with segmented bars', group: 'bold', nativeMode: 'dark',
    fonts: ['Chakra+Petch:wght@500;600;700', 'JetBrains+Mono:wght@400;500;700'] },
  { id: 'sumi', name: 'Sumi', tagline: 'Ink wash and a red seal', group: 'artistic', nativeMode: 'light',
    fonts: ['Shippori+Mincho:wght@400;500;700', 'Geist+Mono:wght@400;500'] },
  { id: 'bauhaus', name: 'Bauhaus', tagline: 'Primary shapes and heavy rules', group: 'artistic', nativeMode: 'light',
    fonts: ['Jost:wght@400;500;700;800', 'Geist+Mono:wght@400;500'] },
  { id: 'riso', name: 'Riso', tagline: 'Two-ink print, halftone dots', group: 'artistic', nativeMode: 'light',
    fonts: ['Archivo+Black', 'Space+Mono:wght@400;700'] },
  { id: 'blueprint', name: 'Blueprint', tagline: 'Technical drawing on a grid', group: 'artistic', nativeMode: 'dark',
    fonts: ['IBM+Plex+Mono:wght@400;500;600', 'IBM+Plex+Sans+Condensed:wght@500;600;700'] },
  { id: 'swiss', name: 'Swiss', tagline: 'Poster grid, black, white and red', group: 'calm', nativeMode: 'light',
    fonts: ['Archivo:wdth,wght@62..125,400..900', 'Geist+Mono:wght@400;500'] },
  { id: 'collage', name: 'Collage', tagline: 'Cut paper, tape and marker', group: 'artistic', nativeMode: 'light',
    fonts: ['Permanent+Marker', 'Special+Elite', 'Geist+Mono:wght@400;500'] },
  { id: 'rings', name: 'Rings', tagline: 'Dark fitness-app clarity', group: 'calm', nativeMode: 'dark',
    fonts: ['Barlow:wght@400;500;600;700;800', 'Geist+Mono:wght@400;500'] },
  { id: 'cyberpunk', name: 'Cyberpunk', tagline: 'Yellow on black, notched corners', group: 'bold', nativeMode: 'dark',
    fonts: ['Bebas+Neue', 'Share+Tech+Mono'] },
];

export const DEFAULT_SKIN = 'canopy';
export const getSkin = (id?: string): Skin => SKINS.find((s) => s.id === id) ?? SKINS[0];

const loaded = new Set<string>();
const fontUrl = (s: Skin) => `https://fonts.googleapis.com/css2?${s.fonts.map((f) => `family=${f}`).join('&')}&display=swap`;

/** Inject the Google Fonts stylesheet for a skin once. Safe to call repeatedly. */
export function loadSkinFonts(id: string) {
  const skin = getSkin(id);
  if (loaded.has(skin.id) || typeof document === 'undefined') return;
  loaded.add(skin.id);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = fontUrl(skin);
  link.dataset.skinFonts = skin.id;
  document.head.appendChild(link);
}

export const loadAllSkinFonts = () => SKINS.forEach((s) => loadSkinFonts(s.id));
