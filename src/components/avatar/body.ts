/* BODY: the human figure. CONVENTION: "L is at +x" (the figure faces +z; its left side is +x, right side is -x).
   Units: 1 = 1 metre-ish, 1.8 tall, feet on y = 0, facing +z.
   Hierarchy: root > hips > spine > chest > neck > head ; chest > shoulderPivot > elbow > wrist ; hips > hipPivot > knee > ankle.
   All limbs hang along local -y. Slots are plain Groups parented under the right joint and follow the pose:
   their origin sits at the described point, axes = parent joint axes (+x is the figure's left, +z forward).
   handL/R slot sits at the palm centre (fingers point to -y, palm faces the thigh, thumb forward). */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { AvatarRig, AvatarState, BuildBody, Dims, Materials, Slots } from './types';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export const buildBody: BuildBody = (state: AvatarState, mats: Materials): AvatarRig => {
  const t = clamp((state.stats.body - 1) / 12, 0, 1);
  const geos: THREE.BufferGeometry[] = [];
  const track = <G extends THREE.BufferGeometry>(g: G): G => { geos.push(g); return g; };
  const outlines: THREE.Mesh[] = [];

  const root = new THREE.Group();
  root.name = 'avatar-root';

  // ---------- measurements ----------
  const shoulderW = lerp(0.44, 0.62, t);
  const armR = lerp(0.04, 0.075, t);
  const legR = lerp(0.075, 0.1, t);
  const chestW = lerp(0.3, 0.4, t);
  const chestD = lerp(0.19, 0.25, t);
  const waistW = lerp(0.235, 0.27, t);
  const hipW = lerp(0.265, 0.33, t);
  const hipD = chestD * 0.98;
  const hipX = lerp(0.08, 0.095, t); // hip joint x offset
  const hipY = 0.93, waistY = 1.07, chestY = 1.28, neckY = 1.5;
  const shoulderY = chestY + 0.17;
  const upperLen = 0.3, foreLen = 0.26, thighLen = 0.43, shinLen = 0.42, ankleH = 0.08;
  const neckR = lerp(0.05, 0.066, t);

  // ---------- helpers ----------
  const S = track(new THREE.SphereGeometry(1, 16, 12));
  const SL = track(new THREE.SphereGeometry(1, 10, 6));

  type Opts = { p?: [number, number, number]; r?: [number, number, number]; s?: [number, number, number]; o?: boolean };
  const mk = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, op: Opts = {}) => {
    const m = new THREE.Mesh(geo, mat);
    if (op.p) m.position.set(...op.p);
    if (op.r) m.rotation.set(...op.r);
    if (op.s) m.scale.set(...op.s);
    parent.add(m);
    if (op.o) {
      const ol = mats.addOutline(m);
      if (ol) {
        if (!ol.parent) {
          ol.position.copy(m.position); ol.quaternion.copy(m.quaternion); ol.scale.copy(m.scale);
          parent.add(ol);
        }
        outlines.push(ol);
      }
    }
    return m;
  };
  const grp = (parent: THREE.Object3D, x = 0, y = 0, z = 0, name = '') => {
    const g = new THREE.Group(); g.position.set(x, y, z); if (name) g.name = name; parent.add(g); return g;
  };

  /** lathe profile builder. pts are [radius, y] ordered any way; sorted bottom to top for outward normals. */
  const lathe = (pts: [number, number][], seg = 28, smooth = 3) => {
    const sorted = pts.slice().sort((a, b) => a[1] - b[1]);
    let v = sorted.map(([r, y]) => new THREE.Vector2(r, y));
    if (smooth > 1) v = new THREE.SplineCurve(v).getPoints((v.length - 1) * smooth);
    v = v.map((p) => new THREE.Vector2(Math.max(p.x, 0), p.y));
    return track(new THREE.LatheGeometry(v, seg));
  };
  /** tapered limb from y=0 down to y=-len, rounded ends, optional muscle bulge at fraction bt */
  const limb = (len: number, r0: number, r1: number, bulge = 0, bt = 0.4, rad = 18, topRound = true) => {
    const pts: [number, number][] = [];
    const K = 6;
    if (topRound) for (let i = 0; i <= K; i++) { const a = (i / K) * (Math.PI / 2); pts.push([r0 * Math.sin(a), r0 * Math.cos(a) * 0.95]); }
    else pts.push([0, 0.0], [r0, 0.0]);
    const N = 10;
    for (let i = 1; i < N; i++) {
      const s = i / N;
      const w = Math.exp(-Math.pow((s - bt) / 0.28, 2));
      pts.push([lerp(r0, r1, s) * (1 + bulge * w), -len * s]);
    }
    for (let i = 0; i <= K; i++) { const a = (i / K) * (Math.PI / 2); pts.push([r1 * Math.cos(a), -len - r1 * Math.sin(a) * 0.95]); }
    // remove duplicates in y from caps joining (keep ordering by y)
    return lathe(pts, rad, 1);
  };

  // ---------- skeleton ----------
  const hips = grp(root, 0, hipY, 0, 'hips');
  const spine = grp(hips, 0, waistY - hipY, 0, 'spine');
  const chest = grp(spine, 0, chestY - waistY, 0, 'chest');
  const neck = grp(chest, 0, neckY - chestY, 0, 'neck');
  const head = grp(neck, 0, 0.05, 0, 'head');
  const bodyMesh = grp(chest, 0, 0, 0, 'chestMesh'); // scaled for breathing

  // ---------- pelvis / trunks / torso ----------
  const wrH = waistW / hipW;
  const pelvisGeo = lathe([[0.0, -0.115], [0.55, -0.1], [0.9, -0.06], [1.0, 0.0], [0.99, 0.06], [wrH + 0.04, 0.12], [wrH, 0.165]]
    .map(([r, y]) => [r, y] as [number, number]), 28, 3);
  mk(hips, pelvisGeo, mats.skin, { s: [hipW / 2 * 0.93, 1, hipD / 2 * 0.93], o: true }); // slightly inside the clothes so skin never pokes through trousers
  const trunkGeo = lathe([[0.0, -0.125], [0.53, -0.11], [0.85, -0.07], [0.94, 0.0], [0.93, 0.07], [0.9, 0.115]], 28, 3);
  mk(hips, trunkGeo, mats.dark, { s: [hipW / 2 + 0.006, 1, hipD / 2 + 0.006], o: true });

  const wr = waistW / chestW;
  const wr2 = wr * lerp(1, 0.96, t);
  const torsoGeo = lathe([
    [wr2, -0.28], [lerp(wr2, 1, 0.3), -0.14], [0.95, -0.02], [1.0, 0.08], [0.97, 0.14], [0.86, 0.19], [0.6, 0.225], [0.3, 0.24], [0.0, 0.245],
  ], 28, 2);
  mk(bodyMesh, torsoGeo, mats.skin, { s: [chestW / 2, 1, chestD / 2], o: true });
  // collarbone/trap yoke across the shoulders
  const yokeR = lerp(0.05, 0.085, t);
  const yokeLen = shoulderW - yokeR * 1.2;
  mk(bodyMesh, track(new THREE.CapsuleGeometry(yokeR, Math.max(0.05, yokeLen - 2 * yokeR), 6, 16)), mats.skin,
    { p: [0, 0.155, -0.005], r: [0, 0, Math.PI / 2], s: [1, 1, 0.78] });
  // traps rising toward the neck
  const trapR = lerp(0.03, 0.06, t);
  for (const sx of [1, -1]) {
    mk(bodyMesh, S, mats.skin, { p: [sx * (neckR + trapR * 1.1), 0.205, -0.01], s: [trapR * 1.5, trapR * 1.1, trapR * 1.5] });
  }
  // pecs + lat hints
  const pecR = chestW * lerp(0.17, 0.19, t);
  for (const sx of [1, -1]) {
    mk(bodyMesh, S, mats.skin, { p: [sx * chestW * 0.23, 0.07, chestD * 0.28], s: [pecR * 1.3, pecR * 0.9, pecR * lerp(0.35, 0.45, t)], r: [0.1, 0, 0] });
  }
  // lower abdomen / belly block between torso and trunks

  // ---------- neck ----------
  const neckGeo = lathe([[neckR * 1.25, -0.06], [neckR * 1.05, -0.02], [neckR, 0.03], [neckR * 0.95, 0.08], [neckR * 0.92, 0.12]], 20, 3);
  mk(neck, neckGeo, mats.skin, { s: [1, 1, 0.92], p: [0, 0, 0], o: false });

  // ---------- head ----------
  const hs = 1;
  const headG = grp(head, 0, 0, 0, 'headMesh');
  headG.scale.setScalar(hs);
  const SKX = 0.088, SKY = 0.116, SKZ = 0.102, SKC = 0.116;
  const headGeo = track(new THREE.SphereGeometry(1, 32, 24));
  {
    const pa = headGeo.attributes.position as THREE.BufferAttribute;
    const sm = (e0: number, e1: number, x: number) => { const k = clamp((x - e0) / (e1 - e0), 0, 1); return k * k * (3 - 2 * k); };
    for (let i = 0; i < pa.count; i++) {
      let x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      const k = clamp((0.2 - y) / 1.2, 0, 1);            // 0 at the cranium, 1 at the chin pole
      x *= 1 - 0.2 * Math.pow(k, 1.1);                 // taper to the jaw
      z = z * (1 - 0.06 * k) + 0.2 * Math.pow(k, 1.5);  // push the chin forward
      y = y < -0.55 ? -0.55 + (y + 0.55) * 0.9 : y;     // slightly squarer chin
      if (z > 0) x *= 1 - 0.1 * sm(0.2, 1, z) * (1 - k); // gentle forehead narrowing
      pa.setXYZ(i, x, y, z);
    }
    headGeo.computeVertexNormals();
  }
  mk(headG, headGeo, mats.skin, { p: [0, SKC, -0.004], s: [SKX, SKY, SKZ], o: true });
  // ears
  for (const sx of [1, -1]) {
    mk(headG, S, mats.skin, { p: [sx * 0.088, 0.108, -0.008], s: [0.011, 0.028, 0.019], r: [0, 0, sx * -0.12] });
  }
  // brow ridge
  for (const sx of [1, -1]) {
    mk(headG, track(new THREE.CapsuleGeometry(0.008, 0.042, 4, 8)), mats.skin,
      { p: [sx * 0.035, 0.151, 0.087], r: [0, sx * 0.25, Math.PI / 2 - sx * 0.05] });
  }
  // nose: bridge + tip + nostril wings
  mk(headG, S, mats.skin, { p: [0, 0.112, 0.096], s: [0.01, 0.026, 0.014], r: [-0.35, 0, 0] });
  mk(headG, S, mats.skin, { p: [0, 0.088, 0.108], s: [0.012, 0.011, 0.012] });
  for (const sx of [1, -1]) mk(headG, SL, mats.skin, { p: [sx * 0.011, 0.085, 0.102], s: [0.0075, 0.008, 0.008] });
  // eyes: dark with a skin lid above
  for (const sx of [1, -1]) {
    mk(headG, SL, mats.dark, { p: [sx * 0.037, 0.13, 0.0885], s: [0.0115, 0.0095, 0.006] });
  }
  // mouth
  mk(headG, track(new THREE.CapsuleGeometry(0.0035, 0.03, 3, 6)), mats.dark, { p: [0, 0.052, 0.094], r: [0, 0, Math.PI / 2] });

  // hair: cap with raised front hairline + volume on top
  const hairCap = track(new THREE.SphereGeometry(1, 32, 22, 0, Math.PI * 2, 0, 1.62));
  mk(headG, hairCap, mats.hair, { p: [0, SKC, -0.004], s: [SKX * 1.07, SKY * 1.06, SKZ * 1.07], r: [-0.5, 0, 0], o: true });
  mk(headG, S, mats.hair, { p: [0, SKC + 0.082, 0.05], s: [0.045, 0.02, 0.04], r: [0.5, 0, 0] }); // quiff
  for (const sx of [1, -1]) mk(headG, S, mats.hair, { p: [sx * 0.08, 0.13, 0.02], s: [0.01, 0.026, 0.02] }); // sideburns

  // ---------- arms ----------
  const abd = lerp(0.1, 0.19, t);
  const upperG = track(limb(upperLen, armR, armR * 0.78, 0.14, 0.35));
  const foreG = track(limb(foreLen, armR * 0.8, 0.027, 0.22, 0.2, 18, false));
  const handBox = track(new RoundedBoxGeometry(0.03, 0.085, 0.085, 2, 0.012));
  const fingerA = track(new RoundedBoxGeometry(0.026, 0.05, 0.08, 2, 0.011));
  const fingerB = track(new RoundedBoxGeometry(0.022, 0.04, 0.074, 2, 0.01));
  const thumbG = track(new THREE.CapsuleGeometry(0.0125, 0.04, 4, 8));
  const arms: Record<string, { sh: THREE.Group; el: THREE.Group; wr: THREE.Group; hand: THREE.Group }> = {};
  const slotArm: Record<string, THREE.Group> = {};
  for (const [side, sx] of [['L', 1], ['R', -1]] as const) {
    const sh = grp(chest, sx * shoulderW / 2, shoulderY - chestY, 0, 'shoulder' + side);
    sh.rotation.set(0.04, 0, sx * abd);
    const delt = armR * 1.18;
    mk(sh, S, mats.skin, { s: [delt, delt * 1.05, delt * 1.02], p: [sx * 0.004, 0.005, 0], o: true });
    mk(sh, upperG, mats.skin, { o: true });
    const el = grp(sh, 0, -upperLen, 0, 'elbow' + side);
    el.rotation.set(-0.32, sx * 0.12, -sx * 0.1);
    mk(el, S, mats.skin, { s: [armR * 0.8, armR * 0.8, armR * 0.8] });
    mk(el, foreG, mats.skin, { o: true });
    const wr = grp(el, 0, -foreLen, 0, 'wrist' + side);
    wr.rotation.set(-0.1, 0, 0);
    mk(wr, SL, mats.skin, { s: [0.028, 0.026, 0.028] });
    const hand = grp(wr, 0, 0, 0, 'hand' + side);
    mk(hand, handBox, mats.skin, { p: [0, -0.05, 0], o: true });
    // knuckle bar + finger block (two curled segments)
    const f1 = grp(hand, -sx * 0.002, -0.093, 0);
    f1.rotation.z = -sx * 0.32;
    mk(f1, fingerA, mats.skin, { p: [0, -0.024, 0], o: true });
    const f2 = grp(f1, 0, -0.049, 0);
    f2.rotation.z = -sx * 0.5;
    mk(f2, fingerB, mats.skin, { p: [0, -0.019, 0.002] });
    // thumb on the forward edge
    const th = grp(hand, -sx * 0.004, -0.03, 0.042);
    th.rotation.set(-0.5, 0, -sx * 0.25);
    mk(th, thumbG, mats.skin, { p: [0, -0.03, 0.004] });
    arms[side] = { sh, el, wr, hand };
    const palm = grp(hand, -sx * 0.012, -0.055, 0, 'palm' + side);
    slotArm[side] = palm;
  }

  // ---------- legs ----------
  const thighG = track(limb(thighLen, legR, legR * 0.66, 0.09, 0.25, 22));
  const shinG = track(limb(shinLen, legR * 0.64, 0.032, 0.3, 0.22, 18, false));
  const heelG = track(new THREE.SphereGeometry(1, 16, 12));
  const footBox = track(new RoundedBoxGeometry(0.088, 0.05, 0.17, 2, 0.02));
  const toeBox = track(new RoundedBoxGeometry(0.092, 0.032, 0.07, 2, 0.014));
  const legs: Record<string, { hp: THREE.Group; kn: THREE.Group; an: THREE.Group; probes: THREE.Object3D[] }> = {};
  const slotLeg: Record<string, THREE.Group> = {};
  for (const [side, sx] of [['L', 1], ['R', -1]] as const) {
    const hp = grp(hips, sx * hipX, 0, 0, 'hip' + side);
    mk(hp, thighG, mats.skin, { o: true });
    const kn = grp(hp, 0, -thighLen, 0, 'knee' + side);
    mk(kn, S, mats.skin, { s: [legR * 0.66, legR * 0.66, legR * 0.66] });
    mk(kn, shinG, mats.skin, { o: true });
    const an = grp(kn, 0, -shinLen, 0, 'ankle' + side);
    mk(an, SL, mats.skin, { s: [0.034, 0.04, 0.036] });
    const foot = grp(an, 0, 0, 0, 'foot' + side);
    // sole at local y = -ankleH
    mk(foot, heelG, mats.skin, { p: [0, -0.045, -0.035], s: [0.04, 0.04, 0.045] });
    mk(foot, footBox, mats.skin, { p: [0, -0.052, 0.045], o: true });
    mk(foot, S, mats.skin, { p: [0, -0.03, 0.04], s: [0.038, 0.032, 0.07] }); // instep
    mk(foot, toeBox, mats.skin, { p: [0, -0.063, 0.13], o: true });
    mk(foot, S, mats.skin, { p: [0, -0.06, 0.162], s: [0.044, 0.02, 0.02] });
    const probes = [[0, -ankleH, -0.06], [0, -ankleH, 0.17], [0.04, -ankleH, 0.05], [-0.04, -ankleH, 0.05]].map(([x, y, z]) => {
      const p = new THREE.Object3D(); p.position.set(x, y, z); foot.add(p); return p;
    });
    legs[side] = { hp, kn, an, probes };
    slotLeg[side] = foot;
  }

  // ---------- slots ----------
  const slots = {} as Slots;
  slots.head = grp(head, 0, 0.115, 0, 'slot-head');
  slots.headTop = grp(head, 0, 0.255, 0, 'slot-headTop');
  slots.neck = grp(neck, 0, 0.02, 0, 'slot-neck');
  slots.chest = grp(chest, 0, 0.06, chestD / 2 + 0.005, 'slot-chest');
  slots.back = grp(chest, 0, 0.12, -chestD / 2 - 0.01, 'slot-back');
  // follows the hips (not the spine) so trousers, belts and hip gear stay locked to the pelvis during the idle sway
  slots.waist = grp(hips, 0, waistY - hipY, 0, 'slot-waist');
  slots.shoulderL = grp(arms.L.sh, 0, 0, 0, 'slot-shoulderL');
  slots.shoulderR = grp(arms.R.sh, 0, 0, 0, 'slot-shoulderR');
  slots.upperArmL = grp(arms.L.sh, 0, -upperLen / 2, 0, 'slot-upperArmL');
  slots.upperArmR = grp(arms.R.sh, 0, -upperLen / 2, 0, 'slot-upperArmR');
  slots.forearmL = grp(arms.L.el, 0, -foreLen / 2, 0, 'slot-forearmL');
  slots.forearmR = grp(arms.R.el, 0, -foreLen / 2, 0, 'slot-forearmR');
  slots.handL = slotArm.L; slots.handR = slotArm.R;
  slots.thighL = grp(legs.L.hp, 0, -thighLen / 2, 0, 'slot-thighL');
  slots.thighR = grp(legs.R.hp, 0, -thighLen / 2, 0, 'slot-thighR');
  slots.shinL = grp(legs.L.kn, 0, -shinLen / 2, 0, 'slot-shinL');
  slots.shinR = grp(legs.R.kn, 0, -shinLen / 2, 0, 'slot-shinR');
  slots.footL = grp(legs.L.an, 0, -0.05, 0.05, 'slot-footL');
  slots.footR = grp(legs.R.an, 0, -0.05, 0.05, 'slot-footR');
  slots.floor = grp(root, 0, 0, 0, 'slot-floor');
  void slotLeg;

  // ---------- pose ----------
  const stance = 0.03 + 0.05 * t;           // leg abduction
  const lean = lerp(0.07, -0.02, t);          // spine forward lean (slouch at low body, upright at high)
  const base = {
    hipsX: -0.028, hipsRz: -0.035, spineRz: 0.03, spineRx: lean * 0.6, chestRx: lean * 0.4 - lerp(0, 0.03, t), chestRz: 0.02,
    headRx: -lean * 0.8 + 0.02, headRz: -0.03, chestY: chest.position.y,
  };
  const applyBase = () => {
    hips.position.x = base.hipsX; hips.rotation.z = base.hipsRz; hips.rotation.y = 0.04;
    spine.rotation.set(base.spineRx, -0.03, base.spineRz);
    chest.rotation.set(base.chestRx, -0.03, base.chestRz);
    neck.rotation.set(0.01, 0, -0.01);
    head.rotation.set(base.headRx, 0.05, base.headRz);
  };
  applyBase();
  // R = support leg (straight), L = free leg (relaxed, slightly forward and out)
  legs.R.hp.rotation.set(0.0, 0, -stance + 0.04);
  legs.R.kn.rotation.set(0.02, 0, 0);
  legs.R.an.rotation.set(-0.02, -0.0, stance - 0.04);
  legs.L.hp.rotation.set(-0.1, -0.08, stance + 0.03);
  legs.L.an.rotation.set(0, 0, -(stance + 0.03));
  legs.L.kn.rotation.x = 0.2;
  legs.L.an.rotation.x = -(-0.1 + 0.2) + 0.0;
  legs.R.hp.rotation.y = 0.12; legs.R.an.rotation.y = -0.0;
  // toes slightly out
  const footYaw = lerp(0.1, 0.18, t);
  legs.R.an.rotation.y = -footYaw; legs.L.an.rotation.y = footYaw;

  const soleY = (side: 'L' | 'R') => Math.min(...legs[side].probes.map((p) => p.getWorldPosition(new THREE.Vector3()).y));
  // plant the support foot on y=0, then solve the free knee so its sole touches y=0 too
  const solve = () => {
    root.position.y = 0; root.updateMatrixWorld(true);
    let lo = 0, hi = 0.7;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      legs.L.kn.rotation.x = mid; legs.L.an.rotation.x = -(legs.L.hp.rotation.x + mid);
      root.updateMatrixWorld(true);
      // want L sole at the same height as R sole
      if (soleY('L') - soleY('R') > 0) hi = mid; else lo = mid;
    }
    root.updateMatrixWorld(true);
    root.position.y = -soleY('R');
    root.updateMatrixWorld(true);
  };
  solve();

  // arm base rotations for idle sway
  const armBase = {
    L: { sh: arms.L.sh.rotation.clone(), el: arms.L.el.rotation.clone() },
    R: { sh: arms.R.sh.rotation.clone(), el: arms.R.el.rotation.clone() },
  };
  // free-side arm hangs a touch lower/looser, support-side arm a touch tighter
  arms.L.sh.rotation.z += 0.03; armBase.L.sh.copy(arms.L.sh.rotation);

  // ---------- outlines/materials sanity ----------
  const dims: Dims = {
    height: 1.8,
    shoulderW,
    chestW,
    chestD,
    waistW,
    hipW,
    armLen: upperLen + foreLen,
    armR,
    legLen: thighLen + shinLen,
    legR,
    headR: 0.1 * hs,
    neckY,
    chestY,
    waistY,
    hipY,
  };

  const reduced = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const update = (time: number) => {
    if (reduced()) return;
    const br = Math.sin(time * 1.7);
    const sw = Math.sin(time * 0.45);
    bodyMesh.scale.set(1 + 0.012 * br, 1 + 0.006 * br, 1 + 0.02 * br);
    chest.position.y = base.chestY + 0.0025 * br;
    hips.position.x = base.hipsX + 0.004 * sw;
    spine.rotation.z = base.spineRz + 0.01 * sw;
    head.rotation.y = 0.05 + 0.05 * Math.sin(time * 0.31);
    head.rotation.x = base.headRx + 0.014 * Math.sin(time * 0.53 + 1);
    arms.L.sh.rotation.z = armBase.L.sh.z + 0.012 * br + 0.006 * sw;
    arms.R.sh.rotation.z = armBase.R.sh.z - 0.012 * br - 0.006 * sw;
    arms.L.el.rotation.x = armBase.L.el.x - 0.015 * Math.sin(time * 0.9);
    arms.R.el.rotation.x = armBase.R.el.x - 0.015 * Math.sin(time * 0.9 + 1.3);
  };

  const dispose = () => {
    for (const g of geos) g.dispose();
    for (const o of outlines) if (o.geometry) o.geometry.dispose();
  };

  return { root, dims, slots, update, dispose };
};
