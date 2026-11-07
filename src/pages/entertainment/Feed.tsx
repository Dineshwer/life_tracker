import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store';
import { Button, SectionHeader } from '../../components/ui';

/* A finite, quality-first feed. Source: videos that Hacker News readers upvoted (the same idea as HackerTube),
   fetched live from the public HN search API. No algorithm, no autoplay, no endless scroll: one short list, then it ends. */
type Item = { key: string; ytId: string; title: string; points: number; comments: number; hn: string; at: number };

const TOPICS: { id: string; label: string; re: RegExp | null }[] = [
  { id: 'all', label: 'Best of all', re: null },
  { id: 'sec', label: 'Security', re: /secur|hack|exploit|vulnerab|malware|crypto|cve|reverse|ctf|attack|breach|privacy|password|zero.?day|linux|kernel|network/i },
  { id: 'code', label: 'Programming', re: /program|code|compiler|rust|python|javascript|typescript|software|algorithm|database|build|from scratch|language|engineer|web|c\+\+|\bgo\b|unix/i },
  { id: 'sci', label: 'Science & math', re: /math|physics|science|space|biolog|chem|universe|quantum|prove|theor|brain|climate|nasa|astronom/i },
  { id: 'make', label: 'Hardware & making', re: /hardware|circuit|electronic|esp32|arduino|drone|robot|3d.?print|build|diy|engine|motor|chip|fpga|machine|repair|machining/i },
];
/* keep the feed educational: drop trailers, drama and outrage bait even when they are upvoted */
const JUNK = /trailer|gameplay|reaction|drama|rant|tier list|prank|vs\.|response|apolog|exposed|roast|mod for|teaser|unboxing|commercial|ad campaign/i;
const CACHE = 'ledger-feed-v2';
const HIDE = 'ledger-feed-hidden';
const TTL = 6 * 3600 * 1000;
const SIZE = 10;

const idFromUrl = (u: string) => { try { const x = new URL(u); if (x.hostname.endsWith('youtu.be')) return x.pathname.slice(1, 12); if (x.hostname.includes('youtube.com')) return x.searchParams.get('v')?.slice(0, 11) ?? null; } catch { /* */ } return null; };
const clean = (t: string) => t.replace(/\s*\[(video|\d{4})\]\s*/gi, ' ').replace(/\s*\(\d{4}\)\s*$/, '').trim();
const ago = (ms: number) => { const d = Math.floor((Date.now() - ms) / 86400000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
const readHidden = (): string[] => { try { return JSON.parse(localStorage.getItem(HIDE) || '[]'); } catch { return []; } };

async function load(): Promise<Item[]> {
  try { const c = JSON.parse(localStorage.getItem(CACHE) || 'null'); if (c && Date.now() - c.at < TTL) return c.items; } catch { /* */ }
  const since = Math.floor(Date.now() / 1000) - 60 * 86400;
  const r = await fetch(`https://hn.algolia.com/api/v1/search?query=youtube.com&restrictSearchableAttributes=url&tags=story&numericFilters=${encodeURIComponent(`points>90,created_at_i>${since}`)}&hitsPerPage=200`);
  if (!r.ok) throw new Error('feed');
  const d = await r.json();
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const h of d.hits as { objectID: string; title: string; url?: string; points: number; num_comments: number; created_at_i: number }[]) {
    const ytId = h.url ? idFromUrl(h.url) : null;
    if (!ytId || seen.has(ytId) || JUNK.test(h.title)) continue;
    seen.add(ytId);
    items.push({ key: h.objectID, ytId, title: clean(h.title), points: h.points, comments: h.num_comments, hn: `https://news.ycombinator.com/item?id=${h.objectID}`, at: h.created_at_i * 1000 });
  }
  try { localStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), items })); } catch { /* */ }
  return items;
}

export default function Feed({ onPlay }: { onPlay: (ytId: string, title: string) => void }) {
  const videos = useStore((s) => s.videos);
  const addVideo = useStore((s) => s.addVideo);
  const [items, setItems] = useState<Item[] | null>(null);
  const [err, setErr] = useState(false);
  const [topic, setTopic] = useState('all');
  const [hidden, setHidden] = useState<string[]>(readHidden);

  const refresh = useCallback((force = false) => {
    if (force) { try { localStorage.removeItem(CACHE); } catch { /* */ } }
    setErr(false); setItems(null);
    load().then(setItems).catch(() => setErr(true));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const known = useMemo(() => new Set(videos.map((v) => v.ytId)), [videos]);
  const shown = useMemo(() => {
    const re = TOPICS.find((t) => t.id === topic)?.re;
    return (items ?? []).filter((i) => !hidden.includes(i.ytId) && !known.has(i.ytId) && (!re || re.test(i.title))).sort((a, b) => b.points - a.points).slice(0, SIZE);
  }, [items, hidden, known, topic]);

  const hide = (id: string) => { const n = [...hidden, id]; setHidden(n); try { localStorage.setItem(HIDE, JSON.stringify(n.slice(-500))); } catch { /* */ } };

  return (
    <section className="en-feed">
      <SectionHeader label="Worth your time" right={<span className="en-filter">{TOPICS.map((t) => <button key={t.id} className={topic === t.id ? 'on' : ''} onClick={() => setTopic(t.id)}>{t.label}</button>)}</span>} />
      <p className="en-feed-note">The most upvoted videos on Hacker News from the last two months. Ten at a time, then it ends.</p>
      {err && <p className="en-empty">Could not reach the feed. Check your connection, then <button className="en-link" onClick={() => refresh(true)}>try again</button>.</p>}
      {!err && items === null && <p className="en-empty">Loading the feed…</p>}
      {items && shown.length === 0 && <p className="en-empty">You have seen everything in this topic. Try another, or <button className="en-link" onClick={() => refresh(true)}>refresh</button>.</p>}
      <ul className="en-feed-list">
        {shown.map((i) => (
          <li className="en-card" key={i.ytId}>
            <button className="en-thumb" onClick={() => onPlay(i.ytId, i.title)} aria-label={`Play ${i.title}`}>
              <img src={`https://i.ytimg.com/vi/${i.ytId}/mqdefault.jpg`} alt="" loading="lazy" /><span className="en-play" aria-hidden>▶</span>
            </button>
            <div className="en-card-body">
              <div className="en-title">{i.title}</div>
              <div className="en-feed-meta">{i.points} points · <a href={i.hn} target="_blank" rel="noreferrer noopener">{i.comments} comments</a> · {ago(i.at)}</div>
              <div className="en-actions en-card-act">
                <Button variant="ghost" onClick={() => onPlay(i.ytId, i.title)}>Watch</Button>
                <Button variant="text" onClick={() => addVideo(i.ytId, i.title, 'learn')}>Save for later</Button>
                <Button variant="text" onClick={() => hide(i.ytId)}>Not for me</Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {items && shown.length > 0 && <p className="en-feed-end">That is the list for now. <button className="en-link" onClick={() => refresh(true)}>Refresh</button> · <a className="en-link" href="https://hackertube.org/" target="_blank" rel="noreferrer noopener">Browse more on HackerTube</a></p>}
    </section>
  );
}
