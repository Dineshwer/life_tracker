import * as THREE from 'three';
import type { BuildCompanion } from './types';
import { fxGlowTexture, fxIsDark, fxMix, fxReducedMotion } from './looks';

/* companion.ts: bands 1-2 nothing | 3 a glowing wisp with halo and trail near the right shoulder (screen-left, figure's right is -x)
   4 a small low-poly bird hovering near the same shoulder, wings flapping | 5 a firebird circling behind the figure with a particle tail.
   Procedural primitives only, theme colours only. */

export const buildCompanion: BuildCompanion = (state, mats, rig) => {
  const none = { update() {}, dispose() {} };
  if (state.band < 3) return none;
  const quiet = fxReducedMotion();
  const dk = fxIsDark(mats.bgHex);
  const bg = new THREE.Color(mats.bgHex);
  const acc = new THREE.Color(mats.accentHex), acc2 = new THREE.Color(mats.accent2Hex);
  const white = new THREE.Color(0xffffff);
  const blend = dk ? THREE.AdditiveBlending : THREE.NormalBlending;
  const group = new THREE.Group();
  group.name = 'companion';
  const geos: THREE.BufferGeometry[] = [];
  const ms: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const G = <T extends THREE.BufferGeometry>(g: T) => (geos.push(g), g);
  const themed = (from: THREE.Material, c: THREE.Color, emissive = 0) => {
    const m = from.clone() as THREE.MeshToonMaterial;
    m.onBeforeCompile = () => {};
    m.color.copy(c);
    if (m.emissive) m.emissive.copy(c).multiplyScalar(emissive);
    m.side = THREE.DoubleSide;
    ms.push(m);
    return m;
  };
  const glowTex = (() => { const t = fxGlowTexture(white); texs.push(t); return t; })();
  const sprite = (c: THREE.Color, size: number, a: number, parent: THREE.Object3D, additive = dk) => {
    const m = new THREE.SpriteMaterial({ map: glowTex, color: c, transparent: true, opacity: a, depthWrite: false, toneMapped: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    ms.push(m);
    const s = new THREE.Sprite(m); s.scale.set(size, size, 1); s.raycast = () => {};
    parent.add(s);
    return s;
  };
  /** a trail of points that fades to nothing (additive) or to the background (normal blend) */
  const trail = (n: number, c: THREE.Color, size: number) => {
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const g = G(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, sizeAttenuation: true, blending: blend });
    ms.push(m);
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.raycast = () => {};
    group.add(pts);
    const end = dk ? new THREE.Color(0x000000) : bg;
    const tmp = new THREE.Color();
    return {
      set(i: number, x: number, y: number, z: number, f: number) { // f: 1 head .. 0 tail
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        tmp.copy(end).lerp(c, f * f); col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
      },
      flush() { g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; },
    };
  };

  const d = rig.dims;
  const sx = -((d?.shoulderW ?? 0.42) / 2 + 0.55); // the figure's right is -x
  const sy = (d?.neckY ?? 1.5) + 0.12;
  const run: Array<(t: number) => void> = [];

  // ================================================================ band 3: wisp
  if (state.band === 3) {
    const wisp = new THREE.Group(); group.add(wisp);
    const coreC = fxMix(acc, white, dk ? 0.6 : 0.15);
    const core = new THREE.Mesh(G(new THREE.IcosahedronGeometry(0.052, 1)), (() => { const m = new THREE.MeshBasicMaterial({ color: coreC, toneMapped: false }); ms.push(m); return m; })());
    core.raycast = () => {}; wisp.add(core);
    const h1 = sprite(acc, 0.5, dk ? 0.85 : 0.6, wisp), h2 = sprite(fxMix(acc, white, 0.5), 0.2, dk ? 1 : 0.9, wisp, true);
    void h1;
    // little lantern cage ring around the core
    const ring = new THREE.Mesh(G(new THREE.TorusGeometry(0.085, 0.006, 5, 14)), (() => { const m = new THREE.MeshBasicMaterial({ color: acc2, toneMapped: false }); ms.push(m); return m; })());
    ring.raycast = () => {}; wisp.add(ring);
    const N = 16, tr = trail(N, acc, 0.07);
    const at = (t: number) => ({
      x: sx + Math.sin(t * 0.9) * 0.1 + Math.sin(t * 1.9) * 0.04,
      y: sy + 0.02 + Math.sin(t * 1.3) * 0.08 + Math.sin(t * 2.7) * 0.02,
      z: 0.1 + Math.cos(t * 0.8) * 0.12,
    });
    run.push((t) => {
      const p = at(t);
      wisp.position.set(p.x, p.y, p.z);
      ring.rotation.set(t * 1.2, t * 0.8, 0);
      h2.scale.setScalar(0.2 * (1 + 0.1 * Math.sin(t * 6)));
      for (let i = 0; i < N; i++) { const q = at(t - i * 0.05); tr.set(i, q.x, q.y - i * 0.012, q.z - i * 0.01, 1 - i / N); }
      tr.flush();
    });
  }

  // ================================================================ birds (shared builder)
  const makeBird = (body: THREE.Color, wing: THREE.Color, scale: number, tailLen: number) => {
    const bird = new THREE.Group();
    const pose = new THREE.Group(); pose.scale.setScalar(scale); bird.add(pose);
    const bm = themed(mats.cloth, body, dk ? 0.25 : 0.1), wm = themed(mats.cloth2, wing, dk ? 0.25 : 0.1), beakM = themed(mats.cloth2, fxMix(acc, white, 0.2), 0.2);
    const add = (g: THREE.BufferGeometry, m: THREE.Material, p: THREE.Object3D = pose) => { const o = new THREE.Mesh(G(g), m); o.raycast = () => {}; p.add(o); mats.addOutline(o, 0.006 / scale); return o; };
    const torso = add(new THREE.SphereGeometry(0.07, 8, 6), bm); torso.scale.set(0.8, 0.75, 1.35);
    const head = add(new THREE.SphereGeometry(0.043, 8, 6), bm); head.position.set(0, 0.035, 0.085);
    const beak = add(new THREE.ConeGeometry(0.014, 0.05, 4), beakM); beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.03, 0.14);
    const eyeM = new THREE.MeshBasicMaterial({ color: dk ? 0x000000 : 0x000000 }); ms.push(eyeM);
    [-1, 1].forEach((s) => { const e = new THREE.Mesh(G(new THREE.SphereGeometry(0.008, 5, 4)), eyeM); e.position.set(0.032 * s, 0.045, 0.118); pose.add(e); });
    // tail: a fan of three flat feathers
    for (let i = -1; i <= 1; i++) {
      const f = add(new THREE.ConeGeometry(0.03, tailLen, 3), i === 0 ? wm : bm);
      f.scale.set(1, 1, 0.3); f.rotation.set(-Math.PI / 2 - 0.12, 0, i * 0.28); f.position.set(i * 0.016, 0.0, -0.1 - tailLen / 2);
      f.rotation.order = 'YXZ'; f.rotation.set(-Math.PI / 2 + 0.1, i * 0.25, 0);
    }
    // wings: pivot at the shoulder, a swept quad of three tapered feathers
    const wingGeo = (() => {
      const s = new THREE.Shape();
      s.moveTo(0, 0.04); s.lineTo(0.2, 0.06); s.lineTo(0.4, 0.01); s.lineTo(0.34, -0.03); s.lineTo(0.35, -0.07); s.lineTo(0.27, -0.06); s.lineTo(0.26, -0.11); s.lineTo(0.18, -0.09); s.lineTo(0.15, -0.14); s.lineTo(0.08, -0.1); s.lineTo(0, -0.08); s.closePath();
      return new THREE.ShapeGeometry(s);
    })();
    G(wingGeo);
    const wings: THREE.Group[] = [];
    [1, -1].forEach((side) => {
      const piv = new THREE.Group(); piv.position.set(0.045 * side, 0.03, 0.01); pose.add(piv);
      const w = new THREE.Mesh(wingGeo, wm); w.raycast = () => {};
      w.rotation.x = Math.PI / 2; // lie flat, leading edge forward
      w.scale.x = side;            // mirror
      piv.add(w); wings.push(piv);
      const lip = new THREE.Mesh(wingGeo, wm); void lip;
    });
    return { bird, pose, flap(t: number, speed: number, amp: number) { const a = Math.sin(t * speed) * amp; wings[0].rotation.z = 0.25 + a; wings[1].rotation.z = -0.25 - a; } };
  };

  // ================================================================ band 4: small bird near the shoulder
  if (state.band === 4) {
    const b = makeBird(acc, acc2, 1.5, 0.12);
    group.add(b.bird);
    run.push((t) => {
      b.bird.position.set(sx + Math.sin(t * 0.6) * 0.06, sy + 0.04 + Math.sin(t * 2.4) * 0.035, 0.18 + Math.cos(t * 0.6) * 0.05);
      b.bird.rotation.y = 0.55 + Math.sin(t * 0.5) * 0.15; // faces the figure's front, a touch toward the viewer
      b.bird.rotation.x = Math.sin(t * 2.4 + 1) * 0.06;
      b.flap(t, 11, 0.75);
    });
  }

  // ================================================================ band 5: firebird circling behind
  if (state.band >= 5) {
    const fire = fxMix(acc, new THREE.Color(0xffa040), dk ? 0.3 : 0.1);
    const b = makeBird(fire, acc2, 1.6, 0.2);
    group.add(b.bird);
    const halo = sprite(fire, 0.9, dk ? 0.5 : 0.28, b.bird);
    halo.position.set(0, 0.02, -0.1);
    // long glowing tail feathers
    const tailM = new THREE.MeshBasicMaterial({ color: fxMix(fire, white, 0.3), transparent: true, opacity: dk ? 0.9 : 0.85, side: THREE.DoubleSide, depthWrite: false, toneMapped: false, blending: blend }); ms.push(tailM);
    for (let i = -2; i <= 2; i++) {
      const g = G(new THREE.PlaneGeometry(0.06, 0.55 - Math.abs(i) * 0.06)); g.translate(0, -(0.55 - Math.abs(i) * 0.06) / 2, 0);
      const f = new THREE.Mesh(g, tailM); f.raycast = () => {};
      f.position.set(i * 0.02, 0.0, -0.3); f.rotation.set(-Math.PI / 2 + 0.2 + Math.abs(i) * 0.04, 0, 0, 'YXZ'); f.rotation.y = i * 0.12;
      b.pose.add(f);
    }
    const N = 44, tr = trail(N, fire, 0.1);
    const cx = 0, cy = 2.0;
    const pathAt = (t: number) => {
      const th = Math.sin(t * 0.38 - 1.35) * 1.15 + 0.2;
      return { x: Math.sin(th) * 1.15, y: cy + Math.sin(t * 0.9) * 0.1 + Math.cos(th) * 0.08, z: -0.45 - Math.cos(th) * 0.65 + cx };
    };
    run.push((t) => {
      const p = pathAt(t), q = pathAt(t + 0.05);
      b.bird.position.set(p.x, p.y, p.z);
      b.bird.rotation.y = Math.atan2(q.x - p.x, q.z - p.z);
      b.bird.rotation.z = -(q.x - p.x) * 1.5; // bank into the turn
      b.flap(t, 5.5, 0.5);
      halo.material.opacity = (dk ? 0.5 : 0.28) * (0.9 + 0.1 * Math.sin(t * 5));
      for (let i = 0; i < N; i++) {
        const s = pathAt(t - i * 0.07 - 0.1);
        tr.set(i, s.x + Math.sin(i * 1.7 + t * 3) * 0.02, s.y - 0.03 - i * 0.004, s.z - 0.1 + Math.cos(i * 2.1 + t * 3) * 0.02, 1 - i / N);
      }
      tr.flush();
    });
  }

  rig.root.add(group);
  run.forEach((u) => u(1.5)); // pleasing static arrangement; also the first frame

  return {
    update(t: number) { if (quiet) return; for (const u of run) u(t); },
    dispose() {
      group.parent?.remove(group);
      geos.forEach((g) => g.dispose()); ms.forEach((m) => m.dispose()); texs.forEach((t) => t.dispose());
      geos.length = ms.length = texs.length = run.length = 0;
    },
  };
};
