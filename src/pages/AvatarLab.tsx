import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { loadBody } from '../components/avatar/body';
import { applyGear } from '../components/avatar/gear';
import { makeMaterials, applyLook } from '../components/avatar/looks';
import { bandFor } from '../lib/titles';
import type { AvatarState } from '../components/avatar/types';

/** QA harness (not linked anywhere): /avatar-lab?skin=canopy&mode=dark&lv=8&body=4&mind=3&skill=5&disc=2&streak=12&yaw=25&w=600&h=800
    Renders one frame of the 3D character with exactly the production modules, so each can be judged from a screenshot. */
export default function AvatarLab() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let dispose = () => {};
    let dead = false;
    const q = new URLSearchParams(location.search);
    const n = (k: string, d: number) => { const v = Number(q.get(k)); return Number.isFinite(v) && q.get(k) !== null ? v : d; };
    const skin = q.get('skin') ?? 'canopy', mode = (q.get('mode') as 'dark' | 'light') ?? 'dark';
    const level = n('lv', 8);
    const state: AvatarState = { level, band: bandFor(level) as AvatarState['band'], stats: { body: n('body', 4), mind: n('mind', 4), skill: n('skill', 4), discipline: n('disc', 4) }, streak: n('streak', 12), pct: n('pct', 0.62) };
    const w = n('w', 600), h = n('h', 800);
    document.documentElement.dataset.skin = skin; document.documentElement.dataset.theme = mode;
    const canvas = ref.current!; canvas.width = w; canvas.height = h;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(w, h, false);
    const scene = new THREE.Scene();
    const mats = makeMaterials(skin, mode);
    loadBody(state, mats).then(async (rig) => {
      if (dead) { rig.dispose(); return; }
      const gear = applyGear(rig, state, mats);
      scene.add(rig.root);
      const look = applyLook({ scene, renderer, skinId: skin, mode, mats, rig });
      // optional extras (setting, companion) when those modules exist: loaded dynamically so the lab works at every stage
      const extras: { update(t: number): void; dispose(): void }[] = [];
      try { const m = await import('../components/avatar/setting'); extras.push(m.buildSetting(state, mats, rig)); } catch { /* module not written yet */ }
      try { const m = await import('../components/avatar/companion'); extras.push(m.buildCompanion(state, mats, rig)); } catch { /* module not written yet */ }
      rig.root.rotation.y = THREE.MathUtils.degToRad(n('yaw', 0));
      const cam = new THREE.PerspectiveCamera(look.camera.fov, w / h, 0.1, 100);
      cam.position.set(0, look.camera.height, look.camera.distance); cam.lookAt(0, look.camera.lookAtY, 0);
      const t = n('t', 1.5);
      rig.update(t); gear.update(t); look.update(t); extras.forEach((x) => x.update(t));
      renderer.render(scene, cam);
      (window as unknown as { __done: boolean }).__done = true;
      dispose = () => { extras.forEach((x) => x.dispose()); gear.dispose(); look.dispose(); rig.dispose(); mats.dispose(); renderer.dispose(); };
    });
    return () => { dead = true; dispose(); };
  }, []);
  return <canvas ref={ref} style={{ display: 'block', width: 'min(100vw, 600px)', margin: '0 auto' }} />;
}
