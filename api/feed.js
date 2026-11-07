/* Latest uploads from the YouTube channels you chose, through the official YouTube Data API v3.
   Needs one free key in the environment variable YOUTUBE_API_KEY (see README). The key stays on the server.
   Runs on Vercel at /api/feed and, in development, through the middleware in vite.config.ts.
   Cost: about 3 quota units per channel per refresh, against a free allowance of 10,000 a day. */

const API = 'https://www.googleapis.com/youtube/v3';
const uploadsCache = new Map(); // handle -> { uploads, name }

const iso = (d) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d || ''); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };

async function g(path, params, key) {
  const u = new URL(`${API}/${path}`);
  Object.entries({ ...params, key }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j?.error?.message || `youtube ${r.status}`); e.code = j?.error?.errors?.[0]?.reason || String(r.status); throw e; }
  return j;
}

async function channel(handle, key) {
  const h = handle.startsWith('@') ? handle : `@${handle}`;
  if (uploadsCache.has(h)) return { h, ...uploadsCache.get(h) };
  const j = await g('channels', { part: 'contentDetails,snippet', forHandle: h }, key);
  const it = j.items?.[0];
  if (!it) throw new Error('channel not found');
  const val = { uploads: it.contentDetails.relatedPlaylists.uploads, name: it.snippet.title };
  uploadsCache.set(h, val);
  return { h, ...val };
}

async function latest(handle, key) {
  const c = await channel(handle, key);
  const p = await g('playlistItems', { part: 'snippet,contentDetails', playlistId: c.uploads, maxResults: '12' }, key);
  const items = (p.items || []).map((x) => ({ ytId: x.contentDetails.videoId, title: x.snippet.title, at: Date.parse(x.contentDetails.videoPublishedAt || x.snippet.publishedAt) }));
  const ids = items.map((i) => i.ytId).join(',');
  const durs = new Map();
  if (ids) (await g('videos', { part: 'contentDetails', id: ids }, key)).items?.forEach((v) => durs.set(v.id, iso(v.contentDetails.duration)));
  return { handle: c.h, name: c.name, videos: items.map((i) => ({ ...i, dur: durs.get(i.ytId) || 0 })).filter((i) => i.title !== 'Private video' && i.title !== 'Deleted video') };
}

export async function run(query, env = process.env) {
  const key = env.YOUTUBE_API_KEY;
  if (!key) return { status: 200, body: { error: 'no_key', channels: [] } };
  const handles = String(query.handles || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 40);
  if (!handles.length) return { status: 400, body: { error: 'handles required' } };
  const channels = await Promise.all(handles.map(async (h) => {
    try { return await latest(h, key); } catch (e) { return { handle: h, error: String(e.message || e), code: e.code, videos: [] }; }
  }));
  const quota = channels.find((c) => c.code === 'quotaExceeded');
  return { status: 200, body: quota ? { error: 'quota', channels } : { channels }, cache: 'public, s-maxage=1800, stale-while-revalidate=3600' };
}

export default async function handler(req, res) {
  const out = await run(req.query || {});
  if (out.cache) res.setHeader('cache-control', out.cache);
  res.status(out.status).json(out.body);
}
