/* THE CONTRACT for the 3D character. Four modules are written against this file in parallel:
     body.ts   (buildBody)   the human figure, proportions driven by the Body stat
     gear.ts   (applyGear)   outfit tiers, stat props, streak glow
     looks.ts  (makeMaterials, applyLook)  per-theme materials, lighting, backdrop
     Avatar3D.tsx            the React component: renderer, camera, drag-to-rotate, level-up moment, fallback
   Do not change this file without telling the integrator. World units: 1 unit = 1 metre-ish, figure ~1.8 tall, feet on y = 0, facing +z. */
import type * as THREE from 'three';

export type Band = 1 | 2 | 3 | 4 | 5; // Seedling, Sapling, Rooted, Branching, Canopy (see lib/titles.ts)

export interface AvatarState {
  level: number;          // overall level, 1..
  band: Band;
  stats: { body: number; mind: number; skill: number; discipline: number }; // each stat's level, 1..
  streak: number;         // consecutive days with at least one habit logged
  /** XP progress to the next overall level, 0..1 (may be used for a subtle glow) */
  pct: number;
}

/** Everything is built from these. One instance per renderer; all colours come from the current theme. */
export interface Materials {
  skin: THREE.Material;
  hair: THREE.Material;
  cloth: THREE.Material;      // main outfit colour
  cloth2: THREE.Material;     // secondary outfit colour (trim, undershirt)
  accent: THREE.Material;     // the theme accent: gem, piping, cape lining
  metal: THREE.Material;      // armour, buckles
  dark: THREE.Material;       // boots, belts, eyes
  glow: THREE.Material;       // emissive: auras, halo, runes, particles (additive-friendly)
  /** statColors for Body / Mind / Skill / Discipline, as hex numbers, taken from --body --mind --skill --discipline */
  stat: { body: number; mind: number; skill: number; discipline: number };
  /** theme tokens as hex numbers */
  accentHex: number; accent2Hex: number; bgHex: number; textHex: number;
  /** true when the theme wants a drawn outline around meshes (toon / paper / ink styles) */
  outline: boolean;
  /** Re-style a material that came from a loaded model (a MeshStandardMaterial with maps from a glTF) in this theme's rendering style,
      keeping its textures: toon / lambert / flat / tinted per theme. `role` says what it is so the theme can recolour it sensibly. */
  convert(src: THREE.Material, role: 'skin' | 'cloth' | 'hair' | 'metal' | 'eye' | 'other'): THREE.Material;
  /** make an outline for a mesh (inverted hull). No-op when outline is false. Returns the outline mesh or null. */
  addOutline(mesh: THREE.Mesh, thickness?: number): THREE.Mesh | null;
  dispose(): void;
}

/** Measurements of the built body so clothes and gear can fit it. All in world units. */
export interface Dims {
  height: number;
  shoulderW: number;     // distance between the shoulder joints
  chestW: number;        // chest width
  chestD: number;        // chest depth (front to back)
  waistW: number;
  hipW: number;
  armLen: number;        // shoulder joint to wrist
  armR: number;          // upper-arm radius
  legLen: number;        // hip joint to ankle
  legR: number;          // thigh radius
  headR: number;
  neckY: number;         // y of the neck joint
  chestY: number;        // y of chest centre
  waistY: number;
  hipY: number;
}

/** Attachment points. Gear adds children to these; they follow the pose. All are THREE.Object3D (Groups). */
export interface Slots {
  head: THREE.Object3D;       // centre of the head
  headTop: THREE.Object3D;    // just above the head (halo, crown)
  neck: THREE.Object3D;
  chest: THREE.Object3D;      // centre of the torso front area
  back: THREE.Object3D;       // behind the shoulders, for capes / packs
  waist: THREE.Object3D;
  shoulderL: THREE.Object3D;  // at the shoulder joint, rotates with the upper arm
  shoulderR: THREE.Object3D;
  upperArmL: THREE.Object3D;  // centre of the upper arm, rotates with it
  upperArmR: THREE.Object3D;
  forearmL: THREE.Object3D;
  forearmR: THREE.Object3D;
  handL: THREE.Object3D;      // palm; gear can hold props here
  handR: THREE.Object3D;
  thighL: THREE.Object3D;
  thighR: THREE.Object3D;
  shinL: THREE.Object3D;
  shinR: THREE.Object3D;
  footL: THREE.Object3D;
  footR: THREE.Object3D;
  floor: THREE.Object3D;      // at y = 0 under the figure, for plinths, rings, flames
}

/* v2 NOTE for model-based bodies: slot Objects are Groups attached under the model's bones (so they follow the animated pose).
   A slot must have identity scale in WORLD terms (counter-scale if a bone is scaled) so gear sized in metres stays correct.
   Convention unchanged: the figure faces +z, L is at +x and R at -x, units are metres, feet on y = 0. */

export interface AvatarRig {
  root: THREE.Group;          // add this to the scene
  dims: Dims;
  slots: Slots;
  /** advance the idle pose (subtle breathing / weight shift). t in seconds. Must be a no-op when reduced motion is set. */
  update(t: number): void;
  dispose(): void;
  /** model bodies only (optional, additive): the skeleton's bones by name (pelvis, spine_01..03, neck_01, Head, clavicle_l, upperarm_l, lowerarm_l, hand_l, thigh_l, calf_l, foot_l, ball_l and the _r twins, finger bones) */
  bones?: Record<string, THREE.Bone>;
}

/** A piece of animated gear / effects. */
export interface GearHandle {
  update(t: number): void;
  dispose(): void;
}

/** The look of one theme, applied to the scene (lights, backdrop, floor, fog) and the renderer. */
export interface LookHandle {
  /** extra per-frame work (moving lights, backdrop shimmer) */
  update(t: number): void;
  /** camera framing the theme prefers */
  camera: { fov: number; distance: number; height: number; lookAtY: number };
  dispose(): void;
}

export type BuildBody = (state: AvatarState, mats: Materials) => AvatarRig;
/** v2: the real human model is loaded from glb files, so building the body is asynchronous. Falls back to the procedural body if loading fails. */
export type LoadBody = (state: AvatarState, mats: Materials) => Promise<AvatarRig>;
/** Ground / set dressing that grows with the band (bare ground, campfire, stone circle, tree, throne...). */
export type BuildSetting = (state: AvatarState, mats: Materials, rig: AvatarRig) => GearHandle;
/** A small companion that appears from band 3 and gets fancier (lantern wisp, bird...). */
export type BuildCompanion = (state: AvatarState, mats: Materials, rig: AvatarRig) => GearHandle;
export type ApplyGear = (rig: AvatarRig, state: AvatarState, mats: Materials) => GearHandle;
export type MakeMaterials = (skinId: string, mode: 'dark' | 'light') => Materials;
export type ApplyLook = (ctx: { scene: THREE.Scene; renderer: THREE.WebGLRenderer; skinId: string; mode: 'dark' | 'light'; mats: Materials; rig: AvatarRig }) => LookHandle;
