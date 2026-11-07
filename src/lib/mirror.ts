/* Public Invidious mirrors: a free way to list a channel's newest videos without a YouTube account or API key.
   Mirrors are volunteer-run and come and go, so every request tries several and remembers the one that answered. */
type Inst = [string, { api?: boolean | null; cors?: boolean | null; uri?: string; type?: string }];
export interface MirrorVideo { ytId: string; title: string; at: number; dur: number; author: string }

const FALLBACK = ['https://yt.chocolatemoo53.com'];
const LS = { list: 'ledger-mirror-list', good: 'ledger-mirror', extra: 'ledger-mirror-extra', ids: 'ledger-mirror-ids' };
const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } };

async function discover(): Promise<string[]> {
  const c = read<{ at: number; list: string[] } | null>(LS.list, null);
  if (c && Date.now() - c.at < 12 * 3600e3 && c.list.length) return c.list;
  try {
    const r = await fetch('https://api.invidious.io/instances.json?sort_by=health');
    const d = await r.json() as Inst[];
    const list = d.filter(([, i]) => i.api && i.cors && i.type === 'https' && i.uri).map(([, i]) => i.uri!.replace(/\/$/, ''));
    if (list.length) { write(LS.list, { at: Date.now(), list }); return list; }
  } catch { /* offline or blocked: use the fallback */ }
  return c?.list ?? [];
}

export async function bases(): Promise<string[]> {
  const good = read<string | null>(LS.good, null);
  const all = [...read<string[]>(LS.extra, []), ...(good ? [good] : []), ...(await discover()), ...FALLBACK];
  return [...new Set(all)];
}
/** The mirror that last answered (used for the "Open ad-free" link). */
export const mirrorBase = (): string => read<string | null>(LS.good, null) ?? FALLBACK[0];

async function get<T>(path: string): Promise<T> {
  let last: unknown = new Error('no mirror');
  for (const b of (await bases()).slice(0, 5)) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(`${b}${path}`, { signal: ctl.signal });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json() as T; write(LS.good, b); return j;
    } catch (e) { last = e; } finally { clearTimeout(t); }
  }
  throw last;
}

/** @handle -> channel id, remembered forever. */
export async function channelId(handle: string, known?: string): Promise<string | null> {
  if (known) return known;
  const key = handle.toLowerCase(); const ids = read<Record<string, string>>(LS.ids, {});
  if (ids[key]) return ids[key];
  const h = handle.startsWith('@') ? handle : `@${handle}`;
  const j = await get<{ ucid?: string }>(`/api/v1/resolveurl?url=${encodeURIComponent(`https://www.youtube.com/${h}`)}`);
  if (!j.ucid) return null;
  write(LS.ids, { ...ids, [key]: j.ucid }); return j.ucid;
}

export async function channelVideos(ucid: string): Promise<MirrorVideo[]> {
  const j = await get<{ videos?: { videoId: string; title: string; published: number; lengthSeconds: number; author: string; liveNow?: boolean; isUpcoming?: boolean; premium?: boolean }[] }>(`/api/v1/channels/${ucid}/videos`);
  return (j.videos ?? []).filter((v) => !v.liveNow && !v.isUpcoming && !v.premium).map((v) => ({ ytId: v.videoId, title: v.title, at: v.published * 1000, dur: v.lengthSeconds, author: v.author }));
}
