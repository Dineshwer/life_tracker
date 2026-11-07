/* MODEL BODY (v2): a real human figure from the Quaternius CC0 packs (see public/avatar/CREDITS.txt).
   Parts are separate .glb files sharing one humanoid skeleton; they are loaded per band, cached at module level, and every
   SkinnedMesh is re-bound to ONE skeleton (by bone name). There are no animation clips: the T-pose is rotated into a per-band
   pose with bone quaternions, the Body stat reshapes the build through bone scales, and update(t) adds a tiny idle.
   Convention: faces +z, left is +x (bone *_l), units metres, feet on y = 0.
   Pose maths: every bone gets a rotation DELTA expressed in the axes of the T-pose (x = across, y = up, z = forward),
   applied after its parent's delta (world rotation = product of the deltas along the chain * rest rotation). */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildBody } from './bodyProcedural';
import type { AvatarRig, AvatarState, Band, Dims, LoadBody, Materials, Slots } from './types';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const DEG = Math.PI / 180;

// ---------------------------------------------------------------- assets
type Role = 'skin' | 'cloth' | 'hair' | 'metal' | 'eye' | 'other';
const BASE_URL: string = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
const url = (f: string) => `${BASE_URL}avatar/${f}`.replace(/\/{2,}/g, '/');

interface PartSpec { file: string; meshes: string[] }
const HEAD: PartSpec = { file: 'head.glb', meshes: ['HeadSkin', 'Eyes', 'Eyebrows'] };
const HAIR: PartSpec = { file: 'hair.glb', meshes: ['Hair_SimpleParted'] };
const PEASANT_PLAIN: PartSpec = { file: 'peasant.glb', meshes: ['Male_Peasant_Body', 'Male_Peasant_Arms', 'Male_Peasant_Arms_Hands', 'Male_Peasant_Legs', 'Feet_Bare'] };
const PEASANT_FULL: PartSpec = { file: 'peasant.glb', meshes: ['Male_Peasant_Body', 'Male_Peasant_Arms', 'Male_Peasant_Arms_Hands', 'Male_Peasant_Legs', 'Male_Peasant_Feet'] };
const RANGER: PartSpec = { file: 'ranger.glb', meshes: ['Male_Ranger_Body', 'Male_Ranger_Body_Belt_1', 'Male_Ranger_Arms', 'Male_Ranger_Arms_Hands', 'Male_Ranger_Legs', 'Male_Ranger_Feet_Boots'] };
const RANGER_PAULDRON: PartSpec = { file: 'ranger.glb', meshes: [...RANGER.meshes, 'Male_Ranger_Acc_Pauldron'] };

const PARTS_BY_BAND: Record<Band, PartSpec[]> = {
  1: [HEAD, HAIR, PEASANT_PLAIN],
  2: [HEAD, HAIR, PEASANT_FULL],
  3: [HEAD, HAIR, RANGER],
  4: [HEAD, HAIR, RANGER_PAULDRON],
  5: [HEAD, HAIR, RANGER_PAULDRON],
};

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();
const loadFile = (file: string): Promise<THREE.Group> => {
  let p = cache.get(file);
  if (!p) {
    p = loader.loadAsync(url(file)).then((g) => g.scene);
    p.catch(() => cache.delete(file));
    cache.set(file, p);
  }
  return p;
};

/** download everything the top band needs (and so every lower band) so later rebuilds are instant */
export const preloadAvatar = async (): Promise<void> => {
  await Promise.all(['head.glb', 'hair.glb', 'peasant.glb', 'ranger.glb'].map(loadFile));
};

const roleOf = (m: THREE.Material, meshName: string): Role => {
  const n = m.name || '';
  if (/hair/i.test(n)) return 'hair';
  if (/eye/i.test(n)) return 'eye';
  if (/superhero|regular_male|skin/i.test(n)) return 'skin';
  if (/pauldron/i.test(meshName)) return 'metal';
  if (/peasant|ranger/i.test(n)) return 'cloth';
  return 'other';
};

// ---------------------------------------------------------------- pose
interface Pose {
  slouch: number;      // spine pitch forward, degrees, split over the three spine bones
  chest: number;       // extra upper chest pitch (negative = chest out)
  neck: number;        // neck pitch
  head: number;        // head pitch (negative = chin up)
  headTilt: number;    // head roll
  headYaw: number;
  shoulderFwd: number; // clavicle rotation forward (rounded shoulders)
  shoulderUp: number;  // clavicle lift (positive = shrug up)
  armDrop: [number, number]; // [L, R] upper arm angle below horizontal, 90 = hanging straight
  armFwd: [number, number];  // upper arm swing forward (+) / back (-)
  elbow: [number, number];   // forearm flexion
  twist: [number, number];   // upper arm roll
  curl: number;        // finger curl
  stance: number;      // leg abduction, degrees, per leg
  toeOut: number;
  kneeFree: number;    // free leg (R) knee bend
  hipRoll: number;     // pelvis roll (weight shift)
  hipYaw: number;
}

export const AVATAR_POSES: Record<Band, Pose> = {
  1: { slouch: 22, chest: 4, neck: 8, head: 4, headTilt: 3, headYaw: 4, shoulderFwd: 9, shoulderUp: -3, armDrop: [80, 82], armFwd: [6, 4], elbow: [12, 16], twist: [0, 0], curl: 26, stance: 3, toeOut: 6, kneeFree: 4, hipRoll: 1.5, hipYaw: 2 },
  2: { slouch: 8, chest: 0, neck: 2, head: -2, headTilt: 1.5, headYaw: 3, shoulderFwd: 4, shoulderUp: -1, armDrop: [79, 78], armFwd: [3, 4], elbow: [14, 12], twist: [0, 0], curl: 22, stance: 4, toeOut: 6, kneeFree: 5, hipRoll: 2, hipYaw: 3 },
  3: { slouch: 0, chest: -2, neck: -1, head: -3, headTilt: 0, headYaw: 0, shoulderFwd: 0, shoulderUp: 0, armDrop: [76, 76], armFwd: [2, 2], elbow: [10, 10], twist: [0, 0], curl: 20, stance: 5, toeOut: 7, kneeFree: 3, hipRoll: 1, hipYaw: 0 },
  4: { slouch: -3, chest: -5, neck: -2, head: -4, headTilt: -1.5, headYaw: 4, shoulderFwd: -2, shoulderUp: 1, armDrop: [70, 42], armFwd: [4, -3], elbow: [14, 100], twist: [0, 70], curl: 24, stance: 9, toeOut: 9, kneeFree: 5, hipRoll: 2, hipYaw: 2 },
  5: { slouch: -4, chest: -7, neck: -3, head: -8, headTilt: 0, headYaw: 0, shoulderFwd: -4, shoulderUp: 2, armDrop: [64, 64], armFwd: [3, 3], elbow: [20, 20], twist: [0, 0], curl: 34, stance: 11, toeOut: 10, kneeFree: 0, hipRoll: 0, hipYaw: 0 },
};

const BONES = [
  'root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head',
  'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
  'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r',
];
const FINGERS = ['index', 'middle', 'ring', 'pinky', 'thumb'];

const reducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- build
async function build(state: AvatarState, mats: Materials): Promise<AvatarRig> {
  const band = clamp(Math.round(state.band), 1, 5) as Band;
  const specs = PARTS_BY_BAND[band];
  const scenes = await Promise.all(specs.map((s) => loadFile(s.file)));
  const t = clamp((state.stats.body - 1) / 12, 0, 1);

  const root = new THREE.Group(); root.name = 'avatar-root';
  const model = new THREE.Group(); model.name = 'avatar-model'; root.add(model);

  // ----- skeleton from the head file (a SkeletonUtils clone, so rebuilds never share bone state)
  const skel = SkeletonUtils.clone(scenes[0]) as THREE.Group;
  model.add(skel);
  const byName: Record<string, THREE.Bone> = {};
  skel.traverse((o) => { if ((o as THREE.Bone).isBone) byName[o.name] = o as THREE.Bone; });
  for (const n of BONES) if (!byName[n]) throw new Error('missing bone ' + n);
  const B = (n: string) => byName[n];

  // ----- meshes
  const skinned: THREE.SkinnedMesh[] = [];
  const matMap = new Map<string, THREE.Material>();
  const styled = (src: THREE.Material, meshName: string) => {
    const role = roleOf(src, meshName);
    const key = src.uuid + role;
    let m = matMap.get(key);
    if (!m) { m = mats.convert(src, role); matMap.set(key, m); }
    return m;
  };
  const finishMesh = (m: THREE.SkinnedMesh) => {
    m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false;
    skinned.push(m);
    if (!/eye/i.test(m.name)) {
      try { mats.addOutline(m); } catch { /* outlines are optional */ }
    }
  };
  const keepHead = new Set(HEAD.meshes);
  const toRemove: THREE.Object3D[] = [];
  skel.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh) return;
    if (!keepHead.has(sm.name)) { toRemove.push(sm); return; }
    sm.material = styled(sm.material as THREE.Material, sm.name);
    finishMesh(sm);
  });
  toRemove.forEach((o) => o.removeFromParent());
  // other parts: new SkinnedMeshes sharing the cached geometry, bound to this skeleton by bone name
  for (let i = 1; i < specs.length; i++) {
    const want = new Set(specs[i].meshes);
    scenes[i].traverse((o) => {
      const src = o as THREE.SkinnedMesh;
      if (!src.isSkinnedMesh || !want.has(src.name)) return;
      const bones = src.skeleton.bones.map((b) => byName[b.name]);
      if (bones.some((b) => !b)) throw new Error('bone mismatch in ' + src.name + ': ' + src.skeleton.bones.filter((b) => !byName[b.name]).map((b) => b.name).join(','));
      const m = new THREE.SkinnedMesh(src.geometry, styled(src.material as THREE.Material, src.name));
      m.name = src.name;
      m.bind(new THREE.Skeleton(bones, src.skeleton.boneInverses.map((x) => x.clone())), src.bindMatrix);
      model.add(m);
      finishMesh(m);
    });
  }

  // ----- rest data
  model.updateMatrixWorld(true);
  const rest: Record<string, { q: THREE.Quaternion; wq: THREE.Quaternion; pos: THREE.Vector3; pwq: THREE.Quaternion }> = {};
  skel.traverse((b) => {
    if (!(b as THREE.Bone).isBone) return;
    const pwq = b.parent ? b.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    rest[b.name] = { q: b.quaternion.clone(), wq: b.getWorldQuaternion(new THREE.Quaternion()), pos: b.position.clone(), pwq };
  });

  const ax = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
  const dq = new THREE.Quaternion(), step = new THREE.Quaternion();
  /** apply a delta (list of [axis, degrees] steps, first step first) to a bone */
  const rot = (name: string, ...steps: ['x' | 'y' | 'z', number][]) => {
    const r = rest[name]; dq.identity();
    for (const [a, d] of steps) dq.premultiply(step.setFromAxisAngle(ax[a], d * DEG));
    const loc = dq.clone().premultiply(r.pwq.clone().invert()).multiply(r.pwq); // Qp^-1 * D * Qp
    B(name).quaternion.copy(loc.multiply(r.q));
  };

  // ----- pose
  const P = AVATAR_POSES[band];
  rot('pelvis', ['z', P.hipRoll], ['y', P.hipYaw]);
  rot('spine_01', ['x', P.slouch * 0.35], ['z', -P.hipRoll * 0.6], ['y', -P.hipYaw * 0.5]);
  rot('spine_02', ['x', P.slouch * 0.35], ['z', -P.hipRoll * 0.3], ['y', -P.hipYaw * 0.3]);
  rot('spine_03', ['x', P.slouch * 0.3 + P.chest], ['z', -P.hipRoll * 0.2], ['y', -P.hipYaw * 0.2]);
  rot('neck_01', ['x', P.neck]);
  rot('Head', ['x', P.head - P.slouch * 0.45], ['z', P.headTilt], ['y', P.headYaw]);
  for (const [side, s] of [['l', 1], ['r', -1]] as const) {
    const i = s === 1 ? 0 : 1;
    rot('clavicle_' + side, ['z', s * (P.shoulderUp * 2.5 - 3)], ['y', s * P.shoulderFwd]);
    rot('upperarm_' + side, ['x', P.twist[i]], ['z', -s * P.armDrop[i]], ['x', -P.armFwd[i]]); // roll about the arm's own axis first
    rot('lowerarm_' + side, ['y', -s * P.elbow[i]]);
    rot('hand_' + side, ['y', s * 4]);
    for (const f of FINGERS) {
      const amt = f === 'thumb' ? P.curl * 0.3 : P.curl;
      const k = f === 'pinky' ? 1.25 : f === 'index' ? 0.85 : 1;
      for (const j of ['01', '02', '03']) {
        const bn = `${f}_${j}_${side}`;
        if (rest[bn]) rot(bn, ['z', -s * amt * k * (j === '01' ? 0.7 : 1)]);
      }
    }
  }
  rot('thigh_l', ['y', P.toeOut * 0.5], ['z', P.stance]);
  rot('thigh_r', ['y', -P.toeOut * 0.5], ['x', -P.kneeFree * 0.8], ['z', -P.stance]);
  rot('calf_r', ['x', P.kneeFree * 1.6]);
  rot('foot_l', ['z', -P.stance]);
  rot('foot_r', ['x', P.kneeFree * 0.8], ['z', P.stance]);

  // ----- build (Body stat): bone scales. Scaled bones get a hand-made local matrix so that children are NOT scaled with them:
  //   local = T(t) * Sparent^-1 * R * Sself   (a child keeps its world rotation, and is carried outwards by the parent's scale)
  const scaleWorld = (name: string, sx: number, sy: number, sz: number) => {
    const R = new THREE.Matrix4().makeRotationFromQuaternion(rest[name].wq);
    return new THREE.Matrix4().copy(R).invert().multiply(new THREE.Matrix4().makeScale(sx, sy, sz)).multiply(R);
  };
  const S: Record<string, THREE.Matrix4> = {};
  S.spine_02 = scaleWorld('spine_02', 1 + 0.06 * t, 1, 1 + 0.05 * t);
  S.spine_03 = scaleWorld('spine_03', 1 + 0.1 * t, 1, 1 + 0.1 * t);
  for (const side of ['l', 'r']) {
    S['upperarm_' + side] = scaleWorld('upperarm_' + side, 1, 1 + 0.25 * t, 1 + 0.25 * t);
    S['lowerarm_' + side] = scaleWorld('lowerarm_' + side, 1, 1 + 0.2 * t, 1 + 0.2 * t);
    S['thigh_' + side] = scaleWorld('thigh_' + side, 1 + 0.12 * t, 1, 1 + 0.12 * t);
    S['calf_' + side] = scaleWorld('calf_' + side, 1 + 0.04 * t, 1, 1 + 0.04 * t);
  }
  const identity = new THREE.Matrix4();
  interface Mgr { bone: THREE.Bone; inv: THREE.Matrix4; self: THREE.Matrix4; push: number; pos: THREE.Vector3 }
  const mgr: Mgr[] = [];
  const mgrOf = new Map<THREE.Bone, Mgr>();
  const addManaged = (n: string) => {
    const b = B(n); b.matrixAutoUpdate = false;
    const p = b.parent && S[b.parent.name];
    const m: Mgr = { bone: b, inv: p ? new THREE.Matrix4().copy(p).invert() : identity, self: S[n] || identity, push: 1, pos: b.position.clone() };
    mgr.push(m); mgrOf.set(b, m);
  };
  for (const n of Object.keys(S)) addManaged(n);
  for (const n of ['neck_01', 'clavicle_l', 'clavicle_r', 'hand_l', 'hand_r', 'foot_l', 'foot_r']) addManaged(n);
  for (const side of ['l', 'r']) mgrOf.get(B('upperarm_' + side))!.push = 1 + 0.14 * t; // broader shoulders
  const rm = new THREE.Matrix4(), qm = new THREE.Matrix4();
  const compose = (m: Mgr) => {
    rm.makeRotationFromQuaternion(m.bone.quaternion);
    qm.copy(m.inv).multiply(rm).multiply(m.self);
    qm.setPosition(m.pos.x * m.push, m.pos.y * m.push, m.pos.z * m.push);
    m.bone.matrix.copy(qm); m.bone.matrixWorldNeedsUpdate = true;
  };
  for (const m of mgr) compose(m);

  // ----- settle on the floor
  model.updateMatrixWorld(true);
  skinned.forEach((m) => m.skeleton.update());
  const v3 = new THREE.Vector3();
  const vertsOf = (m: THREE.SkinnedMesh, fn: (p: THREE.Vector3, dom: string) => void) => {
    const g = m.geometry, n = g.attributes.position.count;
    const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, bones = m.skeleton.bones;
    for (let i = 0; i < n; i++) {
      let bi = 0, bw = -1;
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; bi = k; } }
      m.getVertexPosition(i, v3);
      fn(v3, bones[si.getComponent(i, bi)].name);
    }
  };
  let minY = Infinity;
  for (const m of skinned) if (/feet|boots|bare/i.test(m.name)) vertsOf(m, (p) => { if (p.y < minY) minY = p.y; });
  if (!isFinite(minY)) minY = 0;
  model.position.y = -minY;
  root.updateMatrixWorld(true);
  const lift = model.position.y;

  // ----- measurements
  const wpos = (n: string) => B(n).getWorldPosition(new THREE.Vector3());
  const trunk = skinned.filter((m) => /_Body$/.test(m.name));
  const lower = skinned.filter((m) => /_(Body|Legs)$/.test(m.name));
  const ARM = /^(upperarm|lowerarm|clavicle|hand)/;
  /** extent of the clothed trunk at height yC (the clothing meshes, arms excluded) */
  const ext = (yC: number, hh: number, meshes: THREE.SkinnedMesh[]) => {
    const r = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
    for (const m of meshes) vertsOf(m, (p, dom) => {
      if (ARM.test(dom) || Math.abs(p.y + lift - yC) > hh) return;
      if (p.x < r.x0) r.x0 = p.x;
      if (p.x > r.x1) r.x1 = p.x;
      if (p.z < r.z0) r.z0 = p.z;
      if (p.z > r.z1) r.z1 = p.z;
    });
    if (!isFinite(r.x0)) { r.x0 = -0.17; r.x1 = 0.17; r.z0 = -0.1; r.z1 = 0.1; }
    return r;
  };
  const radiusAround = (meshes: THREE.SkinnedMesh[], dom: string, a: THREE.Vector3, b: THREE.Vector3) => {
    const ab = b.clone().sub(a), L2 = ab.lengthSq(); let best = 0; const tmp = new THREE.Vector3(), off = new THREE.Vector3();
    for (const m of meshes) vertsOf(m, (p, d) => {
      if (d !== dom) return;
      tmp.copy(p); tmp.y += lift;
      const k = tmp.clone().sub(a).dot(ab) / L2;
      if (k < 0.25 || k > 0.75) return;
      off.copy(tmp).sub(a).addScaledVector(ab, -k);
      if (off.length() > best) best = off.length();
    });
    return best;
  };
  const wp = {} as Record<string, THREE.Vector3>;
  for (const n of BONES) wp[n] = wpos(n);
  const chestY = wp.spine_03.y + 0.02, waistY = wp.spine_01.y, hipY = wp.pelvis.y, neckY = wp.neck_01.y;
  const ce = ext(chestY, 0.04, trunk), we = ext(waistY, 0.03, trunk), he = ext(hipY - 0.03, 0.04, lower);
  const armR = radiusAround(skinned.filter((m) => /arms$|body$/i.test(m.name)), 'upperarm_l', wp.upperarm_l, wp.lowerarm_l) || 0.05;
  const legR = radiusAround(skinned.filter((m) => /legs$/i.test(m.name)), 'thigh_l', wp.thigh_l, wp.calf_l) || 0.08;
  const hb = new THREE.Box3(), pt = new THREE.Vector3();
  for (const m of skinned) if (/^(HeadSkin|Hair)/.test(m.name)) vertsOf(m, (p) => hb.expandByPoint(pt.set(p.x, p.y + lift, p.z)));
  const headTop = hb.max.y;
  const headSz = hb.getSize(new THREE.Vector3());
  const dims: Dims = {
    height: headTop,
    shoulderW: Math.abs(wp.upperarm_l.x - wp.upperarm_r.x),
    chestW: ce.x1 - ce.x0, chestD: ce.z1 - ce.z0,
    waistW: we.x1 - we.x0, hipW: he.x1 - he.x0,
    armLen: wp.upperarm_l.distanceTo(wp.lowerarm_l) + wp.lowerarm_l.distanceTo(wp.hand_l),
    armR, legLen: wp.thigh_l.distanceTo(wp.calf_l) + wp.calf_l.distanceTo(wp.foot_l), legR,
    headR: Math.max(headSz.x, headSz.z) / 2,
    neckY, chestY, waistY, hipY,
  };

  // ----- slots (Groups under bones: world-identity rotation and scale at build time, whatever the bone scales are)
  const slotMat = new THREE.Matrix4(), inv = new THREE.Matrix4();
  const mkSlot = (name: string, bone: THREE.Object3D, p: THREE.Vector3) => {
    const g = new THREE.Group(); g.name = 'slot-' + name;
    bone.updateWorldMatrix(true, false);
    inv.copy(bone.matrixWorld).invert();
    slotMat.makeTranslation(p.x, p.y, p.z);
    g.matrixAutoUpdate = false;
    g.matrix.copy(inv).multiply(slotMat);
    bone.add(g);
    return g;
  };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const mid = (a: string, b: string, k = 0.5) => wp[a].clone().lerp(wp[b], k);
  const slots = {} as Slots;
  const headC = V(0, (wp.Head.y + headTop) / 2 - 0.01, (hb.min.z + hb.max.z) / 2);
  slots.head = mkSlot('head', B('Head'), headC);
  slots.headTop = mkSlot('headTop', B('Head'), V(0, headTop + 0.03, headC.z));
  slots.neck = mkSlot('neck', B('neck_01'), V(0, wp.neck_01.y + 0.03, wp.neck_01.z + 0.01));
  slots.chest = mkSlot('chest', B('spine_03'), V(0, chestY + 0.03, ce.z1 + 0.005));
  slots.back = mkSlot('back', B('spine_03'), V(0, chestY + 0.09, ce.z0 - 0.015));
  slots.waist = mkSlot('waist', B('pelvis'), V(0, waistY, (we.z0 + we.z1) / 2));
  for (const [side, s] of [['L', 'l'], ['R', 'r']] as const) {
    const set = (k: keyof Slots, g: THREE.Object3D) => { slots[k] = g; };
    set(('shoulder' + side) as keyof Slots, mkSlot('shoulder' + side, B('upperarm_' + s), wp['upperarm_' + s]));
    set(('upperArm' + side) as keyof Slots, mkSlot('upperArm' + side, B('upperarm_' + s), mid('upperarm_' + s, 'lowerarm_' + s)));
    set(('forearm' + side) as keyof Slots, mkSlot('forearm' + side, B('lowerarm_' + s), mid('lowerarm_' + s, 'hand_' + s)));
    const m1 = byName[`middle_01_${s}`];
    const mp = m1 ? m1.getWorldPosition(new THREE.Vector3()) : wp['hand_' + s].clone().add(V(0, -0.08, 0));
    const palm = wp['hand_' + s].clone().lerp(mp, 0.75); palm.x += s === 'l' ? -0.01 : 0.01; // towards the thigh side of the palm
    set(('hand' + side) as keyof Slots, mkSlot('hand' + side, B('hand_' + s), palm));
    set(('thigh' + side) as keyof Slots, mkSlot('thigh' + side, B('thigh_' + s), mid('thigh_' + s, 'calf_' + s)));
    set(('shin' + side) as keyof Slots, mkSlot('shin' + side, B('calf_' + s), mid('calf_' + s, 'foot_' + s)));
    set(('foot' + side) as keyof Slots, mkSlot('foot' + side, B('foot_' + s), V(wp['foot_' + s].x, 0.05, wp['ball_' + s].z - 0.045)));
  }
  slots.floor = new THREE.Group(); slots.floor.name = 'slot-floor'; root.add(slots.floor);

  // ----- idle (all channels precomputed; no allocation per frame)
  interface Chan { axis: THREE.Vector3; amp: number; f: number; ph: number }
  interface Idle { bone: THREE.Bone; base: THREE.Quaternion; chans: Chan[]; m: Mgr | undefined }
  const idle = new Map<string, Idle>();
  const chan = (n: string, a: 'x' | 'y' | 'z', amp: number, f: number, ph = 0) => {
    let g = idle.get(n);
    if (!g) { g = { bone: B(n), base: B(n).quaternion.clone(), chans: [], m: mgrOf.get(B(n)) }; idle.set(n, g); }
    g.chans.push({ axis: ax[a].clone().applyQuaternion(rest[n].pwq.clone().invert()), amp, f, ph });
  };
  chan('spine_01', 'z', 0.012, 0.45); chan('spine_01', 'x', 0.008, 1.7, 0.5);
  chan('spine_03', 'x', -0.014, 1.7); chan('neck_01', 'x', 0.006, 1.7, 0.3);
  chan('Head', 'y', 0.07, 0.31); chan('Head', 'x', 0.016, 0.53, 1);
  chan('upperarm_l', 'z', 0.02, 1.7, 0.2); chan('upperarm_r', 'z', -0.02, 1.7, 0.2);
  chan('upperarm_l', 'x', 0.02, 0.9, 1); chan('upperarm_r', 'x', 0.02, 0.9, 2.3);
  chan('lowerarm_l', 'y', 0.02, 0.9, 0.5); chan('lowerarm_r', 'y', 0.02, 0.9, 1.7);
  chan('pelvis', 'z', 0.007, 0.45, 0.4);
  const idleList = Array.from(idle.values());
  const qa = new THREE.Quaternion();
  const reduced = reducedMotion();
  const update = (time: number) => {
    if (reduced) return;
    for (let i = 0; i < idleList.length; i++) {
      const g = idleList[i];
      g.bone.quaternion.copy(g.base);
      for (let k = 0; k < g.chans.length; k++) {
        const c = g.chans[k];
        qa.setFromAxisAngle(c.axis, c.amp * Math.sin(time * c.f + c.ph));
        g.bone.quaternion.premultiply(qa);
      }
      if (g.m) compose(g.m);
    }
  };
  update(0);

  const dispose = () => {
    // geometries, textures and original materials belong to the module cache; converted materials belong to `mats`
    for (const m of skinned) {
      m.skeleton.dispose();
      for (const c of m.children.slice()) if (c.userData.isOutline) c.removeFromParent();
    }
    root.removeFromParent();
    root.clear();
  };

  return { root, dims, slots, update, dispose, bones: byName };
}

export const loadBody: LoadBody = async (state, mats) => {
  try { return await build(state, mats); }
  catch (e) {
    console.warn('[avatar] model failed, using the procedural body', e);
    return buildBody(state, mats);
  }
};
