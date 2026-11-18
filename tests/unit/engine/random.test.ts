/* Model-based / property tests: N devices x M random operations in random order with a seeded RNG. The seed is in every failure message:
   re-run one seed with  SYNC_SEED=1234 npx vitest run tests/unit/engine/random.test.ts   (SYNC_SEEDS=50 runs more seeds). */
import { describe, expect, it } from 'vitest';
import { USER, converge, expectConverged, world } from './harness';
import type { Device } from './harness';

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const FIELDS = ['a', 'b', 'c'] as const;
const COLS = ['tasks', 'habits', 'journal'] as const;

interface Cfg { devices: number; ops: number; seed: number }
async function runRandom({ devices: nd, ops, seed }: Cfg) {
  const rand = rng(seed); const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const w = world(); const log: string[] = [];
  const devs: Device[] = []; for (let i = 0; i < nd; i++) devs.push(await w.make(`D${i}`).boot());
  const created = new Map<string, string>(); // key -> 'col/id'
  const everDeleted = new Set<string>(); const written = new Map<string, Set<unknown>>(); let n = 0;
  const wr = (k: string, f: string, v: unknown) => { const kk = `${k}#${f}`; if (!written.has(kk)) written.set(kk, new Set()); written.get(kk)!.add(v); };
  const ctx = () => `seed=${seed} devices=${nd} ops=${ops}\nlast ops:\n${log.slice(-25).join('\n')}`;
  try {
    for (let step = 0; step < ops; step++) {
      const d = pick(devs); const r = rand();
      if (r < 0.22) { // create
        const col = pick(COLS); const id = `i${++n}`; const item = { id, a: `init-${id}`, b: 0, c: 'x' }; d.add(col, item);
        created.set(`${col}/${id}`, d.name); for (const f of FIELDS) wr(`${col}/${id}`, f, item[f]); log.push(`${step} ${d.name} create ${col}/${id}`);
      } else if (r < 0.52) { // update a random subset of fields of a random local item
        const col = pick(COLS); const list = d.items(col); if (!list.length) continue; const it = pick(list); const patch: Record<string, unknown> = {};
        for (const f of FIELDS) if (rand() < 0.5) patch[f] = `${d.name}-${step}`; if (!Object.keys(patch).length) patch[pick(FIELDS)] = `${d.name}-${step}`;
        d.update(col, String(it.id), patch); for (const [f, v] of Object.entries(patch)) wr(`${col}/${it.id}`, f, v); log.push(`${step} ${d.name} update ${col}/${it.id} ${JSON.stringify(patch)}`);
      } else if (r < 0.60) { // delete
        const col = pick(COLS); const list = d.items(col); if (!list.length) continue; const it = pick(list); d.remove(col, String(it.id)); everDeleted.add(`${col}/${it.id}`); log.push(`${step} ${d.name} delete ${col}/${it.id}`);
      } else if (r < 0.70) { d.offline(); log.push(`${step} ${d.name} OFFLINE`); }
      else if (r < 0.80) { d.online(); log.push(`${step} ${d.name} online`); }
      else if (r < 0.90) { await d.sync(); log.push(`${step} ${d.name} sync`); }
      else if (r < 0.94) { const ms = Math.floor(rand() * 90_000); await w.clock.advance(ms); log.push(`${step} advance ${ms}`); }
      else if (r < 0.96) { w.server.dropRealtime(); log.push(`${step} realtime DROP`); }
      else if (r < 0.98) { w.server.restoreRealtime(); log.push(`${step} realtime up`); }
      else if (r < 0.99) { w.server.autoDeliver = !w.server.autoDeliver; log.push(`${step} autoDeliver=${w.server.autoDeliver}`); }
      else { w.server.deliverPending(); log.push(`${step} deliverPending`); }
    }
    w.server.autoDeliver = true; w.server.deliverPending(); w.server.restoreRealtime();
    await converge(devs, w.clock, w.server, 25);
    const c = ctx();
    expectConverged(devs, w.server, USER, c);
    const live = w.server.liveData(USER); const liveKeys = new Set<string>();
    for (const [col, m] of Object.entries(live)) for (const id of Object.keys(m)) liveKeys.add(`${col}/${id}`);
    for (const k of created.keys()) if (!everDeleted.has(k)) expect(liveKeys.has(k), `${c}\nacknowledged create of ${k} was lost`).toBe(true);
    for (const k of liveKeys) expect(created.has(k), `${c}\nserver holds ${k} that nobody created`).toBe(true);
    for (const [col, m] of Object.entries(live)) for (const [id, data] of Object.entries(m)) for (const f of FIELDS) {
      const v = (data as Record<string, unknown>)[f]; const set = written.get(`${col}/${id}#${f}`);
      expect(set?.has(v), `${c}\n${col}/${id}.${f} = ${JSON.stringify(v)} was never written by anyone (corruption)`).toBe(true);
    }
    for (const d of devs) expect(d.engine.info().status, `${c}\n${d.name} status (${d.engine.info().error})`).toBe('synced');
  } catch (e) { (e as Error).message = `[RANDOM TEST FAILED seed=${seed}]\n${(e as Error).message}`; throw e; }
}

const seeds = process.env.SYNC_SEED ? [Number(process.env.SYNC_SEED)] : Array.from({ length: Number(process.env.SYNC_SEEDS ?? 12) }, (_, i) => 1000 + i * 7919);
describe('engine: randomized multi-device convergence (model based)', () => {
  for (const seed of seeds) it(`seed ${seed}: 3 devices x 150 random operations converge, lose no create, corrupt no field`, async () => { await runRandom({ devices: 3, ops: 150, seed }); });
  for (const seed of seeds.slice(0, 3)) it(`seed ${seed}: 5 devices x 120 random operations converge`, async () => { await runRandom({ devices: 5, ops: 120, seed: seed + 1 }); });
});

describe('engine: serial model (no concurrency): every acknowledged write is exactly reflected everywhere', () => {
  for (const seed of seeds.slice(0, 6)) it(`seed ${seed}`, async () => {
    const rand = rng(seed); const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
    const w = world(); const devs: Device[] = []; for (let i = 0; i < 3; i++) devs.push(await w.make(`S${i}`).boot());
    const model = new Map<string, Record<string, unknown>>(); let n = 0; const log: string[] = [];
    try {
      for (let step = 0; step < 80; step++) {
        const d = pick(devs); await d.syncUntilClean(); // sees everything before acting
        const r = rand();
        if (r < 0.4 || model.size === 0) { const id = `m${++n}`; const it = { id, a: `v${step}`, b: step }; d.add('tasks', it); model.set(id, it); log.push(`${d.name} create ${id}`); }
        else if (r < 0.8) { const id = pick([...model.keys()]); const patch = { [pick(FIELDS)]: `u${step}` }; d.update('tasks', id, patch); model.set(id, { ...model.get(id)!, ...patch }); log.push(`${d.name} update ${id} ${JSON.stringify(patch)}`); }
        else { const id = pick([...model.keys()]); d.remove('tasks', id); model.delete(id); log.push(`${d.name} delete ${id}`); }
        await d.syncUntilClean();
      }
      for (const d of devs) await d.syncUntilClean();
      const expected: Record<string, unknown> = {}; for (const [id, v] of model) expected[id] = v;
      for (const d of devs) expect(d.snapshot().tasks ?? {}, `${d.name}`).toEqual(expected);
      expect(w.server.liveData(USER).tasks ?? {}).toEqual(expected); expectConverged(devs, w.server);
    } catch (e) { (e as Error).message = `[SERIAL TEST FAILED seed=${seed}] last ops:\n${log.slice(-15).join('\n')}\n${(e as Error).message}`; throw e; }
  });
});
