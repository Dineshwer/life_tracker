/* A `Remote` over PGlite that calls the DB agent's SQL as a given user: push_records, plain `select ... where seq > $1`,
   list_backups, take_backup, restore_backup. No realtime (subscribe is a no-op). */
import type { PGlite } from '@electric-sql/pglite';
import type { BackupInfo, PushItem, PushResult, Remote, RemoteRow } from '../../src/sync/types';
import { asUser } from './db/harness';
import type { RemoteWorld } from './remote.contract';

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
const dateOnly = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const normRow = (r: any): RemoteRow => ({ collection: r.collection, id: r.id, data: r.data, deleted: !!r.deleted, version: Number(r.version), seq: Number(r.seq), updated_at: iso(r.updated_at), device_id: r.device_id ?? null });

export class PgliteRemote implements Remote {
  private ready: Promise<unknown>;
  constructor(private db: PGlite, readonly userId: string) { this.ready = db.query('insert into auth.users (id, email) values ($1, $2) on conflict do nothing', [userId, `${userId}@test.local`]); }
  private async s() { await this.ready; return asUser(this.db, this.userId); }
  async pull(sinceSeq: number, limit = 1000): Promise<RemoteRow[]> {
    const rows = await (await this.s()).query('select collection, id, data, deleted, version, seq, updated_at, device_id from public.records where seq > $1 order by seq asc limit $2', [sinceSeq, limit]);
    return rows.map(normRow);
  }
  async push(items: PushItem[], deviceId: string): Promise<PushResult[]> {
    const res = await (await this.s()).push(items, deviceId);
    return res.map((r: any): PushResult => ({ collection: r.collection, id: r.id, status: r.status, ...(r.row ? { row: normRow(r.row) } : {}), ...(r.reason ? { reason: r.reason } : {}) }));
  }
  subscribe(_onRow: (row: RemoteRow) => void, _onStatus: (s: 'live' | 'down') => void): () => void { return () => {}; }
  async listBackups(): Promise<BackupInfo[]> {
    const rows = await (await this.s()).query('select taken_on, row_count from public.list_backups()');
    return rows.map((r: any) => ({ taken_on: dateOnly(r.taken_on), row_count: Number(r.row_count) }));
  }
  async restoreBackup(takenOn: string): Promise<number> { return Number(await (await this.s()).rpc('restore_backup', { p_date: takenOn })); }
  async takeBackup(): Promise<BackupInfo> { const r = await (await this.s()).rpc('take_backup'); return { taken_on: dateOnly(r.taken_on), row_count: Number(r.row_count) }; }
}

/** A world over one PGlite database; each contract test uses its own fresh user (created lazily in auth.users). */
export function pgliteWorld(db: PGlite): RemoteWorld {
  return { remote: (u) => new PgliteRemote(db, u), close: () => db.close() };
}
