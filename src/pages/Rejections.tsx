import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useStore } from '../store';
import { Button, Field, Page, SectionHeader } from '../components/ui';
import RejectionMeter from './rejections/RejectionMeter';
import { REJECTION_GOAL, REJECTION_XP } from '../lib/rejections';
import { addDays, fmtLong, fromISO, today } from '../lib/dates';
import './rejections/rejections.css';

const fmtShort = (iso: string) => fromISO(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export default function Rejections() {
  const rejections = useStore((s) => s.rejections);
  const addRejection = useStore((s) => s.addRejection);
  const removeRejection = useStore((s) => s.removeRejection);
  const [what, setWhat] = useState('');
  const [who, setWho] = useState('');
  const [note, setNote] = useState('');
  const [flash, setFlash] = useState<{ text: string; sub?: string; k: number } | null>(null);
  const [openBlocks, setOpenBlocks] = useState<Record<number, boolean>>({});
  const whatRef = useRef<HTMLTextAreaElement>(null);

  // Stable numbering: oldest = #1
  const numbered = useMemo(() => [...rejections].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((r, i) => ({ ...r, n: i + 1 })), [rejections]);
  const total = numbered.length;
  const t = today();
  const todayCount = numbered.filter((r) => r.date === t).length;
  const weekAgo = addDays(t, -6);
  const weekCount = numbered.filter((r) => r.date >= weekAgo).length;

  const stats = useMemo(() => {
    if (total === 0) return { perDay: 0, eta: null as string | null };
    const first = numbered[0].date;
    const days = Math.max(1, Math.round((fromISO(t).getTime() - fromISO(first).getTime()) / 86400000) + 1);
    const perDay = total / days;
    const left = REJECTION_GOAL - total;
    const eta = left <= 0 ? null : total >= 5 ? addDays(t, Math.ceil(left / perDay)) : null;
    return { perDay, eta };
  }, [numbered, total, t]);

  // Group by block of 100, newest block first
  const blocks = useMemo(() => {
    const map = new Map<number, typeof numbered>();
    for (const r of numbered) { const b = Math.floor((r.n - 1) / 100); map.set(b, [...(map.get(b) ?? []), r]); }
    return [...map.entries()].sort((a, b) => b[0] - a[0]).map(([b, items]) => ({ b, items: [...items].reverse() }));
  }, [numbered]);
  const currentBlock = Math.floor(Math.max(0, total - 1) / 100);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!what.trim()) { whatRef.current?.focus(); return; }
    const res = addRejection(what, { who, note });
    setFlash({ text: `#${res.n} logged`, sub: res.milestone ? `${res.milestone} +${res.xp} XP` : `+${res.xp} XP`, k: Date.now() });
    setWhat(''); setWho(''); setNote('');
    whatRef.current?.focus();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); };

  const remove = (id: string, n: number) => { if (window.confirm(`Remove rejection #${n}? This also removes its XP.`)) removeRejection(id); };

  return (
    <Page title="Rejections" kicker="The 1,000 challenge">
      <section className="rj-hero card">
        <div className="rj-total">
          <div className="rj-big display">{total.toLocaleString()}</div>
          <div className="rj-of">of {REJECTION_GOAL.toLocaleString()}<span>{REJECTION_GOAL - total > 0 ? ` · ${(REJECTION_GOAL - total).toLocaleString()} to go` : ' · complete'}</span></div>
          <p className="rj-line display">Every no is a rep. Collect them.</p>
        </div>
        <RejectionMeter total={total} />
      </section>

      <div className="rj-stats">
        <div className="card rj-stat"><div className="label">Today</div><div className="display rj-stat-v">{todayCount}</div></div>
        <div className="card rj-stat"><div className="label">Last 7 days</div><div className="display rj-stat-v">{weekCount}</div></div>
        <div className="card rj-stat"><div className="label">Pace</div><div className="display rj-stat-v">{stats.perDay ? stats.perDay.toFixed(1) : '0'}<small>/day</small></div></div>
        <div className="card rj-stat"><div className="label">On pace to finish</div><div className="rj-stat-eta">{stats.eta ? fmtLong(stats.eta).replace(/^\w+,\s*/, '') : total >= REJECTION_GOAL ? 'Done' : 'Log 5 to see'}</div></div>
      </div>

      <SectionHeader label="Log a rejection" right={`+${REJECTION_XP} XP each`} />
      <form className="rj-composer card" onSubmit={submit}>
        <Field label="What did you do to get it?">
          <textarea ref={whatRef} rows={3} value={what} onChange={(e) => setWhat(e.target.value)} onKeyDown={onKey} placeholder="Asked the cafe owner for a free coffee with my business card…" />
        </Field>
        <div className="rj-row">
          <Field label="Who or where (optional)"><input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Corner cafe" /></Field>
          <Field label="What you learned (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="They said ask on weekdays" /></Field>
        </div>
        <div className="rj-actions">
          <Button type="submit" disabled={!what.trim()}>Log rejection</Button>
          <span className="rj-hint">Ctrl + Enter to save</span>
          {flash && <span key={flash.k} className="rj-flash" role="status"><b>{flash.text}</b> {flash.sub}</span>}
        </div>
      </form>

      <SectionHeader label="The log" right={`${total} entries`} />
      {total === 0 ? (
        <p className="rj-empty display">Nothing yet. The first one is the hardest, and it counts the same as the thousandth.</p>
      ) : (
        <div className="rj-blocks">
          {blocks.map(({ b, items }) => {
            const open = openBlocks[b] ?? b === currentBlock;
            const lo = b * 100 + 1; const hi = (b + 1) * 100;
            const complete = items.length === 100;
            return (
              <section key={b} className="rj-block">
                <button className="rj-block-head" aria-expanded={open} onClick={() => setOpenBlocks((o) => ({ ...o, [b]: !open }))}>
                  <span className="display rj-block-title">Block {b + 1}</span>
                  <span className="rj-block-range mono">#{lo}–{hi}</span>
                  <span className={`rj-block-state${complete ? ' done' : ''}`}>{complete ? 'Complete' : `${items.length} / 100`}</span>
                  <span className="rj-chevron" aria-hidden="true">{open ? '−' : '+'}</span>
                </button>
                {open && (
                  <ul className="rj-list">
                    {items.map((r) => (
                      <li key={r.id} className="rj-item">
                        <span className="rj-n mono">#{r.n}</span>
                        <div className="rj-body">
                          <div className="rj-what">{r.what}</div>
                          {(r.who || r.note) && <div className="rj-meta">{r.who && <span>{r.who}</span>}{r.who && r.note && <span aria-hidden="true"> · </span>}{r.note && <span className="rj-note">{r.note}</span>}</div>}
                        </div>
                        <span className="rj-date">{fmtShort(r.date)}</span>
                        <button className="rj-del" onClick={() => remove(r.id, r.n)} aria-label={`Remove rejection ${r.n}`}>Remove</button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </Page>
  );
}
