import { useEffect, useState } from 'react';
import { onSyncStatus, pendingCount, syncNow, type SyncStatus } from '../sync';
import { useStore } from '../store';
import './sync-banner.css';

/** Shown only when something you changed has not reached the cloud yet. Everything stays on the device meanwhile. */
export default function SyncBanner() {
  const [status, setStatus] = useState<SyncStatus>('off');
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => onSyncStatus((s) => setStatus(s)), []);
  useEffect(() => { const a = () => setOnline(true), b = () => setOnline(false); addEventListener('online', a); addEventListener('offline', b); return () => { removeEventListener('online', a); removeEventListener('offline', b); }; }, []);
  // re-count whenever data changes or a sync finishes
  useEffect(() => { const t = setTimeout(() => setPending(pendingCount()), 50); return () => clearTimeout(t); }, [status]);
  useEffect(() => useStore.subscribe(() => setPending(pendingCount())), []);
  if (status === 'off') return null;
  const bad = status === 'error' || !online;
  if (!bad || pending === 0) return null;
  return (
    <div className="sync-banner" role="status">
      <span>{online ? 'Could not reach the cloud.' : 'You are offline.'} {pending} {pending === 1 ? 'change is' : 'changes are'} saved on this phone and will upload when it reconnects.</span>
      {online && <button onClick={() => syncNow()}>Retry now</button>}
    </div>
  );
}
