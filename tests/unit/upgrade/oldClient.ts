/* A faithful port of the OLD sync client (git b9dc102:src/sync.ts, the code the owner's live devices run today) so the tests can
   (a) populate a 0001 table EXACTLY the way the old client does, (b) keep a stale old client running after the SQL upgrade, and
   (c) produce the browser cache an old device really holds (persisted store 'life-tracker-v1' v2 + 'ledger-sync-<uid>' snapshot).
   The only abstraction is OldDb (what supabase-js does: select with order+range, upsert with onConflict). */
import type { PGlite } from '@electric-sql/pglite';
import { asUser } from '../db/harness';
import { LISTS, clone, type OldState, type Item } from './fixtures';

export interface OldRow { collection: string; id: string; data: unknown; deleted: boolean }
export interface OldDb { fetchAll(): Promise<OldRow[]>; upsert(rows: Record<string, unknown>[]): Promise<void> }

/** supabase-js .from('records').select('collection,id,data,deleted').order('updated_at') / .upsert(rows,{onConflict:'user_id,collection,id'}) as SQL under RLS. */
export function pgOldDb(db: PGlite, uid: string): OldDb {
  return {
    async fetchAll() { return asUser(db, uid).query<OldRow>('select collection, id, data, deleted from public.records order by updated_at'); },
    async upsert(rows) {
      await asUser(db, uid).query(
        `insert into public.records (user_id, collection, id, data, deleted, updated_at)
         select user_id, collection, id, data, deleted, updated_at from jsonb_to_recordset($1::jsonb)
           as x(user_id uuid, collection text, id text, data jsonb, deleted boolean, updated_at timestamptz)
         on conflict (user_id, collection, id) do update set data = excluded.data, deleted = excluded.deleted, updated_at = excluded.updated_at, user_id = excluded.user_id`,
        [JSON.stringify(rows)]);
    },
  };
}

const idOf = (col: string, it: Item) => (col === 'wake' ? `wake:${it.date}` : (it.id as string));

export class OldClient {
  state: OldState; synced = new Map<string, string>(); firstSync = true; saved: string | undefined;   // `saved` = what saveSnap() last wrote to localStorage (only at the end of a successful push)
  lastError: string | undefined; status = 'off';
  constructor(public uid: string, public db: OldDb, state: OldState, snapshot?: [string, string][]) {
    this.state = clone(state);
    if (snapshot) { this.synced = new Map(snapshot); this.firstSync = false; this.saved = JSON.stringify(snapshot); }
  }
  private flatten() {
    const out = new Map<string, { col: string; id: string; json: string; data: unknown }>();
    for (const col of LISTS) for (const it of this.state[col] as Item[]) { const id = idOf(col, it); out.set(`${col}/${id}`, { col, id, json: JSON.stringify(it), data: it }); }
    out.set('meta/settings', { col: 'meta', id: 'settings', json: JSON.stringify(this.state.settings), data: this.state.settings });
    return out;
  }
  private applyRemote(rows: OldRow[], replaceAll: boolean) {
    const local = this.flatten(); const lists: Record<string, Map<string, Item>> = {};
    for (const col of LISTS) { lists[col] = new Map(); if (!replaceAll) for (const it of this.state[col] as Item[]) lists[col].set(idOf(col, it), it); }
    let settings: unknown = replaceAll ? undefined : this.state.settings;
    for (const r of rows) {
      const key = `${r.collection}/${r.id}`; const cur = local.get(key);
      const unmodified = replaceAll || !cur || cur.json === this.synced.get(key);
      if (!unmodified) continue;
      if (r.collection === 'meta') { if (r.id === 'settings' && !r.deleted) { settings = r.data; this.synced.set(key, JSON.stringify(r.data)); } continue; }
      if (!lists[r.collection]) continue;
      if (r.deleted) { lists[r.collection].delete(r.id); this.synced.delete(key); }
      else { lists[r.collection].set(r.id, r.data as Item); this.synced.set(key, JSON.stringify(r.data)); }
    }
    for (const col of LISTS) (this.state as any)[col] = [...lists[col].values()];
    if (settings) this.state.settings = settings as Item;
  }
  private async push() {
    const local = this.flatten(); const rows: Record<string, unknown>[] = []; const now = new Date().toISOString();
    for (const [key, v] of local) if (this.synced.get(key) !== v.json) rows.push({ user_id: this.uid, collection: v.col, id: v.id, data: v.data, deleted: false, updated_at: now });
    for (const key of this.synced.keys()) if (!local.has(key)) { const [col, ...rest] = key.split('/'); rows.push({ user_id: this.uid, collection: col, id: rest.join('/'), data: {}, deleted: true, updated_at: now }); }
    for (let i = 0; i < rows.length; i += 500) await this.db.upsert(rows.slice(i, i + 500));
    for (const r of rows) { const key = `${r.collection}/${r.id}`; if (r.deleted) this.synced.delete(key); else this.synced.set(key, local.get(key)!.json); }
    this.saved = JSON.stringify([...this.synced]);   // saveSnap()
  }
  /** one old cycle (fetchAll, apply, push). Errors become status 'error' exactly like the old setStatus('error', message). */
  async cycle() {
    this.status = 'syncing';
    try {
      const rows = await this.db.fetchAll();
      if (this.firstSync) { if (rows.length > 0) this.applyRemote(rows, true); this.firstSync = false; } else this.applyRemote(rows, false);
      await this.push(); this.status = 'synced'; this.lastError = undefined;
    } catch (e) { this.status = 'error'; this.lastError = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e); }
  }
  pending() { let n = 0; const local = this.flatten(); for (const [k, v] of local) if (this.synced.get(k) !== v.json) n++; for (const k of this.synced.keys()) if (!local.has(k)) n++; return n; }
  /** what zustand-persist wrote to localStorage['life-tracker-v1'] (version 2, functions dropped) */
  persistedBlob(): string { return JSON.stringify({ state: this.state, version: 2 }); }
  /** localStorage['ledger-sync-<uid>'] */
  snapshotBlob(): string { return this.saved ?? JSON.stringify([...this.synced]); }
  /** the browser localStorage this old device holds */
  localStorageDump(extra: Record<string, string> = {}): Map<string, string> {
    const m = new Map<string, string>([['life-tracker-v1', this.persistedBlob()], [`ledger-sync-${this.uid}`, this.snapshotBlob()]]);
    for (const [k, v] of Object.entries(extra)) m.set(k, v);
    return m;
  }
}
