import { useEffect, useState } from 'react';
import type { SyncInfo } from '../sync/types';
import { useSyncInfo, syncNow } from '../sync/api';
import { useOnline } from './sync/actions';
import { plural } from './sync/format';
import { Button } from './ui';
import './sync-banner.css';

export type BannerKind = 'offline' | 'error' | 'stuck' | null;
export const STUCK_MS = 60_000;

/** What, if anything, the user needs to know. Sync being off (local-only, signed out) is never worth a banner. */
export function bannerKind(info: SyncInfo, online: boolean, stuck: boolean): BannerKind {
  if (info.status === 'off') return null;
  if (info.status === 'error') return 'error';
  if ((info.status === 'offline' || !online) && info.pending > 0) return 'offline';
  if (online && info.pending > 0 && stuck) return 'stuck';
  return null;
}

export function SyncBannerView({ kind, pending, error, onRetry, retrying }: { kind: BannerKind; pending: number; error?: string; onRetry: () => void; retrying?: boolean }) {
  if (!kind) return null;
  const saved = pending > 0 ? ` ${plural(pending, 'change is', 'changes are')} saved on this device and will upload when you are back online.` : '';
  const text = kind === 'offline' ? `You are offline.${saved}`
    : kind === 'stuck' ? `${plural(pending, 'change has', 'changes have')} not uploaded yet. They are saved on this device.`
    : `Sync has a problem${error ? `: ${error}` : ''}.${pending > 0 ? ` ${plural(pending, 'change is', 'changes are')} saved on this device.` : ' Your data is safe on this device.'}`;
  return (
    <div className={`sync-banner ${kind}`} role="status" data-testid="sync-banner">
      <span className="sync-banner-text">{text}</span>
      {kind !== 'offline' && <Button variant="ghost" className="sync-banner-btn" onClick={onRetry} disabled={retrying}>{retrying ? 'Trying…' : 'Retry'}</Button>}
    </div>
  );
}

/** True once there have been pending changes, online, for over a minute without them clearing. */
function useStuck(pending: number, online: boolean) {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    setStuck(false);
    if (pending === 0 || !online) return;
    const t = setTimeout(() => setStuck(true), STUCK_MS);
    return () => clearTimeout(t);
  }, [pending > 0, online]); // eslint-disable-line react-hooks/exhaustive-deps
  return stuck;
}

export default function SyncBanner() {
  const info = useSyncInfo();
  const online = useOnline();
  const stuck = useStuck(info.pending, online);
  const [busy, setBusy] = useState(false);
  const kind = bannerKind(info, online, stuck);
  const retry = async () => { setBusy(true); try { await syncNow(); } catch { /* status shows the error */ } setBusy(false); };
  return <SyncBannerView kind={kind} pending={info.pending} error={info.error ? info.error.replace(/\.$/, '') : undefined} onRetry={retry} retrying={busy} />;
}
