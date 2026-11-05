import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { supabase } from '../lib/supabase';
import { onSyncStatus, syncNow, type SyncStatus } from '../sync';
import { Button, Field, Page } from '../components/ui';
import ThemePicker from '../components/ThemePicker';
import './settings.css';

const PILL: Record<SyncStatus, { c: string; t: string }> = {
  synced: { c: 'var(--accent)', t: 'Synced' }, syncing: { c: 'var(--accent-2)', t: 'Syncing' },
  error: { c: 'var(--danger)', t: 'Sync error' }, off: { c: 'var(--faint)', t: 'Waiting' },
};

function syncLabel(s: SyncStatus, at?: Date, err?: string) {
  if (s === 'syncing') return 'Syncing…';
  if (s === 'synced') return `Synced${at ? ` at ${at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : ''}. Phone and laptop share this data.`;
  if (s === 'error') return `Sync paused: ${err ?? 'unknown error'}. Your data is safe on this device and will retry.`;
  return 'Signed in. Waiting to sync.';
}

export default function Settings() {
  const settings = useStore((s) => s.settings);
  const exportAll = useStore((s) => s.exportAll);
  const importAll = useStore((s) => s.importAll);
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const [sync, setSync] = useState<{ status: SyncStatus; at?: Date; err?: string }>({ status: 'off' });
  useEffect(() => onSyncStatus((status, at, err) => setSync({ status, at, err })), []);

  const patch = (p: Partial<typeof settings>) => useStore.setState((s) => ({ settings: { ...s.settings, ...p } }));

  const download = () => {
    const blob = new Blob([exportAll()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ledger-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg('Backup downloaded.');
  };

  const restore = async (file?: File) => {
    if (!file) return;
    try { importAll(await file.text()); setMsg('Backup restored.'); } catch { setMsg('That file could not be read.'); }
  };

  return (
    <Page title="Settings" kicker="Preferences">
      <div className="set-stack">
        <section className="card set-card">
          <div className="set-head"><h2 className="display set-h">Theme</h2></div>
          <p className="set-note" style={{ marginTop: 0 }}>Pick a look. It applies everywhere and syncs to your phone. Every theme has a dark and a light version.</p>
          <ThemePicker />
        </section>

        <section className="card set-card" style={{ ['--d' as string]: '60ms' }}>
          <div className="set-head"><h2 className="display set-h">Rhythm</h2></div>
          <div className="set-grid">
            <div className="wide"><Field label="Your name"><input value={settings.name} onChange={(e) => patch({ name: e.target.value })} /></Field></div>
            <Field label="Wake time, weekdays"><input type="time" value={settings.wakeTime} onChange={(e) => patch({ wakeTime: e.target.value })} /></Field>
            <Field label="Weekends (optional)"><input type="time" value={settings.weekendWake ?? ''} onChange={(e) => patch({ weekendWake: e.target.value || undefined })} /></Field>
          </div>
          <p className="set-note">Tapping "I'm up" within 15 minutes of this time earns full Discipline XP.</p>
        </section>

        {supabase && (
          <section className="card set-card" style={{ ['--d' as string]: '120ms' }}>
            <div className="set-head">
              <h2 className="display set-h">Account and sync</h2>
              <span className={`pill ${sync.status}`} style={{ ['--c' as string]: PILL[sync.status].c }}><span className="pill-dot" />{PILL[sync.status].t}</span>
            </div>
            <p className="set-note" role="status" style={{ marginTop: 0 }}>{syncLabel(sync.status, sync.at, sync.err)}</p>
            <div className="set-actions">
              <Button variant="ghost" onClick={syncNow}>Sync now</Button>
              <Button variant="ghost" onClick={() => supabase!.auth.signOut()}>Sign out</Button>
            </div>
          </section>
        )}

        <section className="card set-card" style={{ ['--d' as string]: '180ms' }}>
          <div className="set-head"><h2 className="display set-h">Your data</h2></div>
          <p className="set-note" style={{ marginTop: 0 }}>Everything is stored on this device until sync is switched on. Download a backup now and then.</p>
          <div className="set-actions">
            <Button variant="ghost" onClick={download}>Download backup</Button>
            <Button variant="ghost" onClick={() => fileRef.current?.click()}>Restore from file</Button>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => restore(e.target.files?.[0])} />
          </div>
          {msg && <p className="set-note set-msg" role="status">{msg}</p>}
        </section>
      </div>
    </Page>
  );
}
