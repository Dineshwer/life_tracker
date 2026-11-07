import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { SkinEmblem } from '../emblems';
import { useEmblemData } from '../emblems/useEmblemData';
import { useActiveSkin } from '../../lib/activeSkin';
import { loadBody } from './body';
import { applyGear } from './gear';
import { applyLook, makeMaterials } from './looks';
import { buildSetting } from './setting';
import { buildCompanion } from './companion';
import { BAND_NAMES, BAND_UNLOCK_LINE } from './tiers';
import { bandFor } from '../../lib/titles';
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

interface Built { mats: Materials; rig: AvatarRig; gear: GearHandle; look: LookHandle; setting: GearHandle; companion: GearHandle; scene: THREE.Scene }
const NOOP: GearHandle = { update() {}, dispose() {} };
const FX_MS = 2400;

/** Warm the glb model cache (the loader agent's ./model exports preloadAvatar). Safe before that module exists. */
const modelMods = import.meta.glob('./model.ts');
export function warmAvatar() {
  try {
    Object.values(modelMods).forEach((load) => { (load() as Promise<{ preloadAvatar?: () => unknown }>).then((m) => m.preloadAvatar?.()).catch(() => {}); });
  } catch { /* ignore */ }
}

function disposeBuilt(b: Built) {
  const safe = (f: () => void) => { try { f(); } catch { /* ignore */ } };
  safe(() => b.companion.dispose()); safe(() => b.setting.dispose()); safe(() => b.gear.dispose());
  safe(() => b.look.dispose()); safe(() => b.rig.dispose());
  safe(() => disposeSceneGeometries(b.scene)); safe(() => b.mats.dispose());
}

/** how far the figure (with gear) reaches sideways and vertically, so wings / cape / weapon never leave the frame */
function measure(rig: AvatarRig) {
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  try {
    rig.root.updateWorldMatrix(true, true);
    const walk = (o: THREE.Object3D) => {
      if (o.userData && o.userData.noFit) return; // scenery (stones, tree, banner) never decides the framing
      const m = o as THREE.Mesh;
      if ((m.isMesh || (o as THREE.Points).isPoints) && m.geometry) {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        if (m.geometry.boundingBox) { tmp.copy(m.geometry.boundingBox).applyMatrix4(o.matrixWorld); box.union(tmp); }
      }
      o.children.forEach(walk);
    };
    walk(rig.root);
  } catch { /* ignore */ }
  if (box.isEmpty()) return { r: 0.8, top: 1.9, bottom: 0 };
  const r = Math.min(1.8, Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z)));
  return { r, top: Math.min(3, box.max.y), bottom: Math.max(-0.5, box.min.y) };
}

function disposeSceneGeometries(scene: THREE.Scene) {
  scene.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
}

export default function Avatar3D({ className }: { className?: string }) {
  const data = useEmblemData();
  const skinId = useActiveSkin();
  const [mode, setMode] = useState<Mode>(() => readMode());
  const [failed, setFailed] = useState(false);
  const [hintGone, setHintGone] = useState(false);
  const [celebrate, setCelebrate] = useState<{ level: number; band: number; newBand: boolean } | null>(null);
  const [rendererReady, setRendererReady] = useState(0);
  const [loaded, setLoaded] = useState(false);       // first build finished: canvas is showing the model
  const [loaderGone, setLoaderGone] = useState(false);

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
    let fit = { r: 0.8, top: 1.9, bottom: 0 };
    let pull = 0; // 0..1 level-up camera pull-back
    let fx: { start: number; ring: THREE.Mesh[]; pts: THREE.Points; vel: Float32Array } | null = null;
    let gen = 0;
    let loadTimer = 0;
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
      const vh = Math.tan(THREE.MathUtils.degToRad(camCfg.fov) / 2);
      const hh = vh * aspect;
      const dh = fit.r / hh + fit.r * 0.3;
      const dv = (Math.max(fit.top - camCfg.lookAtY, camCfg.lookAtY - fit.bottom) + 0.12) / vh + fit.r * 0.2;
      const base = camCfg.distance * k;
      const dist = Math.min(base * 1.6, Math.max(base, dh, dv));
      camera.fov = camCfg.fov; camera.aspect = aspect;
      camera.position.set(0, camCfg.height + pull * 0.25, dist * (1 + pull * 0.28));
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
      const p = (now - spinStart) / FX_MS;
      if (p >= 1) { spinStart = -1; return 0; }
      return ease(p) * Math.PI * 2;
    };
    const endFx = (scene?: THREE.Scene) => {
      if (!fx) return;
      fx.ring.forEach((m) => { scene?.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); });
      scene?.remove(fx.pts); fx.pts.geometry.dispose(); (fx.pts.material as THREE.Material).dispose();
      fx = null; pull = 0; placeCamera();
    };
    const updateFx = (now: number, scene: THREE.Scene) => {
      if (!fx) return;
      const p = (now - fx.start) / FX_MS;
      if (p >= 1) { endFx(scene); return; }
      pull = Math.sin(Math.PI * Math.min(1, p / 0.9)); placeCamera();
      fx.ring.forEach((m, i) => {
        const q = Math.min(1, Math.max(0, (p - i * 0.14) / 0.6));
        m.visible = q > 0 && q < 1;
        m.scale.setScalar(0.25 + ease(q) * 3.4);
        (m.material as THREE.MeshBasicMaterial).opacity = (1 - q) * 0.95;
      });
      const pos = fx.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      const tt = Math.max(0, p - 0.12) * FX_MS / 1000;
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(i, fx.vel[i * 3] * tt * 0.9, 0.1 + fx.vel[i * 3 + 1] * tt - 1.4 * tt * tt, fx.vel[i * 3 + 2] * tt * 0.9);
      }
      pos.needsUpdate = true;
      (fx.pts.material as THREE.PointsMaterial).opacity = p < 0.12 ? 0 : Math.max(0, 1 - (p - 0.12) / 0.88);
    };
    const startFx = (scene: THREE.Scene, mats: Materials, now: number) => {
      endFx(scene);
      const ring = [0, 1].map(() => {
        const m = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 72), new THREE.MeshBasicMaterial({ color: mats.accentHex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        m.rotation.x = -Math.PI / 2; m.position.y = 0.03; m.visible = false; scene.add(m); return m;
      });
      const N = 110, vel = new Float32Array(N * 3), arr = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const a = Math.random() * Math.PI * 2, sp = 0.5 + Math.random() * 1.6;
        vel[i * 3] = Math.cos(a) * sp; vel[i * 3 + 1] = 1.6 + Math.random() * 2.2; vel[i * 3 + 2] = Math.sin(a) * sp;
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: mats.accent2Hex, size: 0.07, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      pts.frustumCulled = false; scene.add(pts);
      fx = { start: now, ring, pts, vel };
    };
    const draw = (now: number) => {
      if (!built) return;
      const t = (now - t0) / 1000;
      built.rig.update(t); built.gear.update(t); built.look.update(t); built.setting.update(t); built.companion.update(t);
      built.rig.root.rotation.y = angle + spinOffset(now);
      if (fx) updateFx(now, built.scene);
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
      const my = ++gen;
      const st = stateRef.current, skin = skinRef.current, mode = modeRef.current;
      const mats = makeMaterials(skin, mode);
      clearTimeout(loadTimer);
      // offline / very slow first load: give up quietly and show the 2D emblem
      if (!built) loadTimer = window.setTimeout(() => { if (my === gen && !built) { gen++; mats.dispose(); setFailed(true); } }, 30000);
      loadBody(st, mats).then((rig) => {
        if (my !== gen || disposed) { try { rig.dispose(); } catch { /* ignore */ } mats.dispose(); return; }
        clearTimeout(loadTimer);
        const old = built; built = null;
        if (old) { endFx(old.scene); disposeBuilt(old); }
        try {
          const scene = new THREE.Scene();
          scene.add(rig.root);
          const gear = applyGear(rig, st, mats);
          const look = applyLook({ scene, renderer, skinId: skin, mode, mats, rig });
          let setting = NOOP, companion = NOOP;
          try { setting = buildSetting(st, mats, rig); } catch (e) { console.warn('setting failed', e); }
          try { companion = buildCompanion(st, mats, rig); } catch (e) { console.warn('companion failed', e); }
          built = { mats, rig, gear, look, setting, companion, scene };
          camCfg = look.camera;
          rig.update(0);
          fit = measure(rig);
        } catch (e) { console.error('Avatar3D build failed', e); setFailed(true); return; }
        resize();
        setLoaded(true);
      }).catch((e) => {
        if (my !== gen || disposed) { mats.dispose(); return; }
        console.warn('Avatar3D load failed, using 2D emblem', e); mats.dispose(); setFailed(true);
      });
    };

    api.current = { rebuild, requestRender, resize, celebrate: () => {
      if (reduced || !built) return;
      const now = performance.now();
      spinStart = now; startFx(built.scene, built.mats, now); requestRender();
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
      disposed = true; gen++; clearTimeout(loadTimer); cancelAnimationFrame(raf); raf = 0;
      ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('dblclick', reset); canvas.removeEventListener('keydown', onKey);
      canvas.removeEventListener('webglcontextlost', onLost);
      if (built) { endFx(built.scene); disposeBuilt(built); built = null; }
      renderer.dispose();
      api.current = null;
    };
  }, []);

  // rebuild on skin / mode / state change
  useEffect(() => {
    if (rendererReady) api.current?.rebuild();
  }, [rendererReady, skinId, mode, stateKey]);

  // loader overlay fades out after the cross-fade
  useEffect(() => {
    if (!loaded) return;
    const id = setTimeout(() => setLoaderGone(true), 700);
    return () => clearTimeout(id);
  }, [loaded]);

  // level-up moment (once, after the first build)
  const checked = useRef(false);
  const celebrateTimer = useRef(0);
  useEffect(() => {
    if (checked.current || !loaded) return;
    checked.current = true;
    const stored = lsGet(SEEN_KEY);
    const force = QS.get('levelup');
    const lv = stateRef.current.level;
    const band = stateRef.current.band;
    const lvUp = stored !== null && lv > Number(stored);
    const up = !!force || lvUp;
    const newBand = force === 'band' || (lvUp && bandFor(Number(stored)) < band);
    if (!QS.get('lv')) lsSet(SEEN_KEY, String(lv));
    if (up) {
      setCelebrate({ level: lv, band, newBand });
      api.current?.celebrate();
      celebrateTimer.current = window.setTimeout(() => setCelebrate(null), newBand ? 4600 : 2800);
    }
  }, [loaded]);
  useEffect(() => () => clearTimeout(celebrateTimer.current), []);

  if (failed) return <div className={className}><SkinEmblem /></div>;

  const label = `Your character, level ${state.level}, ${BAND_NAMES[state.band - 1]}. Drag to turn.`;
  return (
    <div ref={wrapRef} className={`av3-wrap ${className ?? ''}`} data-skin={skinId} data-ready={loaded ? 'true' : 'false'} data-celebrate={celebrate ? (celebrate.newBand ? 'band' : 'true') : 'false'}>
      <canvas ref={canvasRef} className="av3-canvas" tabIndex={0} role="img" aria-label={label} />
      {!loaderGone && <div className="av3-loading" data-done={loaded} aria-hidden="true"><SkinEmblem /></div>}
      <div className="av3-flash" aria-hidden="true" />
      {celebrate && (
        <div className="av3-cap display" role="status">
          <b>LEVEL UP</b><span>Level {celebrate.level}</span>
        </div>
      )}
      {celebrate?.newBand && <div className="av3-line" role="status">{BAND_UNLOCK_LINE[celebrate.band - 1]}</div>}
      <div className="av3-hint" data-hide={hintGone || !loaded} aria-hidden="true">Drag to turn</div>
    </div>
  );
}
