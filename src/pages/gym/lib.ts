import type { Workout, WorkoutSet, BodyEntry } from '../../types';
import { fromISO } from '../../lib/dates';

export type Unit = WorkoutSet['unit'];
export type PRType = 'weight' | 'reps' | 'hold';

/** Convention: for unit 'sec' the `reps` field holds the hold duration in seconds. */
export const norm = (s: string) => s.trim().toLowerCase();
export const PR_LABEL: Record<PRType, string> = { weight: 'Heaviest', reps: 'Most reps', hold: 'Longest hold' };
export const shortDate = (d: string) => fromISO(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
export const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function fmtSet(s: WorkoutSet): string {
  if (s.unit === 'sec') return `${s.reps}s hold`;
  if (s.unit === 'bw') return `${s.reps} reps`;
  return `${s.reps} × ${num(s.weight)} kg`;
}

const byDate = (ws: Workout[]) => [...ws].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

interface Best { weight: number; reps: number; repsAt: Map<number, number>; n: number }

/** Walk history chronologically; flag sets that beat everything before them. First-ever sets are never PRs. */
export function computePRs(workouts: Workout[]): Map<string, PRType[]> {
  const out = new Map<string, PRType[]>();
  const bests = new Map<string, Best>();
  for (const w of byDate(workouts)) {
    for (const s of w.sets) {
      if (!(s.reps > 0)) continue;
      const key = `${norm(s.exercise)}|${s.unit}`;
      const b = bests.get(key) ?? { weight: 0, reps: 0, repsAt: new Map(), n: 0 };
      const types: PRType[] = [];
      if (b.n > 0) {
        if (s.unit === 'kg') {
          if (s.weight > b.weight) types.push('weight');
          else if (b.repsAt.has(s.weight) && s.reps > (b.repsAt.get(s.weight) ?? 0)) types.push('reps');
        } else if (s.unit === 'bw') { if (s.reps > b.reps) types.push('reps'); }
        else if (s.reps > b.reps) types.push('hold');
      }
      if (types.length) out.set(s.id, types);
      b.n++; b.reps = Math.max(b.reps, s.reps); b.weight = Math.max(b.weight, s.weight);
      b.repsAt.set(s.weight, Math.max(b.repsAt.get(s.weight) ?? 0, s.reps));
      bests.set(key, b);
    }
  }
  return out;
}

/** Distinct exercise names (original casing of most recent use), most recent first. */
export function exerciseNames(workouts: Workout[]): string[] {
  const seen = new Map<string, string>();
  for (const w of byDate(workouts).reverse()) for (const s of [...w.sets].reverse()) if (!seen.has(norm(s.exercise))) seen.set(norm(s.exercise), s.exercise);
  return [...seen.values()];
}

export function lastSession(workouts: Workout[], name: string, excludeId?: string): { date: string; sets: WorkoutSet[] } | null {
  const n = norm(name); if (!n) return null;
  for (const w of byDate(workouts).reverse()) {
    if (w.id === excludeId) continue;
    const sets = w.sets.filter((s) => norm(s.exercise) === n);
    if (sets.length) return { date: w.date, sets };
  }
  return null;
}

export interface BoardRow { exercise: string; unit: Unit; value: number; reps: number; date: string; sessions: number; last: string }

export const metric = (s: WorkoutSet) => (s.unit === 'kg' ? s.weight : s.reps);
export const unitSuffix = (u: Unit) => (u === 'kg' ? 'kg' : u === 'sec' ? 's' : 'reps');

export function prBoard(workouts: Workout[]): BoardRow[] {
  const rows = new Map<string, BoardRow & { ids: Set<string> }>();
  for (const w of byDate(workouts)) for (const s of w.sets) {
    if (!(s.reps > 0)) continue;
    const key = `${norm(s.exercise)}|${s.unit}`;
    const r = rows.get(key) ?? { exercise: s.exercise, unit: s.unit, value: 0, reps: 0, date: w.date, sessions: 0, last: w.date, ids: new Set<string>() };
    r.exercise = s.exercise; r.last = w.date; r.ids.add(w.id);
    const m = metric(s);
    if (m > r.value || (m === r.value && s.reps > r.reps && s.unit === 'kg')) { if (m > r.value) r.date = w.date; r.value = m; r.reps = s.reps; }
    rows.set(key, r);
  }
  return [...rows.values()].map((r) => ({ ...r, sessions: r.ids.size })).sort((a, b) => (a.last < b.last ? 1 : -1));
}

export function seriesFor(workouts: Workout[], name: string, unit: Unit): { date: string; value: number }[] {
  const m = new Map<string, number>();
  for (const w of byDate(workouts)) for (const s of w.sets) {
    if (norm(s.exercise) !== norm(name) || s.unit !== unit || !(s.reps > 0)) continue;
    m.set(w.date, Math.max(m.get(w.date) ?? 0, metric(s)));
  }
  return [...m.entries()].map(([date, value]) => ({ date, value }));
}

export const bodyWeightSeries = (body: BodyEntry[]) =>
  [...body].filter((b) => b.weightKg != null).sort((a, b) => (a.date < b.date ? -1 : 1)).map((b) => ({ date: b.date, value: b.weightKg as number }));

// ---- plan (local to this page) ----
export interface PlanExercise { id: string; name: string; sets: number; reps: number; unit: Unit }
export interface PlanSession { id: string; name: string; days: number[]; exercises: PlanExercise[] }
export interface Plan { sessions: PlanSession[] }
const PLAN_KEY = 'ledger-gym-plan';

export const defaultPlan = (): Plan => ({
  sessions: ['A', 'B', 'C', 'D'].map((l) => ({ id: `s${l}`, name: `Session ${l}`, days: [], exercises: [] })),
});
export function loadPlan(): Plan {
  try {
    const raw = localStorage.getItem(PLAN_KEY);
    if (raw) { const p = JSON.parse(raw) as Plan; if (Array.isArray(p.sessions)) return p; }
  } catch { /* ignore */ }
  return defaultPlan();
}
export function savePlan(p: Plan) { try { localStorage.setItem(PLAN_KEY, JSON.stringify(p)); } catch { /* ignore */ } }

/** Downscale an image file to a JPEG data URL (max 800px, quality 0.7). */
export function downscale(file: File, max = 800): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const ctx = c.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error('canvas')); return; }
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.src = url;
  });
}
