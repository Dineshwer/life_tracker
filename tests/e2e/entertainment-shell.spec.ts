import { test, expect, type Page } from '@playwright/test';
import { watch } from './fixtures';

const CORS = { 'access-control-allow-origin': '*' };
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
async function mock(page: Page) {
  await page.route(/i\.ytimg\.com|youtube-nocookie\.com/, (r) => r.fulfill({ headers: CORS, status: 200, contentType: r.request().url().includes('embed') ? 'text/html' : 'image/gif', body: r.request().url().includes('embed') ? '<html></html>' : GIF }));
  await page.route('https://www.youtube.com/oembed**', (r) => r.fulfill({ headers: CORS, json: { title: 'Oembed Title' } }));
  await page.route('https://api.invidious.io/**', (r) => r.abort());
  await page.route('**/courses.json', (r) => r.fulfill({ headers: CORS, json: {} }));
}
const open = async (page: Page) => { await mock(page); await page.goto('/entertainment?skin=canopy&mode=dark', { waitUntil: 'load' }); };
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });

test.describe('Entertainment shell', () => {
  test('opens on Courses with the four tabs and the kicker', async ({ page }) => {
    const w = watch(page); await open(page);
    await expect(page.getByRole('tablist', { name: 'Entertainment' }).getByRole('tab')).toHaveText(['HackerTube', 'Courses', 'Channels', 'Saved']);
    await expect(tab(page, 'Courses')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.page-head .label')).toHaveText(/^\d+ saved · \d+ watched this week$/);
    w.stop(); expect(w.errors).toEqual([]);
  });

  test('tab switching by click and keyboard', async ({ page }) => {
    await open(page);
    await tab(page, 'Saved').click();
    await expect(tab(page, 'Saved')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('YouTube link')).toBeVisible();
    await tab(page, 'Saved').press('ArrowRight'); // wraps to HackerTube
    await expect(tab(page, 'HackerTube')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'HackerTube')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'Courses')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(tab(page, 'Saved')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(tab(page, 'Channels')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(tab(page, 'HackerTube')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toBeVisible();
  });

  test('tab is remembered for the session on reload', async ({ page }) => {
    await open(page); await tab(page, 'Saved').click();
    await page.reload({ waitUntil: 'load' });
    await expect(tab(page, 'Saved')).toHaveAttribute('aria-selected', 'true');
  });

  test('HackerTube shows real thumbnails and plays in the shared player', async ({ page }) => {
    await open(page); await tab(page, 'HackerTube').click();
    const cards = page.locator('.en-card'); await expect(cards.first()).toBeVisible();
    const imgs = cards.locator('.en-thumb img');
    expect(await imgs.count()).toBe(await cards.count());
    for (const i of [0, 1, 2]) await expect(imgs.nth(i)).toHaveAttribute('src', /^https:\/\/i\.ytimg\.com\/vi\/[\w-]{11}\/mqdefault\.jpg$/);
    await cards.first().getByRole('button', { name: 'Watch' }).click();
    await expect(page.locator('.en-player iframe')).toHaveAttribute('src', /youtube-nocookie\.com\/embed\//);
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('.en-player')).toHaveCount(0);
  });

  test('Saved: add, play, mark watched, undo', async ({ page }) => {
    await open(page); await tab(page, 'Saved').click();
    await expect(page.getByText('Your queue is empty')).toBeVisible();
    await page.getByLabel('YouTube link').fill('https://youtu.be/dQw4w9WgXcQ');
    await page.getByRole('button', { name: 'Add to queue' }).click();
    await expect(page.locator('.en-list .en-title')).toHaveText('Oembed Title');
    await expect(page.locator('.en-list .en-thumb img')).toHaveAttribute('src', /dQw4w9WgXcQ/);
    await expect(page.locator('.page-head .label')).toHaveText(/^1 saved/);
    await page.getByRole('button', { name: 'Play Oembed Title' }).click();
    await expect(page.locator('.en-player iframe')).toHaveAttribute('src', /embed\/dQw4w9WgXcQ/);
    await page.getByRole('button', { name: 'Mark watched' }).click();
    await expect(page.locator('.en-player')).toHaveCount(0);
    await expect(page.locator('.en-item.is-done')).toHaveCount(1);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('.en-item.is-done')).toHaveCount(0);
  });

  for (const w of [393, 360]) test(`no horizontal overflow at ${w}px on every tab (page and main boxes, not just scrollWidth)`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 852 });
    await open(page);
    for (const n of ['HackerTube', 'Courses', 'Channels', 'Saved']) {
      await tab(page, n).click(); await page.waitForTimeout(400);
      const o = await page.evaluate(() => {
        const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
        return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, page: r('.page').right, main: r('.main').right, panel: r('.en-panel').right, vw: window.innerWidth };
      });
      expect(o.sw, n).toBeLessThanOrEqual(o.cw);
      for (const k of ['page', 'main', 'panel'] as const) expect(o[k], `${n} ${k}`).toBeLessThanOrEqual(o.vw + 0.5);
      const box = await tab(page, n).boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });
});
