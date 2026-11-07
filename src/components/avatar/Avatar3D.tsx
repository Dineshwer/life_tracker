import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { SkinEmblem } from '../emblems';
import { useEmblemData } from '../emblems/useEmblemData';
import { useActiveSkin } from '../../lib/activeSkin';
import { buildBody } from './body';
import { applyGear } from './gear';
import { applyLook, makeMaterials } from './looks';
import type { AvatarRig, AvatarState, Band, GearHandle, LookHandle, Materials } from './types';
import './avatar3d.css';

type Mode = 'dark' | 'light';
const SEEN_KEY = 'ledger-avatar-seen';
const ASPECT_REF = 4 / 5;
const QS = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const readMode = (): Mode => {
  const t = document.documentElement.dataset.theme;
  if (t === 'light' || t === 'dark') return t;
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
};
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

interface Built { mats: Materials; rig: AvatarRig; gear: GearHandle; look: LookHandle; scene: THREE.Scene }

function disposeSceneGeometries(scene: THREE.Scene) {
  scene.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
}

export default function Avatar3D({ className }: { className?: string }) {
  const data = useEmblemData();
  const skinId = useActiveSkin();
  const [mode, setMode] = useState<Mode>(() => readMode());
  const [failed, setFailed] = useState(false);
  const [hintGone, setHintGone] = useState(false);
  const [celebrate, setCelebrate] = useState(0); // 0 none, >0 level being celebrated
  const [rendererReady, setRendererReady] = useState(0);

  const state: AvatarState = useMemo(() => {
    const n = (k: string, d: number) => { const v = Number(QS.get(k)); return v >= 1 ? Math.round(v) : d; };
    const sv = QS.get('streak');
    return {
      level: data.level, band: Math.min(5, Math.max(1, data.band)) as Band, pct: data.pct,
      stats: { body: n('body', data.stats.body.level), mind: n('mind', data.stats.mind.level), skill: n('skill', data.stats.skill.level), discipline: n('disc', data.stats.discipline.level) },
      streak: sv !== null && sv !== '' && Number(sv) >= 0 ? Math.round(Number(sv)) : data.streak,
    };
  }, [data]);
  const stateKey = `${state.level}|${state.band}|${state.stats.body}|${state.stats.mind}|${state.stats.skill}|${state.stats.discipline}|${state.streak}`;
  const stateRef = useRef(state); stateRef.current = state;
  const skinRef = useRef(skinId); skinRef.current = skinId;

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const api = useRef<{ rebuild(): void; requestRender(): void; resize(): void; celebrate(): void } | null>(null);
  const modeRef = useRef(mode); modeRef.current = mode;

  // theme observer
  useEffect(() => {
    const mo = new MutationObserver(() => setMode(readMode()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);

  // hint chip
  useEffect(() => { const id = setTimeout(() => setHintGone(true), 4000); return () => clearTimeout(id); }, []);

  // renderer, loop, interaction (once per mount)
  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let renderer: THREE.WebGLRenderer;
    try {
      const probe = document.createElement('canvas');
      if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('no webgl');
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch { setFailed(true); return; }
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;

    const camera = new THREE.PerspectiveCamera(35, ASPECT_REF, 0.1, 100);
    let built: Built | null = null;
    let camCfg = { fov: 35, distance: 5.2, height: 1.1, lookAtY: 0.95 };
    let aspect = ASPECT_REF;
    let visible = true, docVisible = !document.hidden, raf = 0, last = 0, disposed = false;
    const reduced = reducedMotion();
    const t0 = performance.now();

    // rotation state
    let angle = 0, vel = 0, dragging = false, lastX = 0, lastMoveT = 0;
    let target: number | null = null;
    let spinStart = -1;
    let lastTap = 0, tapX = 0, downX = 0;

    const placeCamera = () => {
      const k = 1 / Math.min(1, aspect / ASPECT_REF);
      camera.fov = camCfg.fov; camera.aspect = aspect;
      camera.position.set(0, camCfg.height, camCfg.distance * k);
      camera.lookAt(0, camCfg.lookAtY, 0);
      camera.updateProjectionMatrix();
    };
    const resize = () => {
      const w = Math.max(1, wrap.clientWidth), h = Math.max(1, wrap.clientHeight);
      const pr = skinRef.current === 'arcade' ? 0.35 : Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(pr);
      renderer.setSize(w, h, false);
      aspect = w / h; placeCamera(); requestRender();
    };
    const spinOffset = (now: number) => {
      if (spinStart < 0) return 0;
      const p = (now - spinStart) / 1800;
      if (p >= 1) { spinStart = -1; return 0; }
      return ease(p) * Math.PI * 2;
    };
    const draw = (now: number) => {
      if (!built) return;
      const t = (now - t0) / 1000;
      built.rig.update(t); built.gear.update(t); built.look.update(t);
      built.rig.root.rotation.y = angle + spinOffset(now);
      try { renderer.render(built.scene, camera); } catch { setFailed(true); }
    };
    const shouldRun = () => visible && docVisible && !reduced && !disposed;
    const frame = (now: number) => {
      raf = 0;
      if (!shouldRun()) return;
      const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
      if (!dragging) {
        if (target !== null) {
          angle += (target - angle) * (1 - Math.exp(-dt * 10));
          if (Math.abs(target - angle) < 0.002) { angle = target; target = null; }
        } else if (Math.abs(vel) > 0.01) { angle += vel * dt; vel *= Math.exp(-dt * 3.2); } else vel = 0;
      }
      draw(now);
      raf = requestAnimationFrame(frame);
    };
    const kick = () => { if (shouldRun() && !raf) { last = 0; raf = requestAnimationFrame(frame); } };
    function requestRender() {
      if (reduced) { if (!raf) raf = requestAnimationFrame((n) => { raf = 0; draw(n); }); } else kick();
    }

    const rebuild = () => {
      const old = built; built = null;
      if (old) { old.gear.dispose(); old.look.dispose(); old.rig.dispose(); disposeSceneGeometries(old.scene); old.mats.dispose(); }
      try {
        const scene = new THREE.Scene();
        const mats = makeMaterials(skinRef.current, modeRef.current);
        const rig = buildBody(stateRef.current, mats);
        scene.add(rig.root);
        const gear = applyGear(rig, stateRef.current, mats);
        const look = applyLook({ scene, renderer, skinId: skinRef.current, mode: modeRef.current, mats, rig });
        built = { mats, rig, gear, look, scene };
        camCfg = look.camera;
      } catch (e) { console.error('Avatar3D build failed', e); setFailed(true); return; }
      resize();
    };

    api.current = { rebuild, requestRender, resize, celebrate: () => {
      if (reduced) return;
      spinStart = performance.now(); requestRender();
    } };

    // interaction
    const interacted = () => setHintGone(true);
    const onDown = (e: PointerEvent) => {
      dragging = true; vel = 0; target = null; lastX = downX = e.clientX; lastMoveT = e.timeStamp;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dtm = Math.max(1, e.timeStamp - lastMoveT);
      lastX = e.clientX; lastMoveT = e.timeStamp;
      if (Math.abs(e.clientX - downX) > 3) interacted();
      const da = dx * 0.012;
      angle += da;
      vel = reduced ? 0 : vel * 0.5 + (da / dtm) * 1000 * 0.5;
      requestRender();
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (e.timeStamp - lastMoveT > 90) vel = 0;
      const moved = Math.abs(e.clientX - downX) > 6;
      if (!moved && e.type === 'pointerup') {
        if (e.timeStamp - lastTap < 320 && Math.abs(e.clientX - tapX) < 24) { lastTap = 0; reset(); }
        else { lastTap = e.timeStamp; tapX = e.clientX; }
      }
      kick();
    };
    const reset = () => {
      vel = 0; interacted();
      target = Math.round(angle / (Math.PI * 2)) * Math.PI * 2;
      if (reduced) { angle = target; target = null; }
      requestRender();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault(); interacted();
        angle += (e.key === 'ArrowLeft' ? -1 : 1) * 0.3; target = null; vel = 0; requestRender();
      } else if (e.key === 'Home' || e.key === '0') { e.preventDefault(); reset(); }
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('dblclick', reset);
    canvas.addEventListener('keydown', onKey);
    const onLost = (e: Event) => { e.preventDefault(); setFailed(true); };
    canvas.addEventListener('webglcontextlost', onLost);

    const ro = new ResizeObserver(resize); ro.observe(wrap);
    const io = new IntersectionObserver((es) => { visible = es[es.length - 1].isIntersecting; if (visible) { requestRender(); } }, { threshold: 0.01 });
    io.observe(canvas);
    const onVis = () => { docVisible = !document.hidden; if (docVisible) requestRender(); };
    document.addEventListener('visibilitychange', onVis);

    setRendererReady((n) => n + 1);

    return () => {
      disposed = true; cancelAnimationFrame(raf); raf = 0;
      ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('dblclick', reset); canvas.removeEventListener('keydown', onKey);
      canvas.removeEventListener('webglcontextlost', onLost);
      if (built) { built.gear.dispose(); built.look.dispose(); built.rig.dispose(); disposeSceneGeometries(built.scene); built.mats.dispose(); built = null; }
      renderer.dispose();
      api.current = null;
    };
  }, []);

  // rebuild on skin / mode / state change
  useEffect(() => {
    if (rendererReady) api.current?.rebuild();
  }, [rendererReady, skinId, mode, stateKey]);

  // level-up moment
  const checked = useRef(false);
  useEffect(() => {
    if (checked.current || !rendererReady) return;
    checked.current = true;
    const stored = lsGet(SEEN_KEY);
    const forced = QS.get('levelup') === '1';
    const lv = stateRef.current.level;
    const up = forced || (stored !== null && lv > Number(stored));
    if (!QS.get('lv')) lsSet(SEEN_KEY, String(lv));
    if (up) {
      setCelebrate(lv); api.current?.celebrate();
      const id = setTimeout(() => setCelebrate(0), 2700);
      return () => clearTimeout(id);
    }
  }, [rendererReady]);

  if (failed) return <div className={className}><SkinEmblem /></div>;

  const label = `Your character, level ${state.level}, ${['Seedling', 'Sapling', 'Rooted', 'Branching', 'Canopy'][state.band - 1]}. Drag to turn.`;
  return (
    <div ref={wrapRef} className={`av3-wrap ${className ?? ''}`} data-skin={skinId} data-celebrate={celebrate ? 'true' : 'false'}>
      <canvas ref={canvasRef} className="av3-canvas" tabIndex={0} role="img" aria-label={label} />
      <div className="av3-flash" aria-hidden="true" />
      {celebrate > 0 && <div className="av3-cap display" role="status"><b>LEVEL UP</b><span>Level {celebrate}</span></div>}
      <div className="av3-hint" data-hide={hintGone} aria-hidden="true">Drag to turn</div>
    </div>
  );
}
