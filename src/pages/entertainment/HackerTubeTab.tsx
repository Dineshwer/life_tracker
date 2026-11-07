import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store';
import { Button } from '../../components/ui';

/* HackerTube's open dataset (https://hackertube.org/data, ODC-BY): 6,454 YouTube videos that Hacker News readers
   keep recommending, with topics, summaries and the reason HN likes each. It ships with the app as public/hackertube.json
   and is fetched once, so browsing works offline and needs no key. */
type Row = [vid: string, title: string, channel: string, summary: string, why: string, level: string, type: string, news: number, cats: number[], score: number, recs: number, first: number, last: number];
type Data = { areas: { id: string; name: string }[]; cats: { id: string; name: string; a: string }[]; v: Row[] };
const VID = 0, TITLE = 1, CHANNEL = 2, SUMMARY = 3, WHY = 4, LEVEL = 5, TYPE = 6, NEWS = 7, CATS = 8, SCORE = 9, RECS = 10, LAST = 12;

const KEY = 'ledger-ht-topics';
const HIDE = 'ledger-feed-hidden';
// Starting picks: your interests. Change them any time with "Pick topics".
const STARTER = ['security-hacking', 'cryptography', 'privacy-surveillance', 'psychology-behavior', 'neuroscience-brain', 'startups-entrepreneurship', 'product-growth-marketing', 'management-leadership', 'university-lectures', 'productivity-self-improvement'];
const PAGE = 24;

let cache: Promise<Data> | null = null;
const load = () => (cache ??= fetch('/hackertube.json').then((r) => { if (!r.ok) throw new Error('load'); return r.json() as Promise<Data>; }));
const readList = (k: string, d: string[]): string[] => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return Array.isArray(v) ? v : d; } catch { return d; } };
const save = (k: string, v: string[]) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } };

export default function HackerTubeTab({ onPlay }: { onPlay: (ytId: string, title: string) => void }) {
  const videos = useStore((s) => s.videos);
  const addVideo = useStore((s) => s.addVideo);
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState(false);
  const [topics, setTopics] = useState<string[]>(() => readList(KEY, STARTER));
  const [hidden, setHidden] = useState<string[]>(() => readList(HIDE, []));
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'best' | 'new'>('best');
  const [n, setN] = useState(PAGE);

  useEffect(() => { load().then(setData).catch(() => setErr(true)); }, []);
  useEffect(() => { setN(PAGE); }, [topics, q, sort]);

  const catIndex = useMemo(() => new Map((data?.cats ?? []).map((c, i) => [c.id, i])), [data]);
  const sel = useMemo(() => new Set(topics.map((t) => catIndex.get(t)).filter((x): x is number => x !== undefined)), [topics, catIndex]);
  const known = useMemo(() => new Set(videos.map((v) => v.ytId)), [videos]);

  const counts = useMemo(() => { const c = new Array(data?.cats.length ?? 0).fill(0); data?.v.forEach((r) => { if (!r[NEWS]) r[CATS].forEach((i) => c[i]++); }); return c; }, [data]);

  const list = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const out = data.v.filter((r) => !r[NEWS] && !hidden.includes(r[VID]) && !known.has(r[VID])
      && (sel.size === 0 || r[CATS].some((i) => sel.has(i)))
      && (!needle || r[TITLE].toLowerCase().includes(needle) || r[CHANNEL].toLowerCase().includes(needle) || r[SUMMARY].toLowerCase().includes(needle)));
    return sort === 'best' ? out : [...out].sort((a, b) => b[LAST] - a[LAST] || b[SCORE] - a[SCORE]);
  }, [data, sel, q, sort, hidden, known]);

  const toggle = (id: string) => { const next = topics.includes(id) ? topics.filter((t) => t !== id) : [...topics, id]; setTopics(next); save(KEY, next); };
  const setAll = (next: string[]) => { setTopics(next); save(KEY, next); };
  const hide = (id: string) => { const next = [...hidden, id]; setHidden(next); save(HIDE, next.slice(-800)); };

  if (err) return <p className="en-empty">Could not load the HackerTube library. Check your connection and reload.</p>;
  if (!data) return <p className="en-empty">Loading the HackerTube library…</p>;

  return (
    <section className="en-feed-in">
      <div className="en-subbar">
        <div className="en-ht-sel">
          {topics.length === 0 ? <span className="en-feed-note" style={{ margin: 0 }}>Showing everything</span>
            : topics.slice(0, 6).map((t) => { const c = data.cats[catIndex.get(t) ?? -1]; return c ? <span className="en-chip" key={t}>{c.name}</span> : null; })}
          {topics.length > 6 && <span className="en-chip more">+{topics.length - 6}</span>}
        </div>
        <button className="en-link" onClick={() => setOpen((o) => !o)}>{open ? 'Done' : 'Pick topics'}</button>
      </div>

      {open && (
        <div className="card en-topics">
          <div className="en-topics-bar">
            <button className="en-link" onClick={() => setAll(STARTER)}>My starter picks</button>
            <button className="en-link" onClick={() => setAll([])}>Show everything</button>
            <span className="en-feed-note" style={{ margin: 0 }}>{topics.length} picked</span>
          </div>
          {data.areas.map((a) => (
            <div className="en-area" key={a.id}>
              <div className="label">{a.name}</div>
              <div className="en-cat-row">
                {data.cats.map((c, i) => c.a === a.id && counts[i] > 0 && (
                  <button key={c.id} className={`en-cat ${topics.includes(c.id) ? 'on' : ''}`} onClick={() => toggle(c.id)} aria-pressed={topics.includes(c.id)}>{c.name} <i>{counts[i]}</i></button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="en-ht-tools">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, channels, summaries" aria-label="Search the library" />
        <span className="en-filter"><button className={sort === 'best' ? 'on' : ''} onClick={() => setSort('best')}>Best</button><button className={sort === 'new' ? 'on' : ''} onClick={() => setSort('new')}>Newest</button></span>
      </div>
      <p className="en-feed-note">{list.length.toLocaleString()} videos that Hacker News readers recommend. From the open <a className="en-link" href="https://hackertube.org/data" target="_blank" rel="noreferrer noopener">HackerTube data</a>.</p>

      {list.length === 0 && <p className="en-empty">Nothing matches. Pick more topics or clear the search.</p>}
      <ul className="en-feed-list">
        {list.slice(0, n).map((r) => (
          <li className="en-card" key={r[VID]}>
            <button className="en-thumb" onClick={() => onPlay(r[VID], r[TITLE])} aria-label={`Play ${r[TITLE]}`}>
              <img src={`https://i.ytimg.com/vi/${r[VID]}/mqdefault.jpg`} alt="" loading="lazy" /><span className="en-play" aria-hidden>▶</span>
            </button>
            <div className="en-card-body">
              <div className="en-title">{r[TITLE]}</div>
              <div className="en-feed-meta">{r[CHANNEL]} · {r[RECS]} {r[RECS] === 1 ? 'person' : 'people'} recommend{r[RECS] === 1 ? 's' : ''}</div>
              <div className="en-tags">{r[TYPE] && <span className="en-tag">{r[TYPE]}</span>}{r[LEVEL] && r[LEVEL] !== 'general' && <span className="en-tag">{r[LEVEL]}</span>}</div>
              <p className="en-sum">{r[SUMMARY]}</p>
              {r[WHY] && <p className="en-why"><b>Why HN likes it:</b> {r[WHY]}</p>}
              <div className="en-actions en-card-act">
                <Button variant="ghost" onClick={() => onPlay(r[VID], r[TITLE])}>Watch</Button>
                <Button variant="text" onClick={() => addVideo(r[VID], r[TITLE], 'learn')}>Save for later</Button>
                <Button variant="text" onClick={() => hide(r[VID])}>Not for me</Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {n < list.length && <div className="en-more"><Button variant="ghost" onClick={() => setN((x) => x + PAGE)}>Show {Math.min(PAGE, list.length - n)} more</Button></div>}
    </section>
  );
}
