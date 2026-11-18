import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { APP_PORT, MOCK_PORT } from './playwright.config';

export const MOCK = `http://localhost:${MOCK_PORT}`;
export const APP = `http://localhost:${APP_PORT}`;
/** supabase-js storage key: sb-<first label of the url host>-auth-token (host is "localhost") */
export const AUTH_KEY = 'sb-localhost-auth-token';

export interface TestUser { id: string; email: string; access_token: string; refresh_token: string; expires_at: number }

export async function ctl(path: string): Promise<any> {
  const r = await fetch(`${MOCK}/__test/${path}`);
  if (!r.ok) throw new Error(`mock control ${path}: ${r.status}`);
  return r.json();
}
export const resetMock = () => ctl('reset');
export const newUser = (): Promise<TestUser> => ctl('user');
export const setOffline = (on: boolean) => ctl(`offline?on=${on ? 1 : 0}`);
export const setAuthFail = (on: boolean) => ctl(`auth-fail?on=${on ? 1 : 0}`);
export const dropRealtime = (block?: boolean) => ctl(`drop-realtime${block === undefined ? '' : `?block=${block ? 1 : 0}`}`);
export interface ServerRow { collection: string; id: string; data: any; deleted: boolean; version: number; seq: number; device_id: string | null }
export const snapshot = (u: TestUser, all = false): Promise<ServerRow[]> => ctl(`snapshot?user=${u.id}${all ? '&all=1' : ''}`);
export const serverItems = async (u: TestUser, collection: string) => (await snapshot(u)).filter((r) => r.collection === collection);

/** Call the mock's RPC directly as the user (what a third, non-browser client would do). */
export async function rpc<T = any>(u: TestUser, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`${MOCK}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${u.access_token}`, apikey: 'x' }, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`rpc ${fn}: ${r.status} ${await r.text()}`);
  return r.json();
}
export const pushRaw = (u: TestUser, items: { collection: string; id: string; data: unknown; deleted?: boolean; base_version?: number }[], dev = 'raw') =>
  rpc(u, 'push_records', { p_items: items.map((i) => ({ deleted: false, base_version: 0, ...i })), p_device_id: dev });

const sessionFor = (u: TestUser, expiresAt = 4102444800) => ({ access_token: u.access_token, refresh_token: u.refresh_token, token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated' } });

export type Api = { store: any; sync: any };
const IMPORT = `const imp = (p) => new Function('p', 'return import(p)')(p);`;

export class Device {
  page!: Page;
  constructor(public ctx: BrowserContext, public user: TestUser, public name: string) {}

  static async create(browser: Browser, user: TestUser, name: string, opts: { open?: boolean } = {}): Promise<Device> {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    // sign-in: put a session in place when none is stored (so wiping storage = "log in again")
    await ctx.addInitScript(([key, session]) => { try { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(session)); } catch { /* ignore */ } }, [AUTH_KEY, sessionFor(user)] as const);
    const d = new Device(ctx, user, name);
    d.page = await ctx.newPage();
    d.page.on('pageerror', (e) => console.log(`[${name}] pageerror: ${e.message}`));
    if (opts.open !== false) await d.open();
    return d;
  }
  async newTab(): Promise<Page> { const p = await this.ctx.newPage(); await p.goto('/'); await p.waitForFunction(() => document.getElementById('root')?.children.length); return p; }
  async open(path = '/') { await this.page.goto(path); await this.page.waitForFunction(() => document.getElementById('root')?.children.length); await this.ready(); }
  async reload() { await this.page.reload(); await this.page.waitForFunction(() => document.getElementById('root')?.children.length); }
  /** the engine has started (status is not 'off') */
  async ready() { await expect.poll(() => this.info().then((i) => i.status), { timeout: 20_000 }).not.toBe('off'); }
  async close() { await this.ctx.close(); }

  /** Run `fn({store, sync}, arg)` inside the page against the REAL app modules (same instances the app uses). */
  run<T, A = undefined>(fn: (api: Api, arg: A) => T | Promise<T>, arg?: A, page: Page = this.page): Promise<T> {
    return page.evaluate(async ({ src, arg }) => {
      const imp = (p: string) => new Function('p', 'return import(p)')(p);
      const store = (await imp('/src/store.ts')).useStore;
      const sync = await imp('/src/sync/api.ts');
      return (0, eval)(`(${src})`)({ store, sync }, arg);
    }, { src: fn.toString(), arg: arg as A });
  }
  info(page?: Page): Promise<any> { return this.run(({ sync }) => { const i = sync.getSyncInfo(); return JSON.parse(JSON.stringify(i)); }, undefined, page); }
  list<T = any>(col: string): Promise<T[]> { return this.run(({ store }, c) => JSON.parse(JSON.stringify(store.getState()[c as string])), col); }
  ids(col: string): Promise<string[]> { return this.list(col).then((l) => l.map((x: any) => x.id ?? `wake:${x.date}`)); }
  get(col: string, id: string): Promise<any> { return this.list(col).then((l) => l.find((x: any) => (x.id ?? `wake:${x.date}`) === id)); }
  /** upsert / remove through the real store actions */
  upsert(col: string, item: object) { return this.run(({ store }, [c, it]) => store.getState().upsert(c, it), [col, item] as [string, object]); }
  upsertMany(col: string, items: object[]) { return this.run(({ store }, [c, its]) => { const s = store.getState(); for (const it of its as object[]) s.upsert(c, it); }, [col, items] as [string, object[]]); }
  remove(col: string, id: string) { return this.run(({ store }, [c, i]) => store.getState().remove(c, i), [col, id] as [string, string]); }
  setKV(id: string, value: string) { return this.run(({ store }, [i, v]) => store.getState().setKV(i, v), [id, value] as [string, string]); }
  patchSettings(p: object) { return this.run(({ store }, patch) => store.setState((s: any) => ({ settings: { ...s.settings, ...(patch as object) } })), p); }
  /** wait until nothing is pending and the engine reports synced */
  async settled(timeout = 30_000) {
    await expect.poll(async () => { const i = await this.info(); return `${i.status}/${i.pending}`; }, { timeout, message: `${this.name} did not settle` }).toBe('synced/0');
  }
  /** wait until the local list contains item `id` (passes `pred` if given): realtime/pull delivered it */
  async waitFor(col: string, id: string, pred: (x: any) => boolean = () => true, timeout = 5_000) {
    await expect.poll(async () => { const it = await this.get(col, id); return !!it && pred(it); }, { timeout, message: `${this.name}: ${col}/${id} did not arrive` }).toBe(true);
  }
  async waitGone(col: string, id: string, timeout = 5_000) {
    await expect.poll(async () => (await this.ids(col)).includes(id), { timeout, message: `${this.name}: ${col}/${id} still present` }).toBe(false);
  }
  /** wipe localStorage + IndexedDB + caches of this device, session included (the init script logs in again on the next load) */
  async wipe() {
    await this.page.evaluate(async () => {
      localStorage.clear(); sessionStorage.clear();
      const dbs = (await (indexedDB as any).databases?.()) ?? [];
      await Promise.all(dbs.map((d: any) => new Promise((r) => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = () => r(null); })));
    });
  }
}

/** a deterministic id for test items */
let n = 0; export const tid = (p: string) => `${p}-${Date.now().toString(36)}-${n++}`;
export const habit = (id: string, name = id, extra: object = {}) => ({ id, name, stat: 'mind', cadence: { type: 'daily' }, xp: 10, ...extra });
export const task = (id: string, title = id, extra: object = {}) => ({ id, title, done: false, context: 'personal', tags: [], effort: 1, stat: 'discipline', ...extra });
export const journal = (id: string, body: string, date = '2026-11-10') => ({ id, date, body, kind: 'daily' });
export const habitLog = (id: string, habitId: string, date: string) => ({ id, habitId, date, level: 'full' });
export const REALTIME_MS = 5_000;

/** poll the mock's snapshot until predicate holds */
export async function waitServer(u: TestUser, pred: (rows: ServerRow[]) => boolean, msg = 'server state', timeout = 30_000) {
  await expect.poll(async () => pred(await snapshot(u)), { timeout, message: msg }).toBe(true);
}
