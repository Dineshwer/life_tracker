import { useMemo, useRef, useState } from 'react';
import type { BackupInfo, ConflictEntry, SyncInfo } from '../sync/types';
import type { SyncActions } from '../components/sync/actions';
import { DataSyncSections } from '../components/sync/DataSyncSections';
import { SyncBannerView, bannerKind } from '../components/SyncBanner';
import { Page } from '../components/ui';
import './settings.css';

/** QA page (/sync-ui-lab): the Data & sync UI driven by fake data and a fake engine.
    ?state=synced|syncing|offline|error|conflicts|empty|local|stuck  &pending=N  &fail=flush,backups,take,restore,reset,signout,sync  &backups=none|slow|many  &online=0 */
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const day = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const CONFLICTS: ConflictEntry[] = [
  { at: ago(2 * 60e3), collection: 'habits', id: 'h1', kind: 'server-won', fields: ['minutes'], local: { id: 'h1', title: 'Meditation', minutes: 10 }, remote: { id: 'h1', title: 'Meditation', minutes: 20 } },
  { at: ago(50 * 60e3), collection: 'tasks', id: 't1', kind: 'deleted-remotely', local: { id: 't1', title: 'Renew passport' } },
  { at: ago(5 * 3600e3), collection: 'xp', id: 'x1', kind: 'merged', fields: ['amount', 'note'] },
  { at: ago(26 * 3600e3), collection: 'journal', id: 'j1', kind: 'local-won', fields: ['text'], remote: { id: 'j1', title: 'A very long journal entry title that goes on and on to test wrapping at narrow widths' } },
  { at: ago(3 * 86400e3), collection: 'wake', id: 'wake:2026-11-10', kind: 'deleted-locally' },
];

export default function SyncUiLab() {
  const q = useMemo(() => new URLSearchParams(location.search), []);
  const state = q.get('state') ?? 'synced';
  const fail = (q.get('fail') ?? '').split(',');
  const bmode = q.get('backups') ?? 'some';
  const online = q.get('online') !== '0' && state !== 'offline';
  const base: SyncInfo = { status: 'synced', live: true, lastSyncAt: ago(2 * 60e3), pending: 0, conflicts: [], deviceId: 'd3f9a1c27b44e', ...(state === 'conflicts' ? { conflicts: CONFLICTS } : {}) };
  const first: SyncInfo = state === 'syncing' ? { ...base, status: 'syncing', pending: 3 }
    : state === 'offline' ? { ...base, status: 'offline', live: false, pending: 4 }
    : state === 'error' ? { ...base, status: 'error', live: false, pending: 2, error: 'Failed to fetch' }
    : state === 'stuck' ? { ...base, pending: 5 } : base;
  const [info, setInfo] = useState<SyncInfo>({ ...first, pending: q.get('pending') ? +q.get('pending')! : first.pending });
  const ref = useRef(info); ref.current = info;
  const [stuck] = useState(state === 'stuck');
  const calls = ((window as unknown as { __lab?: string[] }).__lab ??= []);
  const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
  const [backups, setBackups] = useState<BackupInfo[]>(bmode === 'none' ? [] : Array.from({ length: bmode === 'many' ? 14 : 3 }, (_, i) => ({ taken_on: day(i), row_count: 1432 - i * 37 })));

  const actions: SyncActions = {
    getInfo: () => ref.current,
    syncNow: async () => { calls.push('syncNow'); setInfo((i) => ({ ...i, status: 'syncing' })); await wait(); if (fail.includes('sync')) { setInfo((i) => ({ ...i, status: 'error', error: 'Failed to fetch' })); throw new Error('Failed to fetch'); } setInfo((i) => ({ ...i, status: online ? 'synced' : 'offline', pending: online ? 0 : i.pending, lastSyncAt: online ? new Date().toISOString() : i.lastSyncAt, error: undefined })); },
    flushSync: async () => { calls.push('flushSync'); await wait(100); if (fail.includes('flush') || !online) throw new Error('offline'); if (q.get('flushclears') !== '0') setInfo((i) => ({ ...i, pending: 0 })); ref.current = { ...ref.current, pending: q.get('flushclears') !== '0' ? 0 : ref.current.pending }; },
    resetLocalCache: async () => { calls.push('resetLocalCache'); await wait(600); if (fail.includes('reset')) throw new Error('Failed to fetch'); },
    restoreConflict: (e) => { calls.push('restoreConflict:' + e.collection + ':' + e.id); },
    listBackups: async () => { calls.push('listBackups'); await wait(bmode === 'slow' ? 1200 : 150); if (fail.includes('backups')) throw new Error('Failed to fetch'); return backups; },
    takeBackup: async () => { calls.push('takeBackup'); await wait(); if (fail.includes('take')) throw new Error('rate limit: once per 10 minutes'); const b = { taken_on: today(), row_count: 1500 }; setBackups((l) => [b, ...l.filter((x) => x.taken_on !== b.taken_on)]); return b; },
    restoreBackup: async (d) => { calls.push('restoreBackup:' + d); await wait(500); if (fail.includes('restore')) throw new Error('Failed to fetch'); return 1395; },
    signOut: async () => { calls.push('signOut'); if (fail.includes('signout')) throw new Error('Failed to fetch'); (window as unknown as { __signedOut?: boolean }).__signedOut = true; },
  };
  // the lab's fake backups list changes after takeBackup: rebuild the action so listBackups sees it
  actions.listBackups = async () => { calls.push('listBackups'); await wait(bmode === 'slow' ? 1200 : 150); if (fail.includes('backups')) throw new Error('Failed to fetch'); return backupsRef.current; };
  const backupsRef = useRef(backups); backupsRef.current = backups;
  const stable = useRef(actions); stable.current = actions;
  const proxy = useMemo<SyncActions>(() => ({
    getInfo: () => stable.current.getInfo(), syncNow: () => stable.current.syncNow(), flushSync: () => stable.current.flushSync(), resetLocalCache: () => stable.current.resetLocalCache(),
    restoreConflict: (e) => stable.current.restoreConflict(e), listBackups: () => stable.current.listBackups(), takeBackup: () => stable.current.takeBackup(), restoreBackup: (d) => stable.current.restoreBackup(d), signOut: () => stable.current.signOut(),
  }), []);

  const kind = state === 'local' ? null : bannerKind(info, online, stuck);
  return (
    <>
      <SyncBannerView kind={kind} pending={info.pending} error={info.error ? 'the cloud could not be reached' : undefined} onRetry={() => { void proxy.syncNow().catch(() => {}); }} />
      <Page title="Settings" kicker="Sync UI lab">
        <div className="set-stack">
          <DataSyncSections info={info} online={online} email="dinesh@example.com" actions={proxy} local={state === 'local'} />
        </div>
      </Page>
    </>
  );
}
