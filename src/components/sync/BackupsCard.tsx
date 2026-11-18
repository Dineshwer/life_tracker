import { useCallback, useEffect, useState } from 'react';
import type { BackupInfo } from '../../sync/types';
import { Button, Sheet } from '../ui';
import { dayLabel, plural, readableError, sentence } from './format';
import type { SyncActions } from './actions';

type Load = { s: 'loading' } | { s: 'ok'; items: BackupInfo[] } | { s: 'error'; msg: string };
type Restore = { s: 'confirm' } | { s: 'running' } | { s: 'done'; n: number } | { s: 'error'; msg: string };

/** Daily server backups: list, back up now, restore (with a strong confirmation). */
export function BackupsCard({ actions, online }: { actions: SyncActions; online: boolean }) {
  const [load, setLoad] = useState<Load>({ s: 'loading' });
  const [making, setMaking] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; t: string } | null>(null);
  const [target, setTarget] = useState<BackupInfo | null>(null);
  const [rs, setRs] = useState<Restore>({ s: 'confirm' });

  const refresh = useCallback(async () => {
    setLoad((l) => (l.s === 'ok' ? l : { s: 'loading' }));
    try { setLoad({ s: 'ok', items: (await actions.listBackups()).slice().sort((a, b) => b.taken_on.localeCompare(a.taken_on)) }); }
    catch (e) { setLoad({ s: 'error', msg: `Could not load your backups: ${readableError(e)}.` }); }
  }, [actions]);
  useEffect(() => { void refresh(); }, [refresh]);

  const make = async () => {
    setMaking(true); setNote(null);
    try { const b = await actions.takeBackup(); setNote({ ok: true, t: `Backed up ${plural(b.row_count, 'item')} on ${dayLabel(b.taken_on)}.` }); await refresh(); }
    catch (e) { setNote({ ok: false, t: sentence(`Could not back up: ${readableError(e)}`) }); }
    setMaking(false);
  };
  const open = (b: BackupInfo) => { setTarget(b); setRs({ s: 'confirm' }); };
  const close = () => { if (rs.s !== 'running') setTarget(null); };
  const restore = async () => {
    if (!target) return;
    setRs({ s: 'running' });
    try { const n = await actions.restoreBackup(target.taken_on); setRs({ s: 'done', n }); void refresh(); }
    catch (e) { setRs({ s: 'error', msg: sentence(`Could not restore this backup: ${readableError(e)}. Your current data was not changed`) }); }
  };

  return (
    <>
      <p className="set-note" style={{ marginTop: 0 }}>A backup of your cloud copy is taken every day and kept for 14 days.</p>
      <div className="set-actions"><Button variant="ghost" className="ds-btn" onClick={make} disabled={making || !online}>{making ? 'Backing up…' : 'Back up now'}</Button></div>
      {!online && <p className="ds-hint">Backups need an internet connection.</p>}
      {note && <p className={`ds-msg ${note.ok ? 'ok' : 'bad'}`} role={note.ok ? 'status' : 'alert'}>{note.t}</p>}
      {load.s === 'loading' && <p className="ds-empty" role="status">Loading backups…</p>}
      {load.s === 'error' && <div><p className="ds-msg bad" role="alert">{load.msg}</p><div className="set-actions"><Button variant="ghost" className="ds-btn" onClick={refresh}>Try again</Button></div></div>}
      {load.s === 'ok' && !load.items.length && <p className="ds-empty">No backups yet. The first one is taken automatically within a day, or use Back up now.</p>}
      {load.s === 'ok' && load.items.length > 0 && (
        <ul className="ds-list">
          {load.items.map((b) => (
            <li key={b.taken_on} className="ds-item">
              <div className="ds-item-main"><div className="ds-item-what">{dayLabel(b.taken_on)}</div><div className="ds-item-when">{plural(b.row_count, 'item')}</div></div>
              <Button variant="ghost" className="ds-btn" aria-label={`Restore backup from ${dayLabel(b.taken_on)}`} onClick={() => open(b)} disabled={!online}>Restore</Button>
            </li>
          ))}
        </ul>
      )}
      <Sheet open={!!target} onClose={close} title="Restore this backup?">
        {target && <div className="ds-sheet">
          {rs.s === 'confirm' && <>
            <p>You are about to restore the backup from <strong>{dayLabel(target.taken_on)}</strong> ({plural(target.row_count, 'item')}).</p>
            <p className="ds-warn"><strong>Every device signed in to your account will change</strong> to match that day. Anything you added or edited since then will disappear.</p>
            <p>Your current state is saved as a new backup first, as a safety copy first (recoverable via the SQL steps in the owner runbook).</p>
            <div className="ds-sheet-actions"><Button className="ds-btn" onClick={restore}>Restore this backup</Button><Button variant="ghost" className="ds-btn" onClick={close}>Cancel</Button></div>
          </>}
          {rs.s === 'running' && <p role="status" className="ds-progress"><span className="ds-spin" aria-hidden /> Restoring. Please keep this open.</p>}
          {rs.s === 'done' && <><p role="status" className="ds-msg ok">Restored {plural(rs.n, 'item')}. Your other devices will update shortly.</p><div className="ds-sheet-actions"><Button className="ds-btn" onClick={close}>Close</Button></div></>}
          {rs.s === 'error' && <><p role="alert" className="ds-msg bad">{rs.msg}</p><div className="ds-sheet-actions"><Button className="ds-btn" onClick={restore}>Try again</Button><Button variant="ghost" className="ds-btn" onClick={close}>Close</Button></div></>}
        </div>}
      </Sheet>
    </>
  );
}
