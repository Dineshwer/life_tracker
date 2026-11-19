// Build-time snapshot of every catalog course playlist -> public/courses.json (so the Courses UI works with the Invidious mirror down).
// Usage: npm run snapshot:playlists   (then commit public/courses.json). Needs network; no dependencies.
// Source: youtube.com/playlist HTML (ytInitialData) + youtubei browse continuations; Invidious mirror as a per-playlist fallback.
// Everything fetched is untrusted data: parsed as JSON only, strings clamped, ids validated. A failed refetch keeps the previous entry.
import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'public/courses.json');
const CAT = ['courses.picks.ts', 'courses.suggest.a.ts', 'courses.suggest.b.ts'].map((f) => path.join(ROOT, 'src/entertainment/catalog', f));
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HDR = { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', cookie: 'CONSENT=YES+1; SOCS=CAI' };
const MIRROR = 'https://yt.chocolatemoo53.com';
const MAX_TITLE = Number(process.env.SNAPSHOT_TITLE_MAX ?? 160);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const ID = /^[\w-]{11}$/;

/* ---- catalog ---- */
function readCatalog() {
  const out = new Map();
  for (const f of CAT) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!/kind:\s*'playlist'/.test(line)) continue;
      const id = line.match(/\bid:\s*'([\w-]+)'/)?.[1]; if (!id) continue;
      out.set(id, { title: line.match(/\btitle:\s*'((?:[^'\\]|\\.)*)'/)?.[1] ?? '', count: Number(line.match(/\bcount:\s*(\d+)/)?.[1] ?? 0) });
    }
  }
  return out;
}

/* ---- fetch with retry ---- */
async function retry(fn, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; await sleep(800 * (i + 1)); }
  }
  throw last;
}
async function getText(url, init = {}) {
  const r = await fetch(url, { ...init, headers: { ...HDR, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`${r.status} ${url.slice(0, 60)}`);
  return r.text();
}

/* ---- youtube parsing ---- */
const walk = (o, f) => { if (o && typeof o === 'object') { f(o); for (const k in o) walk(o[k], f); } };
function dur(text) { // "1:02:03" | "8:11" -> seconds
  const p = String(text ?? '').split(':').map(Number); if (!p.length || p.some((n) => !Number.isFinite(n))) return 0;
  return p.reduce((a, n) => a * 60 + n, 0);
}
function extractVideos(data) {
  const vids = []; let token = null;
  walk(data, (o) => {
    if (o.lockupViewModel && o.lockupViewModel.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
      const l = o.lockupViewModel; let d = 0;
      walk(l.contentImage, (x) => { if (typeof x.text === 'string' && /^\d+(:\d+)+$/.test(x.text) && !d) d = dur(x.text); });
      vids.push({ id: l.contentId, title: l.metadata?.lockupMetadataViewModel?.title?.content, dur: d });
    } else if (o.playlistVideoRenderer) {
      const v = o.playlistVideoRenderer;
      vids.push({ id: v.videoId, title: v.title?.runs?.[0]?.text ?? v.title?.simpleText, dur: Number(v.lengthSeconds) || 0 });
    }
    const c = o.continuationItemViewModel ?? o.continuationItemRenderer; // only the "load more" item, not sort-menu tokens
    if (c) { let tk = null; walk(c, (x) => { if (typeof x.token === 'string' && !tk) tk = x.token; }); if (tk && !token) token = tk; }
  });
  return { vids, token };
}
const okVid = (v) => typeof v.id === 'string' && ID.test(v.id) && v.title && !/^\[(private|deleted) video\]$/i.test(v.title) && !/^(private|deleted) video$/i.test(v.title);

async function fromYoutube(id) {
  const html = await retry(() => getText(`https://www.youtube.com/playlist?list=${encodeURIComponent(id)}&hl=en`));
  const m = html.match(/ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s); if (!m) throw new Error('no ytInitialData');
  const data = JSON.parse(m[1]);
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([\w-]+)"/)?.[1] ?? 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
  const cv = html.match(/"INNERTUBE_CLIENT_VERSION":"([\d.]+)"/)?.[1] ?? html.match(/"clientVersion":"([\d.]+)"/)?.[1] ?? '2.20260101.00.00';
  const title = clamp(data.metadata?.playlistMetadataRenderer?.title, 200);
  let author = '';
  walk(data, (o) => { if (!author && o.videoOwnerRenderer) author = clamp(o.videoOwnerRenderer.title?.runs?.[0]?.text, 100); });
  if (!author) walk(data.header, (o) => { if (!author && o.avatarStackViewModel?.text?.content) author = clamp(o.avatarStackViewModel.text.content.replace(/^by\s+/i, ''), 100); });
  let { vids, token } = extractVideos(data);
  for (let page = 0; token && page < 30; page++) {
    await sleep(400);
    const body = JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: cv, hl: 'en' } }, continuation: token });
    const j = JSON.parse(await retry(() => getText(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`, { method: 'POST', body, headers: { 'content-type': 'application/json' } })));
    const r = extractVideos(j.onResponseReceivedActions ?? j); vids = vids.concat(r.vids); token = r.token;
    if (!r.vids.length) break;
  }
  return { title, author, vids };
}

async function fromMirror(id) {
  let title = '', author = '', vids = [];
  for (let page = 1; page <= 10; page++) {
    const j = JSON.parse(await retry(() => getText(`${MIRROR}/api/v1/playlists/${encodeURIComponent(id)}?page=${page}`)));
    if (j.error) { if (page === 1) throw new Error(String(j.error)); break; }
    title ||= clamp(j.title, 200); author ||= clamp(j.author, 100);
    const got = (Array.isArray(j.videos) ? j.videos : []).filter((v) => !v.liveNow && !v.isUpcoming).map((v) => ({ id: v.videoId, title: clamp(v.title, 300), dur: Number(v.lengthSeconds) || 0 }));
    vids = vids.concat(got); if (!got.length || (j.videoCount && vids.length >= j.videoCount)) break;
  }
  return { title, author, vids };
}

async function snapshot(id) {
  let r; let src = 'yt';
  try { r = await fromYoutube(id); if (!r.vids.filter(okVid).length) throw new Error('no videos'); }
  catch (e) { src = 'mirror'; try { r = await fromMirror(id); } catch (e2) { throw new Error(`yt: ${e.message}; mirror: ${e2.message}`); } }
  const seen = new Set(); const videos = [];
  for (const v of r.vids) if (okVid(v) && !seen.has(v.id)) { seen.add(v.id); videos.push([v.id, clamp(v.title, MAX_TITLE), Math.max(0, Math.floor(v.dur))]); }
  if (!videos.length) throw new Error('no playable videos');
  return { entry: { title: r.title, author: r.author, videos }, src };
}

/* ---- main ---- */
const cat = readCatalog();
let prev = {}; try { const p = JSON.parse(fs.readFileSync(OUT, 'utf8')); if (p?.v === 1 && p.playlists) prev = p.playlists; } catch { /* first run */ }
const playlists = { ...prev }; const rows = []; const ids = [...cat.keys()];
let next = 0;
async function worker() {
  while (next < ids.length) {
    const id = ids[next++]; const c = cat.get(id);
    try { const { entry, src } = await snapshot(id); playlists[id] = entry; rows.push({ id, title: entry.title || c.title, live: entry.videos.length, cat: c.count, status: `ok (${src})` }); }
    catch (e) { rows.push({ id, title: c.title, live: prev[id]?.videos.length ?? 0, cat: c.count, status: `FAILED${prev[id] ? ' (kept previous)' : ''}: ${e.message.slice(0, 80)}` }); }
    await sleep(600);
  }
}
await Promise.all(Array.from({ length: 3 }, worker));
for (const id of Object.keys(playlists)) if (!cat.has(id)) delete playlists[id]; // drop playlists no longer in the catalog
const sorted = Object.fromEntries(ids.filter((i) => playlists[i]).map((i) => [i, playlists[i]]));
const failed = rows.filter((r) => r.status.startsWith('FAILED')).length;
if (Object.keys(sorted).length) fs.writeFileSync(OUT, JSON.stringify({ v: 1, at: Date.now(), playlists: sorted }));
rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
console.log('id'.padEnd(36), 'count'.padEnd(11), 'status'.padEnd(10), 'title');
for (const r of rows) console.log(r.id.padEnd(36), `${r.live}/${r.cat}`.padEnd(11), (r.live === r.cat ? '=' : 'MISMATCH').padEnd(10), `${r.status}  ${r.title.slice(0, 50)}`);
const total = Object.values(sorted).reduce((a, p) => a + p.videos.length, 0);
console.log(`\n${rows.length - failed} ok, ${failed} failed, ${total} videos, ${fs.existsSync(OUT) ? fs.statSync(OUT).size : 0} bytes -> ${path.relative(ROOT, OUT)}`);
process.exitCode = failed ? 1 : 0;
