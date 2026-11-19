import { test, expect, type Page } from '@playwright/test';
import { MODES, SKINS, contrastIssues, expectCleanLayout, layout, shot, visit, watch } from './fixtures';

/** Theme and layout matrix for the redesigned Entertainment tabs: every skin x dark/light, phone viewport.
    Checks layout (overflow, tap targets, clipping, unstyled buttons) and WCAG contrast on Courses (Mine, Suggested, course page)
    and Channels (Mine mixed, Mine one channel, Suggested). Set SHOTS=1 to save screenshots. */
test.beforeEach(({ page: _p }, info) => { test.skip(info.project.name !== 'phone', 'phone only'); });

const CORS = { 'access-control-allow-origin': '*' };
const vid = (s: string, i: number) => (s.replace(/[^A-Za-z0-9]/g, '') + 'xxxxxxxxxxx').slice(-8) + String(i).padStart(3, '0');
async function mock(page: Page) {
  await page.route('**/courses.json', (r) => r.fulfill({ headers: CORS, json: { v: 1, at: 0, playlists: {} } }));
  await page.route('**/i.ytimg.com/**', (r) => r.fulfill({ status: 204 }));
  await page.route(/youtube-nocookie\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }));
  await page.route('https://api.invidious.io/**', (r) => r.fulfill({ headers: CORS, json: [['mirror.test', { api: true, cors: true, type: 'https', uri: 'https://mirror.test' }]] }));
  await page.route('https://yt.chocolatemoo53.com/**', (r) => r.abort());
  await page.route('https://mirror.test/**', (r) => {
    const u = new URL(r.request().url());
    if (u.pathname.endsWith('/resolveurl')) return r.fulfill({ headers: CORS, json: { ucid: 'UC' + (u.searchParams.get('url') ?? '').split('/').pop()!.replace(/\W/g, '') } });
    const pl = /playlists\/([^?]+)/.exec(u.pathname + u.search);
    if (pl) { const id = decodeURIComponent(pl[1]); return r.fulfill({ headers: CORS, json: { title: 'Mock ' + id, author: 'Mock', videoCount: 12, videos: /page=1/.test(u.search) || !/page=/.test(u.search) ? Array.from({ length: 12 }, (_, i) => ({ videoId: vid(id, i), title: `Lecture ${i + 1}: a longer title that has to wrap on a phone screen`, lengthSeconds: 3000 + i, index: i, author: 'Mock' })) : [] } }); }
    const ch = /channels\/([^/]+)\/(videos|playlists)/.exec(u.pathname);
    if (ch && ch[2] === 'playlists') return r.fulfill({ headers: CORS, json: { playlists: [{ playlistId: 'PL' + ch[1], title: 'Mock playlist', videoCount: 12 }] } });
    if (ch) return r.fulfill({ headers: CORS, json: { videos: [0, 1, 2].map((i) => ({ videoId: vid(ch[1], i), title: `Newest from ${ch[1]} number ${i}`, published: Math.floor(Date.now() / 1000) - 3600 * (i + 1), lengthSeconds: 900 + i, author: ch[1] })) } });
    return r.fulfill({ headers: CORS, json: {} });
  });
}
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).click();
const seg = (page: Page, n: string) => page.getByRole('tab', { name: new RegExp('^' + n) }).click();

for (const skin of SKINS) for (const mode of MODES) {
  test(`entertainment tabs · ${skin} · ${mode}`, async ({ page }, info) => {
    const w = watch(page); await mock(page);
    await page.addInitScript(() => { try { sessionStorage.setItem('ledger-ent-tab', 'courses'); } catch { /* */ } });
    await visit(page, '/entertainment', skin, mode);
    await expect(page.getByTestId('course-card').first()).toBeVisible();
    const check = async (label: string) => {
      await page.waitForTimeout(250);
      expectCleanLayout(await layout(page, { touch: true }), `${label} ${skin} ${mode}`);
      expect(await contrastIssues(page, '.main, .page'), `contrast ${label} ${skin} ${mode}`).toEqual([]);
      if (process.env.SHOTS) await shot(page, info, `ent-${label}-${skin}-${mode}`);
    };
    await check('courses-mine');
    await seg(page, 'Suggested'); await expect(page.getByTestId('course-card').first()).toBeVisible(); await check('courses-suggested');
    await seg(page, 'Mine');
    await page.getByTestId('course-card').first().locator('.cr-title-btn').click();
    await expect(page.getByTestId('lecture').first()).toBeVisible(); await check('course-page');
    await page.locator('.cr-back').click();
    await tab(page, 'Channels'); await expect(page.locator('.ch-vid').first()).toBeVisible({ timeout: 20000 }); await check('channels-mixed');
    await page.getByRole('tab', { name: /^One channel/ }).click(); await page.waitForTimeout(400); await check('channels-one');
    await seg(page, 'Suggested'); await page.waitForTimeout(300); await check('channels-suggested');
    expect(w.errors, 'console/page errors').toEqual([]);
  });
}
