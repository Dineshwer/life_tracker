import { supabase } from './lib/supabase';
import { useStore } from './store';

/* Item-level sync. Each item (habit, task, set...) is one row in public.records.
   Rules:
   - First sync on a device: if the cloud has data, the cloud wins (so seed data never overwrites it);
     if the cloud is empty, local data is uploaded.
   - After that: an item changed locally is pushed; an item unchanged locally takes the cloud version.
   - Deletes are tombstones (deleted = true). */

const LISTS = ['habits', 'habitLogs', 'tasks', 'blocks', 'workouts', 'body', 'journal', 'rewards', 'xp', 'books', 'conversations', 'rejections', 'videos', 'channels', 'wake'] as const;
type Item = { id?: string; date?: string };

const idOf = (col: string, it: Item) => (col === 'wake' ? `wake:${it.date}` : (it.id as string));

export type SyncStatus = 'off' | 'syncing' | 'synced' | 'error';
let status: SyncStatus = 'off';
const listeners = new Set<(s: SyncStatus, at?: Date, err?: string) => void>();
let lastAt: Date | undefined; let lastErr: string | undefined;
const setStatus = (s: SyncStatus, err?: string) => { status = s; lastErr = err; if (s === 'synced') lastAt = new Date(); listeners.forEach((l) => l(s, lastAt, lastErr)); };
export const onSyncStatus = (l: (s: SyncStatus, at?: Date, err?: string) => void) => { listeners.add(l); l(status, lastAt, lastErr); return () => { listeners.delete(l); }; };

type Snapshot = Map<string, string>;
function flatten(): Map<string, { col: string; id: string; json: string; data: unknown }> {
  const st = useStore.getState() as unknown as Record<string, unknown>;
  const out = new Map<string, { col: string; id: string; json: string; data: unknown }>();
  for (const col of LISTS) for (const it of st[col] as Item[]) {
    const id = idOf(col, it); out.set(`${col}/${id}`, { col, id, json: JSON.stringify(it), data: it });
  }
  out.set('meta/settings', { col: 'meta', id: 'settings', json: JSON.stringify(st.settings), data: st.settings });
  return out;
}

let userId: string | null = null;
let synced: Snapshot = new Map();
let firstSync = true;
let busy = false; let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let unsub: (() => void) | undefined;
let poll: ReturnType<typeof setInterval> | undefined;

const snapKey = () => `ledger-sync-${userId}`;
function loadSnap() { try { const raw = localStorage.getItem(snapKey()); if (raw) { synced = new Map(JSON.parse(raw)); firstSync = false; } } catch { /* ignore */ } }
function saveSnap() { try { localStorage.setItem(snapKey(), JSON.stringify([...synced])); } catch { /* ignore */ } }

type Row = { collection: string; id: string; data: unknown; deleted: boolean };

async function fetchAll(): Promise<Row[]> {
  const rows: Row[] = []; const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase!.from('records').select('collection,id,data,deleted').order('updated_at').range(from, from + size - 1);
    if (error) throw error;
    rows.push(...(data as Row[]));
    if (!data || data.length < size) break;
  }
  return rows;
}

function applyRemote(rows: Row[], replaceAll: boolean) {
  const st = useStore.getState() as unknown as Record<string, unknown>;
  const local = flatten();
  const lists: Record<string, Map<string, Item>> = {};
  for (const col of LISTS) {
    lists[col] = new Map();
    if (!replaceAll) for (const it of st[col] as Item[]) lists[col].set(idOf(col, it) as string, it);
  }
  let settings: unknown = replaceAll ? undefined : st.settings;
  for (const r of rows) {
    const key = `${r.collection}/${r.id}`;
    const cur = local.get(key);
    const unmodified = replaceAll || !cur || cur.json === synced.get(key);
    if (!unmodified) continue; // local edit wins and will be pushed
    if (r.collection === 'meta') { if (r.id === 'settings' && !r.deleted) { settings = r.data; synced.set(key, JSON.stringify(r.data)); } continue; }
    if (!lists[r.collection]) continue;
    if (r.deleted) { lists[r.collection].delete(r.id); synced.delete(key); }
    else { lists[r.collection].set(r.id, r.data as Item); synced.set(key, JSON.stringify(r.data)); }
  }
  const patch: Record<string, unknown> = {};
  for (const col of LISTS) patch[col] = [...lists[col].values()];
  if (settings) patch.settings = settings;
  useStore.setState(patch as never);
}

async function push() {
  const local = flatten();
  const rows: Record<string, unknown>[] = [];
  const now = new Date().toISOString();
  for (const [key, v] of local) if (synced.get(key) !== v.json) rows.push({ user_id: userId, collection: v.col, id: v.id, data: v.data, deleted: false, updated_at: now });
  for (const key of synced.keys()) if (!local.has(key)) { const [col, ...rest] = key.split('/'); rows.push({ user_id: userId, collection: col, id: rest.join('/'), data: {}, deleted: true, updated_at: now }); }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase!.from('records').upsert(rows.slice(i, i + 500), { onConflict: 'user_id,collection,id' });
    if (error) throw error;
  }
  for (const r of rows) { const key = `${r.collection}/${r.id}`; if (r.deleted) synced.delete(key); else synced.set(key, local.get(key)!.json); }
  saveSnap();
}

async function cycle() {
  if (!supabase || !userId) return;
  if (busy) { again = true; return; }
  busy = true; setStatus('syncing');
  try {
    const rows = await fetchAll();
    if (firstSync) {
      if (rows.length > 0) applyRemote(rows, true); // cloud wins on a fresh device
      firstSync = false;
    } else {
      applyRemote(rows, false);
    }
    await push();
    setStatus('synced');
  } catch (e) {
    setStatus('error', e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
  } finally {
    busy = false;
    if (again) { again = false; schedule(300); }
  }
}

function schedule(ms = 1500) { clearTimeout(timer); timer = setTimeout(cycle, ms); }

export function startSync(uid: string) {
  stopSync(); userId = uid; synced = new Map(); firstSync = true; loadSnap();
  unsub = useStore.subscribe(() => schedule());
  const wake = () => { if (document.visibilityState === 'visible') schedule(200); };
  document.addEventListener('visibilitychange', wake); window.addEventListener('online', wake);
  poll = setInterval(() => schedule(0), 60_000);
  const prevUnsub = unsub; unsub = () => { prevUnsub?.(); document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', wake); };
  schedule(0);
}

export function stopSync() { unsub?.(); unsub = undefined; clearInterval(poll); clearTimeout(timer); userId = null; setStatus('off'); }
export const syncNow = () => schedule(0);
