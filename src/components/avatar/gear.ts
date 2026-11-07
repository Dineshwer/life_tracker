/* gear.ts v2: what the character carries, wears over the model's own clothes, and emits.
   The real human model already wears the Peasant / Ranger outfits, so this file adds only SILHOUETTE pieces per band
   (scarf + staff, cape + bracers + brooch, big pauldrons + plate + sword + circlet, wings + runes + aura) plus the stat props
   (Mind / Skill / Discipline) and the streak fire.
   FITTING: every piece lives in a "world frame": a Group parented under a rig slot (so it follows the pose) whose own matrix
   cancels the slot's world matrix at build time. Inside a frame, coordinates are plain world metres at the rest pose, so all
   pieces are sized from rig.dims and measured slot positions and never assume a slot's local axes. */
import * as THREE from 'three';
import type { ApplyGear, AvatarRig, AvatarState, Dims, Materials } from './types';
import { DISC_TIERS, MIND_TIERS, SKILL_TIERS, STREAK_TIERS, tierOf } from './tiers';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** clearance (m) between the model's clothes and our armour; raise if the real model's clothing pokes through */
const FIT = 0.022;
const PM = FIT * 1.75;   // chest plate clearance (the ranger belt and straps are thick)

export const applyGear: ApplyGear = (rig: AvatarRig, state: AvatarState, mats: Materials) => {
  const d: Dims = rig.dims;
  const S = rig.slots;
  const band = state.band;
  const geos: THREE.BufferGeometry[] = [];
  const own: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const objs: THREE.Object3D[] = [];
  const anims: ((t: number) => void)[] = [];
  const reduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const G = <T extends THREE.BufferGeometry>(g: T): T => { geos.push(g); return g; };
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent?: THREE.Object3D, outline = false) => {
    const me = new THREE.Mesh(g, m);
    if (parent) parent.add(me);
    if (outline) {
      const ol = mats.addOutline(me);
      if (ol && !ol.parent) { ol.position.copy(me.position); ol.quaternion.copy(me.quaternion); ol.scale.copy(me.scale); parent?.add(ol); }
    }
    return me;
  };
  const ADD = (mats.glow as THREE.MeshBasicMaterial).blending === THREE.AdditiveBlending;
  const glowMat = (hex: number, opacity = 1, extra: THREE.MeshBasicMaterialParameters = {}) => {
    const m = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity, blending: ADD ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, toneMapped: false, ...extra });
    own.push(m); return m;
  };
  const whiten = (hex: number, k: number) => new THREE.Color(hex).lerp(new THREE.Color(0xffffff), k).getHex();
  const mind = glowMat(mats.stat.mind, 0.9), skill = glowMat(mats.stat.skill, 0.9), disc = glowMat(mats.stat.discipline, 0.9);
  const mindSoft = glowMat(mats.stat.mind, 0.3), skillSoft = glowMat(mats.stat.skill, 0.28), discSoft = glowMat(mats.stat.discipline, 0.3);
  const accGlow = glowMat(mats.accentHex, 0.85);

  /* ---------- world frames ---------- */
  rig.root.updateMatrixWorld(true);
  const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
  const frames = new Map<THREE.Object3D, THREE.Group>();
  const F = (slot: THREE.Object3D): THREE.Group => {
    let g = frames.get(slot);
    if (!g) {
      slot.updateWorldMatrix(true, false);
      g = new THREE.Group();
      slot.matrixWorld.clone().invert().decompose(g.position, g.quaternion, g.scale);
      slot.add(g); objs.push(g); frames.set(slot, g);
    }
    return g;
  };

  const sc = d.height / 1.8;
  const a = d.chestW / 2, b = d.chestD / 2;
  const zc = (wp(S.waist).z + wp(S.neck).z) / 2;             // z of the spine line (torso centre)
  const bt = clamp((d.shoulderW - 0.44) / 0.18, 0, 1);
  const neckR = Math.max(d.headR * 0.5, lerp(0.045, 0.062, bt));

  // shared unit geometries
  const cyl = G(new THREE.CylinderGeometry(1, 1, 1, 14));
  const sph = G(new THREE.SphereGeometry(1, 14, 10));
  const hemiG = G(new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2 * 0.86));
  const box = G(new THREE.BoxGeometry(1, 1, 1));
  const ico = G(new THREE.IcosahedronGeometry(1, 0));
  const cone = G(new THREE.ConeGeometry(1, 1, 8));
  const leafG = G(new THREE.SphereGeometry(1, 8, 4));
  const cache = new Map<string, THREE.BufferGeometry>();
  const cached = <T extends THREE.BufferGeometry>(key: string, mk: () => T): T => { let g = cache.get(key) as T | undefined; if (!g) { g = G(mk()); cache.set(key, g); } return g; };
  const torusGeo = (r: number, tube: number, seg = 40, arc = Math.PI * 2) => cached(`t${r}_${tube}_${seg}_${arc}`, () => new THREE.TorusGeometry(r, tube, 6, seg, arc));
  const taper = (rt: number, rb: number, seg = 14) => cached(`p${rt}_${rb}_${seg}`, () => new THREE.CylinderGeometry(rt, rb, 1, seg));
  const place = <T extends THREE.Object3D>(m: T, x: number, y: number, z: number, sx = 1, sy = sx, sz = sx): T => { m.position.set(x, y, z); m.scale.set(sx, sy, sz); return m; };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const UP = V(0, 1, 0);
  const tmpV = new THREE.Vector3();
  /** unit-height geometry placed between two points */
  const seg = (parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, p0: THREE.Vector3, p1: THREE.Vector3, outline = false) => {
    const me = mesh(geo, m, parent, outline);
    tmpV.subVectors(p1, p0); const len = tmpV.length();
    me.position.copy(p0).addScaledVector(tmpV, 0.5);
    me.quaternion.setFromUnitVectors(UP, tmpV.normalize());
    me.scale.set(1, len, 1);
    if (outline) { /* outline copies transform made in mesh(); redo */ me.updateMatrix(); }
    return me;
  };

  /* ---------- torso silhouette: ellipse radii of the trunk at height y (from dims) ---------- */
  const wr = (d.waistW / d.chestW) * 0.98;
  const PROF: [number, number][] = [[-0.28, wr], [-0.14, lerp(wr, 1, 0.3)], [-0.02, 0.95], [0.08, 1], [0.14, 0.97], [0.19, 0.86], [0.225, 0.6], [0.24, 0.3]];
  const prof = (dy: number) => {
    if (dy <= PROF[0][0]) return PROF[0][1];
    for (let i = 1; i < PROF.length; i++) if (dy <= PROF[i][0]) { const [y0, v0] = PROF[i - 1], [y1, v1] = PROF[i]; return lerp(v0, v1, (dy - y0) / (y1 - y0)); }
    return PROF[PROF.length - 1][1];
  };
  const hipRx0 = d.hipW / 2 * 1.04, hipRz0 = d.chestD * 0.98 / 2 * 1.04;
  const R = (y: number): [number, number] => {
    const dy = y - d.chestY;
    let rx = 0, rz = 0;
    if (dy >= -0.28) {
      const p = prof(dy); rx = a * p; rz = b * p;
      if (dy > 0.07) {
        const sx = d.shoulderW / 2 * 0.88;
        const sh = dy < 0.15 ? lerp(a, sx, smooth(0.07, 0.15, dy)) : lerp(sx, neckR * 2 + 0.03, smooth(0.17, 0.235, dy));
        rx = Math.max(rx, sh);
        if (dy > 0.15) rz = Math.max(rz, neckR * 1.4);
      }
    }
    const f = clamp(1 - (((d.hipY - 0.02 - y) / 0.11) ** 2) * 0.45, 0.55, 1);
    const bg = Math.sqrt(Math.max(0, 1 - ((y - (d.waistY - 0.01)) / 0.11) ** 2));
    rz = Math.max(rz, b * 1.03 * bg); rx = Math.max(rx, d.waistW * 0.5 * 1.02 * bg);
    const hf = y <= 1.045 * sc ? 1 : Math.max(0, 1 - (y - 1.045 * sc) / 0.07);
    rx = Math.max(rx, hipRx0 * f * hf); rz = Math.max(rz, hipRz0 * f * hf);
    return [rx, rz];
  };
  const Rk = (y: number, k: number, m: number): [number, number] => { const [rx, rz] = R(y); return [rx * k + m, rz * k + m]; };
  /** z of the front surface at (x, y) of the torso scaled by k plus margin m (relative to the spine line) */
  const surfZ = (x: number, y: number, k: number, m = 0) => { const [rx, rz] = Rk(y, k, m); return rz * Math.sqrt(Math.max(0.04, 1 - (x / rx) ** 2)); };
  /** open shell around the torso between y0 and y1 (world y, spine-centred) */
  const shell = (k: number, m: number, y0: number, y1: number, rows = 18) => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < rows; i++) pts.push(new THREE.Vector2(1, y0 + ((y1 - y0) * i) / (rows - 1)));
    const g = G(new THREE.LatheGeometry(pts, 28));
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const [rx, rz] = Rk(pts[i % rows].y, k, m);
      p.setXYZ(i, p.getX(i) * rx, p.getY(i), p.getZ(i) * rz);
    }
    g.computeVertexNormals();
    return g;
  };
  /** tilted bandolier loop around the torso: x>0 side lower for tilt<0 */
  const strapGeo = (m: number, tilt: number, yc: number, tube: number) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 40; i++) {
      const ph = (i / 40) * Math.PI * 2; const y = yc + a * Math.sin(ph) * Math.tan(tilt);
      const [rx, rz] = Rk(y, 1, m);
      pts.push(new THREE.Vector3(rx * Math.sin(ph), y, rz * Math.cos(ph)));
    }
    return G(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 64, tube, 5, true));
  };
  const ringPts = (y: number, k: number, m: number, n: number) => Array.from({ length: n }, (_, i) => { const an = (i / n) * Math.PI * 2; const [rx, rz] = Rk(y, k, m); return { x: Math.sin(an) * rx, z: Math.cos(an) * rz, an }; });

  /* ---------- measured limb geometry (world rest) ---------- */
  const limbs = ([1, -1] as const).map((s) => {
    const sh = wp(s > 0 ? S.shoulderL : S.shoulderR), ua = wp(s > 0 ? S.upperArmL : S.upperArmR), fa = wp(s > 0 ? S.forearmL : S.forearmR), hd = wp(s > 0 ? S.handL : S.handR);
    const e1 = ua.clone().multiplyScalar(2).sub(sh);
    const dirF = hd.clone().sub(fa).normalize();
    const e2 = fa.clone().multiplyScalar(2).sub(hd.clone().addScaledVector(dirF, -0.05));
    const el = e1.clone().add(e2).multiplyScalar(0.5);
    const wr2 = fa.clone().multiplyScalar(2).sub(el);
    const th = wp(s > 0 ? S.thighL : S.thighR), sn = wp(s > 0 ? S.shinL : S.shinR);
    const hipJ = V(th.x, d.hipY, th.z);
    const kn = th.clone().multiplyScalar(2).sub(hipJ);
    const an = sn.clone().multiplyScalar(2).sub(kn);
    return { s, sh, el, wr: wr2, hd, kn, an };
  });
  const armRw = Math.max(d.armR, 0.035);
  const foreFrame = (s: number) => F(s > 0 ? S.forearmL : S.forearmR);
  const shinFrame = (s: number) => F(s > 0 ? S.shinL : S.shinR);
  const shFrame = (s: number) => F(s > 0 ? S.shoulderL : S.shoulderR);
  const upFrame = (s: number) => F(s > 0 ? S.upperArmL : S.upperArmR);
  const handFrame = (s: number) => F(s > 0 ? S.handL : S.handR);
  const headC = wp(S.head);
  const fT = F(S.chest), fH = F(S.waist), fHead = F(S.head), fBack = F(S.back), fNeck = F(S.neck);
  const torso = new THREE.Group(); torso.position.z = zc; fT.add(torso);          // shells centred on the spine line
  const hips = new THREE.Group(); hips.position.z = zc; fH.add(hips);
  const gold = band >= 5 ? mats.accent : mats.metal;                               // band 5: accent-coloured ornate plating
  const trim = band >= 5 ? mats.metal : mats.accent;

  /* ---------------- BAND 2: scarf, satchel, staff ---------------- */
  const sway: ((t: number) => void)[] = [];
  const handR = limbs[1];
  if (band >= 2) {
    // scarf: loose loop around the neck with a knot and two tails
    const ny = d.neckY + 0.012, sr = neckR * 1.55 + 0.018;
    const scarfMat = band >= 3 ? mats.accent : mats.cloth2;
    const loop = mesh(torusGeo(1, 0.26, 24), scarfMat, fNeck, true);
    place(loop, 0, ny, zc + 0.006, sr, sr * 0.95, sr * 0.8); loop.rotation.x = Math.PI / 2 + 0.28;
    const knotP = V(0.045, ny - 0.03, zc + sr * 0.8 + 0.005);
    place(mesh(sph, scarfMat, fNeck, true), knotP.x, knotP.y, knotP.z, 0.03, 0.026, 0.026);
    const tails: [number, number, number, number][] = [[0.032, 0.2, 0.052, 0.12], [0.062, 0.145, 0.045, -0.2]];
    tails.forEach(([x, len, w, rot], i) => {
      const pv = new THREE.Group(); pv.position.set(x, knotP.y - 0.01, knotP.z - 0.004); fNeck.add(pv);
      const tg = mesh(box, i ? mats.cloth2 : scarfMat, pv, true); place(tg, 0, -len / 2, 0.01, w, len, 0.01);
      pv.rotation.set(0.22, 0, rot * 0.3);
      sway.push((t) => { pv.rotation.x = 0.2 + Math.sin(t * 1.3 + i * 1.7) * 0.07; pv.rotation.z = rot * 0.3 + Math.sin(t * 0.9 + i) * 0.05; });
    });
    if (band < 4) {
      // satchel on the left hip, strap over the right shoulder
      mesh(strapGeo(FIT * 0.75, -0.62, d.chestY + 0.0, 0.012), mats.dark, torso, true);
      const bag = new THREE.Group(); fH.add(bag);
      const bx = d.hipW / 2 * 1.04 + 0.075, by = d.hipY - 0.07;
      bag.position.set(bx, by, zc - 0.02); bag.rotation.z = -0.07;
      place(mesh(box, mats.cloth2, bag, true), 0, 0, 0, 0.065, 0.15, 0.17);
      place(mesh(box, mats.dark, bag, true), -0.004, 0.045, 0, 0.07, 0.06, 0.178);
      place(mesh(box, mats.metal, bag), -0.036, 0.012, 0, 0.012, 0.028, 0.03);
      const lk = mesh(cyl, mats.dark, fH); place(lk, bx * 0.9, by + 0.15, zc, 0.01, 0.12, 0.01); lk.rotation.z = -0.2;
    }
  }

  /* weapon planted at the right hand: world-vertical, grip through the palm */
  if (band >= 2) {
    const fR = handFrame(-1);
    const grip = handR.hd;
    const wpn = new THREE.Group(); wpn.position.set(grip.x, 0, grip.z); fR.add(wpn);
    const palmY = grip.y;
    if (band <= 3) {
      const top = d.height * 0.9, bot = 0.012, len = top - bot;
      const wood = mats.cloth2;
      seg(wpn, taper(0.0145, 0.0185, 10), wood, V(0, top, 0), V(0, bot, 0), true);
      place(mesh(cone, mats.dark, wpn), 0, bot + 0.02, 0, 0.022, 0.05, 0.022).rotation.x = Math.PI;
      place(mesh(cyl, mats.dark, wpn), 0, palmY, 0, 0.0205, 0.13, 0.0205);
      place(mesh(cyl, mats.dark, wpn), 0, bot + len * 0.55, 0, 0.018, 0.02, 0.018);
      // crook head: open ring plus a leaf
      const cr = mesh(torusGeo(0.055, 0.0125, 14, Math.PI * 1.45), wood, wpn, true); cr.position.set(0, top + 0.04, 0); cr.rotation.z = Math.PI * 0.78;
      if (band === 2) {
        const lf = mesh(leafG, mats.accent, wpn); place(lf, 0.03, top + 0.085, 0, 0.012, 0.04, 0.008); lf.rotation.z = -0.5;
      } else {
        // band 3: carved shaft with accent inlay, gem head
        const hel = G(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 60 }, (_, i) => { const u = i / 59, an = u * Math.PI * 2 * 6; const y = bot + len * 0.62 + u * len * 0.34; return V(Math.cos(an) * 0.0195, y, Math.sin(an) * 0.0195); })), 120, 0.0035, 4));
        mesh(hel, mats.accent, wpn);
        place(mesh(sph, wood, wpn, true), 0, top - 0.005, 0, 0.026, 0.026, 0.026);
        const gemH = mesh(ico, mats.accent, wpn, true); place(gemH, 0, top + 0.04, 0.0, 0.026, 0.034, 0.026);
        const halo = glowMat(mats.accentHex, 0.25 + 0.5 * clamp(state.pct, 0, 1)); const gh = mesh(sph, halo, wpn); place(gh, 0, top + 0.04, 0, 0.05);
        anims.push((t) => { gh.scale.setScalar(0.05 * (1 + 0.15 * Math.sin(t * 2.2))); });
        const ring = mesh(torusGeo(0.024, 0.005, 14), mats.accent, wpn); ring.position.y = bot + len * 0.55; ring.rotation.x = Math.PI / 2;
      }
    } else {
      // band 4/5: sword planted point-down, hilt in the fist
      const gy = palmY - 0.075, tip = 0.02, bl = Math.max(0.3, gy - tip);
      const bw = band >= 5 ? 0.066 : 0.056, th = 0.011;
      const bladeShape = (w: number, len: number) => {
        const sh = new THREE.Shape();
        sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(w / 2, -len * 0.84); sh.lineTo(0, -len); sh.lineTo(-w / 2, -len * 0.84); sh.closePath(); return sh;
      };
      const ext = (w: number, len: number, dep: number) => { const g = G(new THREE.ExtrudeGeometry(bladeShape(w, len), { depth: dep, bevelEnabled: false })); g.translate(0, 0, -dep / 2); return g; };
      const blade = mesh(ext(bw, bl, th), mats.metal, wpn, true); blade.position.y = gy;
      const edgeM = glowMat(mats.accentHex, band >= 5 ? 0.6 : 0.3);
      const edge = mesh(ext(bw * 1.3, bl * 1.02, 0.004), edgeM, wpn); edge.position.set(0, gy + 0.004, 0);
      const full = mesh(box, accGlow, wpn); place(full, 0, gy - bl * 0.45, th * 0.55, 0.008, bl * 0.7, 0.002);
      anims.push((t) => { edgeM.opacity = (band >= 5 ? 0.55 : 0.28) + 0.12 * Math.sin(t * 2.4); });
      place(mesh(box, gold, wpn, true), 0, gy + 0.008, 0, band >= 5 ? 0.2 : 0.16, 0.024, 0.03);
      [-1, 1].forEach((s) => {
        place(mesh(sph, trim, wpn), s * (band >= 5 ? 0.1 : 0.08), gy + 0.008, 0, 0.014);
        if (band >= 5) { const wg = mesh(cone, gold, wpn, true); place(wg, s * 0.085, gy + 0.045, 0, 0.012, 0.075, 0.01); wg.rotation.z = -s * 0.5; }
      });
      place(mesh(cyl, mats.dark, wpn), 0, palmY, 0, 0.0185, 0.15, 0.0185);
      for (let i = 0; i < 4; i++) place(mesh(cyl, trim, wpn), 0, palmY - 0.05 + i * 0.033, 0, 0.0195, 0.006, 0.0195);
      place(mesh(sph, gold, wpn, true), 0, palmY + 0.092, 0, 0.026, 0.024, 0.026);
      const gemS = mesh(ico, accGlow, wpn); place(gemS, 0, gy + 0.008, th * 0.8 + 0.012, 0.012, 0.016, 0.01);
      if (band >= 5) {
        const rune = (y: number, w: number) => place(mesh(box, accGlow, wpn), 0, y, th * 0.55 + 0.001, w, 0.005, 0.002);
        for (let i = 0; i < 5; i++) rune(gy - 0.09 - i * 0.09, 0.03 - (i % 2) * 0.012);
        const sw = glowMat(mats.accentHex, 0.1); const aura = mesh(sph, sw, wpn); place(aura, 0, gy - bl * 0.45, 0, 0.05, bl * 0.58, 0.05);
        anims.push((t) => { aura.scale.set(0.05 * (1 + 0.1 * Math.sin(t * 1.7)), bl * 0.58, 0.05); });
      }
    }
  }

  /* ---------------- BAND 3: cape, bracers, brooch, belt + pouches ---------------- */
  /** wrapped, deformable two-sided cloth hanging from the shoulders */
  const makeCape = (H: number, flare: number, lining: THREE.Material, scallop: boolean, amp: number) => {
    const Cc = 16, RR = 14, thMax = band >= 4 ? 1.2 : 1.08;
    const A = d.shoulderW / 2 + armRw * 0.4 + FIT, B = b + 0.035;
    const yTop = d.neckY - 0.03;
    const mk = (flip: boolean) => {
      const geo = G(new THREE.PlaneGeometry(1, 1, Cc, RR));
      if (flip) { const ix = geo.index!; for (let i = 0; i < ix.count; i += 3) { const t0 = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, t0); } }
      return { geo, base: Float32Array.from(geo.attributes.position.array as Float32Array), off: flip ? 0 : 0.007 };
    };
    const outer = mk(false), inner = mk(true);
    const mo = (mats.cloth as THREE.MeshStandardMaterial).clone(); mo.side = THREE.FrontSide; own.push(mo);
    const mi = (lining as THREE.MeshStandardMaterial).clone(); own.push(mi);
    const cape = new THREE.Group(); fBack.add(cape);
    const m1 = new THREE.Mesh(outer.geo, mo), m2 = new THREE.Mesh(inner.geo, mi); cape.add(m1, m2);
    m1.frustumCulled = m2.frustumCulled = false;
    const bottomY = yTop - H;
    const deform = (t: number) => {
      for (const part of [outer, inner]) {
        const p = part.geo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) {
          const u = part.base[i * 3] + 0.5, v = 0.5 - part.base[i * 3 + 1];            // u 0..1 across, v 0 top .. 1 bottom
          const th = (u - 0.5) * 2 * thMax;
          const y0 = yTop - 0.045 * Math.abs(u - 0.5) * 2 ** 1.5 * (1 - v) - v * H + (scallop && v > 0.99 ? -0.04 * (Math.round(u * Cc) % 2) : 0);
          const bodyZ = R(clamp(y0, d.hipY - 0.1, d.neckY))[1] + 0.03 + FIT * 0.5;
          const Bv = Math.max(B, bodyZ) + (part.off ? 0 : 0.0) - (part.off ? 0 : 0.008);
          const Av = A * (1 + flare * v) - (part.off ? 0 : 0.008);
          const swayV = v ** 1.4 * amp;
          const sw = (Math.sin(t * 1.25 - v * 2.4) * 0.5 + Math.sin(t * 0.7 + v * 1.3) * 0.25 + 0.3) * swayV;
          const fold = Math.sin(u * 14 + t * 0.8) * 0.012 * v;
          const x = Math.sin(th) * Av + Math.sin(t * 0.9 + v * 2.2) * 0.012 * v * (u - 0.5);
          const z = zc - Math.cos(th) * Bv - 0.1 * v * v * (band >= 4 ? 1 : 0.4) - sw - fold + (part.off ? 0.0 : 0);
          p.setXYZ(i, x, y0, z);
        }
        p.needsUpdate = true; part.geo.computeVertexNormals();
      }
    };
    void bottomY; deform(0.6);
    anims.push(deform);
  };
  if (band >= 3 && band < 4) makeCape(d.height * 0.26, 0.35, mats.accent, true, 0.045);

  const vambrace = (s0: number, s1: number, plate: THREE.Material, edge: THREE.Material, rW: number, flareEnd = false) => {
    limbs.forEach((L) => {
      const fr = foreFrame(L.s);
      const rE = armRw * 0.7 + FIT * 0.55, rW2 = armRw * 0.48 + FIT * 0.55 + (flareEnd ? 0.01 : 0);
      const pa = L.el.clone().lerp(L.wr, s0), pb = L.el.clone().lerp(L.wr, s1);
      const ra = lerp(rE, rW2, s0), rb = lerp(rE, rW2, s1);
      seg(fr, taper(ra, rb, 16), plate, pa, pb, true);
      [pa, pb].forEach((p, i) => { const ring = seg(fr, taper((i ? rb : ra) + 0.005, (i ? rb : ra) + 0.005, 16), edge, p.clone().addScaledVector(pb.clone().sub(pa).normalize(), i ? -0.008 : 0.008), p.clone().addScaledVector(pb.clone().sub(pa).normalize(), i ? 0.008 : -0.008)); void ring; });
    });
    void rW;
  };
  if (band === 3) vambrace(0.42, 0.97, mats.dark, mats.accent, 1);
  if (band >= 3 && band < 4) {
    // leaf brooch holding the mantle, gem glow follows pct
    const gy = d.neckY - 0.065, gz = surfZ(0, gy, 1, FIT * 0.8) + zc;
    const br = new THREE.Group(); br.position.set(0, gy, gz + 0.004); fT.add(br);
    const lf = mesh(leafG, mats.metal, br, true); place(lf, 0, -0.012, 0, 0.022, 0.05, 0.008); lf.rotation.z = 0.0;
    const lf2 = mesh(leafG, mats.accent, br); place(lf2, 0, -0.012, 0.006, 0.014, 0.036, 0.006);
    const gem = mesh(ico, mats.accent, br, true); place(gem, 0, 0.012, 0.012, 0.011, 0.014, 0.01);
    const halo = glowMat(mats.accentHex, 0.22 + 0.55 * clamp(state.pct, 0, 1)); const gh = mesh(sph, halo, br); place(gh, 0, 0.012, 0.014, 0.03);
    anims.push((t) => gh.scale.setScalar(0.03 * (1 + 0.15 * Math.sin(t * 2))));
  }
  if (band >= 3) {
    // belt with pouches
    const wy = d.waistY;
    mesh(shell(1, FIT * 0.9, wy - 0.027, wy + 0.027, 4), mats.dark, hips, true);
    place(mesh(box, band >= 4 ? gold : mats.metal, hips, true), 0, wy, surfZ(0, wy, 1, FIT * 0.9) + 0.008, 0.055, 0.05, 0.016);
    if (band >= 4) place(mesh(ico, trim, hips), 0, wy, surfZ(0, wy, 1, FIT * 0.9) + 0.018, 0.012);
    ringPts(wy - 0.01, 1, FIT * 0.9 + 0.012, 24).forEach((pt, i) => {
      if (!(i === 5 || i === 19 || i === 12)) return;
      const pc = place(mesh(box, mats.cloth2, hips, true), pt.x, wy - 0.06, pt.z, 0.06, 0.08, 0.04); pc.rotation.y = pt.an;
      const fl = place(mesh(box, mats.dark, hips), pt.x * 1.0, wy - 0.025, pt.z, 0.064, 0.026, 0.044); fl.rotation.y = pt.an;
      void fl;
    });
  }

  /* ---------------- BAND 4: pauldrons, plate, gauntlets, greaves, circlet, full cape ---------------- */
  if (band >= 4) {
    // chest plate with ridge and gem
    const top = d.chestY + 0.1, bot = d.waistY + 0.015;
    mesh(shell(1.0, PM, bot, top, 16), gold, torso, true);
    const flo = mesh(shell(1.0, FIT * 1.25, d.waistY - 0.17, d.waistY + 0.02, 8), mats.metal, hips, true); void flo;
    const ridge = d.chestY + 0.0;
    const rg = G(new THREE.BoxGeometry(0.02, 1, 0.014));
    const rd = mesh(rg, trim, torso, true); place(rd, 0, (ridge + bot) / 2, surfZ(0, ridge, 1, PM) + 0.003, 1, ridge - bot + 0.04, 1);
    // pectoral ridges
    ([1, -1]).forEach((s) => {
      const y1 = d.chestY + 0.07, y2 = d.chestY - 0.01;
      const pr = mesh(rg, trim, torso); place(pr, s * a * 0.4, (y1 + y2) / 2, surfZ(s * a * 0.4, (y1 + y2) / 2, 1, PM) + 0.002, 0.7, y1 - y2, 0.8); pr.rotation.z = s * 0.35;
    });
    const gy = d.chestY + 0.045, gz = surfZ(0, gy, 1, PM) + 0.012;
    place(mesh(ico, mats.accent, torso, true), 0, gy, gz, 0.028, 0.038, 0.02);
    const halo = glowMat(mats.accentHex, 0.22 + 0.55 * clamp(state.pct, 0, 1)); const gh = mesh(sph, halo, torso); place(gh, 0, gy, gz + 0.008, 0.055);
    anims.push((t) => gh.scale.setScalar(0.055 * (1 + 0.15 * Math.sin(t * 2))));
    // gorget ring at the collar
    const ring = mesh(torusGeo(1, 0.1, 22), gold, torso, true);
    place(ring, 0, d.neckY - 0.03, 0.0, neckR * 1.9 + 0.025, neckR * 1.9 + 0.025, neckR * 1.2); ring.rotation.x = Math.PI / 2;

    // large layered pauldrons
    limbs.forEach((L) => {
      const g = new THREE.Group(); g.position.copy(L.sh).add(V(L.s * 0.015, 0.045, 0)); g.scale.x = L.s; shFrame(L.s).add(g);
      const rr = clamp(d.shoulderW * 0.29, 0.1, 0.14);
      const tilt = -0.42, cH = Math.cos(Math.PI / 2 * 0.86);
      const lay = (r: number, y: number, h: number, mat: THREE.Material, trimMat: THREE.Material) => {
        const pv = new THREE.Group(); pv.position.set(0.012, y, 0); pv.rotation.z = tilt; g.add(pv);
        const m = mesh(hemiG, mat, pv, true); place(m, 0, 0, 0, r * 1.1, h, r);
        const rim = mesh(torusGeo(1, 0.03, 24), trimMat, pv); place(rim, 0, cH * h, 0, r * 1.1 * 0.975, r * 0.975, r * 0.9); rim.rotation.x = Math.PI / 2;
      };
      lay(rr * 1.0, 0.02, rr * 0.78, gold, trim);
      lay(rr * 1.13, -0.028, rr * 0.7, mats.metal, trim);
      lay(rr * 1.26, -0.075, rr * 0.62, gold, trim);
      place(mesh(ico, mats.accent, g, true), 0.045, rr * 0.8 + 0.03, 0, 0.022, 0.024, 0.022);
      if (band >= 5) {
        for (let i = 0; i < 3; i++) { const sp = mesh(leafG, i === 1 ? mats.accent : mats.metal, g, true); place(sp, 0.01 + i * 0.05, rr * 0.8 + 0.05 - i * 0.012, 0, 0.016, 0.075 - i * 0.012, 0.011); sp.rotation.z = -0.1 - i * 0.45; }
      }
    });

    // vambraces, gauntlets
    vambrace(0.06, 0.98, gold, trim, 1, true);
    limbs.forEach((L) => {
      const fr = handFrame(L.s);
      const dir = L.hd.clone().sub(L.wr).normalize();
      const out = V(L.s, 0, 0);
      const gp = L.wr.clone().lerp(L.hd, 0.7).addScaledVector(out, 0.034);
      const pl = mesh(box, mats.metal, fr, true); place(pl, gp.x, gp.y, gp.z, 0.014, 0.1, 0.075); pl.quaternion.setFromUnitVectors(UP, dir);
      const kn = mesh(cyl, trim, fr); place(kn, gp.x + L.s * 0.007, gp.y - 0.02, gp.z, 0.006, 0.075, 0.006); kn.rotation.x = Math.PI / 2;
      const cuff = seg(fr, taper(armRw * 0.48 + FIT * 0.55 + 0.026, armRw * 0.48 + FIT * 0.55 + 0.01, 16), gold, L.wr.clone().addScaledVector(dir, -0.03), L.wr.clone().addScaledVector(dir, 0.022), true); void cuff;
    });

    // greaves and knee guards
    limbs.forEach((L) => {
      const fr = shinFrame(L.s);
      const rT = d.legR * 0.56 + 0.014, rB = d.legR * 0.43 + 0.012;
      const top2 = L.kn.clone().lerp(L.an, 0.09), bot2 = L.kn.clone().lerp(L.an, 0.78);
      seg(fr, taper(rT, rB, 16), mats.metal, top2, bot2, true);
      seg(fr, taper(rB + 0.006, rB + 0.006, 16), trim, bot2.clone().add(V(0, 0.012, 0)), bot2.clone().add(V(0, -0.012, 0)));
      seg(fr, taper(rT + 0.006, rT + 0.006, 16), trim, top2.clone().add(V(0, 0.014, 0)), top2.clone().add(V(0, -0.012, 0)));
      const kc = mesh(sph, gold, fr, true); place(kc, L.kn.x, L.kn.y + 0.005, L.kn.z + d.legR * 0.45, d.legR * 0.62, d.legR * 0.55, d.legR * 0.45);
    });

    // circlet
    const hs = d.headR / 0.1;
    const circY = headC.y + d.headR * 0.5, cr = d.headR * 1.02 + 0.008;
    const circ = mesh(G(new THREE.TorusGeometry(1, 0.075, 6, 36)), gold, fHead, true); place(circ, headC.x, circY, headC.z - 0.006, cr, cr * 1.07, cr * 0.8); circ.rotation.x = Math.PI / 2 + 0.12; circ.scale.z = 0.1 * hs * 2;
    circ.scale.set(cr, cr * 1.08, 0.016 * hs);
    place(mesh(ico, mats.accent, fHead, true), headC.x, circY + 0.012, headC.z + cr * 1.08, 0.014 * hs, 0.022 * hs, 0.012 * hs);
    [-1, 1].forEach((s) => { const w = mesh(leafG, trim, fHead); place(w, headC.x + s * cr * 0.86, circY + 0.018, headC.z + cr * 0.6, 0.008, 0.032, 0.006); w.rotation.z = -s * 0.3; });

    makeCape(d.height * 0.5, 0.5, mats.accent, false, 0.07);
  }

  /* ---------------- forearm rune lines (band 4, extended at 5) ---------------- */
  if (band >= 4) {
    const runeM = glowMat(mats.stat.discipline, 0.95);
    limbs.forEach((L) => {
      const fr = foreFrame(L.s);
      const axis = L.wr.clone().sub(L.el).normalize();
      const ref = V(L.s * 0.8, 0.0, 0.6).normalize();
      const side0 = ref.clone().addScaledVector(axis, -ref.dot(axis)).normalize();       // outward-forward, perpendicular to the forearm
      const side1 = axis.clone().cross(side0);
      const line = (ang: number, s0: number, s1: number, rOff: number, tube = 0.0032) => {
        const n = 12, pts: THREE.Vector3[] = [];
        for (let i = 0; i <= n; i++) {
          const s = lerp(s0, s1, i / n);
          const r = lerp(armRw * 0.7 + FIT * 0.55, armRw * 0.48 + FIT * 0.55 + 0.01, s) + rOff + (i % 2 && band >= 5 ? 0.0015 : 0);
          const dir = side0.clone().multiplyScalar(Math.cos(ang)).addScaledVector(side1, Math.sin(ang));
          pts.push(L.el.clone().lerp(L.wr, s).addScaledVector(dir, r));
        }
        mesh(G(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, tube, 4)), runeM, fr);
      };
      line(-0.45, 0.14, 0.95, 0.008); line(0.45, 0.14, 0.95, 0.008);
      for (let i = 0; i < 4; i++) {                               // little cross ticks
        const s = 0.25 + i * 0.18, dir = side0.clone();
        const c = L.el.clone().lerp(L.wr, s).addScaledVector(dir, lerp(armRw * 0.7, armRw * 0.48, s) + FIT * 0.55 + 0.01);
        const tk = mesh(box, runeM, fr); place(tk, c.x, c.y, c.z, 0.004, 0.004, 0.004);
        tk.scale.set(0.034, 0.004, 0.004); tk.quaternion.setFromUnitVectors(V(1, 0, 0), side1);
      }
      if (band >= 5) {
        line(0, 0.02, 1.0, 0.01, 0.0042); line(Math.PI, 0.14, 0.9, 0.008);
        // continue up the upper arm
        const ua = L.sh.clone().lerp(L.el, 0.18), ub = L.el.clone().lerp(L.sh, 0.05);
        const pts = [ua, ua.clone().lerp(ub, 0.5), ub].map((p, i) => p.clone().addScaledVector(side0, armRw * (i === 1 ? 1.25 : 1.2) + 0.008 + FIT * 0.5));
        mesh(G(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.0035, 4)), runeM, upFrame(L.s));
      }
    });
    anims.push((t) => { runeM.opacity = 0.8 + 0.15 * Math.sin(t * 2.2); });
  }

  /* ---------------- BAND 5: laurel, wings, runes, aura ---------------- */
  if (band >= 5) {
    const hs = d.headR / 0.1;
    const laurel = new THREE.Group(); fHead.add(laurel); laurel.position.copy(headC); laurel.position.y += d.headR * 0.62;
    const n = 24;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2; if (Math.cos(ang) < -0.55) continue;                        // open at the back centre
      const rx = d.headR * 1.04 + 0.01, rz = d.headR * 1.12 + 0.01;
      const lf = mesh(leafG, i % 2 ? mats.accent : mats.cloth2, laurel, true);
      place(lf, Math.sin(ang) * rx, 0.012 * Math.cos(ang * 2) + 0.012, Math.cos(ang) * rz, 0.03 * hs, 0.008 * hs, 0.013 * hs);
      lf.rotation.set(0, ang, i % 2 ? 0.45 : -0.45);
    }
    const vine = mesh(G(new THREE.TorusGeometry(1, 0.03, 4, 36)), gold, laurel); place(vine, 0, 0.008, -0.004, d.headR * 1.04 + 0.006, d.headR * 1.1 + 0.006, d.headR * 0.25 * 0.2); vine.rotation.x = Math.PI / 2;
    vine.scale.set(d.headR * 1.04 + 0.006, d.headR * 1.1 + 0.006, 0.008);

    // runes on the chest plate
    const runes = new THREE.Group(); torso.add(runes);
    const u = 0.011, pm = PM;
    const bar = (x: number, y: number, w: number, h: number, rot = 0) => { const m = mesh(box, accGlow, runes); place(m, x, y, surfZ(x, y, 1, pm) + 0.004, w, h, 0.004); m.rotation.z = rot; };
    for (let i = 0; i < 3; i++) { const x = (i - 1) * a * 0.5, y = d.chestY + 0.007; bar(x, y, u, u * 5); bar(x + u * 1.8, y + u * 1.4, u * 3.2, u, 0.5); bar(x - u * 1.8, y - u * 1.2, u * 3.2, u, -0.5); }
    for (let i = 0; i < 2; i++) { const x = (i - 0.5) * a * 0.7, y = d.chestY - 0.07; bar(x, y, u * 4, u); bar(x, y - u * 2, u * 2.4, u); }
    anims.push((t) => { accGlow.opacity = 0.6 + 0.25 * Math.sin(t * 1.6); });

    // wings: layered leaf-feather cards, additive in dark themes, alpha-blended in light themes
    const featherGeo = (len: number, w: number, c0: number, c1: number, a0: number, a1: number) => {
      const cols = 3, rows = 7;
      const pos: number[] = [], col: number[] = [], idx: number[] = [];
      const A0 = new THREE.Color(c0), A1 = new THREE.Color(c1), cc = new THREE.Color();
      for (let j = 0; j <= rows; j++) {
        const v = j / rows, half = w * Math.pow(Math.sin(Math.PI * Math.min(1, Math.pow(0.1 + 0.9 * v, 0.7))), 0.55) * 0.5 * (j === rows ? 0 : 1);
        cc.copy(A0).lerp(A1, v);
        for (let i = 0; i <= cols - 1; i++) {
          const x = (i / (cols - 1) - 0.5) * 2 * half;
          pos.push(x, v * len, -Math.abs(x) * 0.25); col.push(cc.r, cc.g, cc.b, lerp(a0, a1, v) * (1 - 0.35 * Math.abs(i / (cols - 1) - 0.5) * 2 * (1 - v)));
        }
      }
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols - 1; i++) { const p = j * cols + i; idx.push(p, p + 1, p + cols, p + 1, p + cols + 1, p + cols); }
      const g = G(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4)); g.setIndex(idx); return g;
    };
    const wingMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false, blending: ADD ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: ADD ? 0.8 : 0.92 }); own.push(wingMat);
    const hi = whiten(mats.accentHex, 0.55);
    const rowsDef = [
      { n: 9, len: 0.95, w: 0.26, g: featherGeo(1, 1, mats.accent2Hex, mats.accentHex, 0.95, 0.3), a0: -52, a1: 68, z: 0 },
      { n: 8, len: 0.66, w: 0.22, g: featherGeo(1, 1, mats.accentHex, hi, 0.95, 0.4), a0: -38, a1: 76, z: 0.004 },
      { n: 6, len: 0.38, w: 0.18, g: featherGeo(1, 1, hi, whiten(mats.accentHex, 0.8), 0.9, 0.5), a0: -18, a1: 84, z: 0.008 },
    ];
    const wings: { g: THREE.Group; s: number; feathers: THREE.Group[] }[] = [];
    ([1, -1] as const).forEach((s) => {
      const wg = new THREE.Group(); wg.position.set(s * 0.09, d.neckY - 0.1, zc - b - 0.085 * sc); fBack.add(wg);
      const inner = new THREE.Group(); wg.add(inner); inner.scale.x = s;
      const feathers: THREE.Group[] = [];
      rowsDef.forEach((r, ri) => {
        for (let i = 0; i < r.n; i++) {
          const u2 = i / (r.n - 1), phi = THREE.MathUtils.degToRad(lerp(r.a1, r.a0, u2));       // from the upright feather (a1) to the low outer (a0)
          const fl = r.len * sc * (0.72 + 0.28 * Math.sin(Math.PI * clamp(u2 * 0.85 + 0.12, 0, 1)));
          const pv = new THREE.Group(); pv.rotation.z = phi - Math.PI / 2; pv.position.z = r.z + i * 0.0015; inner.add(pv); feathers.push(pv);
          const f = new THREE.Mesh(r.g, wingMat); f.scale.set(r.w * sc * (0.9 + 0.25 * u2), fl, 1); f.rotation.x = -0.12; f.frustumCulled = false; pv.add(f);
          void ri;
        }
      });
      wings.push({ g: wg, s, feathers });
    });
    const flap = (t: number) => wings.forEach((w) => {
      const fl = Math.sin(t * 0.9) * 0.5 + 0.5;
      w.g.rotation.y = w.s * (0.22 + 0.1 * fl); w.g.rotation.z = w.s * -0.04 * fl;
      w.feathers.forEach((f, i) => { f.rotation.x = Math.sin(t * 1.1 + i * 0.45) * 0.04; });
    });
    flap(0.7); anims.push(flap);

    // soft aura
    const auraG = G(new THREE.SphereGeometry(1, 24, 14));
    const mkAura = (hex: number, op: number) => { const m = mesh(auraG, glowMat(hex, op, { side: THREE.BackSide }), F(S.waist)); m.position.set(0, d.chestY - 0.25 * sc, zc); return m; };
    const aura = mkAura(mats.accentHex, 0.06), aura2 = mkAura(whiten(mats.accentHex, 0.5), 0.045);
    anims.push((t) => { const s = 1 + 0.03 * Math.sin(t * 1.2); aura.scale.set(0.62 * s, 1.12 * s * sc, 0.5 * s); aura2.scale.set(0.5 * s, 0.98 * s * sc, 0.4 * s); });
  }

  /* ---------------- MIND ---------------- */
  const mTier = tierOf(state.stats.mind, MIND_TIERS);
  if (mTier >= 1) {
    const tome = (): THREE.Group => {
      const g = new THREE.Group(); const w = 0.17, h = 0.23, th = 0.045;
      place(mesh(box, mats.accent, g, true), 0, 0, th * 0.5, w, h, th * 0.25);
      place(mesh(box, mats.accent, g), 0, 0, -th * 0.5, w, h, th * 0.25);
      place(mesh(box, mats.cloth2, g), 0.004, 0, 0, w * 0.93, h * 0.95, th * 0.7);
      place(mesh(box, mats.metal, g), -w / 2, 0, 0, 0.012, h * 1.01, th * 1.1);
      place(mesh(ico, mind, g), 0, 0.02, th * 0.65, w * 0.12, w * 0.12, 0.004);
      place(mesh(torusGeo(1, 0.07, 20), mind, g), 0, 0.02, th * 0.65, w * 0.27, w * 0.27, w * 0.27 * 0.3);
      place(mesh(box, mindSoft, g), 0, -h * 0.28, th * 0.65, w * 0.55, 0.006, 0.003);
      place(mesh(sph, mindSoft, g), 0, 0, th * 0.9, w * 0.45, w * 0.55, 0.01);
      return g;
    };
    const orbit = new THREE.Group(); orbit.position.copy(headC); fHead.add(orbit);
    const books: { g: THREE.Group; r: number; sp: number; ph: number; y: number }[] = [];
    const wide = Math.max(d.shoulderW, 0.45) * 0.15 + (band >= 5 ? 0.25 : 0);
    for (let i = 0; i < mTier; i++) {
      const g = tome(); orbit.add(g);
      books.push({ g, r: 0.34 + i * 0.06 + wide, sp: (0.38 + 0.07 * i) * (i % 2 ? -1 : 1), ph: (i / mTier) * Math.PI * 2 + 0.6, y: 0.02 + i * 0.07 - 0.1 });
    }
    anims.push((t) => books.forEach((bk, i) => {
      const ang = bk.ph + t * bk.sp;
      bk.g.position.set(Math.cos(ang) * bk.r, bk.y + Math.sin(t * 0.9 + i * 2) * 0.035, Math.sin(ang) * bk.r);
      bk.g.rotation.set(0.12 * Math.sin(t * 0.7 + i), Math.PI / 2 - ang, 0.1 * Math.sin(t * 0.5 + i * 2));
    }));
    if (mTier >= 2) {
      const halo = new THREE.Group(); const hy = headC.y + d.headR + (band >= 4 ? 0.12 : 0.1); halo.position.set(headC.x, hy, headC.z); fHead.add(halo);
      const r = d.headR * 1.5 + (band >= 5 ? 0.03 : 0);
      const hh = mesh(torusGeo(r, 0.012, 56), mind, halo); hh.rotation.x = Math.PI / 2;
      const hh2 = mesh(torusGeo(r, 0.035, 56), mindSoft, halo); hh2.rotation.x = Math.PI / 2; hh2.scale.z = 0.3;
      for (let i = 0; i < 6; i++) { const an = (i / 6) * Math.PI * 2; place(mesh(ico, mind, halo), Math.cos(an) * r, 0, Math.sin(an) * r, 0.011); }
      anims.push((t) => { halo.position.y = hy + Math.sin(t * 1.4) * 0.008; halo.rotation.y = t * 0.6; });
    }
    if (mTier >= 3) {
      const rings = new THREE.Group(); rings.position.set(headC.x, headC.y - 0.15, headC.z); fHead.add(rings);
      const mk = (r: number, tilt: number, tilt2: number) => {
        const g = new THREE.Group(); g.rotation.set(tilt, 0, tilt2);
        mesh(torusGeo(r, 0.004, 64), mindSoft, g).rotation.x = Math.PI / 2;
        for (let i = 0; i < 9; i++) { const an = (i / 9) * Math.PI * 2 + i * 0.3; place(mesh(ico, mind, g), Math.cos(an) * r, 0, Math.sin(an) * r, i % 3 ? 0.009 : 0.017); }
        const sp = new THREE.Group(); sp.add(g); rings.add(sp); return sp;
      };
      const rw = Math.max(d.shoulderW, 0.45) * 0.1 + (band >= 5 ? 0.2 : 0);
      const r1 = mk(0.46 + rw, 0.35, 0.1), r2 = mk(0.56 + rw, -0.4, 0.25);
      anims.push((t) => { r1.rotation.y = t * 0.25; r2.rotation.y = -t * 0.18; });
    }
  }

  /* ---------------- SKILL ---------------- */
  const sTier = tierOf(state.stats.skill, SKILL_TIERS);
  if (sTier >= 1) {
    const panel = (w: number, h: number, lines: number, seed: number) => {
      const g = new THREE.Group();
      place(mesh(box, mats.dark, g), 0, 0, 0, w, h, 0.006);
      place(mesh(box, skillSoft, g), 0, 0, 0.004, w * 0.98, h * 0.98, 0.001);
      ([[0, h / 2, w, 0.006], [0, -h / 2, w, 0.006], [w / 2, 0, 0.006, h], [-w / 2, 0, 0.006, h]]).forEach((f) => place(mesh(box, skill, g), f[0], f[1], 0.005, f[2], f[3], 0.003));
      for (let i = 0; i < lines; i++) {
        const rr = Math.abs(Math.sin(seed * 7.3 + i * 12.9)); const ind = (i % 3) * 0.06 * w; const lw = w * (0.25 + 0.5 * rr);
        place(mesh(box, skill, g), -w / 2 + w * 0.08 + ind + lw / 2, h / 2 - h * 0.14 - (i * h * 0.72) / Math.max(1, lines - 1), 0.006, lw, Math.max(0.005, h * 0.03), 0.002);
      }
      return g;
    };
    const big = sTier >= 2;
    const tw = big ? 0.34 : 0.24, th = big ? 0.24 : 0.17;
    const tab = new THREE.Group(); const p = panel(tw, th, big ? 8 : 3, 1); tab.add(p);
    if (!big) place(mesh(torusGeo(1, 0.07, 24), skill, p), 0, -th * 0.1, 0.006, th * 0.2);
    const hdL = limbs[0].hd;
    const anchor = new THREE.Group(); anchor.position.copy(hdL); handFrame(1).add(anchor);
    tab.position.set(0.2, 0.17, 0.13); anchor.add(tab);
    const beam = mesh(cone, skillSoft, anchor); place(beam, 0.06, 0.05, 0.045, 0.028, 0.14, 0.028); beam.rotation.set(0, 0, -1.15);
    const panels: THREE.Group[] = [];
    if (sTier >= 3) {
      [-1, 1].forEach((s2, i) => { const pn = panel(0.13, 0.18, 5, 3 + i); pn.position.set(s2 * (tw / 2 + 0.11), s2 * 0.02, 0.02); pn.rotation.y = s2 * -0.5; tab.add(pn); panels.push(pn); });
      const belt = new THREE.Group(); hips.add(belt); const yb = d.hipY - 0.01;
      const bm = band >= 4 ? FIT * 1.7 : FIT * 1.2;
      mesh(shell(1, bm, yb - 0.03, yb + 0.03, 4), mats.dark, belt, true);
      ringPts(yb, 1, bm, 36).forEach((pt, i) => {
        const frontness = Math.cos(pt.an); if (frontness < -0.3 || i % 3 !== 0) return;
        const pc = place(mesh(box, mats.cloth2, belt, true), pt.x, yb - 0.045, pt.z + 0.015 * Math.cos(pt.an), 0.05, 0.075, 0.035); pc.rotation.y = pt.an;
        if (i % 6 === 0) { const tl = place(mesh(box, mats.metal, belt), pt.x * 1.02, yb + 0.02, pt.z * 1.02 + 0.02, 0.012, 0.12, 0.012); tl.rotation.y = pt.an; }
        else { const tl = place(mesh(cyl, skill, belt), pt.x * 1.02, yb - 0.01, pt.z * 1.02 + 0.03, 0.011, 0.025, 0.011); tl.rotation.set(Math.PI / 2, pt.an, 0); }
      });
    }
    anims.push((t) => {
      anchor.position.y = hdL.y + Math.sin(t * 1.2) * 0.012;
      tab.rotation.y = 0.55 + 0.08 * Math.sin(t * 0.7); tab.rotation.x = 0.05 * Math.sin(t * 0.9);
      panels.forEach((pn, i) => { pn.position.y = (i ? 1 : -1) * 0.02 + Math.sin(t * 1.4 + i * 2) * 0.012; });
      skill.opacity = 0.8 + 0.1 * Math.sin(t * 3);
    });
  }

  /* ---------------- DISCIPLINE ---------------- */
  const dTier = tierOf(state.stats.discipline, DISC_TIERS);
  if (dTier >= 1) {
    const ringG = new THREE.Group(); F(S.floor).add(ringG);
    const ringFill = glowMat(mats.stat.discipline, 0.12, { side: THREE.DoubleSide });
    const mk = (r: number, y: number, ticks = 28) => {
      const g = new THREE.Group(); g.position.set(0, y, zc);
      mesh(torusGeo(r, 0.01, 72), disc, g).rotation.x = Math.PI / 2;
      mesh(torusGeo(r * 0.9, 0.005, 72), discSoft, g).rotation.x = Math.PI / 2;
      mesh(G(new THREE.RingGeometry(r * 0.9, r, 64, 1)), ringFill, g).rotation.x = -Math.PI / 2;
      for (let i = 0; i < ticks; i++) {
        const an = (i / ticks) * Math.PI * 2; const long = i % 4 === 0;
        const tk = place(mesh(box, disc, g), Math.cos(an) * r * (long ? 0.86 : 0.93), 0, Math.sin(an) * r * (long ? 0.86 : 0.93), long ? 0.04 : 0.02, 0.006, long ? 0.012 : 0.008); tk.rotation.y = -an;
        if (i % 7 === 3) { const gl = place(mesh(box, disc, g), Math.cos(an) * r * 1.07, 0, Math.sin(an) * r * 1.07, 0.03, 0.006, 0.012); gl.rotation.y = -an + 0.5; }
      }
      ringG.add(g); return g;
    };
    const baseR = Math.max(d.hipW * 0.9, d.shoulderW * 0.55, 0.42) + 0.12 + (band >= 5 ? 0.12 : 0);
    const rs: { g: THREE.Group; sp: number; y0: number; amp: number }[] = [];
    rs.push({ g: mk(baseR * 1.1, 0.012), sp: 0.5, y0: 0.012, amp: 0 });
    if (dTier >= 2) rs.push({ g: mk(baseR * 0.92, 0.5 * sc, 22), sp: -0.7, y0: 0.5 * sc, amp: 0.05 });
    if (dTier >= 3) rs.push({ g: mk(baseR * 0.88, 1.12 * sc, 20), sp: 0.9, y0: 1.12 * sc, amp: 0.05 });
    anims.push((t) => rs.forEach((r, i) => { r.g.rotation.y = t * r.sp; r.g.position.y = r.y0 + (r.amp ? Math.sin(t * 1.1 + i * 2) * r.amp : 0); }));
    if (dTier >= 2) {
      limbs.forEach((L) => {
        const fr = shinFrame(L.s);
        if (band < 4) { const kc = mesh(sph, mats.metal, fr, true); place(kc, L.kn.x, L.kn.y + 0.005, L.kn.z + d.legR * 0.55, d.legR * 0.8, d.legR * 0.7, d.legR * 0.5); }
        place(mesh(ico, disc, fr), L.kn.x, L.kn.y + 0.005, L.kn.z + d.legR * 0.55 + d.legR * 0.62, 0.014);
      });
    }
    if (dTier >= 3) {
      const rb = new THREE.Group(); hips.add(rb); const yb = d.waistY + 0.075; const km = band >= 4 ? FIT * 1.5 : FIT * 1.1;
      mesh(shell(1, km, yb - 0.012, yb + 0.012, 3), discSoft, rb);
      ringPts(yb, 1, km, 16).forEach((pt) => { const m = place(mesh(box, disc, rb), pt.x * 1.01, yb, pt.z * 1.01, 0.02, 0.028, 0.006); m.rotation.y = pt.an; });
    }
  }

  /* ---------------- STREAK ---------------- */
  const stTier = tierOf(state.streak, STREAK_TIERS);
  if (stTier >= 1) {
    const mkTex = (w: number, h: number, fn: (i: number, j: number) => number) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d')!;
      const img = x.createImageData(w, h);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const o = (j * w + i) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = 255; img.data[o + 3] = Math.round(255 * clamp(fn(i / (w - 1), j / (h - 1)), 0, 1)); }
      x.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; texs.push(t); return t;
    };
    const dot = mkTex(64, 64, (u, v) => { const r = Math.hypot(u - 0.5, v - 0.5) * 2; return r >= 1 ? 0 : (1 - r) ** 1.6 + (r < 0.25 ? 0.3 : 0); });
    /* soft flame: teardrop with a gradient from a hot core to transparent rim; v = 0 top .. 1 bottom */
    const flameTex = mkTex(64, 128, (u, v) => {
      const h = 1 - v; const w = Math.pow(Math.sin(Math.PI * Math.pow(0.1 + 0.9 * h, 0.8)), 0.62) * (1 - 0.25 * h) * 0.5; const du = Math.abs(u - 0.5);
      if (w <= 0.001 || du >= w) return 0;
      const edge = 1 - du / w;
      return Math.pow(edge, 1.5) * Math.min(1, h * 5 + 0.2) * (1 - h * h * 0.4);
    });
    const cA = new THREE.Color(mats.accentHex), cB = new THREE.Color(mats.accent2Hex), cW = new THREE.Color(whiten(mats.accentHex, 0.5));
    const fireR = Math.max(d.hipW * 0.8, d.shoulderW * 0.5, 0.4) + 0.15;
    const fire = new THREE.Group(); fire.position.z = zc; F(S.floor).add(fire);

    const mkParticles = (n: number, rMin: number, rMax: number, rise: number, speed: number, size: number, seed: number) => {
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 4);
      const g = G(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 4));
      const m = new THREE.PointsMaterial({ size, map: dot, vertexColors: true, transparent: true, blending: ADD ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, sizeAttenuation: true }); own.push(m);
      const pts = new THREE.Points(g, m); pts.frustumCulled = false; fire.add(pts);
      const rnd = (i: number, k: number) => { const x = Math.sin((i + 1) * 12.9898 + k * 78.233 + seed) * 43758.5453; return x - Math.floor(x); };
      const tmp = new THREE.Color();
      const step = (t: number) => {
        for (let i = 0; i < n; i++) {
          const life = (t * speed * (0.6 + rnd(i, 1) * 0.8) + rnd(i, 2)) % 1;
          const ang = rnd(i, 3) * Math.PI * 2 + life * (rnd(i, 4) - 0.5) * 2.0;
          const r = rMin + (rMax - rMin) * rnd(i, 5) * (1 - life * 0.35);
          pos[i * 3] = Math.cos(ang) * r + Math.sin(t * 2 + i) * 0.02 * life;
          pos[i * 3 + 1] = 0.02 + life * rise * (0.55 + rnd(i, 6) * 0.45);
          pos[i * 3 + 2] = Math.sin(ang) * r;
          if (life < 0.2) tmp.copy(cW).lerp(cA, life / 0.2); else if (life < 0.6) tmp.copy(cA).lerp(cB, (life - 0.2) / 0.4); else tmp.copy(cB);
          col[i * 4] = tmp.r; col[i * 4 + 1] = tmp.g; col[i * 4 + 2] = tmp.b; col[i * 4 + 3] = Math.min(1, (1 - life) * 1.5) * 0.9;
        }
        g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
      };
      anims.push(step); step(0.37);
    };
    if (stTier === 1) mkParticles(22, 0.1, fireR * 0.9, 0.7, 0.3, 0.04, 1);
    if (stTier >= 2) mkParticles(stTier === 2 ? 36 : stTier === 3 ? 110 : 190, 0.12, fireR * 1.05, stTier === 2 ? 0.8 : stTier === 3 ? 1.5 : 2.0, stTier >= 3 ? 0.22 : 0.3, 0.045, 2);

    if (stTier >= 2) {
      const fm = (hex: number, op: number) => { const m = new THREE.MeshBasicMaterial({ map: flameTex, color: hex, transparent: true, opacity: op, blending: ADD ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }); own.push(m); return m; };
      const layers: [THREE.Material, number, number][] = [[fm(mats.accent2Hex, ADD ? 0.5 : 0.7), 1, 1], [fm(mats.accentHex, ADD ? 0.5 : 0.72), 0.72, 0.68], [fm(whiten(mats.accentHex, 0.45), ADD ? 0.42 : 0.6), 0.42, 0.4]];
      const qg = G(new THREE.PlaneGeometry(1, 1)); qg.translate(0, 0.5, 0);
      const nT = stTier === 2 ? 12 : 16, H = stTier === 2 ? 0.28 : stTier === 3 ? 0.5 : 0.62;
      const tufts: { g: THREE.Group; ph: number; h: number }[] = [];
      for (let rI = 0; rI < (stTier >= 3 ? 2 : 1); rI++) for (let i = 0; i < nT; i++) {
        const ang = ((i + rI * 0.5) / nT) * Math.PI * 2; const rr = fireR * (rI ? 0.78 : 1.0);
        const g = new THREE.Group(); g.position.set(Math.cos(ang) * rr, 0.01, Math.sin(ang) * rr); g.rotation.y = i * 2.1 + rI;
        for (let k = 0; k < 2; k++) layers.forEach(([m, hs, ws], li) => { const q = mesh(qg, m, g); place(q, 0, 0, li * 0.002, 0.8 * ws * hs * H, hs * H, 1); q.rotation.y = k * Math.PI / 2; });
        fire.add(g); tufts.push({ g, ph: i * 1.7 + rI * 3, h: 0.7 + 0.5 * Math.abs(Math.sin(i * 2.3 + rI)) });
      }
      anims.push((t) => tufts.forEach((f) => {
        const fl = f.h * (1 + 0.22 * Math.sin(t * 6 + f.ph) + 0.12 * Math.sin(t * 10.3 + f.ph * 2));
        f.g.scale.set(1 + 0.1 * Math.sin(t * 5 + f.ph), fl, 1 + 0.1 * Math.cos(t * 5 + f.ph));
        f.g.rotation.x = Math.sin(t * 3 + f.ph) * 0.07; f.g.rotation.z = Math.cos(t * 2.6 + f.ph) * 0.07;
      }));
      const gl = mesh(G(new THREE.CircleGeometry(fireR * 1.1, 32)), glowMat(mats.accentHex, 0.14, { side: THREE.DoubleSide }), fire); gl.rotation.x = -Math.PI / 2; gl.position.y = 0.006;
    }
    if (stTier >= 4) {
      const tex = mkTex(64, 256, (u, v) => { const uu = 1 - Math.abs(u - 0.5) * 2; return Math.max(0, uu) ** 1.4 * Math.min(1, v * 1.6) ** 1.5 * (v > 0.9 ? (1 - v) * 10 : 1) * 0.9; });
      const cols = new THREE.Group(); cols.position.set(0, 0, -0.32); fire.add(cols);
      const pg = G(new THREE.PlaneGeometry(1, 1)); pg.translate(0, 0.5, 0);
      const ms = [glowMat(mats.accent2Hex, 0.4, { map: tex, side: THREE.DoubleSide }), glowMat(mats.accentHex, 0.36, { map: tex, side: THREE.DoubleSide }), glowMat(whiten(mats.accentHex, 0.45), 0.32, { map: tex, side: THREE.DoubleSide })];
      const sizes = [[1.5, 2.5], [1.0, 2.1], [0.55, 1.6]];
      const pl: THREE.Mesh[] = [];
      ms.forEach((m, i) => { for (let k = 0; k < 2; k++) { const pm = mesh(pg, m, cols); pm.scale.set(sizes[i][0], sizes[i][1], 1); pm.rotation.y = k * 1.1 - 0.55; pm.position.z = i * -0.01; pl.push(pm); } });
      anims.push((t) => pl.forEach((pm, i) => { const s = 1 + 0.07 * Math.sin(t * 4 + i * 1.3) + 0.04 * Math.sin(t * 9 + i); pm.scale.y = sizes[Math.floor(i / 2)][1] * s; pm.rotation.y = (i % 2 ? 0.55 : -0.55) + Math.sin(t * 1.3 + i) * 0.25; }));
    }
  }

  const run = (t: number) => { for (const f of sway) f(t); for (const f of anims) f(t); };
  run(1.3);
  return {
    update: reduced ? () => {} : run,
    dispose() {
      objs.forEach((o) => o.parent?.remove(o));
      geos.forEach((g) => g.dispose());
      own.forEach((m) => m.dispose());
      texs.forEach((t) => t.dispose());
    },
  };
};
