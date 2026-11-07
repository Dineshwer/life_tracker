import * as THREE from 'three';
import type { ApplyLook, AvatarRig, Materials, MakeMaterials } from './types';

/* ============================================================================================
   looks.ts: per-theme materials, lighting, backdrop and camera framing for the 3D character.
   makeMaterials reads the live CSS tokens; applyLook builds lights + backdrop and returns the camera.
   ========================================================================================== */

// ---------------------------------------------------------------- colour helpers
const SRGB = THREE.SRGBColorSpace;
const tmp = { r: 0, g: 0, b: 0 };

function cssColor(expr: string, fallback: string): THREE.Color {
  const c = new THREE.Color(fallback);
  if (typeof document === 'undefined') return c;
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;';
  el.style.color = expr;
  document.documentElement.appendChild(el);
  const s = getComputedStyle(el).color;
  el.remove();
  const nums = (s.match(/-?\d*\.?\d+(?:e-?\d+)?/g) || []).map(Number);
  if (/^rgba?\(/.test(s) && nums.length >= 3) return c.setRGB(nums[0] / 255, nums[1] / 255, nums[2] / 255, SRGB);
  if (/^color\(srgb/.test(s) && nums.length >= 3) return c.setRGB(nums[0], nums[1], nums[2], SRGB);
  try {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.fillStyle = '#ff00ff';
      ctx.fillStyle = s;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return c.setRGB(d[0] / 255, d[1] / 255, d[2] / 255, SRGB);
    }
  } catch { /* fall through */ }
  return c;
}

const hex = (h: string) => new THREE.Color(h);
/** mix in sRGB space: a*(1-f) + b*f */
function mix(a: THREE.Color, b: THREE.Color, f: number): THREE.Color {
  const A = a.getRGB({ r: 0, g: 0, b: 0 } as THREE.RGB, SRGB);
  const B = b.getRGB({ r: 0, g: 0, b: 0 } as THREE.RGB, SRGB);
  return new THREE.Color().setRGB(A.r + (B.r - A.r) * f, A.g + (B.g - A.g) * f, A.b + (B.b - A.b) * f, SRGB);
}
function lum(c: THREE.Color): number {
  c.getRGB(tmp as THREE.RGB, SRGB);
  return 0.2126 * tmp.r + 0.7152 * tmp.g + 0.0722 * tmp.b;
}
/** make sure c stands out from bg: push toward `toward` until luminance gap >= gap */
function contrast(c: THREE.Color, bg: THREE.Color, toward: THREE.Color, gap = 0.22): THREE.Color {
  let out = c;
  for (let i = 1; i <= 8 && Math.abs(lum(out) - lum(bg)) < gap; i++) out = mix(c, toward, i * 0.12);
  return out;
}
/** scale colour down so its luminance does not exceed max */
function capLum(c: THREE.Color, max: number): THREE.Color {
  const l = lum(c);
  return l > max ? mix(hex('#000000'), c, max / l) : c;
}
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const rngOf = (seed: number) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;

interface Pal {
  bg: THREE.Color; text: THREE.Color; muted: THREE.Color; accent: THREE.Color; accent2: THREE.Color;
  body: THREE.Color; mind: THREE.Color; skill: THREE.Color; disc: THREE.Color; dk: boolean;
}
function readPalette(mode: 'dark' | 'light'): Pal {
  const dk = mode === 'dark';
  const g = (v: string, f: string) => cssColor(`var(--${v})`, f);
  return {
    bg: g('bg', dk ? '#101418' : '#f2f2f2'), text: g('text', dk ? '#eeeeee' : '#111111'), muted: g('muted', '#888888'),
    accent: g('accent', '#ffaa33'), accent2: g('accent-2', '#55aaff'),
    body: g('body', '#ff8a5c'), mind: g('mind', '#5cc8ff'), skill: g('skill', '#ffd35c'), disc: g('discipline', '#b48cff'), dk,
  };
}

// ---------------------------------------------------------------- theme specs
type Style = 'toon' | 'flat' | 'cyber';
interface Rim { color: THREE.Color; power: number; strength: number }
interface Spec {
  style: Style;
  steps: number[];
  outline: boolean;
  outlineW: number;
  ink(p: Pal): THREE.Color;
  skin(p: Pal): THREE.Color;
  hair(p: Pal): THREE.Color;
  cloth(p: Pal): THREE.Color;
  cloth2(p: Pal): THREE.Color;
  metal(p: Pal): THREE.Color;
  dark(p: Pal): THREE.Color;
  glow(p: Pal): THREE.Color;
  phongMetal?: boolean;
  rim?(p: Pal): Rim | null;
}
const darkInk = (p: Pal) => mix(p.bg, hex('#000000'), p.dk ? 0.6 : 0.0).lerp(hex('#000000'), 0);
const std = (p: Pal, dkc: string, ltc: string) => hex(p.dk ? dkc : ltc);

const SPEC: Record<string, Spec> = {
  canopy: {
    style: 'toon', steps: [0.3, 0.52, 0.78, 1], outline: false, outlineW: 0.01, ink: darkInk,
    skin: (p) => std(p, '#cf9a76', '#d9a47e'), hair: (p) => std(p, '#55402f', '#3a2a20'),
    cloth: (p) => contrast(mix(p.accent, p.bg, p.dk ? 0.38 : 0.0), p.bg, p.text, 0.12),
    cloth2: (p) => contrast(mix(p.accent2, p.bg, 0.1), p.bg, p.text), metal: () => hex('#cdbf94'),
    dark: (p) => mix(p.bg, hex('#0c1510'), 0.5).lerp(hex('#16231c'), p.dk ? 0.5 : 0), glow: (p) => p.accent,
    rim: (p) => (p.dk ? { color: mix(p.accent, p.bg, 0.45), power: 3.5, strength: 0.12 } : null),
  },
  paper: {
    style: 'toon', steps: [0.6, 0.82, 1], outline: true, outlineW: 0.013,
    ink: (p) => (p.dk ? mix(p.bg, hex('#000000'), 0.55) : mix(p.text, hex('#000000'), 0.1)),
    skin: (p) => std(p, '#e2bb97', '#e9c4a1'), hair: (p) => std(p, '#4a382c', '#3a2c22'),
    cloth: (p) => p.accent, cloth2: (p) => mix(p.accent2, p.bg, 0.15), metal: (p) => mix(p.muted, p.bg, 0.2),
    dark: (p) => (p.dk ? hex('#14100c') : mix(p.text, p.bg, 0.12)), glow: (p) => p.accent,
  },
  grimoire: {
    style: 'toon', steps: [0.32, 0.56, 0.8, 1], outline: true, outlineW: 0.009,
    ink: (p) => (p.dk ? hex('#050302') : hex('#2b1d10')),
    skin: () => hex('#c68a62'), hair: (p) => std(p, '#6a4528', '#3a2216'),
    cloth: (p) => contrast(p.accent2, p.bg, p.text, 0.12), cloth2: (p) => (p.dk ? hex('#5a3a22') : hex('#4a3020')),
    metal: (p) => (p.dk ? hex('#e0b455') : hex('#b8862a')), dark: (p) => (p.dk ? hex('#2a1c12') : hex('#3a2616')),
    glow: (p) => (p.dk ? hex('#ffb347') : hex('#d98a1f')), phongMetal: true,
    rim: (p) => (p.dk ? { color: hex('#c9553f'), power: 3, strength: 0.2 } : null),
  },
  pop: {
    style: 'toon', steps: [0.62, 0.84, 1], outline: true, outlineW: 0.022,
    ink: (p) => (p.dk ? hex('#05061a') : hex('#111111')),
    skin: () => hex('#f2b48a'), hair: (p) => (p.dk ? hex('#3a2a6a') : hex('#2a1a14')),
    cloth: (p) => p.accent, cloth2: (p) => p.accent2, metal: () => hex('#c9d2e0'),
    dark: (p) => (p.dk ? hex('#0a0c22') : hex('#222222')), glow: (p) => p.accent2,
  },
  arcade: {
    style: 'flat', steps: [1], outline: false, outlineW: 0.01, ink: darkInk,
    skin: (p) => std(p, '#d99a6c', '#cf8f62'), hair: (p) => std(p, '#2a2f3a', '#1d2a28'),
    cloth: (p) => mix(p.accent, p.bg, p.dk ? 0.3 : 0), cloth2: (p) => mix(p.accent2, p.bg, p.dk ? 0.3 : 0), metal: () => hex('#9fb4c0'),
    dark: (p) => (p.dk ? hex('#10161c') : hex('#1a2a2a')), glow: (p) => p.accent,
  },
  sumi: {
    style: 'toon', steps: [0.5, 0.78, 1], outline: true, outlineW: 0.02,
    ink: (p) => (p.dk ? hex('#ece6d8') : hex('#1c1b19')),
    skin: (p) => std(p, '#cfc6b2', '#efe3cb'), hair: (p) => std(p, '#2e2c28', '#16120f'),
    cloth: (p) => (p.dk ? hex('#6a665e') : hex('#4a4843')), cloth2: (p) => (p.dk ? hex('#a8a294') : hex('#9a958a')),
    metal: (p) => (p.dk ? hex('#b8b2a2') : hex('#7a766c')), dark: (p) => (p.dk ? hex('#26241f') : hex('#1c1b19')),
    glow: (p) => p.accent,
  },
  bauhaus: {
    style: 'toon', steps: [0.7, 1], outline: true, outlineW: 0.017,
    ink: (p) => (p.dk ? hex('#efe7d4') : hex('#141414')),
    skin: () => hex('#e8b78c'), hair: (p) => (p.dk ? hex('#3a3a3a') : hex('#141414')),
    cloth: (p) => p.accent, cloth2: (p) => p.accent2, metal: () => hex('#c8c0ac'),
    dark: (p) => (p.dk ? hex('#0b0b0b') : hex('#1a1a1a')), glow: (p) => p.accent2,
  },
  riso: {
    style: 'toon', steps: [0.68, 1], outline: true, outlineW: 0.012,
    ink: (p) => (p.dk ? hex('#050c20') : p.text),
    skin: (p) => (p.dk ? mix(p.accent, hex('#f3eddf'), 0.55) : mix(p.accent, hex('#ffffff'), 0.62)),
    hair: (p) => (p.dk ? hex('#08122c') : mix(p.text, p.accent2, 0.2)),
    cloth: (p) => p.accent2, cloth2: (p) => p.accent, metal: (p) => mix(p.accent2, hex('#ffffff'), 0.55),
    dark: (p) => (p.dk ? hex('#060d1e') : mix(p.text, p.bg, 0.08)), glow: (p) => p.accent,
  },
  blueprint: {
    style: 'toon', steps: [0.65, 1], outline: true, outlineW: 0.02,
    ink: (p) => (p.dk ? hex('#e6f4ff') : p.text),
    skin: (p) => (p.dk ? mix(p.bg, hex('#cfeaff'), 0.55) : mix(p.bg, p.text, 0.12)),
    hair: (p) => (p.dk ? mix(p.bg, hex('#000814'), 0.35) : mix(p.bg, p.text, 0.6)),
    cloth: (p) => (p.dk ? mix(p.bg, p.accent2, 0.75) : mix(p.bg, p.accent2, 0.7)),
    cloth2: (p) => (p.dk ? mix(p.bg, p.text, 0.5) : mix(p.bg, p.text, 0.45)),
    metal: (p) => (p.dk ? hex('#b9d6ee') : hex('#6f8fad')),
    dark: (p) => (p.dk ? mix(p.bg, hex('#000814'), 0.5) : mix(p.bg, p.text, 0.7)), glow: (p) => (p.dk ? p.accent2 : p.accent2),
  },
  swiss: {
    style: 'toon', steps: [0.64, 1], outline: true, outlineW: 0.012,
    ink: (p) => (p.dk ? hex('#ffffff') : hex('#0d0d0d')),
    skin: (p) => std(p, '#e6e6e4', '#fbfaf6'), hair: (p) => (p.dk ? hex('#9a9a98') : hex('#0d0d0d')),
    cloth: (p) => p.accent, cloth2: (p) => (p.dk ? hex('#f2f2f2') : hex('#0d0d0d')),
    metal: () => hex('#9a9a96'), dark: (p) => (p.dk ? hex('#2c2c2c') : hex('#0d0d0d')), glow: (p) => p.accent,
  },
  collage: {
    style: 'toon', steps: [0.66, 1], outline: true, outlineW: 0.016,
    ink: (p) => (p.dk ? hex('#f7efdc') : hex('#201a14')),
    skin: (p) => std(p, '#e2a47e', '#e0a07a'), hair: (p) => std(p, '#3a2a1e', '#2a1d14'),
    cloth: (p) => p.accent, cloth2: (p) => p.accent2, metal: () => hex('#d5a93a'),
    dark: (p) => (p.dk ? hex('#17110c') : hex('#2a2018')), glow: (p) => p.skill,
  },
  rings: {
    style: 'toon', steps: [0.42, 0.72, 1], outline: false, outlineW: 0.01, ink: darkInk,
    skin: (p) => std(p, '#d49c7a', '#d9a07c'), hair: (p) => std(p, '#5a4638', '#3a2a20'),
    cloth: (p) => mix(p.accent2, p.bg, p.dk ? 0.3 : 0), cloth2: (p) => mix(p.body, p.bg, p.dk ? 0.3 : 0.05), metal: () => hex('#cfd3d8'),
    dark: (p) => (p.dk ? hex('#1a1a1e') : hex('#2a2a30')), glow: (p) => p.accent, phongMetal: true,
    rim: (p) => (p.dk ? { color: mix(p.accent2, p.bg, 0.5), power: 2.6, strength: 0.35 } : null),
  },
  cyberpunk: {
    style: 'cyber', steps: [0.4, 0.7, 1], outline: true, outlineW: 0.01,
    ink: (p) => (p.dk ? p.accent2 : hex('#0a0a0a')),
    skin: (p) => std(p, '#a8745e', '#b9805f'), hair: (p) => (p.dk ? hex('#1a1224') : hex('#18121e')),
    cloth: (p) => (p.dk ? mix(hex('#0c1015'), p.accent2, 0.22) : mix(hex('#15191d'), p.accent2, 0.25)),
    cloth2: (p) => (p.dk ? mix(hex('#140812'), hex('#ff2bd6'), 0.28) : mix(hex('#1c0f1a'), hex('#d1219f'), 0.3)),
    metal: (p) => (p.dk ? hex('#c8d4e0') : hex('#8a96a2')), dark: () => hex('#0d0d11'), glow: (p) => (p.dk ? p.accent2 : p.accent2), phongMetal: true,
    rim: (p) => ({ color: p.dk ? hex('#ff2bd6') : hex('#cc1faa'), power: 2.2, strength: p.dk ? 0.5 : 0.6 }),
  },
};

// ---------------------------------------------------------------- materials
function gradientTexture(steps: number[]): THREE.DataTexture {
  const data = new Uint8Array(steps.map((s) => Math.round(s * 255)));
  const t = new THREE.DataTexture(data, steps.length, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

function addRim(m: THREE.Material, rim: Rim) {
  const c = new THREE.Color(rim.color).multiplyScalar(rim.strength);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = { value: c };
    sh.uniforms.uRimP = { value: rim.power };
    sh.fragmentShader = 'uniform vec3 uRim;\nuniform float uRimP;\n' + sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n float rimF = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), uRimP);\n totalEmissiveRadiance += uRim * rimF;',
    );
  };
  m.customProgramCacheKey = () => 'rim';
}

// ---------------------------------------------------------------- model material conversion (grade tables)
type Role = 'skin' | 'cloth' | 'hair' | 'metal' | 'eye' | 'other';
/** mix = how far the texture is pulled toward the theme colour (duotone, keeps shading detail), sat = saturation of the texture first, post = posterize levels (0 off) */
interface Grade { mix: number; sat: number; post?: number }
type GradeSet = Record<Role, Grade>;
const gs = (skin: [number, number], hair: [number, number], cloth: [number, number], metal = 0.6, post = 0): GradeSet => ({
  skin: { mix: skin[0], sat: skin[1], post }, hair: { mix: hair[0], sat: hair[1], post }, cloth: { mix: cloth[0], sat: cloth[1], post },
  metal: { mix: metal, sat: 0.6, post }, eye: { mix: 0, sat: skin[1] < 0.5 ? 0.2 : 1, post }, other: { mix: 0.2, sat: 1, post },
});
const GRADE: Record<string, GradeSet> = {
  canopy: gs([0, 1], [0.35, 1], [0.25, 1]),
  paper: gs([0.15, 0.85], [0.45, 0.9], [0.3, 0.9]),
  grimoire: gs([0.1, 1], [0.4, 1], [0.3, 1]),
  pop: gs([0.1, 1.15], [0.5, 1], [0.3, 1.2]),
  arcade: gs([0.1, 1], [0.4, 1], [0.3, 1], 0.6, 6),
  sumi: gs([0.85, 0.15], [0.8, 0.2], [0.8, 0.15], 0.8),
  bauhaus: gs([0.15, 1.1], [0.6, 1], [0.6, 1]),
  riso: gs([0.6, 0.5], [0.7, 0.5], [0.6, 0.5]),
  blueprint: gs([0.8, 0.2], [0.8, 0.2], [0.8, 0.2], 0.8),
  swiss: gs([0.75, 0.1], [0.8, 0.1], [0.7, 0.2], 0.7),
  collage: gs([0.1, 1], [0.4, 1], [0.3, 1]),
  rings: gs([0, 1], [0.35, 1], [0.25, 1]),
  cyberpunk: gs([0.12, 1], [0.5, 1], [0.5, 1], 0.5),
};
const REF: Record<Role, number> = { skin: 0.4, hair: 0.1, cloth: 0.3, metal: 0.4, eye: 1, other: 0.3 };

/** one onBeforeCompile for both the texture grade and the optional rim light */
function patchMaterial(m: THREE.Material, g: Grade, tint: THREE.Color, ref: number, rim: Rim | null) {
  const rc = rim ? new THREE.Color(rim.color).multiplyScalar(rim.strength) : null;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSat = { value: g.sat }; sh.uniforms.uMix = { value: g.mix }; sh.uniforms.uTint = { value: tint };
    sh.uniforms.uRef = { value: ref }; sh.uniforms.uPost = { value: g.post ?? 0 };
    let f = 'uniform float uSat;\nuniform float uMix;\nuniform vec3 uTint;\nuniform float uRef;\nuniform float uPost;\n' +
      (rc ? 'uniform vec3 uRim;\nuniform float uRimP;\n' : '') + sh.fragmentShader;
    f = f.replace('#include <map_fragment>', `#include <map_fragment>
 { float gLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
   vec3 gc = mix(vec3(gLum), diffuseColor.rgb, uSat);
   gc = mix(gc, uTint * clamp(gLum / uRef, 0.55, 1.4), uMix);
   if (uPost > 0.5) gc = floor(gc * uPost + 0.5) / uPost;
   diffuseColor.rgb = gc; }`);
    if (rc) {
      sh.uniforms.uRim = { value: rc }; sh.uniforms.uRimP = { value: rim!.power };
      f = f.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n float rimF = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), uRimP);\n totalEmissiveRadiance += uRim * rimF;');
    }
    sh.fragmentShader = f;
  };
  m.customProgramCacheKey = () => (rc ? 'grade-rim' : 'grade');
}

export const makeMaterials: MakeMaterials = (skinId, mode) => {
  const spec = SPEC[skinId] ?? SPEC.canopy;
  const p = readPalette(mode);
  const owned: Array<{ dispose(): void }> = [];
  const own = <T extends { dispose(): void }>(o: T): T => (owned.push(o), o);
  const grad = own(gradientTexture(spec.steps));
  const rimSpec = spec.rim ? spec.rim(p) : null;

  const make = (c: THREE.Color, o: { emissive?: THREE.Color; rim?: boolean; metal?: boolean } = {}): THREE.Material => {
    let m: THREE.Material;
    if (o.metal && spec.phongMetal) {
      m = new THREE.MeshPhongMaterial({ color: c, shininess: 70, specular: new THREE.Color(0x777777) });
    } else if (spec.style === 'flat') {
      m = new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    } else if (spec.style === 'cyber') {
      m = new THREE.MeshLambertMaterial({ color: c, emissive: o.emissive ?? new THREE.Color(0x000000) });
    } else {
      m = new THREE.MeshToonMaterial({ color: c, gradientMap: grad, emissive: o.emissive ?? new THREE.Color(0x000000) });
    }
    if (rimSpec && o.rim !== false) addRim(m, rimSpec);
    return own(m);
  };

  const cap = (c: THREE.Color, m: number) => (p.dk ? capLum(c, m) : c);
  const cloth = cap(spec.cloth(p), 0.5);
  const accentC = p.accent;
  const isCyber = spec.style === 'cyber';
  const glowC = spec.glow(p);
  const glow = own(new THREE.MeshBasicMaterial({
    color: glowC, transparent: true, opacity: p.dk ? 1 : 0.92, depthWrite: false, toneMapped: false,
    blending: THREE.NormalBlending,
  }));
  const inkC = spec.ink(p);

  const convCache = new Map<string, THREE.Material>();
  const outlineCache = new Map<number, THREE.MeshBasicMaterial>();
  const outlineMat = (th: number) => {
    const key = Math.round(th * 10000);
    let m = outlineCache.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: inkC, side: THREE.BackSide, toneMapped: false, fog: false });
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uThick = { value: key / 10000 };
        sh.vertexShader = 'uniform float uThick;\n' + sh.vertexShader.replace(
          '#include <begin_vertex>', 'vec3 transformed = position + normalize(normal) * uThick;');
      };
      m.customProgramCacheKey = () => 'outlineHull';
      outlineCache.set(key, m);
      owned.push(m);
    }
    return m;
  };

  const mats: Materials = {
    skin: make(cap(spec.skin(p), 0.5), { emissive: isCyber ? spec.skin(p).clone().multiplyScalar(0.05) : undefined }),
    hair: make(cap(spec.hair(p), 0.3)),
    cloth: make(cloth, { emissive: isCyber ? cloth.clone().multiplyScalar(0.1) : undefined }),
    cloth2: make(cap(spec.cloth2(p), 0.5), { emissive: isCyber ? spec.cloth2(p).clone().multiplyScalar(0.1) : undefined }),
    accent: make(accentC, { emissive: isCyber ? accentC.clone().multiplyScalar(0.7) : undefined, rim: false }),
    metal: make(spec.metal(p), { metal: true }),
    dark: make(spec.dark(p)),
    glow,
    stat: { body: p.body.getHex(), mind: p.mind.getHex(), skill: p.skill.getHex(), discipline: p.disc.getHex() },
    accentHex: p.accent.getHex(), accent2Hex: p.accent2.getHex(), bgHex: p.bg.getHex(), textHex: p.text.getHex(),
    outline: spec.outline,
    convert(src, role) {
      const key = src.uuid + '|' + role;
      const hit = convCache.get(key);
      if (hit) return hit;
      const S = src as THREE.MeshStandardMaterial;
      const g = (GRADE[skinId] ?? GRADE.canopy)[role];
      const tint = (role === 'skin' ? spec.skin(p) : role === 'hair' ? spec.hair(p) : role === 'metal' ? spec.metal(p)
        : role === 'cloth' ? spec.cloth(p) : role === 'other' ? spec.cloth2(p) : new THREE.Color(0xffffff)).clone();
      const base: Record<string, unknown> = { color: S.color ? S.color.clone() : new THREE.Color(0xffffff) };
      if (S.map) base.map = S.map;
      if (S.alphaMap) base.alphaMap = S.alphaMap;
      if (S.alphaTest) base.alphaTest = S.alphaTest;
      if (S.transparent) { base.transparent = true; base.opacity = S.opacity; base.depthWrite = S.depthWrite; }
      base.side = S.side;
      if (S.vertexColors) base.vertexColors = true;
      let m: THREE.Material;
      if (role === 'metal' && spec.phongMetal) {
        m = new THREE.MeshPhongMaterial({ ...base, shininess: 70, specular: new THREE.Color(0x777777) });
      } else if (spec.style === 'flat') {
        m = new THREE.MeshLambertMaterial({ ...base, flatShading: true });
      } else if (spec.style === 'cyber') {
        m = new THREE.MeshLambertMaterial({ ...base, emissive: new THREE.Color(0xffffff).multiplyScalar(role === 'eye' ? 0.3 : 0.1), emissiveMap: S.map ?? null });
      } else {
        m = new THREE.MeshToonMaterial({ ...base, gradientMap: grad });
      }
      m.name = src.name;
      if (S.map || g.mix > 0 || g.sat !== 1 || g.post) patchMaterial(m, g, tint, REF[role], rimSpec && role !== 'eye' ? rimSpec : null);
      else if (rimSpec && role !== 'eye') addRim(m, rimSpec);
      convCache.set(key, m);
      return own(m);
    },
    addOutline(mesh, thickness = spec.outlineW) {
      if (!spec.outline || !mesh.geometry || !mesh.geometry.attributes.normal) return null;
      const sm = mesh as THREE.SkinnedMesh;
      const srcMat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material | undefined;
      if (srcMat && (srcMat.alphaTest > 0 || (srcMat.transparent && srcMat.opacity < 1) || (srcMat as THREE.MeshStandardMaterial).alphaMap)) return null; // hair cards / lashes: a hull would be a solid blob
      let o: THREE.Mesh;
      if (sm.isSkinnedMesh) {
        if (!sm.skeleton) return null;
        mesh.updateWorldMatrix(true, false);
        const ws = mesh.getWorldScale(new THREE.Vector3());
        const k = Math.max(0.05, (Math.abs(ws.x) + Math.abs(ws.y) + Math.abs(ws.z)) / 3);
        // the hull shares geometry, skeleton and bind matrix; the push happens at begin_vertex, i.e. before skinning_vertex
        const hull = new THREE.SkinnedMesh(mesh.geometry, outlineMat(thickness / k));
        hull.bind(sm.skeleton, sm.bindMatrix);
        hull.frustumCulled = false;
        o = hull;
      } else {
        const s = mesh.scale;
        const k = Math.max(0.05, (Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.z)) / 3);
        o = new THREE.Mesh(mesh.geometry, outlineMat(thickness / k));
      }
      o.name = 'outline';
      o.userData.isOutline = true;
      o.raycast = () => {};
      o.castShadow = false;
      mesh.add(o);
      return o;
    },
    dispose() { owned.forEach((o) => o.dispose()); owned.length = 0; outlineCache.clear(); convCache.clear(); },
  };
  return mats;
};

// ---------------------------------------------------------------- look
interface Cam { fov: number; distance: number; height: number; lookAtY: number }
/** distance so that +-hw metres (at the figure's depth) fit the 4:5 portrait frame: wings, weapon, rings and set dressing all inside */
const frame = (fov: number, height: number, lookAtY: number, hw = 1.15): Cam => ({ fov, height, lookAtY, distance: Math.round((hw / 0.8 / Math.tan(THREE.MathUtils.degToRad(fov / 2))) * 100) / 100 });
const CAMERA: Record<string, Cam> = {
  canopy: frame(30, 1.25, 1.05),
  paper: frame(28, 1.2, 1.05),
  grimoire: frame(30, 1.1, 1.07),
  pop: frame(34, 1.25, 1.05),
  arcade: frame(28, 1.1, 1.05),
  sumi: frame(26, 1.15, 1.05),
  bauhaus: frame(24, 1.15, 1.05),
  riso: frame(28, 1.2, 1.05),
  blueprint: frame(22, 1.05, 1.05),
  swiss: frame(24, 1.1, 1.05),
  collage: frame(30, 1.2, 1.05),
  rings: frame(30, 1.25, 1.05),
  cyberpunk: frame(32, 0.8, 1.1),
};

interface LightSpec {
  key: [THREE.ColorRepresentation, number, [number, number, number]];
  ambient: [THREE.ColorRepresentation, number];
  hemi?: [THREE.ColorRepresentation, THREE.ColorRepresentation, number];
  rims: Array<[THREE.ColorRepresentation, number, [number, number, number]]>;
  candle?: boolean;
}
function lightsFor(id: string, p: Pal): LightSpec {
  const dk = p.dk;
  const warmW = dk ? '#fff1dc' : '#fff7ea';
  switch (id) {
    case 'canopy':
      return dk
        ? { key: ['#f4f4ea', 1.5, [2, 3.5, 3.5]], ambient: ['#7a8c84', 0.9], rims: [[p.accent, 1.6, [-2.5, 2.5, -3]], [p.accent2, 0.8, [2.5, 1.5, -2.5]]] }
        : { key: ['#fffbe8', 2.4, [2, 3.5, 3.5]], ambient: ['#dfeedd', 1.8], rims: [[p.accent, 1.0, [-2.5, 2.5, -3]]] };
    case 'paper':
      return { key: [warmW, dk ? 1.9 : 1.7, [1.5, 3, 4]], ambient: [dk ? '#8a7a68' : '#ffffff', dk ? 1.6 : 2.3], rims: [[p.accent, dk ? 1.1 : 0.4, [-2.5, 2, -3]]] };
    case 'grimoire':
      return dk
        ? { key: ['#ffe6c8', 1.8, [-2.5, 2.8, 3]], ambient: ['#6a5a50', 0.8], rims: [['#c9553f', 2.0, [2.5, 2, -2.5]], ['#e0a040', 1.0, [-2.5, 1.5, -2.5]]], candle: true }
        : { key: ['#ffe2b0', 2.6, [-2.5, 3, 3]], ambient: ['#f0dcb8', 1.7], rims: [['#c9553f', 1.0, [2.5, 2, -2.5]]], candle: true };
    case 'pop':
      return { key: ['#ffffff', dk ? 2.5 : 2.4, [2.5, 3.5, 3.5]], ambient: [dk ? '#8a86d0' : '#ffffff', dk ? 1.3 : 2.0], rims: [[p.accent2, dk ? 2.0 : 0.8, [-2.5, 2, -3]]] };
    case 'arcade':
      return { key: [dk ? '#e0ffe0' : '#ffffff', dk ? 2.0 : 2.7, [2.5, 4, 3]], ambient: [dk ? '#707c84' : '#ffffff', dk ? 0.7 : 1.6], rims: [[p.accent2, dk ? 2.6 : 0.7, [-2.5, 2, -3]], [p.accent, dk ? 1.6 : 0.4, [2.5, 1.5, -2.5]]] };
    case 'sumi':
      return { key: [dk ? '#f0ece0' : '#fffdf6', 2.1, [1.5, 3.5, 4]], ambient: [dk ? '#7a766c' : '#ffffff', dk ? 1.5 : 2.3], rims: [] };
    case 'bauhaus':
      return { key: ['#ffffff', 2.4, [2, 3.5, 4]], ambient: [dk ? '#8a8a8a' : '#ffffff', dk ? 1.5 : 2.1], rims: [] };
    case 'riso':
      return { key: [dk ? '#ffe8f4' : '#ffffff', 2.3, [2, 3.5, 4]], ambient: [dk ? '#8a90c0' : '#ffffff', dk ? 1.5 : 2.1], rims: [[p.accent, dk ? 1.6 : 0, [-2.5, 2, -3]]] };
    case 'blueprint':
      return { key: [dk ? '#e8f4ff' : '#ffffff', 2.0, [2, 3, 4]], ambient: [dk ? '#bcd8f0' : '#ffffff', dk ? 1.9 : 2.1], rims: [] };
    case 'swiss':
      return { key: ['#ffffff', 2.2, [2, 3.5, 4]], ambient: [dk ? '#9a9a9a' : '#ffffff', dk ? 1.5 : 2.2], rims: [] };
    case 'collage':
      return { key: [warmW, 2.3, [2, 3.5, 4]], ambient: [dk ? '#9a8470' : '#fff6e2', dk ? 1.4 : 2.0], rims: [] };
    case 'rings':
      return { key: [dk ? '#f4f6ff' : '#ffffff', dk ? 1.8 : 2.4, [2, 3.5, 4]], ambient: [dk ? '#808490' : '#ffffff', dk ? 0.7 : 1.9], rims: [[p.accent2, dk ? 2.2 : 0.6, [-2.5, 2, -3]], [p.body, dk ? 1.6 : 0.4, [2.5, 1.5, -2.5]]] };
    case 'cyberpunk':
      return dk
        ? { key: ['#d8ecff', 1.0, [2, 3, 3.5]], ambient: ['#585068', 0.7], rims: [['#ff2bd6', 2.5, [3, 2, -2.5]], ['#00f0ff', 2.5, [-3, 2, -2.5]]] }
        : { key: ['#fffbe0', 2.2, [2, 3, 3.5]], ambient: ['#f6f0c8', 1.7], rims: [['#d1219f', 2.0, [3, 2, -2.5]], ['#00a0b0', 2.0, [-3, 2, -2.5]]] };
    default:
      return { key: ['#ffffff', 2.4, [2, 3.5, 3.5]], ambient: ['#ffffff', 1.4], rims: [] };
  }
}

export const applyLook: ApplyLook = ({ scene, renderer, skinId, mode, rig }) => {
  const p = readPalette(mode);
  const id = SPEC[skinId] ? skinId : 'canopy';
  const quiet = reducedMotion();
  const objs: THREE.Object3D[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const dmats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const updaters: Array<(t: number) => void> = [];
  const H = rig.dims?.height ?? 1.8;
  const cy = H * 0.55;
  const root = new THREE.Group();
  root.name = 'look-backdrop';
  scene.add(root);
  objs.push(root);

  let prevBg: THREE.Scene['background'] = null;
  let bgSet = false;
  if (renderer.getClearAlpha() > 0) { prevBg = scene.background; scene.background = p.bg.clone(); bgSet = true; }

  // ---- lights
  const ls = lightsFor(id, p);
  const L = (o: THREE.Object3D) => { scene.add(o); objs.push(o); return o; };
  const LS = p.dk ? 0.55 : 0.4;
  const key = new THREE.DirectionalLight(new THREE.Color(ls.key[0]), ls.key[1] * LS);
  key.position.set(...ls.key[2]); L(key);
  L(new THREE.AmbientLight(new THREE.Color(ls.ambient[0]), ls.ambient[1] * LS));
  if (ls.hemi) L(new THREE.HemisphereLight(new THREE.Color(ls.hemi[0]), new THREE.Color(ls.hemi[1]), ls.hemi[2]));
  for (const r of ls.rims) { const d = new THREE.DirectionalLight(new THREE.Color(r[0]), r[1] * LS); d.position.set(...r[2]); L(d); }
  let candle: THREE.PointLight | null = null;
  if (ls.candle) {
    candle = new THREE.PointLight(p.dk ? 0xffa850 : 0xffc880, p.dk ? 2.5 : 2, 6, 2);
    candle.position.set(-1.1, 1.5, 1.3);
    L(candle);
  }
  const candleBase = candle ? candle.intensity : 0;
  if (candle) updaters.push((t) => { candle!.intensity = candleBase * (1 + 0.08 * Math.sin(t * 7.1) + 0.06 * Math.sin(t * 13.7 + 1) + 0.04 * Math.sin(t * 3.3)); });

  // ---- builders
  const mat = <T extends THREE.Material>(m: T): T => (dmats.push(m), m);
  const geo = <T extends THREE.BufferGeometry>(g: T): T => (geos.push(g), g);
  const tex = <T extends THREE.Texture>(t: T): T => (texs.push(t), t);
  const basic = (c: THREE.Color | THREE.ColorRepresentation, o: THREE.MeshBasicMaterialParameters = {}) =>
    mat(new THREE.MeshBasicMaterial({ color: c as THREE.ColorRepresentation, toneMapped: false, depthWrite: !o.transparent, ...o }));
  const put = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, order = -5) => {
    const mesh = new THREE.Mesh(geo(g), m);
    mesh.position.set(x, y, z);
    mesh.renderOrder = order;
    mesh.raycast = () => {};
    root.add(mesh);
    return mesh;
  };
  const disc = (r: number, c: THREE.Color | string | number, x: number, y: number, z: number, opacity = 1, seg = 64, order = -5) =>
    put(new THREE.CircleGeometry(r, seg), basic(c, opacity < 1 ? { transparent: true, opacity } : {}), x, y, z, order);
  const floorDisc = (r: number, c: THREE.Color | string | number, opacity = 1, y = 0.002, seg = 64, sx = 1, sz = 1) => {
    const m = disc(r, c, 0, y, 0, opacity, seg, -4);
    m.rotation.x = -Math.PI / 2; m.scale.set(sx, sz, 1);
    return m;
  };
  const ringMesh = (ri: number, ro: number, c: THREE.Color | string | number, x: number, y: number, z: number, opacity = 1, th0 = 0, len = Math.PI * 2, seg = 96) =>
    put(new THREE.RingGeometry(ri, ro, seg, 1, th0, len), basic(c, opacity < 1 ? { transparent: true, opacity } : {}), x, y, z);
  const canvasTex = (w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, nearest = false) => {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d')!;
    draw(ctx, w, h);
    const t = tex(new THREE.CanvasTexture(cv));
    t.colorSpace = SRGB;
    if (nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; }
    return t;
  };
  const css = (c: THREE.Color, a = 1) => `rgba(${Math.round(c.getRGB({ r: 0, g: 0, b: 0 } as THREE.RGB, SRGB).r * 255)},${Math.round(c.getRGB({ r: 0, g: 0, b: 0 } as THREE.RGB, SRGB).g * 255)},${Math.round(c.getRGB({ r: 0, g: 0, b: 0 } as THREE.RGB, SRGB).b * 255)},${a})`;
  const radialTex = (c: THREE.Color, a0 = 1) => canvasTex(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, css(c, a0)); g.addColorStop(0.5, css(c, a0 * 0.35)); g.addColorStop(1, css(c, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
  const glowPlane = (c: THREE.Color, size: number, x: number, y: number, z: number, a = 0.8, _additive = false) => {
    const m = put(new THREE.PlaneGeometry(size, size), basic(c, { map: radialTex(c, a), transparent: true, blending: THREE.NormalBlending }), x, y, z);
    return m;
  };
  const floorGlow = (c: THREE.Color, r: number, a = 0.7, _additive = false, y = 0.003) => {
    const m = put(new THREE.PlaneGeometry(r * 2, r * 2), basic(c, { map: radialTex(c, a), transparent: true, blending: THREE.NormalBlending }), 0, y, 0, -4);
    m.rotation.x = -Math.PI / 2;
    return m;
  };
  const lineMat = (c: THREE.Color, opacity = 1) => mat(new THREE.LineBasicMaterial({ color: c, transparent: opacity < 1, opacity, toneMapped: false, depthWrite: false }));
  const segs = (pts: number[], m: THREE.Material, order = -5) => {
    const g = geo(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const l = new THREE.LineSegments(g, m);
    l.renderOrder = order; l.raycast = () => {};
    root.add(l);
    return l;
  };
  const tornShape = (r: number, n: number, jit: number, seed: number) => {
    const rnd = rngOf(seed);
    const s = new THREE.Shape();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (1 - jit + rnd() * jit * 2) * (i % 2 ? 1 : 0.985);
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
    }
    s.closePath();
    return s;
  };
  const starShape = (ro: number, ri: number, n: number) => {
    const s = new THREE.Shape();
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2 + Math.PI / 2;
      const r = i % 2 ? ri : ro;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
    }
    s.closePath();
    return s;
  };
  const motes = (o: { n: number; c: THREE.Color; size: number; soft: boolean; rise: number; sway: number; y0: number; y1: number; rx: number; z0: number; z1: number; seed: number }) => {
    const rnd = rngOf(o.seed);
    const base = new Float32Array(o.n * 3);
    const ph = new Float32Array(o.n);
    for (let i = 0; i < o.n; i++) {
      base[i * 3] = (rnd() * 2 - 1) * o.rx; base[i * 3 + 1] = o.y0 + rnd() * (o.y1 - o.y0); base[i * 3 + 2] = o.z0 + rnd() * (o.z1 - o.z0); ph[i] = rnd() * 100;
    }
    const g = geo(new THREE.BufferGeometry());
    const pos = new Float32Array(base);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = mat(new THREE.PointsMaterial({
      color: o.c, size: o.size, sizeAttenuation: true, transparent: true, depthWrite: false, toneMapped: false,
      map: o.soft ? radialTex(new THREE.Color(0xffffff), 1) : null,
      blending: THREE.NormalBlending, opacity: p.dk ? 0.9 : 0.75,
    }));
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false; pts.renderOrder = 3; pts.raycast = () => {};
    root.add(pts);
    const span = o.y1 - o.y0;
    if (!quiet) updaters.push((t) => {
      for (let i = 0; i < o.n; i++) {
        const y = o.y0 + (((base[i * 3 + 1] - o.y0) + t * o.rise * (0.6 + (ph[i] % 1) * 0.8)) % span + span) % span;
        pos[i * 3] = base[i * 3] + Math.sin(t * 0.5 + ph[i]) * o.sway;
        pos[i * 3 + 1] = y;
        pos[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.4 + ph[i] * 1.3) * o.sway;
      }
      (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    });
    return pts;
  };
  const labelTex = (text: string, c: THREE.Color) => canvasTex(256, 64, (ctx, w, h) => {
    ctx.font = '600 30px ui-monospace, Menlo, monospace'; ctx.fillStyle = css(c); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, w / 2, h / 2);
  });
  const mixc = (a: THREE.Color, b: THREE.Color, f: number) => mix(a, b, f);

  // ================================================================ per-theme backdrops
  const dk = p.dk;
  switch (id) {
    case 'canopy': {
      glowPlane(p.accent, 3.6, 0, cy + 0.1, -1.1, dk ? 0.5 : 0.35, dk);
      disc(1.05, mixc(p.bg, p.accent, dk ? 0.1 : 0.12), 0, cy, -1.0, 1, 64);
      ringMesh(1.05, 1.07, mixc(p.bg, p.accent, 0.4), 0, cy, -0.99, 0.7);
      floorGlow(p.accent, 1.5, dk ? 0.55 : 0.3, dk);
      floorDisc(0.9, mixc(p.bg, p.accent, dk ? 0.14 : 0.16), 0.9);
      motes({ n: 36, c: dk ? mixc(p.accent, hex('#ffffff'), 0.3) : p.accent, size: 0.06, soft: true, rise: 0.05, sway: 0.12, y0: 0.1, y1: 2.5, rx: 1.3, z0: -1, z1: 0.8, seed: 7 });
      break;
    }
    case 'paper': {
      disc(1.12, mixc(p.bg, p.text, dk ? 0.1 : 0.06), 0.02, cy, -1.0);
      const rt = canvasTex(512, 512, (ctx, w, h) => {
        const rnd = rngOf(11);
        ctx.strokeStyle = css(p.accent); ctx.lineCap = 'round'; ctx.lineWidth = 7;
        for (let k = 0; k < 2; k++) {
          ctx.beginPath();
          for (let i = 0; i <= 80; i++) {
            const a = (i / 80) * Math.PI * 2.08 + k * 0.4;
            const r = w * 0.43 + (rnd() - 0.5) * 7 + Math.sin(a * 3 + k) * 4;
            const x = w / 2 + Math.cos(a) * r, y = h / 2 + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke(); ctx.lineWidth = 3.5;
        }
      });
      put(new THREE.PlaneGeometry(2.5, 2.5), basic(0xffffff, { map: rt, transparent: true }), 0.02, cy, -0.98);
      const fr = put(new THREE.PlaneGeometry(2.4, 2.4), basic(0xffffff, { map: rt, transparent: true, opacity: 0.9 }), 0, 0.003, 0, -4);
      fr.rotation.x = -Math.PI / 2;
      floorGlow(hex('#000000'), 0.9, dk ? 0.45 : 0.2, false);
      break;
    }
    case 'grimoire': {
      glowPlane(hex(dk ? '#ff9a3c' : '#e0a050'), 4.0, 0, cy + 0.1, -1.0, dk ? 0.55 : 0.4, dk);
      const stone = mixc(p.bg, hex('#8a7a60'), dk ? 0.35 : 0.3);
      const slab = put(new THREE.CylinderGeometry(1.3, 1.36, 0.08, 40), mat(new THREE.MeshToonMaterial({ color: stone, gradientMap: undefined })), 0, -0.05, 0, -4);
      slab.renderOrder = 0;
      const top = put(new THREE.CylinderGeometry(1.05, 1.05, 0.02, 40), mat(new THREE.MeshToonMaterial({ color: mixc(stone, hex('#000000'), 0.25) })), 0, -0.005, 0, 0);
      top.renderOrder = 0;
      const gold = dk ? hex('#e0b455') : hex('#9a6a1a');
      const rune = canvasTex(512, 512, (ctx, w, h) => {
        const rnd = rngOf(5);
        ctx.strokeStyle = css(gold); ctx.lineCap = 'round'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.455, 0, 7); ctx.stroke();
        ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.345, 0, 7); ctx.stroke();
        ctx.lineWidth = 4;
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2, rc = w * 0.4, x = w / 2 + Math.cos(a) * rc, y = h / 2 + Math.sin(a) * rc;
          ctx.save(); ctx.translate(x, y); ctx.rotate(a + Math.PI / 2); ctx.beginPath();
          const k = 2 + Math.floor(rnd() * 3);
          for (let j = 0; j < k; j++) { const px = (rnd() - 0.5) * 20, py = (rnd() - 0.5) * 30; if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
          ctx.moveTo(0, -17); ctx.lineTo(0, 17); ctx.stroke(); ctx.restore();
        }
        ctx.lineWidth = 3; ctx.beginPath();
        for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 - Math.PI / 2; const x = w / 2 + Math.cos(a) * w * 0.3, y = h / 2 + Math.sin(a) * w * 0.3; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.closePath(); ctx.stroke();
      });
      const rp = put(new THREE.PlaneGeometry(2.1, 2.1), basic(0xffffff, { map: rune, transparent: true, blending: THREE.NormalBlending }), 0, 0.012, 0, 1);
      rp.rotation.x = -Math.PI / 2;
      if (!quiet) updaters.push((t) => { rp.rotation.z = t * 0.05; });
      floorGlow(hex('#ffa040'), 1.3, dk ? 0.5 : 0.25, dk, 0.016);
      motes({ n: 20, c: hex(dk ? '#ffb347' : '#d98a1f'), size: 0.04, soft: true, rise: 0.12, sway: 0.1, y0: 0.0, y1: 2.4, rx: 1.0, z0: -0.8, z1: 0.8, seed: 3 });
      break;
    }
    case 'pop': {
      const ink = dk ? hex('#05061a') : hex('#111111');
      const burst = (c: THREE.Color, ox: number, oy: number, z: number, s = 1) => {
        const m = put(new THREE.ShapeGeometry(starShape(1.28 * s, 0.98 * s, 14)), basic(c), ox, cy + oy, z); return m;
      };
      burst(ink, 0.07, -0.07, -1.02);
      burst(dk ? p.accent2 : hex('#ffffff'), 0, 0, -1.0);
      disc(0.72, dk ? p.accent : p.accent, 0, cy, -0.98);
      disc(0.72 - 0.05, dk ? p.accent : p.accent, 0, cy, -0.97);
      ringMesh(0.72, 0.77, ink, 0, cy, -0.975);
      const dot = (x: number, y: number, r: number, c: THREE.Color) => { disc(r + 0.04, ink, x + 0.03, y - 0.03, -0.93, 1, 24); disc(r, c, x, y, -0.92, 1, 24); };
      dot(-1.0, cy + 1.0, 0.13, p.accent2); dot(1.05, cy + 0.75, 0.1, dk ? p.disc : p.accent); dot(0.95, cy - 0.8, 0.14, dk ? p.accent2 : p.accent2); dot(-0.95, cy - 0.7, 0.09, dk ? p.mind : p.disc);
      floorDisc(1.0, ink, 1, 0.002, 48, 1, 0.8).position.set(0.06, 0.001, 0.05);
      floorDisc(0.95, dk ? p.accent2 : p.accent2, 1, 0.003, 48, 1, 0.8);
      floorDisc(0.7, dk ? p.accent : hex('#ffffff'), 1, 0.004, 48, 1, 0.8);
      break;
    }
    case 'arcade': {
      const sun = canvasTex(48, 48, (ctx, w, h) => {
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const dx = x - w / 2 + 0.5, dy = y - h / 2 + 0.5;
          if (dx * dx + dy * dy < (w / 2 - 1) ** 2) {
            if (y > h * 0.5 && y % 5 < 2 + Math.floor((y - h * 0.5) / 6)) continue;
            ctx.fillStyle = css(mixc(p.bg, p.accent2, dk ? 0.35 : 0.3 + (y / h) * 0.05)); ctx.fillRect(x, y, 1, 1);
          }
        }
      }, true);
      put(new THREE.PlaneGeometry(2.3, 2.3), basic(0xffffff, { map: sun, transparent: true }), 0, cy + 0.1, -1.1);
      const chk = canvasTex(8, 8, (ctx) => {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { ctx.fillStyle = css(mixc(p.bg, p.accent, (x + y) % 2 ? (dk ? 0.28 : 0.3) : (dk ? 0.08 : 0.1))); ctx.fillRect(x, y, 1, 1); }
      }, true);
      const fl = put(new THREE.CircleGeometry(1.6, 8), basic(0xffffff, { map: chk }), 0, 0.002, 0, -4);
      fl.rotation.set(-Math.PI / 2, 0, Math.PI / 8);
      motes({ n: 26, c: dk ? p.accent2 : p.accent, size: 0.07, soft: false, rise: 0.03, sway: 0.0, y0: 0.2, y1: 2.8, rx: 1.4, z0: -1.4, z1: -0.9, seed: 21 });
      if (!quiet) updaters.push((t) => { sun.offset.y = 0; fl.rotation.z = Math.PI / 8; void t; });
      break;
    }
    case 'sumi': {
      const ink = dk ? hex('#ece6d8') : hex('#1c1b19');
      const a0 = -0.55, a1 = Math.PI * 2 - 0.9, n = 120, R = 1.08;
      const rnd = rngOf(9);
      const pos: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n, a = a0 + t * (a1 - a0) * 1;
        const w = 0.05 + 0.08 * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.9 + 0.2) * (1 - t * 0.55) + (rnd() - 0.5) * 0.012;
        const r = R + Math.sin(a * 2) * 0.02;
        pos.push(Math.cos(a) * (r - w), Math.sin(a) * (r - w), 0, Math.cos(a) * (r + w), Math.sin(a) * (r + w), 0);
        if (i < n) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
      }
      const g = geo(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
      put(g, basic(ink, { transparent: true, opacity: dk ? 0.78 : 0.86, side: THREE.DoubleSide }), 0, cy + 0.02, -1.0);
      disc(1.0, mixc(p.bg, ink, dk ? 0.07 : 0.045), 0, cy + 0.02, -1.05);
      put(new THREE.PlaneGeometry(0.16, 0.16), basic(p.accent), -0.92, cy + 1.0, -0.95).rotation.z = 0.06;
      floorGlow(ink, 1.1, dk ? 0.2 : 0.3, false);
      break;
    }
    case 'bauhaus': {
      const ink = dk ? hex('#efe7d4') : hex('#141414');
      disc(0.78, p.accent, -0.3, cy + 0.45, -1.0);
      put(new THREE.PlaneGeometry(1.25, 1.25), basic(p.accent2), 0.55, cy - 0.15, -1.02);
      const tri = new THREE.Shape(); tri.moveTo(-0.7, -0.6); tri.lineTo(0.7, -0.6); tri.lineTo(-0.7, 0.8); tri.closePath();
      put(new THREE.ShapeGeometry(tri), basic(dk ? p.mind : p.skill), -0.55, cy - 0.45, -1.04);
      put(new THREE.PlaneGeometry(0.07, 2.6), basic(ink), 0.9, cy + 0.1, -0.98);
      put(new THREE.PlaneGeometry(2.3, 0.07), basic(ink), 0, cy + 1.2, -0.98);
      const fd = floorDisc(0.85, ink, 1, 0.002, 48, 1, 1); void fd;
      floorDisc(0.76, p.accent, 1, 0.003, 48, 1, 1);
      break;
    }
    case 'riso': {
      const d = 0.62, r = 0.82, a = Math.acos(d / (2 * r)), N = 40;
      const pink = p.accent, blue = p.accent2;
      disc(r, pink, -d / 2, cy + 0.15, -1.0);
      disc(r, blue, d / 2, cy + 0.15, -1.0 + 0.001);
      const lens = new THREE.Shape();
      for (let i = 0; i <= N; i++) { const th = -a + (i / N) * 2 * a; const x = -d / 2 + r * Math.cos(th), y = r * Math.sin(th); if (i === 0) lens.moveTo(x, y); else lens.lineTo(x, y); }
      for (let i = 0; i <= N; i++) { const th = Math.PI - a + (i / N) * 2 * a; lens.lineTo(d / 2 + r * Math.cos(th), r * Math.sin(th)); }
      put(new THREE.ShapeGeometry(lens), basic(mixc(mixc(pink, blue, 0.5), hex('#1a1040'), dk ? 0.35 : 0.45)), 0, cy + 0.15, -0.99);
      const ht = canvasTex(256, 256, (ctx, w, h) => {
        ctx.fillStyle = css(blue);
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const cx = x * 16 + (y % 2 ? 8 : 0), cyy = y * 16 + 8;
          const dist = Math.hypot(cx - w / 2, cyy - h / 2) / (w / 2);
          const rr = Math.max(0, 7.2 * (1 - Math.min(1, dist) * 0.85) * (dist < 1 ? 1 : 0));
          ctx.beginPath(); ctx.arc(cx, cyy, rr, 0, 7); ctx.fill();
        }
      });
      const hf = put(new THREE.PlaneGeometry(2.6, 2.6), basic(0xffffff, { map: ht, transparent: true, opacity: 0.95 }), 0, 0.003, 0, -4);
      hf.rotation.x = -Math.PI / 2;
      break;
    }
    case 'blueprint': {
      const line = dk ? hex('#cfeaff') : p.text;
      const faint = lineMat(line, dk ? 0.16 : 0.2), mid = lineMat(line, dk ? 0.55 : 0.6), strong = lineMat(line, 0.95);
      const gx: number[] = [], gz: number[] = [], gv: number[] = [];
      for (let i = -8; i <= 8; i++) { gx.push(i * 0.25, 0, -2, i * 0.25, 0, 2); gz.push(-2, 0, i * 0.25, 2, 0, i * 0.25); }
      segs([...gx, ...gz], faint);
      for (let i = -8; i <= 8; i++) { gv.push(i * 0.25, -0.0, -1.3, i * 0.25, 2.8, -1.3); }
      for (let j = 0; j <= 11; j++) { gv.push(-2, j * 0.25, -1.3, 2, j * 0.25, -1.3); }
      segs(gv, faint);
      // dimension lines
      const dx = -0.95, h = H, tk = 0.07;
      segs([dx, 0, 0, dx, h, 0, dx - tk, 0, 0, dx + tk, 0, 0, dx - tk, h, 0, dx + tk, h, 0, dx - 0.03, 0.08, 0, dx, 0, 0, dx + 0.03, 0.08, 0, dx, 0, 0, dx - 0.03, h - 0.08, 0, dx, h, 0, dx + 0.03, h - 0.08, 0, dx, h, 0], mid, 2);
      segs([-0.2, 0, 0, dx + tk, 0, 0, -0.2, h, 0, dx + tk, h, 0].map((v, i) => (i % 3 === 0 && v === -0.2 ? -0.45 : v)), faint, 2);
      const lbl = put(new THREE.PlaneGeometry(0.8, 0.2), basic(0xffffff, { map: labelTex(`H ${H.toFixed(2)}`, line), transparent: true }), dx - 0.2, h * 0.5, 0, 2);
      lbl.rotation.z = Math.PI / 2;
      const wz = 0.85;
      segs([-0.6, 0.001, wz, 0.6, 0.001, wz, -0.6, 0.001, wz - 0.06, -0.6, 0.001, wz + 0.06, 0.6, 0.001, wz - 0.06, 0.6, 0.001, wz + 0.06], mid, 2);
      const l2 = put(new THREE.PlaneGeometry(0.8, 0.2), basic(0xffffff, { map: labelTex('Ø 1.20', line), transparent: true }), 0, 0.002, wz + 0.17, 2);
      l2.rotation.x = -Math.PI / 2;
      // centreline + circles
      const cl = segs([0, -0.1, -0.5, 0, h + 0.35, -0.5], mat(new THREE.LineDashedMaterial({ color: line, dashSize: 0.12, gapSize: 0.06, transparent: true, opacity: 0.6, toneMapped: false })), 2);
      cl.computeLineDistances();
      const circ = (r: number, m: THREE.Material, y: number, z: number, vertical: boolean) => {
        const pts: number[] = [];
        for (let i = 0; i < 96; i++) { const a = (i / 96) * Math.PI * 2, b = ((i + 1) / 96) * Math.PI * 2; pts.push(Math.cos(a) * r, vertical ? Math.sin(a) * r + y : y, vertical ? z : Math.sin(a) * r, Math.cos(b) * r, vertical ? Math.sin(b) * r + y : y, vertical ? z : Math.sin(b) * r); }
        return segs(pts, m, 2);
      };
      circ(0.6, mid, 0.001, 0, false); circ(0.9, strong, 0.001, 0, false);
      circ(1.1, mid, cy, -1.25, true); circ(1.18, faint, cy, -1.25, true);
      segs([-1.3, cy, -1.25, 1.3, cy, -1.25, 0, cy - 1.3, -1.25, 0, cy + 1.3, -1.25], mid, 2);
      floorDisc(0.9, mixc(p.bg, line, 0.06), 1, 0.001, 64);
      break;
    }
    case 'swiss': {
      const ink = dk ? hex('#ffffff') : hex('#0d0d0d');
      disc(0.9, p.accent, 0.35, cy + 0.35, -1.0);
      put(new THREE.PlaneGeometry(0.12, 2.9), basic(ink), -0.78, cy + 0.15, -0.99);
      put(new THREE.PlaneGeometry(1.5, 0.05), basic(ink), 0.1, cy - 0.78, -0.98);
      put(new THREE.PlaneGeometry(0.38, 0.38), basic(mixc(p.bg, ink, 0.12)), 0.95, cy - 0.35, -1.02);
      put(new THREE.PlaneGeometry(1.9, 0.04), basic(ink), 0, 0.001, 0, -4).rotation.x = -Math.PI / 2;
      floorDisc(0.8, mixc(p.bg, ink, dk ? 0.14 : 0.1), 1, 0.002, 48, 1, 0.55).position.z = 0;
      break;
    }
    case 'collage': {
      const paperC = dk ? hex('#e8dcc0') : hex('#f4ead0');
      put(new THREE.ShapeGeometry(tornShape(1.2, 44, 0.04, 4)), basic(mixc(p.accent2, hex('#000000'), 0.1)), 0.06, cy + 0.02, -1.04).rotation.z = 0.3;
      put(new THREE.ShapeGeometry(tornShape(1.06, 40, 0.035, 8)), basic(paperC), -0.02, cy, -1.0).rotation.z = 1.2;
      put(new THREE.ShapeGeometry(tornShape(0.86, 36, 0.05, 15)), basic(p.accent), 0.0, cy - 0.04, -0.98).rotation.z = 0.5;
      const tape = put(new THREE.PlaneGeometry(0.62, 0.17), basic(hex(dk ? '#ffd84a' : '#f2d36b'), { transparent: true, opacity: 0.85 }), -0.82, cy + 0.82, -0.9);
      tape.rotation.z = 0.7;
      const tape2 = put(new THREE.PlaneGeometry(0.5, 0.15), basic(hex('#f4ead0'), { transparent: true, opacity: 0.85 }), 0.9, cy - 0.72, -0.9);
      tape2.rotation.z = 0.6;
      put(new THREE.ShapeGeometry(tornShape(0.95, 34, 0.06, 23)), basic(hex(dk ? '#e8b43a' : '#e8b43a')), 0.03, 0.002, 0.0, -4).rotation.set(-Math.PI / 2, 0, 0.2);
      (root.children[root.children.length - 1] as THREE.Mesh).scale.set(1, 0.7, 1);
      break;
    }
    case 'rings': {
      const track = mixc(p.bg, p.text, dk ? 0.12 : 0.1);
      const cols = [p.body, p.mind, p.skill];
      const radii = [1.12, 0.9, 0.68];
      const lens = [5.2, 4.2, 3.4];
      radii.forEach((r, i) => {
        ringMesh(r - 0.08, r + 0.08, track, 0, cy, -1.0);
        ringMesh(r - 0.08, r + 0.08, cols[i], 0, cy, -0.99, 1, Math.PI / 2 - lens[i], lens[i]);
        const cap = (ang: number) => disc(0.08, cols[i], Math.cos(ang) * r, cy + Math.sin(ang) * r, -0.985, 1, 20);
        cap(Math.PI / 2); cap(Math.PI / 2 - lens[i]);
      });
      [0.95, 0.72].forEach((r, i) => ringMesh(r - 0.035, r + 0.035, i ? p.disc : p.accent2, 0, 0.003, 0, dk ? 0.9 : 0.85, 0, Math.PI * 2, 96).rotation.set(-Math.PI / 2, 0, 0));
      floorDisc(0.7, mixc(p.bg, p.text, dk ? 0.07 : 0.05), 1, 0.002);
      floorGlow(p.accent2, 1.3, dk ? 0.35 : 0.15, dk);
      break;
    }
    case 'cyberpunk': {
      const mag = hex(dk ? '#ff2bd6' : '#d1219f'), cy2 = hex(dk ? '#00f0ff' : '#00788a');
      // neon grid floor, fading with distance
      const pts: number[] = [], cols: number[] = [];
      const fade = (x: number, z: number, c: THREE.Color) => { const f = Math.max(0, 1 - Math.hypot(x, z + 0.3) / 3.6); cols.push(c.r * f, c.g * f, c.b * f); };
      for (let i = -9; i <= 9; i++) {
        const x = i * 0.4;
        pts.push(x, 0.001, -3, x, 0.001, 2.4); fade(x, -3, mag); fade(x, 2.4, mag);
      }
      for (let k = 0; k <= 13; k++) { const z = -3 + k * 0.42; pts.push(-3.6, 0.001, z, 3.6, 0.001, z); fade(-3.6, z, cy2); fade(3.6, z, cy2); }
      const gg = geo(new THREE.BufferGeometry());
      gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      gg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      const gm = mat(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.NormalBlending, toneMapped: false, depthWrite: false, opacity: dk ? 1 : 0.85 }));
      const gl = new THREE.LineSegments(gg, gm); gl.renderOrder = -4; root.add(gl);
      floorDisc(1.0, mixc(p.bg, cy2, dk ? 0.12 : 0.08), 1, 0.0015, 64);
      ringMesh(0.92, 0.96, cy2, 0, 0.004, 0, 1).rotation.x = -Math.PI / 2;
      ringMesh(0.6, 0.62, mag, 0, 0.004, 0, 0.9).rotation.x = -Math.PI / 2;
      // neon sign bars
      const bar = (x: number, y0: number, hgt: number, w: number, c: THREE.Color, z: number) => {
        glowPlane(c, hgt * 0.9, x, y0 + hgt / 2, z - 0.01, dk ? 0.5 : 0.25, dk).scale.set(w * 6 / hgt, 1, 1);
        const b = put(new THREE.PlaneGeometry(w, hgt), basic(dk ? mixc(c, hex('#ffffff'), 0.25) : c), x, y0 + hgt / 2, z);
        return b;
      };
      const yel = dk ? p.accent : hex('#c9a800');
      const sign = bar(0.55, 0.0, 2.7, 0.09, yel, -1.1);
      bar(-0.75, 0.5, 1.6, 0.05, cy2, -1.15);
      bar(1.1, 1.5, 0.9, 0.04, mag, -1.2);
      const top = put(new THREE.PlaneGeometry(0.6, 0.07), basic(dk ? mixc(yel, hex('#ffffff'), 0.25) : yel), 0.82, 2.6, -1.1);
      void top;
      if (!quiet) updaters.push((t) => {
        const f = 0.85 + 0.15 * Math.sin(t * 40) * Math.sin(t * 2.3) * (Math.sin(t * 0.7) > 0.93 ? 1.6 : 0.2);
        (sign.material as THREE.MeshBasicMaterial).opacity = 1; sign.scale.y = 1; gm.opacity = (dk ? 0.9 : 0.85) * (0.9 + 0.1 * f);
      });
      break;
    }
  }

  // reduced motion: strip animators
  const ups = quiet ? [] : updaters;
  const cam = CAMERA[id] ?? CAMERA.canopy;

  return {
    camera: { ...cam },
    update(t: number) { if (quiet) return; for (const u of ups) u(t); },
    dispose() {
      for (const o of objs) scene.remove(o);
      geos.forEach((g) => g.dispose());
      dmats.forEach((m) => m.dispose());
      texs.forEach((t) => t.dispose());
      objs.length = 0; geos.length = 0; dmats.length = 0; texs.length = 0; updaters.length = 0;
      if (bgSet) scene.background = prevBg;
    },
  };
};

export type { AvatarRig };

// ---------------------------------------------------------------- shared helpers for setting.ts / companion.ts
export const fxReducedMotion = reducedMotion;
export function fxMix(a: THREE.Color, b: THREE.Color, f: number): THREE.Color { return mix(a, b, f); }
export function fxIsDark(bgHex: number): boolean { return lum(new THREE.Color(bgHex)) < 0.5; }
/** soft radial glow texture (white-ish centre fading to transparent) */
export function fxGlowTexture(c: THREE.Color, inner = 1): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d')!;
  const rgb = c.getRGB({ r: 0, g: 0, b: 0 } as THREE.RGB, SRGB);
  const col = (a: number) => `rgba(${Math.round(rgb.r * 255)},${Math.round(rgb.g * 255)},${Math.round(rgb.b * 255)},${a})`;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, col(inner)); g.addColorStop(0.45, col(inner * 0.35)); g.addColorStop(1, col(0));
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = SRGB;
  return t;
}
