/* gear.ts: everything the character wears, carries and emits.
   body.ts convention (verified): character faces +z, slot L is at +x. Slots follow joints; limb slots sit at segment centres,
   limbs hang along -y; slots.chest is at the chest front surface, slots.waist is the spine origin (y = waistY).
   Cloth for the torso is built in "world rest" coordinates: torsoRoot / hipRoot are groups offset so that their origin
   is the world origin at rest, which lets every piece use absolute y values from dims. */
import * as THREE from 'three';
import type { ApplyGear, AvatarRig, AvatarState, Dims, Materials } from './types';
import { DISC_TIERS, MIND_TIERS, SKILL_TIERS, STREAK_TIERS, tierOf } from './tiers';

/** x direction (in slot space) that points away from the body on the L side */
const OUT = 1;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

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
  const slotAdd = <T extends THREE.Object3D>(slot: THREE.Object3D, o: T): T => { slot.add(o); objs.push(o); return o; };
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent?: THREE.Object3D, outline = false) => {
    const me = new THREE.Mesh(g, m);
    if (parent) parent.add(me);
    if (outline) mats.addOutline(me);
    return me;
  };
  /* additive only where the theme's own glow is additive (dark mode); additive on light backgrounds washes the whole frame out */
  const ADD = (mats.glow as THREE.MeshBasicMaterial).blending === THREE.AdditiveBlending;
  const glowMat = (hex: number, opacity = 1, extra: THREE.MeshBasicMaterialParameters = {}) => {
    const m = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity, blending: ADD ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, toneMapped: false, ...extra });
    own.push(m); return m;
  };
  const whiten = (hex: number, k: number) => new THREE.Color(hex).lerp(new THREE.Color(0xffffff), k).getHex();
  const mind = glowMat(mats.stat.mind, 0.9), skill = glowMat(mats.stat.skill, 0.9), disc = glowMat(mats.stat.discipline, 0.9);
  const mindSoft = glowMat(mats.stat.mind, 0.3), skillSoft = glowMat(mats.stat.skill, 0.28), discSoft = glowMat(mats.stat.discipline, 0.3);
  const accGlow = glowMat(mats.accentHex, 0.85);

  const sc = d.height / 1.8;
  const upperLen = d.armLen * 0.536, foreLen = d.armLen * 0.464, thighLen = d.legLen * 0.506, shinLen = d.legLen * 0.494;
  const a = d.chestW / 2, b = d.chestD / 2;
  const bt = clamp((d.shoulderW - 0.44) / 0.18, 0, 1);            // body build 0..1, recovered from the shoulder width
  const neckR = lerp(0.045, 0.062, bt);
  const side = (L: THREE.Object3D, R: THREE.Object3D, build: (g: THREE.Group) => void) => {
    ([[L, OUT], [R, -OUT]] as [THREE.Object3D, number][]).forEach(([slot, s]) => { const g = new THREE.Group(); g.scale.x = s; build(g); slotAdd(slot, g); });
  };

  // shared unit geometries
  const cyl = G(new THREE.CylinderGeometry(1, 1, 1, 14));
  const sph = G(new THREE.SphereGeometry(1, 14, 10));
  const hemi = G(new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2));
  const box = G(new THREE.BoxGeometry(1, 1, 1));
  const ico = G(new THREE.IcosahedronGeometry(1, 0));
  const cone = G(new THREE.ConeGeometry(1, 1, 8));
  const torusGeo = (r: number, tube: number, seg = 40) => G(new THREE.TorusGeometry(r, tube, 6, seg));
  const taper = (rt: number, rb: number, seg = 14) => G(new THREE.CylinderGeometry(rt, rb, 1, seg));
  const place = <T extends THREE.Object3D>(m: T, x: number, y: number, z: number, sx = 1, sy = sx, sz = sx): T => { m.position.set(x, y, z); m.scale.set(sx, sy, sz); return m; };

  /* ---------- body silhouette: ellipse radii of the clothed torso at absolute height y ---------- */
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
    const f = clamp(1 - (((d.hipY - 0.02 - y) / 0.11) ** 2) * 0.45, 0.55, 1) * (y > d.hipY - 0.02 ? 1 : 1);
    const bg = Math.sqrt(Math.max(0, 1 - ((y - (d.waistY - 0.01)) / 0.11) ** 2));
    rz = Math.max(rz, b * 1.03 * bg); rx = Math.max(rx, d.waistW * 0.5 * 1.02 * bg);
    const hf = y <= 1.045 * sc ? 1 : Math.max(0, 1 - (y - 1.045 * sc) / 0.07);
    rx = Math.max(rx, hipRx0 * f * hf); rz = Math.max(rz, hipRz0 * f * hf);
    return [rx, rz];
  };
  const surfZ = (x: number, y: number, k: number) => { const [rx, rz] = R(y); return rz * k * Math.sqrt(Math.max(0.04, 1 - (x / (rx * k)) ** 2)); };

  /** open shell following the silhouette between y0 and y1, scaled by k, rx/rz grow by an absolute margin m */
  const shell = (k: number, y0: number, y1: number, rows = 18, m = 0) => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < rows; i++) pts.push(new THREE.Vector2(1, y0 + ((y1 - y0) * i) / (rows - 1)));
    const g = G(new THREE.LatheGeometry(pts, 24));
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const [rx, rz] = R(pts[i % rows].y);
      p.setXYZ(i, p.getX(i) * (rx * k + m), p.getY(i), p.getZ(i) * (rz * k + m));
    }
    g.computeVertexNormals();
    return g;
  };
  /** tilted loop hugging the torso (straps) */
  const strapGeo = (k: number, tilt: number, yc: number, tube: number) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 40; i++) {
      const ph = (i / 40) * Math.PI * 2; const y = yc + a * Math.cos(ph) * Math.tan(tilt);
      const [rx, rz] = R(y);
      pts.push(new THREE.Vector3(rx * k * Math.cos(ph), y, rz * k * Math.sin(ph)));
    }
    return G(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 64, tube, 5, true));
  };
  const ringPts = (y: number, k: number, n: number) => Array.from({ length: n }, (_, i) => { const an = (i / n) * Math.PI * 2; const [rx, rz] = R(y); return { x: Math.sin(an) * rx * k, z: Math.cos(an) * rz * k, an }; });

  /* world-origin frames */
  const torsoRoot = new THREE.Group(); torsoRoot.position.set(0, -(d.chestY + 0.06), -(d.chestD / 2 + 0.005)); slotAdd(S.chest, torsoRoot);
  const hipRoot = new THREE.Group(); hipRoot.position.set(0, -d.waistY, 0); slotAdd(S.waist, hipRoot);
  const backRoot = new THREE.Group(); backRoot.position.set(0, -(d.chestY + 0.12), 0); void backRoot;
  const waistTop = d.waistY, hipY = d.hipY;
  const gemK = band >= 4 ? 1.3 : 1.22;
  let tNow = 0;

  /* ---------------- BAND 1: tee, trousers, shoes ---------------- */
  mesh(shell(1.09, 0.965, d.chestY + 0.225), mats.cloth, torsoRoot, true);
  const neckTrim = mesh(G(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 16 }, (_, i) => { const ph = (i / 16) * Math.PI * 2; const [rx, rz] = R(d.chestY + 0.225); return new THREE.Vector3(Math.sin(ph) * rx * 1.09, d.chestY + 0.225, Math.cos(ph) * rz * 1.09); }), true), 24, 0.008, 4, true)), mats.cloth2, torsoRoot);
  void neckTrim;
  mesh(shell(1.13, hipY - 0.115, 1.03), mats.cloth2, hipRoot, true);

  const slvLen = band >= 2 ? upperLen * 1.02 : upperLen * 0.6;
  side(S.upperArmL, S.upperArmR, (g) => {
    const sl = mesh(taper(d.armR * 1.32, d.armR * (band >= 2 ? 1.05 : 1.12)), mats.cloth, g, true);
    place(sl, 0, upperLen / 2 - slvLen / 2 + 0.012, 0, 1, slvLen, 1);
    if (band < 2) { const cuff = mesh(cyl, mats.cloth2, g); place(cuff, 0, upperLen / 2 - slvLen + 0.012, 0, d.armR * 1.14, 0.018, d.armR * 1.14); }
  });
  side(S.shoulderL, S.shoulderR, (g) => { place(mesh(sph, mats.cloth, g, true), 0.004, 0.004, 0, d.armR * 1.34, d.armR * 1.3, d.armR * 1.3); });
  side(S.thighL, S.thighR, (g) => { place(mesh(taper(d.legR * 1.2, d.legR * 0.8), mats.cloth2, g, true), 0, 0.0, 0, 1, thighLen * 1.03, 1); });
  const shinShort = band >= 2 ? 0.17 : 0;
  side(S.shinL, S.shinR, (g) => {
    const L = shinLen - shinShort, f = L / shinLen;
    place(mesh(taper(d.legR * 1.0, lerp(d.legR * 1.0, d.legR * 0.8, f)), mats.cloth2, g, true), 0, shinLen / 2 - L / 2 + 0.01, 0, 1, L, 1);
  });
  side(S.footL, S.footR, (g) => {
    const col = band >= 2 ? mats.dark : mats.cloth;
    place(mesh(box, col, g, true), 0, 0.0, -0.01, 0.112, 0.07, 0.2);
    place(mesh(sph, col, g, true), 0, -0.012, 0.085, 0.056, 0.042, 0.06);
    place(mesh(box, mats.cloth2, g), 0, -0.027, 0.004, 0.118, 0.014, 0.245);
    if (band < 2) place(mesh(cyl, mats.cloth, g), 0, 0.045, -0.02, 0.05, 0.04, 0.05);
  });

  /* ---------------- BAND 2: hoodie, belt, boots, satchel ---------------- */
  if (band >= 2) {
    mesh(shell(1.15, hipY - 0.02, d.chestY + 0.225), mats.cloth, torsoRoot, true);
    // front pocket seam and drawcord for readability
    place(mesh(box, mats.cloth2, torsoRoot), 0, d.chestY - 0.16, surfZ(0, d.chestY - 0.16, 1.15) + 0.004, 0.17, 0.012, 0.008);
    // hood bunched behind the neck
    const hood = mesh(hemi, mats.cloth, S.neck, true); place(hood, 0, -0.04, -0.035, neckR * 3.0, neckR * 2.6, neckR * 2.2); hood.rotation.x = -1.0; objs.push(hood);
    const collar = mesh(G(new THREE.TorusGeometry(1, 0.2, 6, 18)), mats.cloth, S.neck, true); collar.rotation.x = Math.PI / 2 - 0.15; place(collar, 0, -0.02, 0, neckR * 1.9, neckR * 1.9, neckR * 1.4); collar.rotation.x = Math.PI / 2 - 0.2; objs.push(collar);
    side(S.forearmL, S.forearmR, (g) => {
      place(mesh(taper(d.armR * 1.1, 0.027 + 0.016), mats.cloth, g, true), 0, 0.0, 0, 1, foreLen * 1.0, 1);
      place(mesh(cyl, mats.cloth2, g), 0, -foreLen * 0.46, 0, 0.027 + 0.019, 0.026, 0.027 + 0.019);
    });
    side(S.shinL, S.shinR, (g) => {
      place(mesh(taper(0.063, 0.052), mats.dark, g, true), 0, -shinLen / 2 + 0.095, 0, 1, 0.19, 1);
      place(mesh(cyl, mats.cloth2, g), 0, -shinLen / 2 + 0.19, 0, 0.066, 0.016, 0.066);
    });
    const kb = band >= 4 ? 1.28 : 1.21;
    const belt = mesh(shell(kb, waistTop - 0.03, waistTop + 0.03, 4), mats.dark, hipRoot, true); void belt;
    place(mesh(box, mats.metal, hipRoot, true), 0, waistTop, R(waistTop)[1] * kb + 0.008, 0.055, 0.05, 0.016);
    // satchel: strap over the right shoulder, bag on the right hip
    const sk = band >= 4 ? 1.32 : band >= 3 ? 1.22 : 1.18;
    mesh(strapGeo(sk, -0.5 * OUT, d.chestY - 0.03, 0.013), mats.dark, torsoRoot, true);
    const bag = new THREE.Group();
    place(mesh(box, mats.cloth2, bag, true), 0, 0, 0, 0.065, 0.15, 0.17);
    place(mesh(box, mats.dark, bag, true), 0.004, 0.045, 0, 0.07, 0.06, 0.178);
    place(mesh(box, mats.metal, bag), 0.036, 0.012, 0, 0.012, 0.028, 0.03);
    bag.position.set(-OUT * (d.hipW / 2 * 1.04 * 1.12 + 0.045), d.hipY - 0.07 - d.waistY, -0.015); bag.rotation.z = -OUT * -0.06;
    slotAdd(S.waist, bag);
  }

  /* ---------------- BAND 3: light armour ---------------- */
  const armour = (g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, p: number[], s: number[], o = true) => place(mesh(geo, m, g, o), p[0], p[1], p[2], s[0], s[1], s[2]);
  if (band >= 3) {
    side(S.shoulderL, S.shoulderR, (g) => {
      const r = d.armR * 1.95;
      const cap = armour(g, hemi, mats.metal, [0.01, d.armR * 0.15, 0], [r * 1.18, r * 0.8, r * 1.1]); cap.rotation.z = -0.12;
      armour(g, taper(1, 1.02, 18), mats.accent, [0.012, d.armR * 0.15, 0], [r * 1.2, 0.012, r * 1.12]);
      armour(g, taper(0.97, 1.0, 18), mats.metal, [0.016, -0.025, 0], [r * 1.12, 0.05, r * 1.04]);
    });
    side(S.forearmL, S.forearmR, (g) => {
      armour(g, taper(d.armR * 1.0 + 0.005, 0.027 + 0.026), mats.metal, [0, -foreLen * 0.1, 0], [1, foreLen * 0.55, 1]);
      armour(g, cyl, mats.accent, [0, -foreLen * 0.1 + foreLen * 0.275, 0], [d.armR * 1.02 + 0.005, 0.014, d.armR * 1.02 + 0.005], false);
    });
    const gy = d.chestY + 0.035;
    armour(torsoRoot, ico, mats.accent, [0, gy, surfZ(0, gy, gemK) + 0.012], [0.026, 0.034, 0.018]);
    const halo = glowMat(mats.accentHex, 0.22 + 0.55 * clamp(state.pct, 0, 1));
    const gh = mesh(sph, halo, torsoRoot); place(gh, 0, gy, surfZ(0, gy, gemK) + 0.02, 0.05);
    mesh(strapGeo(gemK, 0.5 * OUT, d.chestY - 0.03, 0.012), mats.dark, torsoRoot, true);
    anims.push((t) => { const s = 0.05 * (1 + 0.15 * Math.sin(t * 2)); gh.scale.setScalar(s); });
  }

  /* ---------------- BAND 4: plate, gauntlets, greaves, circlet, cape ---------------- */
  if (band >= 4) {
    mesh(shell(1.25, waistTop + 0.02, d.chestY + 0.13, 14), mats.metal, torsoRoot, true);
    const ry = d.chestY + 0.02;
    place(mesh(box, mats.accent, torsoRoot, true), 0, (ry + waistTop + 0.04) / 2, surfZ(0, ry, 1.25) + 0.004, 0.012, ry - waistTop + 0.05, 0.016);
    // faulds
    mesh(shell(1.29, waistTop - 0.19, waistTop + 0.0, 6), mats.metal, hipRoot, true);
    side(S.forearmL, S.forearmR, (g) => {
      armour(g, taper(d.armR * 1.0 + 0.014, 0.027 + 0.03), mats.metal, [0, -foreLen * 0.0, 0], [1, foreLen * 0.9, 1]);
      armour(g, cyl, mats.accent, [0, -foreLen * 0.45, 0], [0.027 + 0.032, 0.014, 0.027 + 0.032], false);
      armour(g, cyl, mats.accent, [0, foreLen * 0.44, 0], [d.armR * 1.0 + 0.016, 0.014, d.armR * 1.0 + 0.016], false);
    });
    side(S.handL, S.handR, (g) => { armour(g, box, mats.metal, [0.016, 0.006, 0], [0.056, 0.1, 0.1]); armour(g, box, mats.accent, [0.045, 0.01, 0], [0.006, 0.06, 0.05], false); });
    side(S.shinL, S.shinR, (g) => {
      armour(g, taper(d.legR * 1.02 + 0.02, d.legR * 0.9 + 0.02), mats.metal, [0, shinLen * 0.08, 0], [1, shinLen * 0.62, 1]);
      armour(g, cyl, mats.accent, [0, shinLen * 0.08 - shinLen * 0.31, 0], [d.legR * 0.92 + 0.02, 0.013, d.legR * 0.92 + 0.02], false);
      armour(g, sph, mats.metal, [0, shinLen / 2 - 0.005, d.legR * 0.6], [d.legR * 1.0, d.legR * 0.85, d.legR * 0.62]);
    });
    side(S.thighL, S.thighR, (g) => { armour(g, taper(d.legR * 1.2 + 0.02, d.legR * 0.95 + 0.02), mats.metal, [0, thighLen * 0.2, 0], [1, thighLen * 0.5, 1]); });
    // circlet
    const circPts = (y: number, rx: number, rz: number) => new THREE.CatmullRomCurve3(Array.from({ length: 28 }, (_, i) => { const ph = (i / 28) * Math.PI * 2; return new THREE.Vector3(Math.sin(ph) * rx, y, Math.cos(ph) * rz); }), true);
    const hs = d.headR / 0.1;
    const circ = mesh(G(new THREE.TubeGeometry(circPts(0.045, 0.095 * hs, 0.108 * hs), 48, 0.0085, 5, true)), mats.metal, S.head, true); objs.push(circ);
    const cgem = mesh(ico, mats.accent, S.head, true); place(cgem, 0, 0.056 * hs, 0.108 * hs + 0.004, 0.012 * hs, 0.018 * hs, 0.01 * hs); objs.push(cgem);

    // cape: two deformable sheets (outer cloth, inner accent lining)
    const RR = 12, Cc = 4;
    const capeW = d.shoulderW * 0.74, capeH = d.height * 0.5;
    const mk = (flip: boolean) => { const geo = G(new THREE.PlaneGeometry(1, 1, Cc, RR)); if (flip) geo.rotateY(Math.PI); return { geo, base: Float32Array.from(geo.attributes.position.array as Float32Array) }; };
    const outer = mk(true), inner = mk(false);
    const capeOut = mats.cloth.clone() as THREE.MeshStandardMaterial; own.push(capeOut);
    const capeIn = mats.accent.clone() as THREE.MeshStandardMaterial; own.push(capeIn);
    const cape = new THREE.Group(); cape.add(new THREE.Mesh(outer.geo, capeOut), new THREE.Mesh(inner.geo, capeIn));
    cape.children.forEach((c) => { (c as THREE.Mesh).frustumCulled = false; });
    slotAdd(S.back, cape);
    const zBack = -0.035;
    const deform = (t: number) => {
      for (const part of [outer, inner]) {
        const p = part.geo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) {
          const bx = part.base[i * 3], by = part.base[i * 3 + 1];
          const v = 0.5 - by;
          const x = bx * capeW * (1 + 0.4 * v) + Math.sin(t * 0.9 + v * 2.2) * 0.02 * v * Math.sign(bx || 1) * 0.3;
          const y = -0.01 - v * capeH;
          const sway = (Math.sin(t * 1.25 - v * 2.4) * 0.5 + Math.sin(t * 0.7 + v * 1.3) * 0.25 + 0.3) * 0.07 * v ** 1.4;
          const fold = Math.sin(bx * 7 + t * 0.8) * 0.014 * v;
          const z = zBack - 0.06 * v * v - sway - fold + (part === inner ? 0.006 : 0);
          p.setXYZ(i, x, y, z);
        }
        p.needsUpdate = true; part.geo.computeVertexNormals();
      }
    };
    deform(0.6);
    anims.push(deform);
    // clasps at the collarbones
    side(S.shoulderL, S.shoulderR, (g) => { armour(g, sph, mats.metal, [-0.05 * 0, d.armR * 0.1, -d.armR * 1.2], [0.02, 0.02, 0.02], false); });
  }

  /* ---------------- BAND 5: laurel, branch ornaments, runes, aura ---------------- */
  if (band >= 5) {
    const hs = d.headR / 0.1;
    const leafG = G(new THREE.SphereGeometry(1, 6, 4));
    const laurel = new THREE.Group(); const n = 22;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2; const rx = 0.106 * hs, rz = 0.118 * hs;
      const m = mesh(leafG, i % 2 ? mats.accent : mats.cloth2, laurel);
      place(m, Math.sin(ang) * rx, 0.008 * Math.cos(ang * 2), Math.cos(ang) * rz, 0.026 * hs, 0.007 * hs, 0.012 * hs);
      m.rotation.order = 'YXZ'; m.rotation.set(0, ang, 0.0); m.rotateZ(0); m.rotateY(0);
      m.rotation.set(-0.25 * (i % 2 ? 1 : -1) * 0, ang, (i % 2 ? 0.35 : -0.35));
    }
    const vine = mesh(G(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 28 }, (_, i) => { const ph = (i / 28) * Math.PI * 2; return new THREE.Vector3(Math.sin(ph) * 0.1 * hs, 0, Math.cos(ph) * 0.112 * hs); }), true), 48, 0.0045, 4, true)), mats.metal, laurel);
    void vine;
    laurel.position.y = 0.025 * hs; slotAdd(S.head, laurel);
    // branch ornaments rising from each pauldron
    const tw = (pts: number[][]) => G(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]))), 12, 0.009, 5));
    const twigs: [THREE.BufferGeometry, number[]][] = [
      [tw([[0, 0, 0], [0.035, 0.08, 0], [0.06, 0.17, 0.02], [0.05, 0.27, 0.03]]), [0.05, 0.27, 0.03]],
      [tw([[0, 0, 0], [0.07, 0.04, -0.02], [0.14, 0.09, -0.03], [0.2, 0.17, -0.03]]), [0.2, 0.17, -0.03]],
      [tw([[0, 0, 0], [-0.025, 0.07, 0.01], [-0.05, 0.14, 0], [-0.04, 0.23, -0.01]]), [-0.04, 0.23, -0.01]],
    ];
    side(S.shoulderL, S.shoulderR, (g) => {
      const base = new THREE.Group(); base.position.set(d.armR * 1.1, d.armR * 1.45, -0.012); g.add(base);
      twigs.forEach(([tg, tip], i) => {
        mesh(tg, mats.metal, base, true);
        for (let j = 0; j < 3; j++) {
          const f = 0.45 + j * 0.2;
          const l = mesh(leafG, j % 2 ? mats.accent : mats.cloth2, base);
          place(l, tip[0] * f + (j % 2 ? 0.012 : -0.012), tip[1] * f, tip[2] * f, 0.011, 0.028, 0.006); l.rotation.z = (j % 2 ? -0.7 : 0.7) + (i - 1) * 0.3;
        }
        place(mesh(leafG, mats.accent, base), tip[0], tip[1] + 0.014, tip[2], 0.011, 0.03, 0.007);
      });
    });
    // runes on the chest plate
    const runes = new THREE.Group(); torsoRoot.add(runes);
    const u = 0.011;
    const bar = (x: number, y: number, w: number, h: number, rot = 0) => { const m = mesh(box, accGlow, runes); place(m, x, y, surfZ(x, y, 1.25) + 0.006, w, h, 0.004); m.rotation.z = rot; };
    for (let i = 0; i < 3; i++) { const x = (i - 1) * a * 0.55, y = d.chestY + 0.075; bar(x, y, u, u * 6); bar(x + u * 2, y + u * 1.6, u * 3.4, u, 0.5); bar(x - u * 2, y - u * 1.4, u * 3.4, u, -0.5); }
    for (let i = 0; i < 2; i++) { const x = (i - 0.5) * a * 0.8, y = d.chestY - 0.075; bar(x, y, u * 5, u); bar(x, y - u * 2.2, u * 3, u); }
    anims.push((t) => { accGlow.opacity = 0.6 + 0.25 * Math.sin(t * 1.6); });
    // soft aura
    const auraG = G(new THREE.SphereGeometry(1, 24, 14));
    const mkAura = (hex: number, op: number, sx: number, sy: number) => { const m = mesh(auraG, glowMat(hex, op, { side: THREE.BackSide }), S.waist); place(m, 0, 0.15, 0, sx, sy, sx * 0.8); objs.push(m); return m; };
    const aura = mkAura(mats.accentHex, 0.07, 0.62, 1.12), aura2 = mkAura(whiten(mats.accentHex, 0.5), 0.05, 0.5, 0.98);
    anims.push((t) => { const s = 1 + 0.03 * Math.sin(t * 1.2); aura.scale.set(0.62 * s, 1.12 * s, 0.5 * s); aura2.scale.set(0.5 * s, 0.98 * s, 0.4 * s); });
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
    const orbit = new THREE.Group(); slotAdd(S.head, orbit);
    const books: { g: THREE.Group; r: number; sp: number; ph: number; y: number }[] = [];
    for (let i = 0; i < mTier; i++) {
      const g = tome(); orbit.add(g);
      books.push({ g, r: 0.34 + i * 0.06 + d.shoulderW * 0.15, sp: (0.38 + 0.07 * i) * (i % 2 ? -1 : 1), ph: (i / mTier) * Math.PI * 2 + 0.6, y: 0.02 + i * 0.07 });
    }
    anims.push((t) => books.forEach((bk, i) => {
      const ang = bk.ph + t * bk.sp;
      bk.g.position.set(Math.cos(ang) * bk.r, bk.y + Math.sin(t * 0.9 + i * 2) * 0.035, Math.sin(ang) * bk.r);
      bk.g.rotation.set(0.12 * Math.sin(t * 0.7 + i), Math.PI / 2 - ang, 0.1 * Math.sin(t * 0.5 + i * 2));
    }));
    if (mTier >= 2) {
      const halo = new THREE.Group(); slotAdd(S.headTop, halo);
      const r = d.headR * 1.5;
      const hh = mesh(torusGeo(r, 0.012, 56), mind, halo); hh.rotation.x = Math.PI / 2;
      const hh2 = mesh(torusGeo(r, 0.035, 56), mindSoft, halo); hh2.rotation.x = Math.PI / 2; hh2.scale.z = 0.3;
      for (let i = 0; i < 6; i++) { const an = (i / 6) * Math.PI * 2; place(mesh(ico, mind, halo), Math.cos(an) * r, 0, Math.sin(an) * r, 0.011); }
      halo.position.y = 0.06;
      anims.push((t) => { halo.position.y = 0.06 + Math.sin(t * 1.4) * 0.008; halo.rotation.y = t * 0.6; });
    }
    if (mTier >= 3) {
      const rings = new THREE.Group(); slotAdd(S.head, rings);
      const mk = (r: number, tilt: number, tilt2: number) => {
        const g = new THREE.Group(); g.rotation.set(tilt, 0, tilt2);
        mesh(torusGeo(r, 0.004, 64), mindSoft, g).rotation.x = Math.PI / 2;
        for (let i = 0; i < 9; i++) { const an = (i / 9) * Math.PI * 2 + i * 0.3; place(mesh(ico, mind, g), Math.cos(an) * r, 0, Math.sin(an) * r, i % 3 ? 0.009 : 0.017); }
        const sp = new THREE.Group(); sp.add(g); rings.add(sp); return sp;
      };
      const r1 = mk(0.46 + d.shoulderW * 0.1, 0.35, 0.1), r2 = mk(0.56 + d.shoulderW * 0.1, -0.4, 0.25);
      rings.position.y = 0.0;
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
    const anchor = new THREE.Group(); slotAdd(OUT > 0 ? S.handL : S.handR, anchor);
    tab.position.set(OUT * 0.2, 0.17, 0.13); anchor.add(tab);
    const beam = mesh(cone, skillSoft, anchor); place(beam, OUT * 0.06, 0.05, 0.045, 0.028, 0.14, 0.028); beam.rotation.set(0.0, 0.0, -OUT * 1.15);
    const panels: THREE.Group[] = [];
    if (sTier >= 3) {
      [-1, 1].forEach((s2, i) => { const pn = panel(0.13, 0.18, 5, 3 + i); pn.position.set(s2 * (tw / 2 + 0.11), s2 * 0.02, 0.02); pn.rotation.y = s2 * -0.5; tab.add(pn); panels.push(pn); });
      const belt = new THREE.Group(); const yb = d.hipY - 0.01;
      const bk = band >= 4 ? 1.31 : band >= 2 ? 1.23 : 1.12;
      mesh(shell(bk, yb - 0.03, yb + 0.03, 4), mats.dark, belt, true);
      ringPts(yb, bk, 36).forEach((pt, i) => {
        const frontness = Math.cos(pt.an); if (frontness < -0.3 || i % 3 !== 0) return;
        const pc = place(mesh(box, mats.cloth2, belt, true), pt.x, -0.045, pt.z + 0.015 * Math.cos(pt.an), 0.05, 0.075, 0.035); pc.rotation.y = pt.an;
        if (i % 6 === 0) { const tl = place(mesh(box, mats.metal, belt), pt.x * 1.02, 0.02, pt.z * 1.02 + 0.02, 0.012, 0.12, 0.012); tl.rotation.y = pt.an; }
        else { const tl = place(mesh(cyl, skill, belt), pt.x * 1.02, -0.01, pt.z * 1.02 + 0.03, 0.011, 0.025, 0.011); tl.rotation.set(Math.PI / 2, pt.an, 0); }
      });
      belt.position.y = -d.waistY; slotAdd(S.waist, belt);
    }
    anims.push((t) => {
      anchor.position.y = Math.sin(t * 1.2) * 0.012;
      tab.rotation.y = OUT * (0.55 + 0.08 * Math.sin(t * 0.7)); tab.rotation.x = 0.05 * Math.sin(t * 0.9);
      panels.forEach((pn, i) => { pn.position.y = (i ? 1 : -1) * 0.02 + Math.sin(t * 1.4 + i * 2) * 0.012; });
      skill.opacity = 0.8 + 0.1 * Math.sin(t * 3);
    });
  }

  /* ---------------- DISCIPLINE ---------------- */
  const dTier = tierOf(state.stats.discipline, DISC_TIERS);
  if (dTier >= 1) {
    const ringG = new THREE.Group(); slotAdd(S.floor, ringG);
    const ringFill = glowMat(mats.stat.discipline, 0.12, { side: THREE.DoubleSide });
    const mk = (r: number, y: number, ticks = 28) => {
      const g = new THREE.Group(); g.position.y = y;
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
    const baseR = Math.max(d.hipW * 0.9, d.shoulderW * 0.55, 0.42) + 0.12;
    const rs: { g: THREE.Group; sp: number; y0: number; amp: number }[] = [];
    rs.push({ g: mk(baseR * 1.1, 0.012), sp: 0.5, y0: 0.012, amp: 0 });
    if (dTier >= 2) rs.push({ g: mk(baseR * 0.92, 0.5 * sc, 22), sp: -0.7, y0: 0.5 * sc, amp: 0.05 });
    if (dTier >= 3) rs.push({ g: mk(baseR * 0.88, 1.12 * sc, 20), sp: 0.9, y0: 1.12 * sc, amp: 0.05 });
    anims.push((t) => rs.forEach((r, i) => { r.g.rotation.y = t * r.sp; r.g.position.y = r.y0 + (r.amp ? Math.sin(t * 1.1 + i * 2) * r.amp : 0); }));
    if (dTier >= 2) {
      side(S.shinL, S.shinR, (g) => {
        if (band < 4) armour(g, sph, mats.metal, [0, shinLen / 2 - 0.005, d.legR * 0.62], [d.legR * 1.0, d.legR * 0.85, d.legR * 0.6]);
        place(mesh(ico, disc, g), 0, shinLen / 2 - 0.005, d.legR * 0.62 + d.legR * 0.55, 0.014);
      });
    }
    if (dTier >= 3) {
      const rb = new THREE.Group(); const yb = waistTop + 0.075; const kk = band >= 4 ? 1.34 : band >= 2 ? 1.25 : 1.13;
      mesh(shell(kk, yb - 0.012, yb + 0.012, 3), discSoft, rb);
      ringPts(yb, kk, 16).forEach((pt) => { const m = place(mesh(box, disc, rb), pt.x * 1.01, yb, pt.z * 1.01, 0.02, 0.028, 0.006); m.rotation.y = pt.an; });
      rb.position.y = -d.waistY; slotAdd(S.waist, rb);
      void rb;
    }
  }

  /* ---------------- STREAK ---------------- */
  const stTier = tierOf(state.streak, STREAK_TIERS);
  if (stTier >= 1) {
    const dot = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d')!;
      const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c); texs.push(t); return t;
    })();
    const cA = new THREE.Color(mats.accentHex), cB = new THREE.Color(mats.accent2Hex), cW = new THREE.Color(whiten(mats.accentHex, 0.85));
    const fireR = Math.max(d.hipW * 0.8, d.shoulderW * 0.5, 0.4) + 0.15;
    const fire = new THREE.Group(); slotAdd(S.floor, fire);

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
          col[i * 4] = tmp.r; col[i * 4 + 1] = tmp.g; col[i * 4 + 2] = tmp.b; col[i * 4 + 3] = Math.min(1, (1 - life) * 1.6);
        }
        g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
      };
      anims.push(step); step(0.37);
    };
    if (stTier === 1) mkParticles(22, 0.1, fireR * 0.9, 0.7, 0.3, 0.04, 1);
    if (stTier >= 2) mkParticles(stTier === 2 ? 36 : stTier === 3 ? 110 : 190, 0.12, fireR * 1.05, stTier === 2 ? 0.8 : stTier === 3 ? 1.5 : 2.0, stTier >= 3 ? 0.22 : 0.3, 0.045, 2);

    if (stTier >= 2) {
      const flameGeo = (hex: number) => {
        const g = G(new THREE.ConeGeometry(0.5, 1, 8, 1, true)); g.translate(0, 0.5, 0);
        const pa = g.attributes.position, cols = new Float32Array(pa.count * 4), c = new THREE.Color(hex);
        for (let i = 0; i < pa.count; i++) { const k = Math.max(0, 1 - pa.getY(i)) ** 1.3; cols[i * 4] = c.r; cols[i * 4 + 1] = c.g; cols[i * 4 + 2] = c.b; cols[i * 4 + 3] = k; }
        g.setAttribute('color', new THREE.BufferAttribute(cols, 4)); return g;
      };
      const fm = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: ADD ? 0.4 : 0.55, blending: ADD ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, side: THREE.DoubleSide }); own.push(fm);
      const layers: [THREE.BufferGeometry, number, number][] = [[flameGeo(mats.accent2Hex), 1, 0.15], [flameGeo(mats.accentHex), 0.7, 0.1], [flameGeo(whiten(mats.accentHex, 0.8)), 0.42, 0.065]];
      const nT = stTier === 2 ? 14 : 18, H = stTier === 2 ? 0.26 : stTier === 3 ? 0.48 : 0.6;
      const tufts: { g: THREE.Group; ph: number; h: number }[] = [];
      for (let rI = 0; rI < (stTier >= 3 ? 2 : 1); rI++) for (let i = 0; i < nT; i++) {
        const ang = ((i + rI * 0.5) / nT) * Math.PI * 2; const rr = fireR * (rI ? 0.8 : 1.0);
        const g = new THREE.Group(); g.position.set(Math.cos(ang) * rr, 0.01, Math.sin(ang) * rr);
        layers.forEach(([geo, hs, ws]) => place(mesh(geo, fm, g), 0, 0, 0, ws, hs * H, ws));
        fire.add(g); tufts.push({ g, ph: i * 1.7 + rI * 3, h: 0.7 + 0.5 * Math.abs(Math.sin(i * 2.3 + rI)) });
      }
      anims.push((t) => tufts.forEach((f) => {
        const fl = f.h * (1 + 0.28 * Math.sin(t * 7 + f.ph) + 0.15 * Math.sin(t * 12.3 + f.ph * 2));
        f.g.scale.set(1 + 0.12 * Math.sin(t * 5 + f.ph), fl, 1 + 0.12 * Math.cos(t * 5 + f.ph));
        f.g.rotation.set(Math.sin(t * 3 + f.ph) * 0.08, 0, Math.cos(t * 2.6 + f.ph) * 0.08);
      }));
      const gl = mesh(G(new THREE.CircleGeometry(fireR * 1.1, 32)), glowMat(mats.accentHex, 0.16, { side: THREE.DoubleSide }), fire); gl.rotation.x = -Math.PI / 2; gl.position.y = 0.006;
    }
    if (stTier >= 4) {
      const tex = (() => {
        const c = document.createElement('canvas'); c.width = 64; c.height = 256; const x = c.getContext('2d')!;
        const img = x.createImageData(64, 256);
        for (let j = 0; j < 256; j++) for (let i = 0; i < 64; i++) {
          const u = 1 - Math.abs(i - 31.5) / 32, v = j / 255;                 // v: 0 top .. 1 bottom
          const al = Math.max(0, u) ** 1.4 * Math.min(1, v * 1.6) ** 1.5 * (v > 0.9 ? (1 - v) * 10 : 1);
          const o = (j * 64 + i) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = 255; img.data[o + 3] = Math.round(255 * al);
        }
        x.putImageData(img, 0, 0);
        const t = new THREE.CanvasTexture(c); texs.push(t); return t;
      })();
      const cols = new THREE.Group(); cols.position.set(0, 0, -0.32); fire.add(cols);
      const pg = G(new THREE.PlaneGeometry(1, 1)); pg.translate(0, 0.5, 0);
      const ms = [glowMat(mats.accent2Hex, 0.42, { map: tex, side: THREE.DoubleSide }), glowMat(mats.accentHex, 0.38, { map: tex, side: THREE.DoubleSide }), glowMat(whiten(mats.accentHex, 0.8), 0.4, { map: tex, side: THREE.DoubleSide })];
      const sizes = [[1.5, 2.5], [1.0, 2.1], [0.55, 1.6]];
      const pl: THREE.Mesh[] = [];
      ms.forEach((m, i) => { for (let k = 0; k < 2; k++) { const pm = mesh(pg, m, cols); pm.scale.set(sizes[i][0], sizes[i][1], 1); pm.rotation.y = k * 1.1 - 0.55; pm.position.z = i * -0.01; pl.push(pm); } });
      anims.push((t) => pl.forEach((pm, i) => { const s = 1 + 0.07 * Math.sin(t * 4 + i * 1.3) + 0.04 * Math.sin(t * 9 + i); pm.scale.y = sizes[Math.floor(i / 2)][1] * s; pm.rotation.y = (i % 2 ? 0.55 : -0.55) + Math.sin(t * 1.3 + i) * 0.25; }));
    }
  }

  const run = (t: number) => { tNow = t; for (const f of anims) f(t); };
  void tNow;
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
