import * as THREE from 'three';
import type { BuildSetting } from './types';
import { fxGlowTexture, fxIsDark, fxMix, fxReducedMotion } from './looks';

/* setting.ts: ground and set dressing around the feet. Cumulative by band:
   1 dirt patch + stones | 2 + grass tufts + lantern post | 3 + campfire | 4 + standing-stone ring, banner, glowing runes | 5 + big tree and drifting petals.
   Everything hangs off rig.slots.floor, uses only theme colours (via mats), and the front arc (|angle| < 40 deg) is kept clear. */

const rngOf = (seed: number) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;

export const buildSetting: BuildSetting = (state, mats, rig) => {
  const quiet = fxReducedMotion();
  const band = state.band;
  const bg = new THREE.Color(mats.bgHex), text = new THREE.Color(mats.textHex);
  const acc = new THREE.Color(mats.accentHex), acc2 = new THREE.Color(mats.accent2Hex);
  const dk = fxIsDark(mats.bgHex);
  const group = new THREE.Group();
  group.name = 'setting';
  const geos: THREE.BufferGeometry[] = [];
  const ms: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const updaters: Array<(t: number) => void> = [];
  const G = <T extends THREE.BufferGeometry>(g: T) => (geos.push(g), g);
  /** themed material: clone of one of the theme materials with another colour (keeps toon / flat / lambert style) */
  const themed = (from: THREE.Material, c: THREE.Color, o: { emissive?: number; side?: THREE.Side } = {}) => {
    const m = from.clone() as THREE.MeshToonMaterial;
    m.onBeforeCompile = () => {};
    m.color.copy(c);
    if (m.emissive) m.emissive.copy(c).multiplyScalar(o.emissive ?? 0);
    if (o.side !== undefined) m.side = o.side;
    ms.push(m);
    return m;
  };
  const basic = (c: THREE.Color, o: THREE.MeshBasicMaterialParameters = {}) => {
    const m = new THREE.MeshBasicMaterial({ color: c, toneMapped: false, ...o });
    ms.push(m);
    return m;
  };
  const tex = <T extends THREE.Texture>(t: T) => (texs.push(t), t);
  const blend = dk ? THREE.AdditiveBlending : THREE.NormalBlending;
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = group) => {
    const o = new THREE.Mesh(G(g), m);
    o.raycast = () => {};
    parent.add(o);
    return o;
  };
  const outline = (m: THREE.Mesh, w?: number) => { mats.addOutline(m, w); };

  const stoneC = fxMix(bg, text, dk ? 0.32 : 0.2);
  const stoneDark = fxMix(bg, text, dk ? 0.2 : 0.32);
  const stoneMat = themed(mats.dark, stoneC);
  const stoneMat2 = themed(mats.dark, stoneDark);
  const grassC = fxMix(acc2, text, 0.15);
  const woodC = fxMix(bg, text, dk ? 0.28 : 0.55).lerp(new THREE.Color(0x3a2a1c), 0.45);
  const woodMat = themed(mats.dark, woodC);
  const glowCol = new THREE.Color(mats.accentHex);
  const flameCol = acc.clone().lerp(new THREE.Color(0xffa040), dk ? 0.35 : 0.1);

  const glowTex = tex(fxGlowTexture(new THREE.Color(0xffffff)));
  const sprite = (c: THREE.Color, size: number, a: number, x: number, y: number, z: number, additive = dk) => {
    const m = new THREE.SpriteMaterial({ map: glowTex, color: c, transparent: true, opacity: a, depthWrite: false, toneMapped: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    ms.push(m);
    const s = new THREE.Sprite(m);
    s.scale.set(size, size, 1);
    s.position.set(x, y, z);
    s.raycast = () => {};
    group.add(s);
    return s;
  };
  const polar = (deg: number, r: number) => [Math.sin(THREE.MathUtils.degToRad(deg)) * r, Math.cos(THREE.MathUtils.degToRad(deg)) * r] as const;

  // ---------------------------------------------------------------- band 1: dirt patch, a few stones (always)
  {
    const rnd = rngOf(5);
    const pcv = document.createElement('canvas'); pcv.width = pcv.height = 128;
    const px = pcv.getContext('2d')!;
    const pg = px.createRadialGradient(64, 64, 10, 64, 64, 64);
    pg.addColorStop(0, 'rgba(255,255,255,0.9)'); pg.addColorStop(0.7, 'rgba(255,255,255,0.6)'); pg.addColorStop(1, 'rgba(255,255,255,0)');
    px.fillStyle = pg; px.fillRect(0, 0, 128, 128);
    const ptex = tex(new THREE.CanvasTexture(pcv)); ptex.colorSpace = THREE.SRGBColorSpace;
    const pm = mesh(new THREE.PlaneGeometry(3.6, 3.6), basic(fxMix(bg, text, dk ? 0.12 : 0.2), { map: ptex, transparent: true, depthWrite: false }));
    pm.rotation.x = -Math.PI / 2; pm.position.y = 0.001; pm.renderOrder = -6; // soft earth patch; the theme's own floor discs sit on top of it
    void rnd;
    const small: Array<[number, number, number]> = [[-62, 1.22, 0.12], [58, 1.3, 0.09], [-96, 1.0, 0.07], [112, 1.2, 0.1], [30, 1.55, 0.06]];
    small.forEach(([a, r, s], i) => {
      const [x, z] = polar(a, r);
      const st = mesh(new THREE.DodecahedronGeometry(s, 0), i % 2 ? stoneMat2 : stoneMat);
      st.position.set(x, s * 0.55, z); st.scale.set(1.3, 0.8, 1); st.rotation.set(i, i * 2.1, 0);
      outline(st, 0.008);
    });
  }

  // ---------------------------------------------------------------- band 2: grass tufts, lantern on a post
  if (band >= 2) {
    const rnd = rngOf(17);
    const blade = G(new THREE.ConeGeometry(0.013, 0.15, 3));
    blade.translate(0, 0.075, 0);
    const grass = new THREE.InstancedMesh(blade, themed(mats.cloth2, grassC, { side: THREE.DoubleSide }), 64);
    const d = new THREE.Object3D();
    let n = 0;
    const tufts: Array<[number, number]> = [[-55, 1.35], [-80, 1.18], [68, 1.28], [95, 1.4], [-125, 1.45], [140, 1.35], [-35, 1.6], [40, 1.62]];
    tufts.forEach(([a, r]) => {
      const [cx, cz] = polar(a, r);
      for (let j = 0; j < 8; j++) {
        d.position.set(cx + (rnd() - 0.5) * 0.18, 0, cz + (rnd() - 0.5) * 0.18);
        d.rotation.set((rnd() - 0.5) * 0.5, rnd() * 6, (rnd() - 0.5) * 0.5);
        const s = 0.7 + rnd() * 0.9; d.scale.set(1, s, 1);
        d.updateMatrix(); grass.setMatrixAt(n++, d.matrix);
      }
    });
    grass.count = n; grass.raycast = () => {};
    group.add(grass);

    // lantern post, behind-right (screen right), clear of the figure
    const lx = 1.05, lz = -0.35;
    const post = mesh(new THREE.CylinderGeometry(0.022, 0.03, 1.25, 6), woodMat);
    post.position.set(lx, 0.625, lz); outline(post, 0.008);
    const arm = mesh(new THREE.BoxGeometry(0.2, 0.025, 0.025), woodMat);
    arm.position.set(lx - 0.09, 1.22, lz);
    const lamp = mesh(new THREE.BoxGeometry(0.1, 0.13, 0.1), basic(flameCol.clone().lerp(new THREE.Color(0xffffff), 0.35)));
    lamp.position.set(lx - 0.19, 1.12, lz);
    const cap = mesh(new THREE.ConeGeometry(0.085, 0.07, 4), stoneMat2);
    cap.position.set(lx - 0.19, 1.22, lz); cap.rotation.y = Math.PI / 4;
    const halo = sprite(flameCol, 0.75, dk ? 0.75 : 0.55, lx - 0.19, 1.12, lz + 0.02);
    const halo2 = sprite(flameCol, 0.28, dk ? 0.9 : 0.8, lx - 0.19, 1.12, lz + 0.06, true);
    const base = halo.material.opacity;
    updaters.push((t) => { halo.material.opacity = base * (0.9 + 0.1 * Math.sin(t * 5.1) * Math.sin(t * 2.3)); halo2.scale.setScalar(0.28 * (1 + 0.06 * Math.sin(t * 7))); });
  }

  // ---------------------------------------------------------------- band 3: campfire
  if (band >= 3) {
    const cx = -0.98, cz = 0.4;
    const fire = new THREE.Group(); fire.position.set(cx, 0, cz); group.add(fire);
    // ring stones
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2, s = 0.055 + (i % 3) * 0.012;
      const st = mesh(new THREE.DodecahedronGeometry(s, 0), i % 2 ? stoneMat : stoneMat2, fire);
      st.position.set(Math.cos(a) * 0.23, s * 0.6, Math.sin(a) * 0.23); st.scale.set(1, 0.75, 1.2); st.rotation.y = a;
      outline(st, 0.006);
    }
    // logs
    const logG = G(new THREE.CylinderGeometry(0.032, 0.036, 0.42, 6));
    for (let i = 0; i < 3; i++) {
      const l = new THREE.Mesh(logG, woodMat);
      l.position.set(0, 0.05, 0); l.rotation.set(Math.PI / 2 - 0.2, (i / 3) * Math.PI * 2 + 0.4, 0, 'YXZ');
      l.raycast = () => {};
      fire.add(l);
      outline(l, 0.006);
    }
    // flame billboards
    const ftex = tex((() => {
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128;
      const x = cv.getContext('2d')!;
      const g = x.createLinearGradient(0, 128, 0, 0);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.beginPath(); x.moveTo(32, 2); x.bezierCurveTo(52, 40, 62, 70, 52, 108); x.quadraticCurveTo(32, 128, 12, 108); x.bezierCurveTo(2, 70, 14, 40, 32, 2); x.fill();
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
    })());
    const flames: Array<{ s: THREE.Sprite; b: number; h: number; p: number }> = [];
    const layers: Array<[THREE.Color, number, number, number, number]> = [
      [flameCol.clone().multiplyScalar(dk ? 0.9 : 0.8), 0.34, 0.6, -0.04, 0], [flameCol.clone().lerp(new THREE.Color(0xffffff), dk ? 0.35 : 0.12), 0.24, 0.46, 0.05, 1.7],
      [flameCol.clone().lerp(new THREE.Color(0xffffff), dk ? 0.75 : 0.4), 0.14, 0.3, 0, 3.1],
    ];
    layers.forEach(([c, w, h, ox, p]) => {
      const m = new THREE.SpriteMaterial({ map: ftex, color: c, transparent: true, opacity: dk ? 0.9 : 0.95, depthWrite: false, toneMapped: false, blending: blend });
      ms.push(m);
      const s = new THREE.Sprite(m); s.center.set(0.5, 0); s.position.set(ox, 0.07, 0.02); s.scale.set(w, h, 1); s.raycast = () => {};
      fire.add(s); flames.push({ s, b: w, h, p });
    });
    const glow = sprite(flameCol, 1.5, dk ? 0.5 : 0.28, cx, 0.25, cz + 0.05);
    const gb = glow.material.opacity;
    const emb = new THREE.Mesh(G(new THREE.CircleGeometry(0.24, 16)), basic(flameCol, { transparent: true, opacity: dk ? 0.5 : 0.35, depthWrite: false, blending: blend }));
    emb.rotation.x = -Math.PI / 2; emb.position.y = 0.012; fire.add(emb);
    // sparks
    const N = 14, sp = new Float32Array(N * 3), sph = new Float32Array(N).map((_, i) => i * 1.7);
    const sg = G(new THREE.BufferGeometry()); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    const sm = new THREE.PointsMaterial({ color: flameCol.clone().lerp(new THREE.Color(0xffffff), 0.4), size: 0.035, map: glowTex, transparent: true, depthWrite: false, toneMapped: false, blending: blend });
    ms.push(sm);
    const pts = new THREE.Points(sg, sm); pts.frustumCulled = false; pts.raycast = () => {}; fire.add(pts);
    const tick = (t: number) => {
      flames.forEach((f, i) => {
        const k = 1 + 0.14 * Math.sin(t * (9 + i * 3) + f.p) + 0.08 * Math.sin(t * (17 + i) + f.p * 2);
        f.s.scale.set(f.b * (1 - 0.1 * (k - 1)), f.h * k, 1);
        f.s.position.x = (i === 1 ? 0.05 : i === 0 ? -0.04 : 0) + 0.015 * Math.sin(t * 6 + f.p);
      });
      glow.material.opacity = gb * (0.9 + 0.1 * Math.sin(t * 8.3) * Math.sin(t * 3.1));
      for (let i = 0; i < N; i++) {
        const u = ((t * 0.5 + sph[i]) % 1 + 1) % 1;
        sp[i * 3] = Math.sin(sph[i] * 3 + t * 1.2) * 0.1 * u; sp[i * 3 + 1] = 0.15 + u * 0.8; sp[i * 3 + 2] = Math.cos(sph[i] * 2 + t) * 0.08 * u;
      }
      sg.attributes.position.needsUpdate = true;
    };
    updaters.push(tick);
    tick(0.8);
  }

  // ---------------------------------------------------------------- band 4: standing-stone ring, banner, glowing runes
  const runeStones: Array<{ g: THREE.Group; h: number; w: number }> = [];
  if (band >= 4) {
    const R = 1.28;
    const angles = [-150, -118, -88, 88, 118, 150, 180];
    const rnd = rngOf(41);
    angles.forEach((a, i) => {
      const [x, z] = polar(a, R);
      const h = 0.55 + rnd() * 0.45 + (Math.abs(a) > 100 ? 0.25 : 0), w = 0.26 + rnd() * 0.08;
      const g = new THREE.Group(); g.position.set(x, 0, z); g.lookAt(0, 0, 0); group.add(g);
      const body = mesh(new THREE.CylinderGeometry(w * 0.42, w * 0.55, h, 5), i % 2 ? stoneMat : stoneMat2, g);
      body.position.y = h / 2; body.rotation.set((rnd() - 0.5) * 0.06, rnd(), (rnd() - 0.5) * 0.06, 'YXZ');
      outline(body, 0.01);
      const topc = mesh(new THREE.ConeGeometry(w * 0.42, 0.1, 5), i % 2 ? stoneMat : stoneMat2, g);
      topc.position.y = h + 0.05; topc.rotation.y = body.rotation.y;
      if (a === -118 || a === 118) runeStones.push({ g, h, w });
    });
    // runes: two stones glow
    const rtex = tex((() => {
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128;
      const x = cv.getContext('2d')!; x.strokeStyle = '#fff'; x.lineWidth = 6; x.lineCap = 'round'; x.lineJoin = 'round';
      x.beginPath(); x.moveTo(32, 14); x.lineTo(32, 114); x.moveTo(32, 36); x.lineTo(14, 56); x.moveTo(32, 62); x.lineTo(50, 82); x.moveTo(32, 90); x.lineTo(20, 104); x.stroke();
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
    })());
    const runeMat = new THREE.MeshBasicMaterial({ map: rtex, color: glowCol.clone().lerp(new THREE.Color(0xffffff), dk ? 0.35 : 0), transparent: true, depthWrite: false, toneMapped: false, blending: blend });
    ms.push(runeMat);
    runeStones.forEach(({ g, h, w }, i) => {
      const r = new THREE.Mesh(G(new THREE.PlaneGeometry(w * 0.55, w * 1.1)), runeMat);
      r.position.set(0, h * 0.5, w * 0.5 + 0.015); r.rotation.z = i ? 0.06 : -0.05; r.raycast = () => {}; g.add(r);
      const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: glowCol, transparent: true, opacity: dk ? 0.45 : 0.3, depthWrite: false, toneMapped: false, blending: blend }));
      ms.push(gl.material); gl.scale.set(0.7, 0.9, 1); gl.position.set(0, h * 0.5, w * 0.5 + 0.03); g.add(gl);
    });
    updaters.push((t) => { runeMat.opacity = 0.75 + 0.25 * Math.sin(t * 1.6); });
    // banner on a pole, back-left
    {
      const bx = -1.0, bz = -1.15;
      const pole = mesh(new THREE.CylinderGeometry(0.02, 0.025, 1.75, 6), woodMat); pole.position.set(bx, 0.875, bz); outline(pole, 0.008);
      const bar = mesh(new THREE.BoxGeometry(0.4, 0.025, 0.025), woodMat); bar.position.set(bx + 0.18, 1.68, bz);
      const flag = G(new THREE.PlaneGeometry(0.34, 0.66, 4, 8));
      const fm = themed(mats.cloth, acc, { side: THREE.DoubleSide, emissive: 0.15 });
      const f = mesh(flag, fm); f.position.set(bx + 0.18, 1.3, bz + 0.01);
      const emblem = mesh(new THREE.CircleGeometry(0.09, 3), basic(acc2, { side: THREE.DoubleSide }));
      emblem.position.set(0, 0.08, 0.004); emblem.rotation.z = Math.PI / 2 * 3; f.add(emblem);
      const pa = flag.attributes.position as THREE.BufferAttribute;
      const orig = pa.array.slice() as Float32Array;
      const wave = (t: number) => {
        for (let i = 0; i < pa.count; i++) {
          const y = orig[i * 3 + 1], x = orig[i * 3];
          pa.setZ(i, Math.sin(y * 4 - t * 2.2) * 0.04 * (0.5 + y * -0.5 + 0.5) * ((x + 0.2) / 0.4 + 0.2));
        }
        pa.needsUpdate = true;
      };
      updaters.push(wave); wave(1.0);
    }
  }

  // ---------------------------------------------------------------- band 5: the big tree and drifting petals
  if (band >= 5) {
    const tx = 0.95, tz = -1.45;
    const tree = new THREE.Group(); tree.position.set(tx, 0, tz); tree.scale.setScalar(0.88); group.add(tree);
    const trunk = mesh(new THREE.CylinderGeometry(0.09, 0.17, 1.8, 7, 4), woodMat, tree);
    trunk.position.y = 0.95; trunk.rotation.z = -0.08; outline(trunk, 0.012);
    const br1 = mesh(new THREE.CylinderGeometry(0.04, 0.07, 0.9, 5), woodMat, tree); br1.position.set(0.28, 1.65, 0); br1.rotation.z = -0.9;
    const br2 = mesh(new THREE.CylinderGeometry(0.03, 0.06, 0.7, 5), woodMat, tree); br2.position.set(-0.22, 1.55, 0.05); br2.rotation.z = 0.8;
    const leafA = fxMix(acc2, acc, 0.15), leafB = fxMix(acc, bg, 0.0), leafC = fxMix(acc2, text, 0.2);
    const lm = [themed(mats.cloth2, leafA, { emissive: 0.1 }), themed(mats.cloth2, leafC, { emissive: 0.1 }), themed(mats.cloth, leafB, { emissive: 0.1 })];
    const blobs: Array<[number, number, number, number, number]> = [
      [0.0, 2.1, 0, 0.62, 0], [0.55, 1.88, 0.05, 0.46, 1], [-0.55, 1.92, 0.0, 0.48, 1], [0.1, 2.45, 0.0, 0.4, 2], [-0.2, 1.75, 0.3, 0.38, 2], [0.7, 2.25, -0.1, 0.34, 2],
    ];
    blobs.forEach(([x, y, z, r, k], i) => {
      const b = mesh(new THREE.IcosahedronGeometry(r * 0.85, 1), lm[k], tree);
      b.position.set(x, y, z); b.scale.set(1.1, 0.85, 1); b.rotation.y = i;
      outline(b, 0.014);
    });
    // soft glow among the leaves
    const ca = sprite(leafA, 2.4, dk ? 0.28 : 0.16, tx, 2.1, tz - 0.1);
    void ca;
    // petals
    const NP = 26, rnd = rngOf(77);
    const petalGeo = G(new THREE.CircleGeometry(0.035, 5));
    petalGeo.scale(1, 1.5, 1);
    const petals = new THREE.InstancedMesh(petalGeo, basic(acc.clone().lerp(new THREE.Color(0xffffff), dk ? 0.45 : 0.1), { side: THREE.DoubleSide, transparent: true, opacity: 0.95 }), NP);
    petals.frustumCulled = false; petals.raycast = () => {};
    group.add(petals);
    const ph = Array.from({ length: NP }, () => ({ x: tx - 0.4 + (rnd() - 0.5) * 1.8, z: tz + (rnd() + 0.2) * 1.3, o: rnd(), s: 0.05 + rnd() * 0.05, p: rnd() * 6.28 }));
    const d = new THREE.Object3D();
    const drift = (t: number) => {
      ph.forEach((q, i) => {
        const u = (((t * q.s + q.o) % 1) + 1) % 1;
        d.position.set(q.x + Math.sin(t * 0.7 + q.p) * 0.18 + u * 0.5, 2.4 - u * 2.35, q.z + Math.cos(t * 0.5 + q.p) * 0.15);
        d.rotation.set(t * 1.3 + q.p, t * 0.9, t + q.p); d.updateMatrix(); petals.setMatrixAt(i, d.matrix);
      });
      petals.instanceMatrix.needsUpdate = true;
    };
    updaters.push(drift); drift(2.0);
  }

  group.userData.noFit = true;
  (rig.slots.floor ?? rig.root).add(group);
  updaters.forEach((u) => u(1.2)); // static arrangement for reduced motion (and initial frame)

  return {
    update(t: number) { if (quiet) return; for (const u of updaters) u(t); },
    dispose() {
      group.parent?.remove(group);
      geos.forEach((g) => g.dispose()); ms.forEach((m) => m.dispose()); texs.forEach((t) => t.dispose());
      group.traverse((o) => { const im = o as THREE.InstancedMesh; if (im.isInstancedMesh) im.dispose(); });
      geos.length = ms.length = texs.length = updaters.length = 0;
    },
  };
};
