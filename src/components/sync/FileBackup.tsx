import { useRef, useState } from 'react';
import { useStore } from '../../store';
import { Button, Sheet } from '../ui';
import { buildBackup, parseBackup } from '../../lib/backup';
import { summarize, type SummaryRow } from './backupFile';
import { plural } from './format';

const reason = (e: unknown) => { const m = e instanceof Error ? e.message.trim() : 'The file could not be read.'; return /[.!?]$/.test(m) ? m : m + '.'; };

/** Download a backup file, or restore from one. A file is validated and summarised before anything changes. */
export function FileBackup({ emphasis = false }: { emphasis?: boolean }) {
  const importAll = useStore((s) => s.importAll);
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [pending, setPending] = useState<{ parsed: Record<string, unknown>; rows: SummaryRow[]; settings: boolean; name: string; text: string; dropped: number } | null>(null);

  const download = () => {
    const blob = new Blob([JSON.stringify(buildBackup(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ledger-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg({ ok: true, t: 'Backup downloaded.' });
  };
  const choose = async (file?: File) => {
    if (!file) return;
    try {
      const text = await file.text();
      const { data, report } = parseBackup(text);
      const s = summarize(data, useStore.getState() as unknown as Record<string, unknown>);
      setMsg(null); setPending({ parsed: data, ...s, name: file.name, text, dropped: report.droppedTotal });
    } catch (e) { setPending(null); setMsg({ ok: false, t: `That file could not be restored: ${reason(e)} Nothing was changed.` }); }
    if (fileRef.current) fileRef.current.value = ''; // allow choosing the same file again
  };
  const apply = () => {
    if (!pending) return;
    try {
      const r = importAll(pending.text);
      setMsg({ ok: true, t: r.droppedTotal ? `Backup restored. ${plural(r.droppedTotal, 'invalid item was', 'invalid items were')} skipped.` : 'Backup restored.' });
    } catch (e) { setMsg({ ok: false, t: `That file could not be restored: ${reason(e)} Nothing was changed.` }); }
    setPending(null);
  };
  const nothing = pending && !pending.rows.length && !pending.settings;
  return (
    <>
      <div className="set-actions">
        <Button variant={emphasis ? 'solid' : 'ghost'} className="ds-btn" onClick={download}>Download backup file</Button>
        <Button variant="ghost" className="ds-btn" onClick={() => fileRef.current?.click()}>Restore from file</Button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => choose(e.target.files?.[0])} />
      </div>
      {msg && <p className={`ds-msg ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.t}</p>}
      <Sheet open={!!pending} onClose={() => setPending(null)} title="Restore from this file?">
        {pending && <div className="ds-sheet">
          <p>The file <strong className="ds-file">{pending.name}</strong> is a valid Ledger backup. Restoring replaces each list the file contains, as a whole, on this device.</p>
          {pending.dropped > 0 && <p className="ds-hint">{plural(pending.dropped, 'item in the file is invalid and will be skipped', 'items in the file are invalid and will be skipped')}.</p>}
          {nothing ? <p className="ds-empty">The file matches what is already here. Nothing would change.</p> : (
            <ul className="ds-sum">
              {pending.rows.map((r) => (
                <li key={r.key}><span>{r.label}</span><span>{[r.added && `${r.added} added`, r.replaced && `${r.replaced} replaced`, r.removed && `${r.removed} removed`].filter(Boolean).join(', ')}</span></li>
              ))}
              {pending.settings && <li><span>Settings</span><span>replaced</span></li>}
            </ul>
          )}
          {pending.rows.some((r) => r.removed) && <p className="ds-warn">{plural(pending.rows.reduce((n, r) => n + r.removed, 0), 'item')} on this device {pending.rows.reduce((n, r) => n + r.removed, 0) === 1 ? 'is' : 'are'} not in the file and will be removed, because the file's list replaces yours. Download a backup first if you might want them.</p>}
          <div className="ds-sheet-actions"><Button className="ds-btn" onClick={apply}>Restore</Button><Button variant="ghost" className="ds-btn" onClick={() => setPending(null)}>Cancel</Button></div>
        </div>}
      </Sheet>
    </>
  );
}
