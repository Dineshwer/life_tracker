import { test, expect, type Page } from '@playwright/test';
import { CHANNELS_ALL, CHANNEL_PICKS, handleId } from '../../src/entertainment/catalog';
import { layout } from './fixtures';

/* Entertainment > Channels tab. Phone project only. Every mirror call is mocked (the real mirrors are slow and flaky). */
const PICK_IDS = new Set(CHANNEL_PICKS.map((c) => handleId(c.handle)));
const SUGGESTED = CHANNELS_ALL.filter((c) => !PICK_IDS.has(handleId(c.handle)));
const byCid = new Map(CHANNELS_ALL.filter((c) => c.cid).map((c) => [c.cid!, c]));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const idOf = (cid: string, n: number) => `${cid.slice(2, 9)}_v${n}`.padEnd(11, 'x').slice(0, 11).replace(/[^\w-]/g, '_');

async function mock(page: Page, opts: { down?: boolean } = {}) {
  await page.route('**/instances.json*', (r) => r.fulfill({ json: [] }));
  await page.route('**/i.ytimg.com/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
  await page.route('**/api/v1/**', async (route) => {
    if (opts.down) return route.fulfill({ status: 503, body: 'down' });
    const u = new URL(route.request().url()); const p = u.pathname;
    let m: RegExpMatchArray | null;
    if (p.endsWith('/resolveurl')) return route.fulfill({ json: { ucid: 'UCcustomcustomcustomcust1' } });
    if ((m = p.match(/\/channels\/(UC[\w-]+)\/videos$/))) {
      const cid = m[1]; const c = byCid.get(cid); const now = Date.now();
      return route.fulfill({ json: { videos: [
        { videoId: idOf(cid, 1), title: `Newest from ${c?.name ?? 'custom'}`, published: Math.floor((now - 86400000) / 1000), lengthSeconds: 900, author: c?.name ?? 'Custom channel' },
        { videoId: idOf(cid, 2), title: `Older from ${c?.name ?? 'custom'}`, published: Math.floor((now - 5 * 86400000) / 1000), lengthSeconds: 1300, author: c?.name ?? 'Custom channel' },
        { videoId: idOf(cid, 3), title: 'A short clip', published: Math.floor(now / 1000), lengthSeconds: 40, author: c?.name ?? 'x' },
      ] } });
    }
    if ((m = p.match(/\/channels\/(UC[\w-]+)\/playlists$/))) return route.fulfill({ json: { playlists: [{ playlistId: 'PLfixture0000001', title: 'Fixture course', videoCount: 2 }] } });
    if ((m = p.match(/\/playlists\/([\w-]+)$/))) return route.fulfill({ json: { title: 'Fixture course', author: 'x', videoCount: 2, videos: [
      { videoId: 'lecture0001', title: 'Lecture one', lengthSeconds: 600, index: 0 }, { videoId: 'lecture0002', title: 'Lecture two', lengthSeconds: 700, index: 1 }] } });
    return route.fulfill({ status: 404, body: '{}' });
  });
}
async function open(page: Page, skin = 'canopy', mode = 'dark') {
  await page.goto(`/entertainment?skin=${skin}&mode=${mode}&demo=1#channels`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tab', { name: /^Mine/ })).toBeVisible();
}
const tab = (page: Page, name: RegExp) => page.getByRole('tab', { name });

test.beforeEach(({}, info) => { test.skip(info.project.name !== 'phone', 'phone only'); });

test('opens on Mine with counts and no horizontal scroll', async ({ page }) => {
  await mock(page); await open(page);
  await expect(tab(page, /^Mine/)).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, /^Mine/)).toContainText(String(CHANNEL_PICKS.length));
  await expect(tab(page, /^Suggested/)).toContainText(String(SUGGESTED.length));
  await expect(tab(page, /^All mixed/)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.ch-vid').first()).toBeVisible();
  expect((await layout(page, { touch: true })).hscroll).toBeLessThanOrEqual(0);
});

test('mixed feed: thumbnails, topic filter, newest first, short clips hidden', async ({ page }) => {
  await mock(page); await open(page);
  const rows = page.locator('.ch-vid');
  await expect(rows.first()).toBeVisible();
  await expect(rows.first().locator('img')).toHaveAttribute('src', /i\.ytimg\.com\/vi\/.+\/mqdefault/);
  await expect(page.getByText('A short clip')).toHaveCount(0);
  await expect(page.getByText('Loading your channels…')).toHaveCount(0, { timeout: 30_000 });
  const before = await rows.count();
  await page.getByRole('group', { name: 'Topic' }).getByRole('button', { name: 'Tamil' }).click();
  const tamil = CHANNEL_PICKS.filter((c) => c.topic === 'tamil').map((c) => c.name);
  const n = await rows.count();
  expect(n).toBeGreaterThan(0); expect(n).toBeLessThan(before);
  for (const meta of await rows.locator('.ch-vmeta').allTextContents()) expect(tamil.some((t) => meta.startsWith(t))).toBe(true);
});

test('feed shows progress while loading', async ({ page }) => {
  await mock(page);
  await page.route('**/api/v1/channels/*/videos', async (r) => { await new Promise((x) => setTimeout(x, 1500)); await r.fallback(); });
  await open(page);
  await expect(page.getByText(/Loading your channels… \d+ of \d+/)).toBeVisible();
});

test('play, hide and save for later', async ({ page }) => {
  await mock(page); await open(page);
  const rows = page.locator('.ch-vid');
  await expect(rows.first()).toBeVisible();
  await rows.first().getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('section[aria-label="Player"] iframe')).toHaveAttribute('src', /youtube-nocookie\.com\/embed\//);
  const first = await rows.first().locator('.ch-vtitle').textContent();
  await rows.first().getByRole('button', { name: 'Not interested' }).click();
  await expect(rows.filter({ hasText: first! })).toHaveCount(0);
  const second = await rows.first().locator('.ch-vtitle').textContent();
  await rows.first().getByRole('button', { name: 'Save for later' }).click();
  await expect(rows.filter({ hasText: second! })).toHaveCount(0);
  await page.reload();
  await expect(rows.first()).toBeVisible();
  await expect(rows.filter({ hasText: first! })).toHaveCount(0);
  await expect(rows.filter({ hasText: second! })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Saved' }).click();
  await expect(page.getByText(second!).first()).toBeVisible();
});

test('add from Suggested moves to Mine (persists), remove returns it', async ({ page }) => {
  await mock(page); await open(page);
  const target = SUGGESTED.find((c) => c.topic === 'tech')!;
  await tab(page, /^Suggested/).click();
  const card = page.locator('.ch-card', { hasText: target.name }).first();
  await expect(card).toContainText(target.about!);
  await card.getByRole('button', { name: '+ Add to mine' }).click();
  await expect(tab(page, /^Mine/)).toContainText(String(CHANNEL_PICKS.length + 1));
  await expect(tab(page, /^Suggested/)).toContainText(String(SUGGESTED.length - 1));
  await expect(page.locator('.ch-card', { hasText: target.name })).toHaveCount(0);
  await page.reload();
  await expect(tab(page, /^Mine/)).toContainText(String(CHANNEL_PICKS.length + 1));
  await tab(page, /^One channel/).click();
  await page.locator('.ch-strip').getByRole('button', { name: target.name }).click();
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(tab(page, /^Mine/)).toContainText(String(CHANNEL_PICKS.length));
  await tab(page, /^Suggested/).click();
  await expect(page.locator('.ch-card', { hasText: target.name })).toHaveCount(1);
});

test('dismiss and restore a suggestion', async ({ page }) => {
  await mock(page); await open(page);
  await tab(page, /^Suggested/).click();
  const first = page.locator('.ch-card').first();
  const name = (await first.locator('.ch-name').textContent())!;
  await first.getByRole('button', { name: 'Not interested' }).click();
  await expect(page.locator('.ch-card', { hasText: name })).toHaveCount(0);
  await expect(tab(page, /^Suggested/)).toContainText(String(SUGGESTED.length - 1));
  await page.getByRole('button', { name: 'Restore 1 dismissed' }).click();
  await expect(page.locator('.ch-card', { hasText: name })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Restore/ })).toHaveCount(0);
});

test('suggested: topic chips limited to present topics, finance sub chips, preview on demand', async ({ page }) => {
  await mock(page);
  let videoCalls = 0;
  await page.route('**/api/v1/channels/*/videos', (r) => { videoCalls++; return r.fallback(); });
  await open(page);
  await tab(page, /^Suggested/).click();
  const chips = page.getByRole('group', { name: 'Topic' });
  await expect(chips.getByRole('button', { name: 'Finance' })).toBeVisible();
  await expect(chips.getByRole('button', { name: 'Science & engineering' })).toBeVisible();
  await chips.getByRole('button', { name: 'Finance' }).click();
  await page.getByRole('group', { name: 'Finance type' }).getByRole('button', { name: 'Stocks' }).click();
  const stocks = SUGGESTED.filter((c) => c.topic === 'fin' && c.sub === 'stocks').length;
  await expect(page.locator('.ch-card')).toHaveCount(stocks);
  const before = videoCalls;
  await page.locator('.ch-card').first().getByRole('button', { name: /^Preview/ }).click();
  await expect(page.getByRole('heading', { name: 'Latest videos' })).toBeVisible();
  await expect(page.locator('.ch-vid').first()).toBeVisible();
  expect(videoCalls - before).toBeLessThanOrEqual(1);
  await expect(page.getByRole('button', { name: '+ Add to mine' })).toBeVisible();
  await page.getByRole('button', { name: /Back to Suggested/ }).click();
  await expect(page.locator('.ch-card')).toHaveCount(stocks);
});

test('One channel: strip, channel page, playlist drill-down', async ({ page }) => {
  await mock(page); await open(page);
  await tab(page, /^One channel/).click();
  const strip = page.locator('.ch-strip');
  const second = CHANNEL_PICKS[1];
  await strip.getByRole('button', { name: second.name, exact: true }).click();
  await expect(page.getByRole('heading', { name: second.name })).toBeVisible();
  await expect(page.getByText(`Newest from ${second.name}`)).toBeVisible();
  await expect(page.locator('.ch-vid img').first()).toBeVisible();
  expect(await page.locator('.ch').evaluate((e) => e.getBoundingClientRect().width)).toBeLessThanOrEqual(393);
  await page.getByRole('button', { name: /Fixture course/ }).click();
  await expect(page.getByText('Lecture two')).toBeVisible();
  await page.locator('.ch-vid').first().getByRole('button', { name: /Play Lecture one/ }).click();
  await expect(page.locator('section[aria-label="Player"] iframe')).toHaveAttribute('src', /list=PLfixture0000001/);
  await page.getByRole('button', { name: /Back to/ }).click();
  await expect(page.getByRole('heading', { name: 'Latest videos' })).toBeVisible();
  expect((await layout(page, { touch: true })).hscroll).toBeLessThanOrEqual(0);
});

test('mirror servers down: friendly state with retry and YouTube link', async ({ page }) => {
  await mock(page, { down: true }); await open(page);
  await expect(page.getByText('Mirror servers are down right now')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the channel on YouTube' })).toHaveAttribute('href', /^https:\/\/www\.youtube\.com\/@/);
  await tab(page, /^One channel/).click();
  await expect(page.getByText('Mirror servers are down right now')).toBeVisible({ timeout: 60_000 });
});

test('custom channel: validation and add', async ({ page }) => {
  await mock(page); await open(page);
  await page.getByRole('button', { name: '+ Add your own channel' }).click();
  const form = page.getByRole('form', { name: 'Add a channel' });
  await form.getByRole('button', { name: 'Add channel' }).click();
  await expect(form.getByRole('alert')).toContainText('Enter a channel handle');
  await form.getByLabel('Channel handle or link').fill('https://www.youtube.com/channel/UC123');
  await form.getByRole('button', { name: 'Add channel' }).click();
  await expect(form.getByRole('alert')).toContainText('@name');
  await form.getByLabel('Channel handle or link').fill(CHANNEL_PICKS[0].handle);
  await form.getByRole('button', { name: 'Add channel' }).click();
  await expect(form.getByRole('alert')).toContainText('already');
  await form.getByLabel('Channel handle or link').fill('https://www.youtube.com/@MyCustomChan');
  await form.getByLabel('Topic').selectOption('fin');
  await form.getByLabel('Finance type').selectOption('stocks');
  await form.getByRole('button', { name: 'Add channel' }).click();
  await expect(tab(page, /^Mine/)).toContainText(String(CHANNEL_PICKS.length + 1));
  await page.reload();
  await expect(tab(page, /^Mine/)).toContainText(String(CHANNEL_PICKS.length + 1));
  await tab(page, /^One channel/).click();
  await page.getByRole('group', { name: 'Topic' }).getByRole('button', { name: 'Finance' }).click();
  await expect(page.locator('.ch-strip').getByRole('button', { name: 'MyCustomChan' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'MyCustomChan' })).toBeVisible();
});
