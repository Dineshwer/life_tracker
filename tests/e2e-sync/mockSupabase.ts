/* Mock Supabase for the multi-device sync E2E suite. Run with:  npx vite-node tests/e2e-sync/mockSupabase.ts  (PORT env, default 54321)
   Postgres = PGlite running the REAL migrations (tests/unit/db/harness.ts), so push_records / backups / seq / RLS are the real SQL.
   The HTTP layer speaks just enough PostgREST + GoTrue + Realtime (Phoenix) for supabase-js as the app uses it.
   Test controls (all under /__test/*) are documented in tests/e2e-sync/README.md. */
import http from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import type { Socket } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import type { PGlite } from '@electric-sql/pglite';
import { asAdmin, asUser, createDb, createUser } from '../unit/db/harness';

const PORT = Number(process.env.PORT ?? 54321);
const COLS = ['user_id', 'collection', 'id', 'data', 'deleted', 'version', 'seq', 'updated_at', 'device_id'];
const SECRET = 'e2e-secret';

/* ---------- state ---------- */
let db: PGlite;
let offline = false;
let latency = 0;
let authFail = false;          // token / REST answer 401 (session expiry)
let blockRealtime = false;     // refuse websocket upgrades
const lastBroadcast = new Map<string, number>();
const sockets = new Set<Sock>();
const stats = { requests: 0, rpc: {} as Record<string, number>, pulls: 0 };
interface Sock { ws: WebSocket; user: string | null; joins: { topic: string; joinRef: string | null; filters: { id: number; event: string; table?: string }[] }[] }

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function mintJwt(sub: string, email: string): string {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub, email, role: 'authenticated', aud: 'authenticated', exp: 4102444800, iat: 1700000000 });
  return `${head}.${body}.${createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')}`;
}
function subOf(jwt?: string | null): string | null {
  if (!jwt) return null;
  try { const p = JSON.parse(Buffer.from(jwt.replace(/^Bearer\s+/i, '').split('.')[1], 'base64url').toString()); return typeof p.sub === 'string' ? p.sub : null; } catch { return null; }
}
const userJson = (id: string, email: string) => ({ id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
const sessionJson = (id: string, email: string) => ({ access_token: mintJwt(id, email), refresh_token: `rt.${id}.${email}`, token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user: userJson(id, email) });

async function resetDb() {
  for (const s of sockets) s.ws.close();
  sockets.clear(); lastBroadcast.clear();
  try { await (db as PGlite | undefined)?.close(); } catch { /* ignore */ }
  db = await createDb();
}

/* ---------- PostgREST bits ---------- */
class HttpErr extends Error { constructor(public status: number, public body: unknown) { super('http'); } }
const pgErr = (e: any) => {
  const code = e?.code ?? 'XX000';
  const status = code === '28000' ? 401 : code === '42501' ? 403 : code === 'P0002' ? 404 : 400;
  return new HttpErr(status, { code, message: e?.message ?? String(e), details: e?.detail ?? null, hint: null });
};
const OPS: Record<string, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };

async function restGet(sub: string, url: URL, headers: http.IncomingHttpHeaders) {
  const sel = url.searchParams.get('select') ?? '*';
  const cols = sel === '*' ? ['*'] : sel.split(',').map((c) => c.trim());
  for (const c of cols) if (c !== '*' && !COLS.includes(c)) throw new HttpErr(400, { code: '42703', message: `column ${c} does not exist` });
  const where: string[] = []; const params: unknown[] = []; let orderBy = ''; let limit: number | undefined; let offset = 0;
  for (const [k, v] of url.searchParams) {
    if (k === 'select') continue;
    if (k === 'order') { orderBy = v.split(',').map((o) => { const [c, d] = o.split('.'); if (!COLS.includes(c)) throw new HttpErr(400, { message: 'bad order' }); return `${c} ${d === 'desc' ? 'desc' : 'asc'}`; }).join(', '); continue; }
    if (k === 'limit') { limit = Number(v); continue; }
    if (k === 'offset') { offset = Number(v); continue; }
    if (!COLS.includes(k)) throw new HttpErr(400, { code: 'PGRST100', message: `unsupported filter ${k}` });
    const dot = v.indexOf('.'); const op = v.slice(0, dot); const val = v.slice(dot + 1);
    if (op in OPS) { params.push(val); where.push(`${k}::text ${OPS[op]} $${params.length}`.replace(/^(seq|version)::text/, '$1')); if (k === 'seq' || k === 'version') params[params.length - 1] = Number(val); }
    else if (op === 'in') { const list = val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')); params.push(list); where.push(`${k}::text = any($${params.length}::text[])`); }
    else if (op === 'is') where.push(`${k} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : 'false'}`);
    else throw new HttpErr(400, { code: 'PGRST100', message: `unsupported operator ${op}` });
  }
  const range = /^(\d+)-(\d+)?$/.exec(String(headers['range'] ?? ''));
  if (range) { offset = Number(range[1]); if (range[2]) limit = Number(range[2]) - offset + 1; }
  const sql = `select ${cols.join(',')} from public.records${where.length ? ' where ' + where.join(' and ') : ''}${orderBy ? ' order by ' + orderBy : ''}${limit !== undefined ? ` limit ${limit | 0}` : ''}${offset ? ` offset ${offset | 0}` : ''}`;
  let rows: any[];
  try { rows = await asUser(db, sub).query(sql, params); } catch (e) { throw pgErr(e); }
  stats.pulls++;
  return rows;
}

async function rpc(sub: string, fn: string, args: Record<string, unknown>) {
  stats.rpc[fn] = (stats.rpc[fn] ?? 0) + 1;
  const s = asUser(db, sub);
  try {
    if (fn === 'list_backups') {
      return await s.query(`select taken_on::text as taken_on, row_count, kind, created_at from public.list_backups(p_include_safety => $1)`, [args.p_include_safety ?? false]);
    }
    if (fn === 'push_records' || fn === 'take_backup' || fn === 'restore_backup') {
      const keys = Object.keys(args);
      const cast = (k: string) => (k === 'p_items' ? '::jsonb' : k === 'p_date' ? '::date' : '');
      const call = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}${cast(k)}`).join(', ')}) as r`;
      const params = keys.map((k) => (typeof args[k] === 'object' && args[k] !== null ? JSON.stringify(args[k]) : args[k]));
      const out = (await s.tx((q) => q(call, params)))[0].r;
      void broadcast(sub);
      return out;
    }
  } catch (e) { throw pgErr(e); }
  throw new HttpErr(404, { code: 'PGRST202', message: `unknown function ${fn}` });
}

/* ---------- realtime (Phoenix) ---------- */
async function broadcast(user: string) {
  const since = lastBroadcast.get(user) ?? -1;
  let rows: any[];
  if (since < 0) { // first broadcast for the user: only what happens from now on matters; baseline = max(seq) before this write is unknown, so send everything new since the earliest socket join
    rows = await asAdmin(db).query(`select * from public.records where user_id = $1 order by seq`, [user]);
  } else rows = await asAdmin(db).query(`select * from public.records where user_id = $1 and seq > $2 order by seq`, [user, since]);
  if (!rows.length) return;
  lastBroadcast.set(user, Math.max(...rows.map((r) => Number(r.seq))));
  if (since < 0) { const jr = joinBaseline.get(user); rows = jr === undefined ? rows : rows.filter((r) => Number(r.seq) > jr); }
  for (const r of rows) {
    const rec = { ...r, seq: Number(r.seq), version: Number(r.version), updated_at: new Date(r.updated_at).toISOString() };
    const type = rec.version === 1 ? 'INSERT' : 'UPDATE';
    for (const s of sockets) {
      if (s.user !== user || offline) continue;
      for (const j of s.joins) for (const f of j.filters) {
        if (f.event !== '*' && f.event !== type) continue;
        const data = { schema: 'public', table: 'records', commit_timestamp: new Date().toISOString(), type, columns: COLS.map((name) => ({ name, type: 'text' })), record: rec, old_record: type === 'UPDATE' ? { user_id: user, collection: rec.collection, id: rec.id } : {}, errors: null };
        s.ws.send(JSON.stringify([j.joinRef, null, j.topic, 'postgres_changes', { ids: [f.id], data }]));
      }
    }
  }
}
const joinBaseline = new Map<string, number>(); // user -> max seq at the time of the latest socket join (rows at/below it are not "news")
async function noteBaseline(user: string) {
  const r = await asAdmin(db).query(`select coalesce(max(seq),0) as m from public.records where user_id = $1`, [user]);
  const m = Number(r[0].m);
  if (!lastBroadcast.has(user)) { lastBroadcast.set(user, m); joinBaseline.set(user, m); }
}

function onSocket(ws: WebSocket, url: URL) {
  const sock: Sock = { ws, user: subOf(url.searchParams.get('jwt')) ?? subOf(url.searchParams.get('apikey')), joins: [] };
  sockets.add(sock);
  let nextId = 1000;
  ws.on('close', () => sockets.delete(sock));
  ws.on('message', async (raw) => {
    let msg: any[]; try { msg = JSON.parse(String(raw)); } catch { return; }
    const [joinRef, ref, topic, event, payload] = msg;
    const reply = (status: string, response: unknown = {}) => ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status, response }]));
    if (offline) return ws.close();
    if (event === 'heartbeat') return ws.send(JSON.stringify([null, ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} }]));
    if (event === 'phx_join') {
      const tok = payload?.access_token ?? payload?.config?.access_token;
      sock.user = subOf(tok) ?? sock.user;
      if (authFail) return reply('error', { reason: 'JWT expired' });
      const filters = ((payload?.config?.postgres_changes ?? []) as any[]).map((f) => ({ id: nextId++, event: f.event, table: f.table }));
      sock.joins = sock.joins.filter((j) => j.topic !== topic);
      sock.joins.push({ topic, joinRef, filters });
      if (sock.user) await noteBaseline(sock.user);
      reply('ok', { postgres_changes: filters.map((f, i) => ({ ...payload.config.postgres_changes[i], id: f.id })) });
      ws.send(JSON.stringify([joinRef, null, topic, 'system', { message: 'Subscribed to PostgreSQL', status: 'ok', extension: 'postgres_changes', channel: topic.replace(/^realtime:/, '') }]));
      return;
    }
    if (event === 'access_token') { sock.user = subOf(payload?.access_token) ?? sock.user; return reply('ok'); }
    if (event === 'phx_leave') { sock.joins = sock.joins.filter((j) => j.topic !== topic); return reply('ok'); }
    reply('ok');
  });
}

/* ---------- http ---------- */
const readBody = (req: http.IncomingMessage) => new Promise<string>((res) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => res(s)); });
const send = (res: http.ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...extra });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const conns = new Set<Socket>();

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin ?? '*';
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-credentials', 'true');
  res.setHeader('access-control-allow-headers', String(req.headers['access-control-request-headers'] ?? '*'));
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('access-control-expose-headers', 'content-range,content-profile');
  res.setHeader('access-control-max-age', '600');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url!, `http://localhost:${PORT}`);
  const path = url.pathname;
  try {
    /* ---- test controls (never affected by outage mode) ---- */
    if (path.startsWith('/__test/')) {
      res.setHeader('connection', 'close');
      const op = path.slice(8);
      if (op === 'reset') { await resetDb(); offline = false; latency = 0; authFail = false; blockRealtime = false; stats.requests = 0; stats.rpc = {}; stats.pulls = 0; return send(res, 200, { ok: true }); }
      if (op === 'offline') { offline = url.searchParams.get('on') === '1'; if (offline) { for (const s of sockets) s.ws.close(); for (const c of conns) if (c !== req.socket) c.destroy(); } return send(res, 200, { offline }); }
      if (op === 'latency') { latency = Number(url.searchParams.get('ms') ?? 0); return send(res, 200, { latency }); }
      if (op === 'auth-fail') { authFail = url.searchParams.get('on') === '1'; return send(res, 200, { authFail }); }
      if (op === 'drop-realtime') { const block = url.searchParams.get('block'); if (block !== null) blockRealtime = block === '1'; for (const s of sockets) s.ws.terminate(); return send(res, 200, { dropped: true, blockRealtime }); }
      if (op === 'user') {
        const email = `u${Date.now()}${Math.floor(Math.random() * 1e6)}@e2e.test`;
        const id = await createUser(db, randomUUID());
        return send(res, 200, { ...sessionJson(id, email), email, id });
      }
      if (op === 'session') { const id = url.searchParams.get('id')!; return send(res, 200, sessionJson(id, url.searchParams.get('email') ?? 'x@e2e.test')); }
      if (op === 'snapshot') {
        const id = url.searchParams.get('user')!; const all = url.searchParams.get('all') === '1';
        const rows = await asAdmin(db).query(`select collection, id, data, deleted, version, seq::int as seq, device_id from public.records where user_id = $1 ${all ? '' : 'and not deleted'} order by seq`, [id]);
        return send(res, 200, rows);
      }
      if (op === 'stats') return send(res, 200, { ...stats, sockets: sockets.size });
      if (op === 'sockets') return send(res, 200, { count: [...sockets].filter((s) => s.user === url.searchParams.get('user')).length });
      return send(res, 404, { error: 'unknown control' });
    }
    if (offline) { req.socket.destroy(); return; }
    stats.requests++;
    if (latency) await new Promise((r) => setTimeout(r, latency));
    const bodyText = req.method === 'GET' || req.method === 'HEAD' ? '' : await readBody(req);

    /* ---- auth (GoTrue) ---- */
    if (path.startsWith('/auth/v1/')) {
      const sub = subOf(req.headers.authorization);
      if (path === '/auth/v1/token') {
        if (authFail) return send(res, 401, { code: 401, error_code: 'invalid_credentials', msg: 'Invalid Refresh Token: Session Expired', error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
        const rt = (() => { try { return JSON.parse(bodyText).refresh_token as string; } catch { return ''; } })();
        const m = /^rt\.([^.]+)\.(.+)$/.exec(rt ?? '');
        if (!m) return send(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' });
        return send(res, 200, sessionJson(m[1], m[2]));
      }
      if (path === '/auth/v1/user') {
        if (authFail || !sub) return send(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
        return send(res, 200, userJson(sub, `${sub}@e2e.test`));
      }
      if (path === '/auth/v1/logout') return send(res, 204, undefined);
      return send(res, 200, {});
    }

    /* ---- PostgREST ---- */
    if (path.startsWith('/rest/v1/')) {
      const sub = subOf(req.headers.authorization);
      if (authFail || !sub) return send(res, 401, { code: 'PGRST301', message: authFail ? 'JWT expired' : 'No suitable key or wrong key type', details: null, hint: null });
      if (path.startsWith('/rest/v1/rpc/')) {
        const fn = path.slice('/rest/v1/rpc/'.length);
        const args = bodyText ? JSON.parse(bodyText) : Object.fromEntries(url.searchParams);
        return send(res, 200, await rpc(sub, fn, args));
      }
      if (path === '/rest/v1/records' && (req.method === 'GET' || req.method === 'HEAD')) {
        const rows = await restGet(sub, url, req.headers);
        const single = String(req.headers.accept ?? '').includes('vnd.pgrst.object');
        const hdr: Record<string, string> = rows.length ? { 'content-range': `0-${rows.length - 1}/*` } : { 'content-range': '*/0' };
        if (single) return rows.length === 1 ? send(res, 200, rows[0], hdr) : send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
        return send(res, 200, rows, hdr);
      }
      return send(res, 403, { code: '42501', message: 'direct writes are not allowed: use push_records' });
    }
    send(res, 404, { error: 'not found', path });
  } catch (e) {
    if (e instanceof HttpErr) return send(res, e.status, e.body);
    console.error('[mock] error', e);
    send(res, 500, { message: String((e as Error)?.message ?? e) });
  }
});
server.on('connection', (c) => { conns.add(c); c.on('close', () => conns.delete(c)); });

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`);
  if (url.pathname !== '/realtime/v1/websocket' || offline || blockRealtime || authFail) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => onSocket(ws, url));
});

await resetDb();
server.listen(PORT, () => console.log(`[mock-supabase] listening on :${PORT}`));
process.on('SIGTERM', () => { server.close(); process.exit(0); });
