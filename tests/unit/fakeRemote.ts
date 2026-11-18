/* FakeServer + FakeRemote: an in-memory implementation of the sync contract (src/sync/types.ts) with EXACT server semantics.
   Several FakeRemote clients ("devices") share one FakeServer. The same behaviours are asserted against the real SQL by
   tests/unit/pgliteRemote.test.ts through tests/unit/remote.contract.ts. */
import { COLLECTIONS, LIMITS } from '../../src/sync/types';
import type { BackupInfo, PushItem, PushResult, Remote, RemoteRow } from '../../src/sync/types';

type Op = 'push' | 'pull' | 'any';
interface Fault { op: Op; remaining: number; skip: number; loseResponse: boolean; message: string }
interface Backup { taken_on: string; taken_at: number; rows: RemoteRow[] }
interface Sub { remote: FakeRemote; onRow: (r: RemoteRow) => void; onStatus: (s: 'live' | 'down') => void; queue: RemoteRow[] }

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const key = (c: string, id: string) => `${c}\u0000${id}`;
const isPlainObject = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);

export class FakeServer {
  /** injectable clock (ms epoch); the server stamps updated_at with it */
  clock: () => number = () => Date.now();
  /** artificial latency in ms (real timers); 0 = none */
  latency = 0;
  /** deliver realtime rows immediately (microtask). false = queue until deliverPending() */
  autoDeliver = true;
  seq = 0;
  readonly calls = { push: 0, pull: 0, pushItems: 0 };
  private tables = new Map<string, Map<string, RemoteRow>>();
  private backups = new Map<string, Backup[]>();
  private faults: Fault[] = [];
  private subs = new Set<Sub>();
  private realtimeUp = true;
  private offline = new Set<string>();

  /* ---------- test controls ---------- */
  /** make the next `n` calls of `op` throw (after letting `skip` calls through) */
  failNext(n = 1, op: Op = 'any', skip = 0, message = 'FakeServer: injected network failure') { this.faults.push({ op, remaining: n, skip, loseResponse: false, message }); }
  /** the next `n` pushes are APPLIED by the server but the response is lost (the client sees a thrown error) */
  loseResponseNext(n = 1, skip = 0) { this.faults.push({ op: 'push', remaining: n, skip, loseResponse: true, message: 'FakeServer: response lost after the write was applied' }); }
  clearFaults() { this.faults = []; }
  setOffline(device: string, offline: boolean) { if (offline) this.offline.add(device); else this.offline.delete(device); }
  isOffline(device: string) { return this.offline.has(device); }
  /** realtime connection drops: every subscriber gets 'down', rows written meanwhile are NOT delivered (they must be pulled) */
  dropRealtime() { this.realtimeUp = false; for (const s of this.subs) { s.queue = []; s.onStatus('down'); } }
  restoreRealtime() { this.realtimeUp = true; for (const s of this.subs) s.onStatus('live'); }
  /** deliver queued realtime rows (when autoDeliver is false) */
  deliverPending() { for (const s of this.subs) { const q = s.queue; s.queue = []; for (const r of q) if (!this.offline.has(s.remote.device)) s.onRow(clone(r)); } }
  pendingRealtime() { let n = 0; for (const s of this.subs) n += s.queue.length; return n; }
  /** delete every tombstone (simulates the 90-day purge). Returns how many were removed. */
  purgeTombstones(userId?: string): number {
    let n = 0;
    for (const [u, t] of this.tables) if (!userId || u === userId) for (const [k, r] of t) if (r.deleted) { t.delete(k); n++; }
    return n;
  }
  /** write a raw row bypassing validation (to simulate corrupt/foreign rows). Bumps version and seq like a real write. */
  injectRow(userId: string, row: { collection: string; id: string; data: unknown; deleted?: boolean }): RemoteRow {
    const t = this.table(userId); const prev = t.get(key(row.collection, row.id));
    return this.store(userId, { collection: row.collection, id: row.id, data: row.data, deleted: !!row.deleted }, (prev?.version ?? 0) + 1, 'injected', null);
  }
  /* ---------- inspection ---------- */
  allRows(userId: string): RemoteRow[] { return [...this.table(userId).values()].sort((a, b) => a.seq - b.seq).map(clone); }
  liveRows(userId: string, collection?: string): RemoteRow[] { return this.allRows(userId).filter(r => !r.deleted && (!collection || r.collection === collection)); }
  getRow(userId: string, collection: string, id: string): RemoteRow | undefined { return clone(this.table(userId).get(key(collection, id))); }
  /** canonical comparable snapshot of live data: { collection: { id: data } } */
  liveData(userId: string): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const r of this.liveRows(userId)) (out[r.collection] ||= {})[r.id] = r.data;
    return out;
  }

  /* ---------- internals used by FakeRemote ---------- */
  table(userId: string) { let t = this.tables.get(userId); if (!t) { t = new Map(); this.tables.set(userId, t); } return t; }
  private nowIso() { return new Date(this.clock()).toISOString(); }
  private store(userId: string, p: { collection: string; id: string; data: unknown; deleted: boolean }, version: number, deviceId: string, writer: FakeRemote | null): RemoteRow {
    const row: RemoteRow = { collection: p.collection, id: p.id, data: p.deleted ? {} : clone(p.data), deleted: p.deleted, version, seq: ++this.seq, updated_at: this.nowIso(), device_id: deviceId };
    this.table(userId).set(key(p.collection, p.id), row);
    this.broadcast(userId, row, writer);
    return clone(row);
  }
  private broadcast(userId: string, row: RemoteRow, writer: FakeRemote | null) {
    if (!this.realtimeUp) return;
    for (const s of this.subs) {
      if (s.remote.userId !== userId || s.remote === writer) continue;
      if (this.autoDeliver) { const r = clone(row); queueMicrotask(() => { if (this.subs.has(s) && this.realtimeUp && !this.offline.has(s.remote.device)) s.onRow(r); }); }
      else s.queue.push(clone(row));
    }
  }
  async gate(op: 'push' | 'pull', device: string): Promise<Fault | null> {
    this.calls[op]++;
    if (this.latency > 0) await new Promise(r => setTimeout(r, this.latency)); else await Promise.resolve();
    if (this.offline.has(device)) throw new Error('FakeServer: device is offline');
    for (const f of this.faults) {
      if (f.op !== 'any' && f.op !== op) continue;
      if (f.skip > 0) { f.skip--; return null; }
      if (f.remaining > 0) {
        f.remaining--;
        this.faults = this.faults.filter(x => x.remaining > 0);
        if (f.loseResponse) return f;
        throw new Error(f.message);
      }
    }
    return null;
  }
  validate(it: PushItem): string | null {
    if (!(COLLECTIONS as readonly string[]).includes(it.collection)) return `unknown collection: ${it.collection}`;
    if (typeof it.id !== 'string' || it.id.length === 0) return 'id must be a non-empty string';
    if (it.id.length > LIMITS.maxIdLength) return `id longer than ${LIMITS.maxIdLength}`;
    if (!isPlainObject(it.data)) return 'data must be a JSON object';
    if (typeof it.deleted !== 'boolean') return 'deleted must be a boolean';
    if (!Number.isInteger(it.base_version) || it.base_version < 0) return 'base_version must be a non-negative integer';
    if (Buffer.byteLength(JSON.stringify(it.data), 'utf8') > LIMITS.maxItemBytes) return `data larger than ${LIMITS.maxItemBytes} bytes`;
    return null;
  }
  applyPush(userId: string, items: PushItem[], deviceId: string, writer: FakeRemote): PushResult[] {
    if (!Array.isArray(items)) throw new Error('items must be an array');
    if (items.length > LIMITS.maxBatch) throw new Error(`batch too large: ${items.length} > ${LIMITS.maxBatch}`);
    this.calls.pushItems += items.length;
    const t = this.table(userId);
    return items.map((it): PushResult => {
      const base = { collection: it.collection, id: it.id };
      const bad = this.validate(it);
      if (bad) return { ...base, status: 'rejected', reason: bad };
      const cur = t.get(key(it.collection, it.id));
      if (!cur) {
        if (it.base_version > 0) return { ...base, status: 'gone' };
        return { ...base, status: 'ok', row: this.store(userId, it, 1, deviceId, writer) };
      }
      if (cur.version !== it.base_version) return { ...base, status: 'conflict', row: clone(cur) };
      return { ...base, status: 'ok', row: this.store(userId, it, cur.version + 1, deviceId, writer) };
    });
  }
  applyPull(userId: string, since: number, limit: number): RemoteRow[] {
    return [...this.table(userId).values()].filter(r => r.seq > since).sort((a, b) => a.seq - b.seq).slice(0, Math.max(0, limit)).map(clone);
  }
  addSub(s: Sub) { this.subs.add(s); if (this.realtimeUp) queueMicrotask(() => { if (this.subs.has(s)) s.onStatus('live'); }); else queueMicrotask(() => s.onStatus('down')); }
  removeSub(s: Sub) { this.subs.delete(s); }
  userBackups(userId: string) { let b = this.backups.get(userId); if (!b) { b = []; this.backups.set(userId, b); } return b; }
  takeBackupFor(userId: string): BackupInfo {
    const list = this.userBackups(userId); const now = this.clock(); const last = list[list.length - 1];
    const snapshotRows = () => this.allRows(userId).filter(r => !r.deleted);
    if (last && now - last.taken_at < 10 * 60_000) return { taken_on: last.taken_on, row_count: last.rows.length };
    const taken_on = new Date(now).toISOString().slice(0, 10);
    const rows = snapshotRows();
    const same = list.findIndex(b => b.taken_on === taken_on);
    const b: Backup = { taken_on, taken_at: now, rows };
    if (same >= 0) list[same] = b; else list.push(b);
    list.sort((a, c) => a.taken_on.localeCompare(c.taken_on));
    while (list.length > LIMITS.backupDays) list.shift();
    return { taken_on, row_count: rows.length };
  }
  restoreFor(userId: string, takenOn: string, deviceId: string, writer: FakeRemote): number {
    const b = this.userBackups(userId).find(x => x.taken_on === takenOn);
    if (!b) throw new Error(`no backup for ${takenOn}`);
    const t = this.table(userId); const snap = new Map(b.rows.map(r => [key(r.collection, r.id), r])); let n = 0;
    for (const s of snap.values()) {
      const cur = t.get(key(s.collection, s.id));
      if (!cur || cur.deleted || JSON.stringify(cur.data) !== JSON.stringify(s.data)) { this.store(userId, { collection: s.collection, id: s.id, data: s.data, deleted: false }, (cur?.version ?? 0) + 1, deviceId, writer); n++; }
    }
    for (const cur of [...t.values()]) if (!cur.deleted && !snap.has(key(cur.collection, cur.id))) { this.store(userId, { collection: cur.collection, id: cur.id, data: {}, deleted: true }, cur.version + 1, deviceId, writer); n++; }
    return n;
  }
}

export class FakeRemote implements Remote {
  constructor(readonly server: FakeServer, readonly userId: string, readonly device: string = 'device') {}
  async pull(sinceSeq: number, limit = 1000): Promise<RemoteRow[]> {
    await this.server.gate('pull', this.device);
    return this.server.applyPull(this.userId, sinceSeq, limit);
  }
  async push(items: PushItem[], deviceId: string): Promise<PushResult[]> {
    const lost = await this.server.gate('push', this.device);
    const res = this.server.applyPush(this.userId, clone(items), deviceId, this);
    if (lost) throw new Error(lost.message);
    return res;
  }
  subscribe(onRow: (row: RemoteRow) => void, onStatus: (s: 'live' | 'down') => void): () => void {
    const s: Sub = { remote: this, onRow, onStatus, queue: [] };
    this.server.addSub(s);
    return () => this.server.removeSub(s);
  }
  async listBackups(): Promise<BackupInfo[]> {
    await this.server.gate('pull', this.device);
    return this.server.userBackups(this.userId).map(b => ({ taken_on: b.taken_on, row_count: b.rows.length })).sort((a, b) => b.taken_on.localeCompare(a.taken_on));
  }
  async takeBackup(): Promise<BackupInfo> { await this.server.gate('push', this.device); return this.server.takeBackupFor(this.userId); }
  async restoreBackup(takenOn: string): Promise<number> { await this.server.gate('push', this.device); return this.server.restoreFor(this.userId, takenOn, this.device, this); }
}
