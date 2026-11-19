import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChannelView } from '../contract';
import { channelId, channelVideos } from '../../lib/mirror';

/** One video of the mixed feed. `h` = lowercase handle id of the channel it came from (topic/sub are looked up live). */
export interface FeedItem { ytId: string; title: string; at: number; dur: number; channel: string; h: string }
const CCACHE = 'ledger-channels-v2';
const CTTL = 3 * 3600 * 1000;

const toItems = (c: ChannelView, vs: Awaited<ReturnType<typeof channelVideos>>): FeedItem[] => vs.map((v) => ({ ytId: v.ytId, title: v.title, at: v.at, dur: v.dur, channel: v.author || c.name, h: c.id }));
const save = (sig: string, items: FeedItem[]) => { if (items.length) { try { localStorage.setItem(CCACHE, JSON.stringify({ at: Date.now(), sig, items })); } catch { /* */ } } };

/** Combined feed of my channels. 3 workers, a slower second try for failures, 3 h cache. Partial results stay visible while loading. */
export function useChannelFeed(channels: ChannelView[]) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState<string[]>([]); // channel ids
  const [busy, setBusy] = useState(false);
  const run = useRef(0);
  const chRef = useRef(channels); chRef.current = channels;
  const itemsRef = useRef<FeedItem[]>([]); itemsRef.current = items;
  const sig = 'v3|' + channels.map((c) => c.id).sort().join(',');

  const fetchOne = async (c: ChannelView) => { const id = await channelId(c.handle, c.cid); if (!id) throw new Error('unknown'); return toItems(c, await channelVideos(id)); };

  const refresh = useCallback(async (force = false) => {
    const mine = chRef.current; const my = ++run.current;
    setFailed([]); setDone(0);
    if (!mine.length) { setItems([]); setBusy(false); return; }
    if (!force) { try { const c = JSON.parse(localStorage.getItem(CCACHE) || 'null'); if (c && c.sig === sig && Date.now() - c.at < CTTL) { setItems(c.items); setBusy(false); setDone(mine.length); return; } } catch { /* */ } }
    setBusy(true); setItems([]);
    const acc: FeedItem[] = []; const bad: string[] = []; let finished = 0; let next = 0;
    const worker = async () => {
      while (next < mine.length && run.current === my) {
        const c = mine[next++];
        try { acc.push(...await fetchOne(c)); if (run.current === my) setItems([...acc]); }
        catch { bad.push(c.id); if (run.current === my) setFailed([...bad]); }
        if (run.current === my) setDone(++finished);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    // Mirrors rate-limit bursts: give the channels that failed a second, slower try.
    for (const id of [...bad]) {
      if (run.current !== my) return;
      const c = mine.find((x) => x.id === id); if (!c) continue;
      await new Promise((r) => setTimeout(r, 900));
      try { acc.push(...await fetchOne(c)); bad.splice(bad.indexOf(id), 1); if (run.current === my) { setItems([...acc]); setFailed([...bad]); } } catch { /* stays failed */ }
    }
    if (run.current !== my) return;
    save(sig, acc); setBusy(false);
  }, [sig]);
  useEffect(() => { refresh(); return () => { run.current++; }; }, [refresh]);

  /** Retry only the channels that failed, keeping what already loaded. */
  const retryFailed = useCallback(async () => {
    const todo = chRef.current.filter((c) => failed.includes(c.id));
    if (!todo.length) return;
    const my = ++run.current; setBusy(true);
    const acc = [...itemsRef.current]; const bad: string[] = [];
    for (const c of todo) {
      try { acc.push(...await fetchOne(c)); if (run.current === my) setItems([...acc]); } catch { bad.push(c.id); }
    }
    if (run.current !== my) return;
    setFailed(bad); setBusy(false); save(sig, acc);
  }, [failed, sig]);

  return { items, done, total: channels.length, failed, busy, refresh, retryFailed };
}
