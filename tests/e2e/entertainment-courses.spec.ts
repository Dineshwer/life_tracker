import { test, expect, type Page } from '@playwright/test';
import { visit, layout } from './fixtures';
import { COURSES_ALL } from '../../src/entertainment/catalog';

/** Courses tab of the Entertainment page. Phone project only. Network is mocked: /courses.json and the Invidious mirror. */
test.beforeEach(({ page: _p }, info) => { test.skip(info.project.name !== 'phone', 'phone only'); });

const PICKS = COURSES_ALL.filter((c) => c.origin === 'pick');
const SUGG_PL = COURSES_ALL.filter((c) => c.origin === 'suggest' && c.kind === 'playlist');
const SUGG_LINK = COURSES_ALL.find((c) => c.origin === 'suggest' && c.kind === 'link');
const BACKEND = PICKS.find((c) => c.title === 'Backend from first principles')!;

const vid = (pl: string, i: number) => (pl.replace(/[^A-Za-z0-9]/g, '') + 'xxxxxxxxxxx').slice(-8) + String(i).padStart(3, '0');
const COUNT = 12;
async function mock(page: Page, opts: { fail?: boolean } = {}) {
  await page.route('**/courses.json', (r) => r.fulfill({ status: 404, body: '' }));
  await page.route('**/api.invidious.io/**', (r) => r.fulfill({ json: [] }));
  await page.route('**/i.ytimg.com/**', (r) => r.fulfill({ status: 204 }));
  await page.route('**/api/v1/**', (r) => {
    if (opts.fail) return r.fulfill({ status: 500, body: 'no' });
    const m = /playlists\/([^?]+)/.exec(r.request().url());
    if (!m) return r.fulfill({ json: {} });
    const id = decodeURIComponent(m[1]);
    const page1 = /page=1/.test(r.request().url());
    return r.fulfill({ json: { title: 'Mock ' + id, author: 'Mock', videoCount: COUNT, videos: page1 ? Array.from({ length: COUNT }, (_, i) => ({ videoId: vid(id, i), title: `Lecture ${i + 1} of ${id.slice(-4)}`, lengthSeconds: 600 + i, index: i })) : [] } });
  });
}
async function open(page: Page, skin = 'canopy', mode = 'dark') {
  await page.addInitScript(() => { try { sessionStorage.setItem('ledger-ent-tab', 'courses'); } catch { /* */ } });
  await mock(page);
  await visit(page, '/entertainment', skin, mode);
  await expect(page.getByRole('tab', { name: /^Mine/ })).toBeVisible();
}
const card = (page: Page, title: string) => page.getByTestId('course-card').filter({ hasText: title });
const seg = (page: Page, n: 'Mine' | 'Suggested') => page.getByRole('tab', { name: new RegExp('^' + n) });

test('Mine opens by default and counts match', async ({ page }) => {
  await open(page);
  await expect(seg(page, 'Mine')).toHaveAttribute('aria-selected', 'true');
  await expect(seg(page, 'Mine')).toContainText(String(PICKS.length));
  await expect(seg(page, 'Suggested')).toContainText(String(COURSES_ALL.length - PICKS.length));
  await expect(page.getByTestId('course-card')).toHaveCount(PICKS.length);
  const l = await layout(page, { touch: true });
  expect(l.hscroll).toBeLessThanOrEqual(0);
});

test('add from Suggested moves to Mine, survives reload; remove returns it', async ({ page }) => {
  await open(page);
  const s = SUGG_PL[0];
  await seg(page, 'Suggested').click();
  await card(page, s.title).getByRole('button', { name: '+ Add to mine' }).click();
  await expect(card(page, s.title)).toHaveCount(0);
  await expect(seg(page, 'Mine')).toContainText(String(PICKS.length + 1));
  await page.waitForTimeout(800);
  await page.reload(); await page.waitForTimeout(500);
  await seg(page, 'Mine').click();
  await expect(card(page, s.title)).toHaveCount(1);
  await card(page, s.title).getByRole('button', { name: /^Remove/ }).click();
  await expect(card(page, s.title)).toHaveCount(0);
  await seg(page, 'Suggested').click();
  await expect(card(page, s.title)).toHaveCount(1);
});

test('removing a pick sends it to Suggested', async ({ page }) => {
  await open(page);
  await card(page, BACKEND.title).getByRole('button', { name: /^Remove/ }).click();
  await seg(page, 'Suggested').click();
  await expect(card(page, BACKEND.title)).toHaveCount(1);
});

test('dismiss and restore', async ({ page }) => {
  await open(page);
  const s = SUGG_PL[1];
  await seg(page, 'Suggested').click();
  await expect(page.getByRole('button', { name: /Restore dismissed/ })).toHaveCount(0);
  await card(page, s.title).getByRole('button', { name: /^Not interested/ }).click();
  await expect(card(page, s.title)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Restore dismissed (1)' })).toBeVisible();
  await page.getByRole('button', { name: /Restore dismissed/ }).click();
  await expect(card(page, s.title)).toHaveCount(1);
});

test('course page, mark watched, progress and Continue', async ({ page }) => {
  await open(page);
  const c = card(page, BACKEND.title);
  await expect(c.getByText('Not started')).toBeVisible();
  await expect(c.getByRole('button', { name: 'Start' })).toBeVisible();
  await c.getByRole('button', { name: BACKEND.title, exact: true }).click();
  await expect(page.getByRole('heading', { name: BACKEND.title })).toBeVisible();
  await expect(page.getByTestId('lecture')).toHaveCount(COUNT);
  await page.getByRole('button', { name: 'Mark lecture 1 watched' }).click();
  await page.getByRole('button', { name: 'Mark lecture 2 watched' }).click();
  await expect(page.getByText(`2 of ${COUNT} watched`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue · #3' })).toBeVisible();
  await page.getByRole('button', { name: 'Mark lecture 2 unwatched' }).click();
  await expect(page.getByText(`1 of ${COUNT} watched`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue · #2' })).toBeVisible();
  await page.getByRole('button', { name: /^Play lecture 4/ }).click();
  await expect(page.locator('.en-player iframe')).toHaveAttribute('src', new RegExp(`list=${BACKEND.id}`));
  await page.getByRole('button', { name: '‹ Courses' }).click();
  await expect(card(page, BACKEND.title).getByText(`1 of ${COUNT} watched`)).toBeVisible();
  await expect(card(page, BACKEND.title).getByRole('button', { name: 'Continue · #2' })).toBeVisible();
  await card(page, BACKEND.title).getByRole('button', { name: 'Continue · #2' }).click();
  await expect(page.locator('.en-player iframe')).toHaveAttribute('src', new RegExp(vid(BACKEND.id, 1)));
});

test('finished course says Review', async ({ page }) => {
  await open(page);
  await card(page, BACKEND.title).getByRole('button', { name: BACKEND.title, exact: true }).click();
  for (let i = 1; i <= COUNT; i++) await page.getByRole('button', { name: `Mark lecture ${i} watched` }).click();
  await page.getByRole('button', { name: '‹ Courses' }).click();
  await expect(card(page, BACKEND.title).getByRole('button', { name: 'Review' })).toBeVisible();
});

test('lecture list failure offers YouTube, in-app and retry', async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem('ledger-ent-tab', 'courses'); } catch { /* */ } });
  await page.route('**/courses.json', (r) => r.fulfill({ status: 404, body: '' }));
  await page.route('**/api.invidious.io/**', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/v1/**', (r) => r.fulfill({ status: 500, body: 'no' }));
  await visit(page, '/entertainment', 'canopy', 'dark');
  await card(page, BACKEND.title).getByRole('button', { name: 'Open' }).click();
  await expect(page.getByText('Could not load the lecture list')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('link', { name: 'Play on YouTube' })).toHaveAttribute('href', /playlist\?list=/);
  await page.getByRole('button', { name: 'Play inside the app' }).click();
  await expect(page.locator('.cr-embed iframe')).toHaveAttribute('src', /videoseries\?list=/);
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('custom playlist: invalid link then valid', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '+ Add a playlist' }).click();
  await page.getByLabel('Playlist link').fill('https://example.com/nope');
  await page.getByLabel('Name').fill('My course');
  await page.getByRole('button', { name: 'Add course' }).click();
  await expect(page.getByRole('alert')).toContainText('does not look like a YouTube playlist link');
  await page.getByLabel('Playlist link').fill('https://www.youtube.com/playlist?list=PLabcdefghijk1234567');
  await page.getByRole('button', { name: 'Add course' }).click();
  await expect(card(page, 'My course')).toHaveCount(1);
  await expect(seg(page, 'Mine')).toContainText(String(PICKS.length + 1));
  await card(page, 'My course').getByRole('button', { name: /^Remove/ }).click();
  await expect(card(page, 'My course')).toHaveCount(0);
});

test('Finance sub-chips filter', async ({ page }) => {
  await open(page);
  await page.getByRole('group', { name: 'Topic' }).getByRole('button', { name: 'Finance' }).click();
  const fin = PICKS.filter((c) => c.topic === 'fin');
  await expect(page.getByTestId('course-card')).toHaveCount(fin.length);
  const sub = page.getByRole('group', { name: 'Finance type' });
  await sub.getByRole('button', { name: 'Investing' }).click();
  await expect(page.getByTestId('course-card')).toHaveCount(fin.filter((c) => c.sub === 'investing').length);
  await sub.getByRole('button', { name: 'Money saving' }).click();
  await expect(page.getByText(/No Finance courses here/)).toBeVisible();
  await page.getByRole('button', { name: 'Show all topics' }).click();
  await expect(page.getByTestId('course-card')).toHaveCount(PICKS.length);
});

test('link course shows website note and can be added', async ({ page }) => {
  test.skip(!SUGG_LINK, 'no link course in catalog');
  await open(page);
  await seg(page, 'Suggested').click();
  const c = card(page, SUGG_LINK!.title);
  await expect(c.getByText('Opens on their website')).toBeVisible();
  await c.getByRole('button', { name: '+ Add to mine' }).click();
  await seg(page, 'Mine').click();
  await expect(card(page, SUGG_LINK!.title).getByRole('link', { name: 'Open course site' })).toHaveAttribute('href', SUGG_LINK!.url!);
});

/** screenshots for visual review (not asserted) */
const SHOTS = (process.env.SHOT_SKINS ?? '').split(',').filter(Boolean);
for (const skin of SHOTS) for (const mode of ['dark', 'light']) test(`shots ${skin} ${mode}`, async ({ page }, info) => {
  await open(page, skin, mode);
  const dir = process.env.SHOT_DIR ?? '/tmp/pw-courses-shots';
  const snap = (n: string) => page.screenshot({ path: `${dir}/${skin}-${mode}-${n}.png` });
  await page.waitForTimeout(600); await snap('mine');
  await seg(page, 'Suggested').click(); await page.waitForTimeout(400); await snap('suggested');
  await seg(page, 'Mine').click();
  await card(page, BACKEND.title).getByRole('button', { name: BACKEND.title, exact: true }).click();
  await page.getByRole('button', { name: 'Mark lecture 1 watched' }).click();
  await page.waitForTimeout(400); await snap('page');
  expect((await layout(page, { touch: true })).hscroll).toBeLessThanOrEqual(0);
  void info;
});
