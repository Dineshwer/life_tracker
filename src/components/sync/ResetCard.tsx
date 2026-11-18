import { useState } from 'react';
import type { SyncInfo } from '../../sync/types';
import { Button, Sheet } from '../ui';
import { plural, readableError } from './format';
import type { SyncActions } from './actions';

type Phase = { s: 'idle' } | { s: 'running' } | { s: 'done' } | { s: 'error'; msg: string };

/** Explains where the data lives and offers a safe way to rebuild this device's copy from the cloud. */
export function ResetCard({ info, online, actions }: { info: SyncInfo; online: boolean; actions: SyncActions }) {
  const [open, setOpen] = useState(false);
  const [p, setP] = useState<Phase>({ s: 'idle' });
  const unsynced = info.pending > 0 || !online;
  const run = async () => {
    setP({ s: 'running' });
    try { try { await actions.flushSync(); } catch { /* offline: reset below will fail too and nothing is lost */ } await actions.resetLocalCache(); setP({ s: 'done' }); }
    catch (e) { setP({ s: 'error', msg: `Could not rebuild this device's copy: ${readableError(e)}. Nothing was changed.` }); }
  };
  const close = () => { if (p.s !== 'running') { setOpen(false); if (p.s !== 'idle') setP({ s: 'idle' }); } };
  return (
    <>
      <p className="set-note" style={{ marginTop: 0 }}>The copy in your account is the master. This device keeps a copy so the app works offline and loads quickly. Wiping this device's copy loses nothing that has synced: it is downloaded again from your account.</p>
      <div className="set-actions"><Button variant="ghost" className="ds-btn" onClick={() => { setP({ s: 'idle' }); setOpen(true); }}>Reset this device's copy</Button></div>
      <Sheet open={open} onClose={close} title="Reset this device's copy?">
        <div className="ds-sheet">
          {p.s === 'idle' && <>
            <p>This removes the copy of your data stored on this device and downloads it again from your account. It takes a few seconds.</p>
            {unsynced
              ? <p className="ds-warn"><strong>{info.pending > 0 ? `${plural(info.pending, 'change')} ${info.pending === 1 ? 'has' : 'have'} not uploaded yet` : 'This device is offline'}.</strong> {!online ? 'You need to be online to download your data again. ' : ''}Changes that have not uploaded will be lost.</p>
              : <p>Everything on this device has already synced, so nothing will be lost.</p>}
            <div className="ds-sheet-actions">
              <Button className="ds-btn" onClick={run}>Reset this device's copy</Button>
              <Button variant="ghost" className="ds-btn" onClick={close}>Cancel</Button>
            </div>
          </>}
          {p.s === 'running' && <p role="status" className="ds-progress"><span className="ds-spin" aria-hidden /> Downloading your data again. Please keep this open.</p>}
          {p.s === 'done' && <>
            <p role="status" className="ds-msg ok">Done. This device now matches your cloud copy.</p>
            <div className="ds-sheet-actions"><Button className="ds-btn" onClick={close}>Close</Button></div>
          </>}
          {p.s === 'error' && <>
            <p role="alert" className="ds-msg bad">{p.msg}</p>
            <div className="ds-sheet-actions"><Button className="ds-btn" onClick={run}>Try again</Button><Button variant="ghost" className="ds-btn" onClick={close}>Close</Button></div>
          </>}
        </div>
      </Sheet>
    </>
  );
}
