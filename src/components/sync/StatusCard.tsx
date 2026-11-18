import { useState } from 'react';
import type { SyncInfo } from '../../sync/types';
import { Button, Sheet } from '../ui';
import { headline, plural, readableError, relTime } from './format';
import { useNow, type SyncActions } from './actions';
import './sync.css';

/** The "Data & sync" status block: headline, facts, retry, and a sign-out that never silently drops unsynced changes. */
export function StatusCard({ info, online, email, actions }: { info: SyncInfo; online: boolean; email?: string; actions: SyncActions }) {
  const now = useNow();
  const h = headline(info, online, now);
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false);
  const [guard, setGuard] = useState<{ pending: number; offline: boolean } | null>(null);
  const [err, setErr] = useState('');

  const retry = async () => { setBusy(true); setErr(''); try { await actions.syncNow(); } catch (e) { setErr(`Could not sync: ${readableError(e)}.`); } setBusy(false); };
  const signOut = async () => {
    setSigning(true); setErr('');
    let flushed = true;
    try { await actions.flushSync(); } catch { flushed = false; }
    const i = actions.getInfo();
    const offline = !online || i.status === 'offline' || !flushed;
    if (i.pending > 0 || offline) { setGuard({ pending: i.pending, offline }); setSigning(false); return; }
    try { await actions.signOut(); } catch (e) { setErr(`Could not sign out: ${readableError(e)}.`); setSigning(false); }
  };
  const forceSignOut = async () => { setGuard(null); setSigning(true); try { await actions.signOut(); } catch (e) { setErr(`Could not sign out: ${readableError(e)}.`); setSigning(false); } };

  return (
    <>
      <div className={`ds-status tone-${h.tone}`}>
        <span className={`ds-dot${h.tone === 'busy' ? ' pulse' : ''}`} aria-hidden />
        <div className="ds-status-text" role="status" aria-live="polite">
          <strong className="ds-title">{h.title}</strong>
          <span className="ds-detail">{h.detail}</span>
        </div>
        <Button variant="ghost" className="ds-btn" onClick={retry} disabled={busy || info.status === 'syncing'}>{info.status === 'error' ? 'Retry' : busy ? 'Syncing…' : 'Sync now'}</Button>
      </div>
      {err && <p className="ds-msg bad" role="alert">{err}</p>}
      <dl className="ds-facts">
        <div><dt>Last sync</dt><dd>{info.lastSyncAt ? relTime(info.lastSyncAt, now) : 'Not yet'}</dd></div>
        <div><dt>Waiting to upload</dt><dd>{info.pending === 0 ? 'Nothing' : plural(info.pending, 'change')}</dd></div>
        <div><dt>Live updates</dt><dd>{info.live ? 'On. Changes from other devices arrive within seconds.' : 'Off. Other devices\' changes arrive on the next sync.'}</dd></div>
        <div><dt>This device</dt><dd><code className="ds-code">{info.deviceId.slice(0, 8)}</code> <span className="ds-chip">This device</span></dd></div>
        <div><dt>Account</dt><dd className="ds-email">{email ?? 'Signed in'}</dd></div>
      </dl>
      <div className="set-actions">
        <Button variant="ghost" className="ds-btn" onClick={signOut} disabled={signing}>{signing ? 'Checking…' : 'Sign out'}</Button>
      </div>

      <Sheet open={!!guard} onClose={() => setGuard(null)} title="Sign out with unsynced changes?">
        <div className="ds-sheet">
          <p>{guard?.pending ? `${plural(guard.pending, 'change')} on this device ${guard.pending === 1 ? 'has' : 'have'} not reached your cloud copy.` : 'This device is offline, so it could not confirm that everything was uploaded.'}</p>
          <p><strong>If you sign out now, unsynced changes on this device will be lost.</strong> Everything already synced stays safe in your account.</p>
          {guard?.offline && <p className="ds-hint">Tip: wait until you are back online, and sign out once the status says Synced.</p>}
          <div className="ds-sheet-actions">
            <Button className="ds-btn" onClick={() => setGuard(null)}>Stay signed in</Button>
            <Button variant="ghost" className="ds-btn ds-danger" onClick={forceSignOut}>Sign out anyway</Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
