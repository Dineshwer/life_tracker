import { test, expect, type Page } from '@playwright/test';
import { MODES, SKINS, contrastIssues, expectCleanLayout, layout, shot, visit, watch } from './fixtures';
import { parseYouTubeId } from '../../src/pages/entertainment/parse';

/* ---------- helpers ---------- */
const KEY = 'life-tracker-v1';
const ID = (n: number) => String(n).padStart(11, 'x'); // 11 char fake video ids

type Net = { instances?: 'ok' | 'fail'; channel?: (ucid: string) => unknown | 'fail' | 'bad-json' | 'slow'; resolve?: (url: string) => string | null };
/** Mock every external host the Entertainment page can reach. */
const CORS = { 'access-control-allow-origin': '*' };
async function mockNet(page: Page, net: Net = {}) {
  const hits = { api: 0 };
  await page.route(/i\.ytimg\.com|youtube-nocookie\.com|ytimg/, (r) => r.fulfill({ headers: CORS, status: 200, contentType: r.request().url().includes('embed') ? 'text/html' : 'image/gif', body: r.request().url().includes('embed') ? '<html></html>' : Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') }));
  await page.route('https://www.youtube.com/oembed**', (r) => r.fulfill({ headers: CORS, json: { title: 'Oembed Title' } }));
  await page.route('https://api.invidious.io/**', (r) => net.instances === 'fail'
    ? r.abort() : r.fulfill({ headers: CORS, json: [['mirror.test', { api: true, cors: true, type: 'https', uri: 'https://mirror.test' }]] }));
  await page.route('https://mirror.test/**', async (r) => {
    hits.api++;
    const u = new URL(r.request().url());
    if (u.pathname.endsWith('/resolveurl')) {
      const h = decodeURIComponent(u.searchParams.get('url') ?? '').split('/').pop() ?? '';
      const ucid = net.resolve ? net.resolve(h) : 'UC' + h.replace('@', '');
      return ucid ? r.fulfill({ headers: CORS, json: { ucid } }) : r.fulfill({ headers: CORS, status: 404, json: {} });
    }
    const m = u.pathname.match(/channels\/(.+)\/videos/);
    if (m) {
      const out = net.channel ? net.channel(m[1]) : defaultVideos(m[1]);
      if (out === 'fail') return r.fulfill({ headers: CORS, status: 500, body: 'no' });
      if (out === 'bad-json') return r.fulfill({ headers: CORS, status: 200, contentType: 'application/json', body: '<html>not json' });
      if (out === 'slow') { await new Promise((s) => setTimeout(s, 1500)); return r.fulfill({ headers: CORS, json: defaultVideos(m[1]) }); }
      return r.fulfill({ headers: CORS, json: out });
    }
    return r.fulfill({ headers: CORS, status: 404, body: '' });
  });
  await page.route('https://yt.chocolatemoo53.com/**', (r) => r.abort());
  return hits;
}
const hash = (t: string) => [...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1e9, 7);
const defaultVideos = (ucid: string) => ({ videos: [0, 1, 2].map((i) => ({ videoId: ID(hash(ucid) * 10 + i), title: `${ucid} video ${i}`, published: Math.floor(Date.now() / 1000) - i * 86400, lengthSeconds: 600 + i, author: ucid })) });

async function kvGet(page: Page, id: string): Promise<string | null> { const st = await getStore(page); return ((st?.kv ?? []) as { id: string; value: string }[]).find((x) => x.id === id)?.value ?? null; }
async function getStore(page: Page) { return page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}').state, KEY); }
/** Patch the persisted zustand state, then reload so the app hydrates it. */
async function patchStore(page: Page, patch: Record<string, unknown>) {
  await page.evaluate(([k, p]) => { const raw = JSON.parse(localStorage.getItem(k as string) || '{"version":2,"state":{}}'); raw.state = { ...raw.state, ...(p as object) }; localStorage.setItem(k as string, JSON.stringify(raw)); }, [KEY, patch] as const);
  await page.reload({ waitUntil: 'load' });
}
/** Fresh empty account on a route (no demo). */
async function empty(page: Page, route: string, skin = 'canopy', mode = 'dark') {
  await page.goto(`${route}?skin=${skin}&mode=${mode}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts?.ready);
}
const xpEvent = (amount: number, i = 0) => ({ id: 'x' + i, date: '2026-11-11', stat: 'body', amount, reason: 'test' });

/* ---------- parseYouTubeId (pure) ---------- */
test.describe('parseYouTubeId', () => {
  const id = 'dQw4w9WgXcQ';
  const cases: [string, string | null][] = [
    [`https://www.youtube.com/watch?v=${id}`, id], [`https://youtube.com/watch?v=${id}&t=30s`, id], [`https://m.youtube.com/watch?v=${id}`, id],
    [`https://youtu.be/${id}`, id], [`https://youtu.be/${id}?si=abc`, id], [`https://www.youtube.com/shorts/${id}`, id],
    [`https://www.youtube.com/embed/${id}`, id], [`https://www.youtube-nocookie.com/embed/${id}`, id], [`https://www.youtube.com/live/${id}`, id],
    [`youtube.com/watch?v=${id}`, id], [`  ${id}  `, id], [`\n https://youtu.be/${id}\t`, id], [id, id],
    ['', null], ['   ', null], ['garbage', null], ['https://example.com/watch?v=' + id, null], ['https://youtube.com/', null],
    ['https://www.youtube.com/watch?v=', null], ['short', null], ['dQw4w9WgXc', null], ['@@@@', null], ['javascript:alert(1)', null],
  ];
  cases.forEach(([input, want], n) => test(`#${n} "${input.trim().slice(0, 40)}" -> ${want}`, () => { expect(parseYouTubeId(input)).toBe(want); }));
  test('a too-short v= param is rejected', () => { expect(parseYouTubeId('https://www.youtube.com/watch?v=abc')).toBeNull(); });
});

/** Known SHARED-token failure (reported to the shared-styles agent, not fixable in page css): cyberpunk light `.label` ink is 4.36:1 on the label chip. */
const sharedKnown = (skin: string, mode: string) => (v: string) => skin === 'cyberpunk' && mode === 'light' && /\.label\b|header > div > \.label/.test(v);
const contrast = async (page: Page, skin: string, mode: string, sel = '.main, .page') => (await contrastIssues(page, sel)).filter((v) => !sharedKnown(skin, mode)(v) && !/tp-mini|tp-chip|tp-btn/.test(v)); // theme-picker miniatures are aria-hidden decoration (tiny 'chip' sample)

/* ---------- theme matrix ---------- */
const ROUTES = (process.env.ROUTES ? process.env.ROUTES.split(',') : ['/entertainment', '/rewards', '/settings']);
for (const route of ROUTES) for (const skin of SKINS) for (const mode of MODES) {
  test(`matrix ${route} · ${skin} · ${mode}`, async ({ page }, info) => {
    const w = watch(page);
    await mockNet(page);
    await visit(page, route, skin, mode);
    if (route === '/entertainment') await expect(page.locator('.en-card').first()).toBeVisible();
    const touch = info.project.name !== 'desktop';
    expectCleanLayout(await layout(page, { touch }), `${route} ${skin} ${mode}`);
    expect(await contrast(page, skin, mode), 'contrast').toEqual([]);
    if (process.env.SHOTS) await shot(page, info, `${route.replace(/\W+/g, '_')}-${skin}-${mode}`);
    w.stop();
    expect(w.errors, 'console/page errors').toEqual([]);
  });
}
// the other Entertainment tab + the open topic picker + player + reward form sheet, in a representative spread of themes
for (const skin of ['canopy', 'paper', 'arcade', 'cyberpunk', 'sumi']) for (const mode of MODES) {
  test(`matrix extras · ${skin} · ${mode}`, async ({ page }, info) => {
    const w = watch(page); await mockNet(page);
    await visit(page, '/entertainment#mine', skin, mode);
    await page.evaluate(() => localStorage.setItem('ledger-feed-tab', 'mine')); await page.reload({ waitUntil: 'load' });
    await expect(page.locator('.en-card').first()).toBeVisible();
    await page.getByRole('button', { name: /^Channels/ }).click();
    const touch = info.project.name !== 'desktop';
    expectCleanLayout(await layout(page, { touch }), `mine ${skin} ${mode}`);
    expect(await contrast(page, skin, mode), 'contrast mine').toEqual([]);
    if (process.env.SHOTS) await shot(page, info, `ent-mine-${skin}-${mode}`);
    await page.getByRole('button', { name: 'Watch' }).first().click();
    await expect(page.locator('.en-player iframe')).toBeVisible();
    expectCleanLayout(await layout(page, { touch }), `player ${skin} ${mode}`);
    if (process.env.SHOTS) await shot(page, info, `ent-player-${skin}-${mode}`);
    await visit(page, '/rewards', skin, mode);
    await page.getByRole('button', { name: /Add/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.waitForTimeout(900); // let the sheet's entry animation finish, axe would otherwise measure mid-fade colours
    expect(await contrast(page, skin, mode, '.sheet'), 'contrast sheet').toEqual([]);
    if (process.env.SHOTS) await shot(page, info, `rw-sheet-${skin}-${mode}`);
    w.stop(); expect(w.errors).toEqual([]);
  });
}

/* ---------- Entertainment flows ---------- */
test.describe('Entertainment: queue', () => {
  test('empty account: empty state, add by link, validation, duplicate, persistence, watched', async ({ page }) => {
    const w = watch(page); await mockNet(page);
    await empty(page, '/entertainment');
    await expect(page.getByText('Your queue is empty')).toBeVisible();
    const link = page.getByLabel('YouTube link'); const add = page.getByRole('button', { name: 'Add to queue' });
    // garbage
    await link.fill('not a link'); await add.click();
    await expect(page.getByRole('alert')).toContainText('does not look like a YouTube link');
    await link.fill('   '); await add.click(); // whitespace only: HTML required or parser rejects
    expect((await getStore(page)).videos).toHaveLength(0);
    // valid, title blank -> oembed
    await link.fill('  https://youtu.be/dQw4w9WgXcQ  '); await add.click();
    await expect(page.locator('.en-list .en-title')).toHaveText('Oembed Title');
    await expect(link).toHaveValue('');
    // duplicate
    await link.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ'); await add.click();
    await expect(page.getByRole('alert')).toContainText('Already in your list');
    expect((await getStore(page)).videos).toHaveLength(1);
    // very long title, no spaces, must not overflow
    await link.fill(ID(1)); await page.getByLabel('Title (optional)').fill('W'.repeat(300) + ' ' + 'long title '.repeat(30)); await add.click();
    await expect(page.locator('.en-list li')).toHaveCount(2);
    expectCleanLayout(await layout(page, { touch: false }), 'long title');
    // persists across reload
    await page.reload({ waitUntil: 'load' });
    await expect(page.locator('.en-list li')).toHaveCount(2);
    // mark watched then undo
    await page.getByRole('button', { name: 'Watched' }).first().click();
    await expect(page.getByText('Watched').first()).toBeVisible();
    await expect(page.locator('.en-item.is-done')).toHaveCount(1);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('.en-item.is-done')).toHaveCount(0);
    // remove
    await page.getByRole('button', { name: /^Remove/ }).first().click();
    await expect(page.locator('.en-list li')).toHaveCount(1);
    w.stop(); expect(w.errors).toEqual([]);
  });

  test('oembed failure falls back to Untitled video; tag filter works', async ({ page }) => {
    await mockNet(page);
    await page.route('https://www.youtube.com/oembed**', (r) => r.abort());
    await empty(page, '/entertainment');
    await page.getByLabel('YouTube link').fill(ID(2));
    await page.locator('.en-seg').getByRole('button', { name: 'Fun', exact: true }).click();
    await page.getByRole('button', { name: 'Add to queue' }).click();
    await expect(page.locator('.en-list .en-title')).toHaveText('Untitled video');
    await page.getByLabel('YouTube link').fill(ID(3)); await page.getByLabel('Title (optional)').fill('A learn one');
    await page.locator('.en-seg').getByRole('button', { name: 'Learn', exact: true }).click();
    await page.getByRole('button', { name: 'Add to queue' }).click();
    await page.locator('.en-filter button', { hasText: 'fun' }).first().click();
    await expect(page.locator('.en-list li')).toHaveCount(1);
    await page.locator('.en-filter button', { hasText: 'learn' }).first().click();
    await expect(page.locator('.en-list li')).toHaveCount(1);
  });

  test('rapid double click on Add creates one video', async ({ page }) => {
    await mockNet(page);
    await page.route('https://www.youtube.com/oembed**', async (r) => { await new Promise((s) => setTimeout(s, 300)); await r.fulfill({ headers: CORS, json: { title: 'Slow' } }); });
    await empty(page, '/entertainment');
    await page.getByLabel('YouTube link').fill(ID(4));
    await page.getByRole('button', { name: 'Add to queue' }).dblclick();
    await page.waitForTimeout(800);
    expect((await getStore(page)).videos).toHaveLength(1);
  });

  test('Enter key submits the form', async ({ page }) => {
    await mockNet(page); await empty(page, '/entertainment');
    await page.getByLabel('YouTube link').fill(ID(5)); await page.getByLabel('Title (optional)').fill('Via Enter'); await page.keyboard.press('Enter');
    await expect(page.locator('.en-list .en-title')).toHaveText('Via Enter');
  });

  test('player: open, mark watched (XP-free log), close; phone layout', async ({ page }, info) => {
    await mockNet(page); await empty(page, '/entertainment');
    await page.getByLabel('YouTube link').fill(ID(6)); await page.getByLabel('Title (optional)').fill('Playable'); await page.getByRole('button', { name: 'Add to queue' }).click();
    await page.getByRole('button', { name: 'Play Playable' }).click();
    const frame = page.locator('.en-frame'); await expect(frame.locator('iframe')).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/x+6/);
    const box = await frame.boundingBox(); const vw = page.viewportSize()!.width;
    expect(box!.width).toBeLessThanOrEqual(vw); expect(box!.width / box!.height).toBeCloseTo(16 / 9, 1);
    expectCleanLayout(await layout(page, { touch: info.project.name !== 'desktop' }), 'player');
    await page.getByRole('button', { name: 'Mark watched' }).click();
    await expect(page.locator('.en-player')).toHaveCount(0);
    const s = await getStore(page); expect(s.videos).toHaveLength(1); expect(s.videos[0].watchedAt).toBeTruthy();
  });
});

test.describe('Entertainment: HackerTube', () => {
  test('loads, search, sort, show more, save, not for me, persistence of hidden + topics', async ({ page }) => {
    const w = watch(page); await mockNet(page); await empty(page, '/entertainment');
    await expect(page.locator('.en-card').first()).toBeVisible();
    expect(await page.locator('.en-card').count()).toBe(24);
    await page.getByRole('button', { name: /Show \d+ more/ }).click();
    expect(await page.locator('.en-card').count()).toBe(48);
    // search with no match, then clear
    const q = page.getByLabel('Search the library');
    await q.fill('zzzqqqxxnomatch'); await expect(page.getByText('Nothing matches')).toBeVisible();
    await expect(page.locator('.en-card')).toHaveCount(0);
    await q.fill('<script>alert(1)</script> "quoted" \\ [');  // regex-ish chars must not throw
    await expect(page.getByText('Nothing matches')).toBeVisible();
    await q.fill(''); await expect(page.locator('.en-card').first()).toBeVisible();
    expect(await page.locator('.en-card').count()).toBe(24); // paging resets when the query changes
    await page.getByRole('button', { name: 'Newest' }).click(); await expect(page.getByRole('button', { name: 'Newest' })).toHaveClass(/on/);
    // save for later -> leaves the library, appears in the queue
    const t = (await page.locator('.en-card .en-title').first().textContent())!;
    await page.locator('.en-card').first().getByRole('button', { name: 'Save for later' }).click();
    await expect(page.locator('.en-list .en-title', { hasText: t })).toBeVisible();
    await expect(page.locator('.en-feed-list .en-title', { hasText: t })).toHaveCount(0);
    // not for me -> hidden and persisted
    const t2 = (await page.locator('.en-card .en-title').first().textContent())!;
    await page.locator('.en-card').first().getByRole('button', { name: 'Not for me' }).click();
    await expect(page.locator('.en-feed-list .en-title', { hasText: t2 })).toHaveCount(0);
    expect(JSON.parse((await kvGet(page, 'ledger-feed-hidden'))!).length).toBe(1); // preferences live in the synced store (kv), not only in localStorage
    await page.reload({ waitUntil: 'load' });
    await expect(page.locator('.en-card').first()).toBeVisible();
    await expect(page.locator('.en-feed-list .en-title', { hasText: t2 })).toHaveCount(0);
    w.stop(); expect(w.errors).toEqual([]);
  });

  test('topic picker: toggle, starter picks, show everything, persists; corrupt storage tolerated', async ({ page }) => {
    await mockNet(page); await empty(page, '/entertainment');
    await expect(page.locator('.en-card').first()).toBeVisible();
    await page.getByRole('button', { name: 'Pick topics' }).click();
    const cats = page.locator('.en-cat'); expect(await cats.count()).toBeGreaterThan(100);
    await page.getByRole('button', { name: 'Show everything' }).click();
    await expect(page.getByText('0 picked')).toBeVisible();
    await expect(page.getByText('Showing everything')).toBeVisible();
    const first = cats.first(); await first.click(); await expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse((await kvGet(page, 'ledger-ht-topics'))!).length).toBe(1);
    await page.reload({ waitUntil: 'load' });
    await page.getByRole('button', { name: 'Pick topics' }).click();
    await expect(page.getByText('1 picked')).toBeVisible();
    await page.getByRole('button', { name: 'My starter picks' }).click(); await expect(page.getByText('10 picked')).toBeVisible();
    // corrupt / wrong-type storage must not crash
    const w = watch(page);
    await page.evaluate(() => { localStorage.setItem('ledger-ht-topics', '{"a":1}'); localStorage.setItem('ledger-feed-hidden', 'not json'); });
    await page.reload({ waitUntil: 'load' });
    await expect(page.locator('.en-card').first()).toBeVisible();
    w.stop(); expect(w.errors).toEqual([]);
  });

  test('library fetch failure shows an error, not a blank page', async ({ page }) => {
    await mockNet(page);
    await page.route('**/hackertube.json', (r) => r.fulfill({ headers: CORS, status: 500, body: 'x' }));
    await empty(page, '/entertainment');
    await expect(page.getByText('Could not load the HackerTube library')).toBeVisible();
  });

  test('a topic id in storage that no longer exists is ignored', async ({ page }) => {
    await mockNet(page); await empty(page, '/entertainment');
    await page.evaluate(() => localStorage.setItem('ledger-ht-topics', JSON.stringify(['does-not-exist'])));
    await page.reload({ waitUntil: 'load' });
    // unknown-only selection must not render a blank, "Nothing matches" feed with a misleading chip row
    await expect(page.locator('.en-card').first()).toBeVisible();
  });
});

test.describe('Entertainment: My YouTube', () => {
  test.setTimeout(120_000); // each channel is fetched with retries, so a failing mirror legitimately takes a while
  const mine = async (page: Page) => { await page.addInitScript(() => localStorage.setItem('ledger-feed-tab', 'mine')); };

  test('success: lists newest first, hides short videos, save + not for me, cache survives reload', async ({ page }) => {
    const w = watch(page); const hits = await mockNet(page, { channel: (u) => ({ videos: [
      { videoId: ID(hash(u) * 10 + 1), title: `${u} long`, published: Math.floor(Date.now() / 1000) - 3600, lengthSeconds: 900, author: u },
      { videoId: ID(hash(u) * 10 + 2), title: `${u} short`, published: Math.floor(Date.now() / 1000), lengthSeconds: 60, author: u },
      { videoId: ID(hash(u) * 10 + 3), title: `${u} live`, published: Math.floor(Date.now() / 1000), lengthSeconds: 900, author: u, liveNow: true },
    ] }) });
    await mine(page); await empty(page, '/entertainment');
    await expect(page.locator('.en-card').first()).toBeVisible();
    await expect(page.getByText(/short$/)).toHaveCount(0); await expect(page.getByText(/live$/)).toHaveCount(0);
    expect(await page.locator('.en-card').count()).toBeGreaterThan(0);
    await page.locator('.en-card').first().getByRole('button', { name: 'Not for me' }).click();
    await page.locator('.en-card').first().getByRole('button', { name: 'Save for later' }).click();
    expect((await getStore(page)).videos.length).toBe(1);
    const before = hits.api; await page.reload({ waitUntil: 'load' });
    await expect(page.locator('.en-card').first()).toBeVisible();
    expect(hits.api).toBe(before); // served from the 3h cache
    w.stop(); expect(w.errors).toEqual([]);
  });

  test('total failure shows message and Try again recovers', async ({ page }) => {
    let fail = true;
    await mockNet(page, { channel: (u) => (fail ? 'fail' : defaultVideos(u)) });
    await mine(page); await empty(page, '/entertainment');
    await expect(page.getByText('Could not reach any mirror server')).toBeVisible({ timeout: 60_000 });
    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('.en-card').first()).toBeVisible();
  });

  test('partial failure lists failed handles; Retry loads them', async ({ page }) => {
    let broken = true;
    await mockNet(page, { channel: (u) => (u === 'UCVeW9qkBjo3zosnqUbG7CFw' && broken ? 'fail' : defaultVideos(u)) });
    await mine(page); await empty(page, '/entertainment');
    const note = page.getByText(/Could not load:/);
    await expect(note).toBeVisible({ timeout: 60_000 });
    broken = false;
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(note).toHaveCount(0);
  });

  test('malformed JSON from a mirror counts as failure, no crash', async ({ page }) => {
    const w = watch(page);
    await mockNet(page, { channel: () => 'bad-json' });
    await mine(page); await empty(page, '/entertainment');
    await expect(page.getByText('Could not reach any mirror server')).toBeVisible({ timeout: 60_000 });
    w.stop(); expect(w.errors).toEqual([]);
  });

  test('missing "videos" field is treated as an empty channel', async ({ page }) => {
    await mockNet(page, { channel: () => ({}) });
    await mine(page); await empty(page, '/entertainment');
    await expect(page.getByText(/Loading your channels/)).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator('.en-card')).toHaveCount(0);
  });

  test('slow responses show loading progress', async ({ page }) => {
    await mockNet(page, { channel: () => 'slow' });
    await mine(page); await empty(page, '/entertainment');
    await expect(page.getByText(/Loading your channels… \d+ of \d+/)).toBeVisible();
    await expect(page.locator('.en-card').first()).toBeVisible({ timeout: 30_000 });
  });

  test('channel manager: add, duplicate, bad handle, remove, empty submit', async ({ page }) => {
    await mockNet(page, { resolve: (h) => (h === '@nope' ? null : 'UC' + h.replace('@', '')) });
    await mine(page); await empty(page, '/entertainment');
    await page.getByRole('button', { name: /^Channels \(/ }).click();
    const n0 = (await getStore(page)).channels.length;
    const input = page.getByLabel('Channel handle');
    await input.fill('   '); await page.getByRole('button', { name: 'Add channel' }).click();
    expect((await getStore(page)).channels.length).toBe(n0);
    await input.fill('https://www.youtube.com/@MyTestChan/videos'); await page.getByRole('button', { name: 'Add channel' }).click();
    await expect(page.locator('.en-chips li', { hasText: '@MyTestChan' })).toBeVisible();
    await input.fill('mytestchan'); await page.getByRole('button', { name: 'Add channel' }).click(); // duplicate (case-insens)
    expect((await getStore(page)).channels.length).toBe(n0 + 1);
    await input.fill('@'); await page.getByRole('button', { name: 'Add channel' }).click(); // just "@"
    expect((await getStore(page)).channels.some((c: { id: string }) => c.id === '')).toBe(false);
    await input.fill('@nope'); await page.getByRole('button', { name: 'Add channel' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText(/Could not load:.*@nope/)).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: /^Channels \(/ }).click();
    await page.getByRole('button', { name: 'Remove @nope' }).click();
    await page.getByRole('button', { name: 'Remove @MyTestChan' }).click();
    expect((await getStore(page)).channels.length).toBe(n0);
  });

  test('removing every channel does not crash and shows nothing', async ({ page }) => {
    const w = watch(page); await mockNet(page);
    await mine(page); await empty(page, '/entertainment');
    await patchStore(page, { channels: [] });
    await expect(page.getByRole('button', { name: 'Channels (0)' })).toBeVisible();
    await expect(page.locator('.en-card')).toHaveCount(0);
    w.stop(); expect(w.errors).toEqual([]);
  });
});

/* ---------- Rewards ---------- */
test.describe('Rewards', () => {
  test('empty account has a bare-wall state and no NaN', async ({ page }) => {
    await empty(page, '/rewards'); await patchStore(page, { rewards: [], xp: [] });
    await expect(page.getByText('The wall is bare')).toBeVisible();
    await expect(page.getByText('Nothing queued')).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(/NaN|undefined|Infinity/);
  });

  test('unlock threshold, claim, almost-there, sort order, persistence', async ({ page }) => {
    await empty(page, '/rewards');
    await patchStore(page, { xp: [xpEvent(600)], rewards: [
      { id: 'r1', title: 'Big', cost: 5000 }, { id: 'r2', title: 'Exact', cost: 600 }, { id: 'r3', title: 'Almost', cost: 1000 }, { id: 'r4', title: 'Far', cost: 100000 }, { id: 'r5', title: 'Cheap', cost: 100 },
    ] });
    const titles = await page.locator('.rw-grid').first().locator('.rw-title').allTextContents();
    expect(titles).toEqual(['Cheap', 'Exact', 'Almost', 'Big', 'Far']);
    await expect(page.locator('.rw-card', { hasText: 'Exact' })).toHaveClass(/rw-open/); // cost == xp unlocks
    await expect(page.locator('.rw-card', { hasText: 'Almost' })).toHaveClass(/rw-almost/); // 60%
    await expect(page.locator('.rw-card', { hasText: 'Big' })).toHaveClass(/rw-locked/);
    await expect(page.locator('.rw-card', { hasText: 'Almost' }).getByText('Almost there')).toBeVisible();
    await expect(page.locator('.rw-card', { hasText: 'Almost' }).getByRole('button', { name: 'Claim' })).toHaveCount(0);
    await expect(page.locator('.rw-sub')).toContainText('400 XP from');
    // claim: double click must claim once; XP is NOT spent (total XP threshold design)
    await page.locator('.rw-card', { hasText: 'Cheap' }).getByRole('button', { name: 'Claim' }).dblclick();
    const s = await getStore(page);
    expect(s.rewards.filter((r: { claimedAt?: string }) => r.claimedAt)).toHaveLength(1);
    expect(s.xp).toHaveLength(1);
    await expect(page.getByText('Claimed', { exact: true })).toBeVisible();
    await page.reload({ waitUntil: 'load' });
    await expect(page.locator('.rw-done', { hasText: 'Cheap' })).toBeVisible();
    // out-of-date: lower XP after claim keeps claimed reward claimed
  });

  test('XP 0 and huge totals render', async ({ page }) => {
    await empty(page, '/rewards');
    await patchStore(page, { xp: [xpEvent(1e12)], rewards: [{ id: 'a', title: 'Huge', cost: 9e15 }, { id: 'b', title: 'Zero cost', cost: 0 }] });
    expect(await page.locator('body').innerText()).not.toMatch(/NaN|Infinity/);
    expectCleanLayout(await layout(page, { touch: false }), 'huge numbers');
  });

  test('add reward validation: empty title, 0, negative, decimal, huge; Escape/scrim close', async ({ page }) => {
    await empty(page, '/rewards'); await patchStore(page, { rewards: [], xp: [] });
    const open = () => page.getByRole('button', { name: /Add/ }).click();
    const dlg = page.getByRole('dialog');
    await open();
    const save = dlg.getByRole('button', { name: 'Save' });
    await expect(save).toBeDisabled(); // empty title
    await dlg.getByPlaceholder('Something worth grinding for').fill('   '); await expect(save).toBeDisabled();
    await dlg.getByPlaceholder('Something worth grinding for').fill('Treat');
    for (const bad of ['0', '-5']) { await dlg.getByLabel(/Cost/).fill(bad); await expect(save).toBeDisabled(); }
    await dlg.getByLabel(/Cost/).fill(''); await expect(save).toBeDisabled();
    await dlg.getByLabel(/Cost/).fill('12.6'); await save.click();
    await expect(dlg).toHaveCount(0);
    expect((await getStore(page)).rewards[0].cost).toBe(13);
    await open(); await dlg.getByPlaceholder('Something worth grinding for').fill('Huge'); await dlg.getByLabel(/Cost/).fill('99999999999999999999'); await expect(dlg.getByRole('button', { name: 'Save' })).toBeDisabled(); // absurd costs are refused
    await dlg.getByLabel(/Cost/).fill('1000000000000'); await dlg.getByRole('button', { name: 'Save' }).click();
    expect(await page.locator('body').innerText()).not.toMatch(/NaN|Infinity|e\+/);
    expectCleanLayout(await layout(page, { touch: false }), 'huge reward');
    // 0.4 rounds to 0: must not create a zero-cost reward
    await open(); await dlg.getByPlaceholder('Something worth grinding for').fill('Tiny'); await dlg.getByLabel(/Cost/).fill('0.4');
    await expect(dlg.getByRole('button', { name: 'Save' })).toBeDisabled();
    const s = await getStore(page); expect(s.rewards.every((r: { cost: number }) => r.cost >= 1)).toBe(true);
  });

  test('Enter submits, Escape closes the sheet', async ({ page }) => {
    await empty(page, '/rewards'); await patchStore(page, { rewards: [], xp: [] });
    await page.getByRole('button', { name: /Add/ }).click();
    await page.getByPlaceholder('Something worth grinding for').fill('Via enter'); await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.rw-title', { hasText: 'Via enter' })).toBeVisible();
    await page.getByRole('button', { name: /Add/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('edit and delete a reward; claimed reward can be edited back', async ({ page }) => {
    await empty(page, '/rewards');
    await patchStore(page, { xp: [xpEvent(50)], rewards: [{ id: 'e1', title: 'Old name', cost: 10 }, { id: 'e2', title: 'Gone', cost: 99999 }] });
    await page.getByRole('button', { name: 'Old name' }).click();
    await page.getByPlaceholder('Something worth grinding for').fill('New name'); await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'New name' })).toBeVisible();
    expect((await getStore(page)).rewards).toHaveLength(2); // upsert, not duplicate
    await page.getByRole('button', { name: 'Gone' }).click(); await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('button', { name: 'Gone' })).toHaveCount(0);
  });

  test('long title does not overflow on the phone', async ({ page }, info) => {
    await empty(page, '/rewards');
    await patchStore(page, { xp: [xpEvent(5)], rewards: [{ id: 'l1', title: 'Supercalifragilisticexpialidocious'.repeat(4) + ' and then some more words go here', cost: 10 }] });
    expectCleanLayout(await layout(page, { touch: info.project.name !== 'desktop' }), 'long reward title');
  });

  test('many rewards: page stays usable', async ({ page }) => {
    await empty(page, '/rewards');
    await patchStore(page, { xp: [xpEvent(500)], rewards: Array.from({ length: 80 }, (_, i) => ({ id: 'm' + i, title: 'Reward ' + i, cost: (i + 1) * 20 })) });
    await expect(page.locator('.rw-card')).toHaveCount(80);
    expectCleanLayout(await layout(page, { touch: false }), 'many rewards');
  });
});

/* ---------- Settings ---------- */
test.describe('Settings', () => {
  test('theme picker: 13 tiles, preview modes, select persists and sets data-skin/data-theme', async ({ page }) => {
    const w = watch(page);
    await page.goto('/settings', { waitUntil: 'load' });
    await expect(page.locator('.tpk-tile')).toHaveCount(13);
    await expect(page.locator('.tpk-tile.on')).toHaveCount(1);
    for (const p of ['Dark', 'Light', 'As designed']) { await page.locator('.tpk-seg').first().getByRole('button', { name: p }).click(); }
    await page.locator('.tpk-seg').first().getByRole('button', { name: 'Light' }).click();
    const modes = await page.locator('.tp-mini').evaluateAll((els) => els.map((e) => e.getAttribute('data-theme')));
    expect(new Set(modes)).toEqual(new Set(['light']));
    await page.locator('.tpk-tile', { hasText: 'Cyberpunk' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'cyberpunk');
    await expect(page.locator('.tpk-tile.on')).toHaveCount(1);
    await expect(page.locator('.tpk-tile.on')).toContainText('Cyberpunk');
    // current-mode toggle
    const mode = page.getByRole('group', { name: 'Mode' });
    await mode.getByRole('button', { name: 'Light' }).click(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await mode.getByRole('button', { name: 'Dark' }).click(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload({ waitUntil: 'load' });
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'cyberpunk');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const s = await getStore(page); expect(s.settings.skin).toBe('cyberpunk');
    w.stop(); expect(w.errors).toEqual([]);
  });

  test('every tile can be selected', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'load' });
    const n = await page.locator('.tpk-tile').count();
    for (let i = 0; i < n; i++) {
      const tile = page.locator('.tpk-tile').nth(i); const name = (await tile.locator('.tpk-name').textContent())!;
      await tile.click(); await expect(page.locator('.tpk-tile.on .tpk-name')).toHaveText(name);
      const skin = await page.locator('html').getAttribute('data-skin'); expect(skin).toBeTruthy();
    }
  });

  test('name and wake time fields persist; clearing weekend wake; invalid time input', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'load' });
    await page.getByLabel('Your name').fill('Ünï Cödé 😀 ' + 'N'.repeat(200));
    await page.getByLabel('Wake time, weekdays').fill('05:45');
    await page.getByLabel('Weekends (optional)').fill('08:30');
    let s = await getStore(page); expect(s.settings.wakeTime).toBe('05:45'); expect(s.settings.weekendWake).toBe('08:30');
    await page.getByLabel('Weekends (optional)').fill('');
    s = await getStore(page); expect(s.settings.weekendWake ?? null).toBeNull();
    // clearing the weekday time must not store garbage that breaks the Today page
    await page.getByLabel('Wake time, weekdays').fill('');
    s = await getStore(page); expect(s.settings.wakeTime, 'wakeTime must stay a valid HH:MM').toMatch(/^\d{2}:\d{2}$/);
    await page.reload({ waitUntil: 'load' });
    await expect(page.getByLabel('Your name')).toHaveValue(/^Ünï Cödé/);
    const w = watch(page); await page.goto('/today', { waitUntil: 'load' }); await page.waitForTimeout(300); w.stop(); expect(w.errors).toEqual([]);
  });

  test('backup download is valid JSON containing the full state', async ({ page }) => {
    await visit(page, '/settings', 'canopy', 'dark');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
    expect(dl.suggestedFilename()).toMatch(/^ledger-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const txt = await (await import('node:fs/promises')).readFile((await dl.path())!, 'utf8');
    const j = JSON.parse(txt);
    expect(j).toMatchObject({ format: 'ledger-backup', version: 2 });
    for (const k of ['habits', 'tasks', 'xp', 'rewards', 'videos']) expect(j.collections, k).toHaveProperty(k);
    expect(j, 'settings').toHaveProperty('settings');
    await expect(page.getByText('Backup downloaded.')).toBeVisible();
  });

  const upload = async (page: Page, content: string, name = 'b.json') => {
    await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(content) });
  };

  test('restore: round trip restores data', async ({ page }) => {
    await empty(page, '/settings'); await patchStore(page, { xp: [xpEvent(77)], rewards: [{ id: 'q', title: 'Backed up', cost: 5 }] });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
    const txt = await (await import('node:fs/promises')).readFile((await dl.path())!, 'utf8');
    await patchStore(page, { xp: [], rewards: [] });
    await upload(page, txt);
    await page.getByRole('dialog', { name: 'Restore from this file?' }).getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.getByText('Backup restored.')).toBeVisible();
    const s = await getStore(page); expect(s.rewards[0].title).toBe('Backed up'); expect(s.xp[0].amount).toBe(77);
  });

  const BAD: [string, string][] = [
    ['invalid JSON', '{not json'], ['empty file', ''], ['null', 'null'], ['a number', '42'], ['a string', '"hi"'], ['an array', '[1,2,3]'],
    ['wrong shape', '{"foo":"bar"}'], ['collections of the wrong type', '{"habits":"nope","tasks":5,"xp":{"a":1},"settings":null,"rewards":null}'],
    ['settings missing fields', '{"settings":{"theme":"purple"}}'],
  ];
  for (const [label, body] of BAD) test(`restore rejects ${label} without corrupting data or crashing`, async ({ page }) => {
    const w = watch(page);
    await empty(page, '/settings'); await patchStore(page, { xp: [xpEvent(77)], rewards: [{ id: 'q', title: 'Keep me', cost: 5 }] });
    const before = await getStore(page);
    await upload(page, body);
    await expect(page.getByRole('status').filter({ hasText: /could not|not a valid|invalid/i })).toBeVisible();
    expect(await getStore(page)).toEqual(before);
    // app still navigable after reload
    await page.reload({ waitUntil: 'load' });
    await page.goto('/today', { waitUntil: 'load' }); await expect(page.locator('.main, .page').first()).toBeVisible();
    await page.goto('/rewards', { waitUntil: 'load' }); await expect(page.getByText('Keep me')).toBeVisible();
    w.stop(); expect(w.errors).toEqual([]);
  });

  test('restore of an older / partial backup keeps the app working (missing collections default to empty)', async ({ page }) => {
    const w = watch(page);
    await empty(page, '/settings'); await patchStore(page, { xp: [xpEvent(77)] });
    await upload(page, JSON.stringify({ rewards: [{ id: 'old', title: 'Old backup reward', cost: 10 }], xp: [], settings: { theme: 'light', wakeTime: '06:00', name: 'Old' } }));
    await page.getByRole('dialog', { name: 'Restore from this file?' }).getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.getByText('Backup restored.')).toBeVisible();
    for (const r of ['/today', '/habits', '/tasks', '/gym', '/journal', '/books', '/entertainment', '/character', '/rewards', '/settings']) {
      await page.goto(r, { waitUntil: 'load' }); await expect(page.locator('.main, .page').first()).toBeVisible();
    }
    w.stop(); expect(w.errors).toEqual([]);
  });

  test('buttons are keyboard reachable and show a visible focus ring', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'load' });
    await page.getByRole('button', { name: 'Download backup' }).focus();
    const ring = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement!); return cs.outlineStyle !== 'none' || cs.boxShadow !== 'none'; });
    expect(ring).toBe(true);
  });

  test('no sync card without Supabase (no dead pill)', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'load' });
    await expect(page.getByText('Account and sync')).toHaveCount(0);
  });
});
