import { useEffect, useMemo, useRef, useState } from 'react';
import type { JournalEntry } from '../types';
import { Page, SectionHeader } from '../components/ui';
import { useStore, uid } from '../store';
import { fmtLong, fromISO, today, weekStart } from '../lib/dates';
import { Conversations, Dots, Sparkline } from './journal/Parts';
import './journal/journal.css';

const PROMPTS = [
  'What deserves your attention today, and what can wait?',
  'Describe one small thing that went quietly well.',
  'What are you avoiding, and what is the smallest step toward it?',
  'Whom did you learn something from lately?',
  'What would make tonight feel complete?',
  'Where did your energy go today, and was it worth it?',
  'Write the sentence you would like to be true by Sunday.',
];
const promptFor = (d: string) => PROMPTS[Math.floor(fromISO(d).getTime() / 864e5) % PROMPTS.length];

const WEEKLY = [
  { key: 'Wins', hint: 'What went well this week?' },
  { key: 'Failures', hint: 'Where did it fall short?' },
  { key: 'Lessons', hint: 'What did it teach you?' },
  { key: "Next week's focus", hint: 'The one thing to protect.' },
];
const parseWeekly = (body: string) => {
  const out: Record<string, string> = {};
  WEEKLY.forEach((w, i) => {
    const start = body.indexOf(`## ${w.key}\n`);
    if (start < 0) return;
    const from = start + w.key.length + 4;
    const next = WEEKLY.slice(i + 1).map((n) => body.indexOf(`\n## ${n.key}\n`, from)).filter((n) => n >= 0);
    out[w.key] = body.slice(from, next.length ? Math.min(...next) : undefined).trim();
  });
  return out;
};
const buildWeekly = (v: Record<string, string>) => WEEKLY.map((w) => `## ${w.key}\n${(v[w.key] ?? '').trim()}`).join('\n\n');

/** Debounced autosave of one entry; keeps a stable id across keystrokes. */
function useEntry(kind: JournalEntry['kind'], date: string) {
  const entries = useStore((s) => s.journal);
  const upsert = useStore((s) => s.upsert);
  const existing = entries.find((e) => e.kind === kind && e.date === date);
  const idRef = useRef(existing?.id ?? uid());
  const [saved, setSaved] = useState(false);
  const timer = useRef<number>();
  const latest = useRef<Partial<JournalEntry>>({});
  const pending = useRef(false);

  const flush = () => {
    window.clearTimeout(timer.current);
    if (!pending.current) return;
    pending.current = false;
    const cur = useStore.getState().journal.find((e) => e.id === idRef.current);
    upsert('journal', { body: '', ...cur, ...latest.current, id: idRef.current, date, kind } as JournalEntry);
    setSaved(true);
  };
  const save = (patch: Partial<JournalEntry>, immediate = false) => {
    latest.current = { ...latest.current, ...patch };
    pending.current = true; setSaved(false);
    window.clearTimeout(timer.current);
    if (immediate) flush(); else timer.current = window.setTimeout(flush, 800);
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps
  return { entry: existing, save, flush, saved };
}

const serifKey = 'lt-journal-serif';
const readSerif = () => { try { return localStorage.getItem(serifKey) === '1'; } catch { return false; } };

function Daily() {
  const d = today();
  const { entry, save, flush, saved } = useEntry('daily', d);
  const [body, setBody] = useState(entry?.body ?? '');
  const [mood, setMood] = useState(entry?.mood);
  const [energy, setEnergy] = useState(entry?.energy);
  const [serif, setSerif] = useState(readSerif);
  const toggleSerif = () => { const n = !serif; setSerif(n); try { localStorage.setItem(serifKey, n ? '1' : '0'); } catch { /* ignore */ } };
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  return (
    <div className="paper card j-fx" style={{ ['--i' as string]: 1 }}>
      <div className="paper-top">
        <div className="j-date display">{fmtLong(d)}</div>
        <button className={`j-serif${serif ? ' on' : ''}`} onClick={toggleSerif} aria-pressed={serif} title="Serif writing face"><span className="display">Aa</span></button>
      </div>
      <p className="j-prompt display">{promptFor(d)}</p>
      <textarea className={`j-area${serif ? ' serif' : ''}`} value={body} placeholder="Begin anywhere." aria-label="Journal entry"
        onChange={(e) => { setBody(e.target.value); save({ body: e.target.value }); }} onBlur={flush} />
      <div className="j-foot">
        <Dots label="Mood" value={mood} color="var(--mind)" onChange={(n) => { setMood(n); save({ mood: n }, true); }} />
        <Dots label="Energy" value={energy} color="var(--skill)" onChange={(n) => { setEnergy(n); save({ energy: n }, true); }} />
        <span className="saved">{saved ? 'Saved' : words ? `${words} ${words === 1 ? 'word' : 'words'}` : ''}</span>
      </div>
    </div>
  );
}

function Weekly() {
  const d = weekStart(today());
  const { entry, save, flush, saved } = useEntry('weekly', d);
  const [vals, setVals] = useState<Record<string, string>>(() => parseWeekly(entry?.body ?? ''));
  const set = (k: string, v: string) => { const n = { ...vals, [k]: v }; setVals(n); save({ body: buildWeekly(n) }); };
  return (
    <div className="paper card j-fx" style={{ ['--i' as string]: 1 }}>
      <div className="j-date display">Week of {fromISO(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}</div>
      <p className="j-prompt display">Four honest paragraphs. Short is fine.</p>
      {WEEKLY.map((w, i) => (
        <div className="w-field" key={w.key}>
          <h3><span className="w-num display">{String(i + 1).padStart(2, '0')}</span>{w.key}</h3>
          <textarea value={vals[w.key] ?? ''} placeholder={w.hint} aria-label={w.key} onChange={(e) => set(w.key, e.target.value)} onBlur={flush} />
        </div>
      ))}
      <div className="j-foot"><span className="saved">{saved ? 'Saved' : ''}</span></div>
    </div>
  );
}

function Archive() {
  const journal = useStore((s) => s.journal);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return journal.filter((e) => e.body.trim() && (!n || e.body.toLowerCase().includes(n))).sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind));
  }, [journal, q]);
  return (
    <section>
      <SectionHeader label="Archive" right={list.length || undefined} />
      <input className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search entries" aria-label="Search entries" />
      {list.length === 0 && <p className="j-empty">{q ? 'No entries match.' : 'Your entries will gather here.'}</p>}
      <div className="arch-list">
      {list.map((e, n) => (
        <div className="arch j-fx" key={e.id} style={{ ['--i' as string]: Math.min(n, 8) }}>
          <button onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
            <div className="arch-top">
              <span className="arch-date">{e.kind === 'weekly' ? 'Week of ' : ''}{fromISO(e.date).toLocaleDateString('en-IN', { weekday: e.kind === 'weekly' ? undefined : 'short', day: 'numeric', month: 'long', year: 'numeric' })}</span>
              <span className="label">{e.kind === 'weekly' ? 'Review' : [e.mood && `M${e.mood}`, e.energy && `E${e.energy}`].filter(Boolean).join(' · ')}</span>
            </div>
            {open !== e.id && <div className="arch-snip">{e.body.replace(/## /g, '').replace(/\s+/g, ' ')}</div>}
          </button>
          {open === e.id && <div className="arch-full">{e.body}</div>}
        </div>
      ))}
      </div>
    </section>
  );
}

export default function Journal() {
  const journal = useStore((s) => s.journal);
  const [mode, setMode] = useState<'daily' | 'weekly'>('daily');
  return (
    <Page title="Journal" kicker="Reflect">
      <div className="j-grid">
        <div>
          <div className="j-seg j-fx" style={{ ['--k' as string]: mode === 'daily' ? 0 : 1 }} role="tablist">
            <span className="j-seg-thumb" aria-hidden="true" />
            <button role="tab" aria-selected={mode === 'daily'} className={mode === 'daily' ? 'on' : ''} onClick={() => setMode('daily')}>Daily</button>
            <button role="tab" aria-selected={mode === 'weekly'} className={mode === 'weekly' ? 'on' : ''} onClick={() => setMode('weekly')}>Weekly review</button>
          </div>
          {mode === 'daily' ? <Daily key="d" /> : <Weekly key="w" />}
          <Archive />
        </div>
        <aside>
          <SectionHeader label="Mood & energy" />
          <div className="card spark-card j-fx" style={{ ['--i' as string]: 3 }}><Sparkline entries={journal} /></div>
          <Conversations />
        </aside>
      </div>
    </Page>
  );
}
