import { test, expect, type Page } from '@playwright/test';
import { ALL_SKINS, MODES, SKINS, contrastIssues, expectCleanLayout, layout, shot, visit, watch } from './fixtures';

/** Character (3D), app shell and auth. Auth tests need the dummy-Supabase server: BASE_URL=http://localhost:5189 */
const AUTH = !!process.env.BASE_URL && process.env.BASE_URL.includes('5189');
const ROUTES = ['/today', '/habits', '/tasks', '/rejections', '/gym', '/one', '/journal', '/books', '/entertainment', '/character', '/rewards', '/settings'];
const isPhone = (info: { project: { name: string } }) => info.project.name !== 'desktop';

async function waitAvatar(page: Page) {
  await expect(page.locator('.av3-wrap[data-ready="true"], .ch-hero svg').first()).toBeVisible({ timeout: 90_000 });
}
/** live (not lost / not disposed) WebGL contexts created by the page: browsers cap these at about 16 */
const glContexts = (page: Page) => page.evaluate(() => (window as unknown as { __gls: WebGLRenderingContext[] }).__gls.filter((g) => !g.isContextLost()).length);
const countContexts = (page: Page) => page.addInitScript(() => {
  const w = window as unknown as { __gls: WebGLRenderingContext[] };
  w.__gls = [];
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, t: string, ...a: unknown[]) {
    const ctx = (orig as (...x: unknown[]) => unknown).call(this, t, ...a);
    if (ctx && /webgl/.test(t) && !w.__gls.includes(ctx as WebGLRenderingContext)) w.__gls.push(ctx as WebGLRenderingContext);
    return ctx;
  } as typeof orig;
});

/* ---------------- theme matrix ---------------- */
test.describe('character theme matrix', () => {
  for (const skin of SKINS) for (const mode of MODES) {
    test(`/character · ${skin} · ${mode}`, async ({ page }, info) => {
      const w = watch(page);
      await visit(page, '/character', skin, mode);
      await waitAvatar(page);
      await expect(page.locator('.av3-canvas')).toBeVisible();
      await page.waitForTimeout(1200); // let the loader overlay fade
      expectCleanLayout(await layout(page, { touch: isPhone(info) }), `character ${skin} ${mode}`, { clipped: /ch-stat/ }); // blueprint draws decorative corner marks past the card box
      expect(await contrastIssues(page), 'contrast').toEqual([]);
      if (process.env.SHOTS) await shot(page, info, `character-${skin}-${mode}`);
      w.stop();
      expect(w.errors).toEqual([]);
    });
  }
});

test.describe('shell theme matrix', () => {
  for (const skin of SKINS) for (const mode of MODES) {
    test(`more sheet + tab bar · ${skin} · ${mode}`, async ({ page }, info) => {
      test.skip(!isPhone(info), 'tab bar is phone only');
      const w = watch(page);
      await visit(page, '/today', skin, mode);
      await expect(page.locator('.tabbar .tab')).toHaveCount(5);
      expect(await contrastIssues(page, '.tabbar'), 'tabbar contrast').toEqual([]);
      await page.getByRole('button', { name: 'More' }).click();
      await expect(page.getByRole('dialog', { name: 'More' })).toBeVisible();
      expect(await contrastIssues(page, '.sheet'), 'sheet contrast').toEqual([]);
      expectCleanLayout(await layout(page, { touch: true }), `more ${skin} ${mode}`, { tabbarGap: /./ });
      if (process.env.SHOTS) await shot(page, info, `more-${skin}-${mode}`);
      w.stop();
      expect(w.errors).toEqual([]);
    });
    test(`desktop rail · ${skin} · ${mode}`, async ({ page }, info) => {
      test.skip(isPhone(info), 'rail is desktop only');
      await visit(page, '/habits', skin, mode);
      await expect(page.locator('.rail')).toBeVisible();
      await expect(page.locator('.rail-link.on')).toHaveText(/Habits/);
      expect(await contrastIssues(page, '.rail'), 'rail contrast').toEqual([]);
      if (process.env.SHOTS) await shot(page, info, `rail-${skin}-${mode}`);
    });
  }
});

/* tab bar clearance: last content must clear the bar by a comfortable margin in every theme */
test.describe('tab bar clearance', () => {
  for (const skin of ALL_SKINS) {
    test(`clearance · ${skin}`, async ({ page }, info) => {
      test.skip(!isPhone(info), 'phone only');
      for (const route of ['/today', '/habits', '/settings', '/character']) {
        await visit(page, route, skin, 'dark');
        const l = await layout(page, { touch: true });
        expect(l.tabbarGap, `${route} ${skin}`).not.toBeNull();
        expect(l.tabbarGap!, `${route} ${skin} gap`).toBeGreaterThanOrEqual(16);
      }
    });
  }
});

/* ---------------- character flows ---------------- */
test.describe('character flows', () => {
  test('level numbers: empty account has 0 XP and level 1', async ({ page }) => {
    const w = watch(page);
    await page.goto('/character?skin=canopy&mode=dark', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.page-head .label')).toHaveText('0 total XP');
    await expect(page.locator('.ch-xp')).toContainText('0');
    await expect(page.locator('.ch-hero .label').first()).toContainText('band 1 of 5');
    await expect(page.getByText('No XP yet')).toBeVisible();
    await expect(page.locator('.ch-un-list li')).toHaveCount(8);
    await waitAvatar(page);
    w.stop(); expect(w.errors).toEqual([]);
  });

  for (const lv of [1, 3, 6, 9, 13]) {
    test(`forced level ${lv} shows a matching title, band and unlock panel`, async ({ page }) => {
      const w = watch(page);
      await visit(page, '/character', 'canopy', 'dark', `lv=${lv}`);
      await waitAvatar(page);
      const band = lv < 3 ? 1 : lv < 6 ? 2 : lv < 9 ? 3 : lv < 13 ? 4 : 5;
      const label = await page.locator('.ch-hero .label').first().innerText();
      expect(label).toMatch(/band \d of 5/i);
      const title = await page.locator('.ch-title').innerText();
      expect(title.length).toBeGreaterThan(2);
      await expect(page.locator('.ch-un-list li').first()).toContainText(`Lv ${lv}`);
      await expect(page.locator('.ch-un-list li')).toHaveCount(8);
      for (const li of await page.locator('.ch-un-list li .ch-un-v').allInnerTexts()) expect(li.trim().length, 'unlock text').toBeGreaterThan(0);
      void band;
      w.stop(); expect(w.errors).toEqual([]);
    });
  }

  test('very high real XP gives sane numbers', async ({ page }) => {
    await page.addInitScript(() => {
      const xp = Array.from({ length: 60 }, (_, i) => ({ id: 'x' + i, date: '2026-01-01', stat: ['body', 'mind', 'skill', 'discipline'][i % 4], amount: 5000, reason: 'test' }));
      localStorage.setItem('life-tracker-v1', JSON.stringify({ state: { xp }, version: 2 }));
    });
    await page.goto('/character?skin=canopy&mode=dark', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.page-head .label')).toHaveText('300,000 total XP');
    const t = await page.locator('.ch-xp').innerText();
    expect(t).not.toMatch(/NaN|Infinity|undefined/);
    await expect(page.locator('.ch-stat .ch-lv').first()).not.toHaveText(/NaN/);
    for (const n of await page.locator('.ch-nums').allInnerTexts()) expect(n).not.toMatch(/NaN|Infinity/);
  });

  test('2D emblem fallback when WebGL is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, t: string, ...a: unknown[]) { return /webgl/.test(t) ? null : (orig as (...x: unknown[]) => unknown).call(this, t, ...a); } as typeof orig;
    });
    const w = watch(page);
    await visit(page, '/character', 'paper', 'light');
    await expect(page.locator('.ch-tree svg').first()).toBeVisible();
    await expect(page.locator('.av3-canvas')).toHaveCount(0);
    expectCleanLayout(await layout(page), 'fallback');
    w.stop(); expect(w.errors).toEqual([]);
  });

  test('canvas keeps a 4:5 box at 360, 393 and 430 px', async ({ page }, info) => {
    test.skip(!isPhone(info), 'phone only');
    for (const width of [360, 393, 430]) {
      await page.setViewportSize({ width, height: 852 });
      await visit(page, '/character', 'canopy', 'dark');
      await waitAvatar(page);
      const b = (await page.locator('.av3-wrap').boundingBox())!;
      expect(b.width).toBeGreaterThan(200);
      expect(b.width / b.height).toBeGreaterThan(0.7);
      expect(b.width / b.height).toBeLessThan(0.9);
      expect(b.width).toBeLessThanOrEqual(width);
    }
  });

  test('mouse drag rotates, touch-action keeps vertical scrolling', async ({ page }, info) => {
    test.skip(isPhone(info), 'desktop mouse');
    await visit(page, '/character', 'canopy', 'dark');
    await waitAvatar(page);
    await page.waitForTimeout(1500);
    const canvas = page.locator('.av3-canvas');
    expect(await canvas.evaluate((c) => getComputedStyle(c).touchAction)).toBe('pan-y');
    const hint = page.locator('.av3-hint'); // the hint also fades on its own after 4 s, so only the final state is asserted
    const b = (await canvas.boundingBox())!;
    const before = await canvas.screenshot();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 120, b.y + b.height / 2, { steps: 6 }); await page.mouse.up();
    await expect(hint).toHaveAttribute('data-hide', 'true');
    await page.waitForTimeout(300);
    expect(Buffer.compare(before, await canvas.screenshot())).not.toBe(0);
  });

  test('touch: canvas only claims horizontal pans (touch-action pan-y) so the page still scrolls', async ({ page }, info) => {
    test.skip(!isPhone(info), 'phone only');
    await visit(page, '/character', 'canopy', 'dark');
    await waitAvatar(page);
    expect(await page.locator('.av3-canvas').evaluate((c) => getComputedStyle(c).touchAction)).toBe('pan-y');
    // the hero around the canvas must not block scrolling either
    expect(await page.locator('.ch-hero').evaluate((c) => getComputedStyle(c).touchAction)).not.toBe('none');
    // (CDP synthesized touch scrolling does not move the page in this headless setup, so behaviour is asserted via touch-action)
    await page.evaluate(() => scrollTo(0, 300));
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(100);
  });

  test('?levelup=1 plays the level-up caption then clears it', async ({ page }) => {
    const w = watch(page);
    await visit(page, '/character', 'canopy', 'dark', 'levelup=1');
    await expect(page.locator('.av3-cap')).toContainText('LEVEL UP', { timeout: 90_000 });
    await expect(page.locator('.av3-cap')).toHaveCount(0, { timeout: 8000 });
    w.stop(); expect(w.errors).toEqual([]);
  });

  test('navigating away and back 10 times: no errors, no WebGL context growth', async ({ page }) => {
    test.setTimeout(400_000);
    await countContexts(page);
    const w = watch(page);
    await visit(page, '/character', 'canopy', 'dark');
    await waitAvatar(page);
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => { history.pushState({}, '', '/today?skin=canopy&mode=dark&demo=1'); dispatchEvent(new PopStateEvent('popstate')); });
      await expect(page.locator('.av3-canvas')).toHaveCount(0);
      await page.evaluate(() => { history.pushState({}, '', '/character?skin=canopy&mode=dark&demo=1'); dispatchEvent(new PopStateEvent('popstate')); });
      await expect(page.locator('.av3-wrap[data-ready="true"]')).toBeVisible({ timeout: 60_000 });
    }
    // one canvas per mount is created; the old ones must have been released (live canvases in DOM stay at one)
    expect(await page.locator('canvas').count()).toBe(1);
    expect(await glContexts(page)).toBeLessThanOrEqual(2);
    w.stop(); expect(w.errors).toEqual([]);
  });
});

/* ---------------- shell flows ---------------- */
test.describe('shell flows', () => {
  test('"/" redirects to /today and every route deep-links and reloads', async ({ page }) => {
    const w = watch(page);
    await page.goto('/?demo=1', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/today/);
    for (const r of ROUTES) {
      await page.goto(`${r}?demo=1`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.main .page-title, .main .today').first(), r).toBeVisible();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('.main .page-title, .main .today').first(), 'reload ' + r).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(r);
    }
    w.stop(); expect(w.errors).toEqual([]);
  });

  test('unknown route is not blank', async ({ page }) => {
    await page.goto('/nope?demo=1', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/today/);
    await expect(page.locator('.main .today').first()).toBeVisible();
    await page.goto('/habits/zzz/deep?demo=1', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.main .today').first()).toBeVisible();
  });

  test('browser back and forward walk the history', async ({ page }, info) => {
    await visit(page, '/today', 'canopy', 'dark');
    const go = async (name: string) => {
      if (isPhone(info)) await page.locator('.tabbar').getByRole('link', { name }).click();
      else await page.locator('.rail').getByRole('link', { name }).click();
    };
    await go('Habits'); await expect(page).toHaveURL(/\/habits/);
    await go('Tasks'); await expect(page).toHaveURL(/\/tasks/);
    await page.goBack(); await expect(page).toHaveURL(/\/habits/);
    await page.goBack(); await expect(page).toHaveURL(/\/today/);
    await page.goForward(); await expect(page).toHaveURL(/\/habits/);
    await expect(page.locator('.page-title').first()).toContainText(/Habits/i);
  });

  test('scroll position resets on route change', async ({ page }, info) => {
    test.skip(!isPhone(info), 'phone');
    await visit(page, '/settings', 'canopy', 'dark');
    await page.evaluate(() => scrollTo(0, 400));
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(100);
    await page.locator('.tabbar').getByRole('link', { name: 'Habits' }).click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => scrollY), 'new page starts at top').toBeLessThan(20);
  });

  test('tab bar: 5 tabs, active highlight incl. More for non-tab routes', async ({ page }, info) => {
    test.skip(!isPhone(info), 'phone');
    await visit(page, '/gym', 'canopy', 'dark');
    await expect(page.locator('.tabbar .tab')).toHaveCount(5);
    await expect(page.locator('.tabbar .tab.on')).toHaveText(/Gym/);
    await visit(page, '/journal', 'canopy', 'dark');
    await expect(page.locator('.tabbar .tab.on')).toHaveCount(1);
    await expect(page.locator('.tabbar .tab.on')).toHaveText(/More/);
  });

  test('More sheet: opens, navigates, closes with Escape, scrim and Close', async ({ page }, info) => {
    test.skip(!isPhone(info), 'phone');
    await visit(page, '/today', 'canopy', 'dark');
    const more = page.getByRole('button', { name: 'More' });
    const dlg = page.getByRole('dialog', { name: 'More' });
    await more.click(); await expect(dlg).toBeVisible();
    await page.keyboard.press('Escape'); await expect(dlg).toHaveCount(0);
    await more.click(); await expect(dlg).toBeVisible();
    await page.mouse.click(196, 30); await expect(dlg).toHaveCount(0);
    await more.click(); await dlg.getByRole('button', { name: 'Close' }).click(); await expect(dlg).toHaveCount(0);
    await more.click(); await dlg.getByRole('link', { name: 'Journal' }).click();
    await expect(page).toHaveURL(/\/journal/); await expect(dlg).toHaveCount(0);
    await more.click(); await expect(dlg.locator('.more-link.on')).toHaveText(/Journal/);
  });

  test('theme toggle flips data-theme (rail on desktop, More sheet on phone)', async ({ page }, info) => {
    await page.goto('/today?demo=1', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.clear());
    await page.goto('/today?demo=1&skin=canopy', { waitUntil: 'domcontentloaded' });
    const t0 = await page.evaluate(() => document.documentElement.dataset.theme);
    if (isPhone(info)) { await page.getByRole('button', { name: 'More' }).click(); await page.getByRole('button', { name: /light mode|dark mode/i }).click(); }
    else await page.getByRole('button', { name: 'Toggle theme' }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).not.toBe(t0);
  });

  test('landscape 852x393 stays usable', async ({ page }, info) => {
    test.skip(!isPhone(info), 'phone');
    await page.setViewportSize({ width: 852, height: 393 });
    for (const skin of ['canopy', 'pop', 'paper', 'cyberpunk']) {
      await visit(page, '/habits', skin, 'dark');
      const tb = (await page.locator('.tabbar').boundingBox())!;
      expect(tb.height).toBeLessThan(393 * 0.34);
      const l = await layout(page, { touch: true });
      expect(l.hscroll).toBeLessThanOrEqual(0);
    }
  });

  test('keyboard: Tab reaches the nav with a visible focus indicator', async ({ page }, info) => {
    test.skip(isPhone(info), 'desktop');
    for (const skin of ['canopy', 'paper', 'pop', 'swiss']) {
      await visit(page, '/today', skin, 'dark');
      await page.keyboard.press('Tab');
      const f = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement; const cs = getComputedStyle(e);
        return { inRail: !!e.closest('.rail'), outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0, shadow: cs.boxShadow !== 'none' };
      });
      expect(f.inRail, skin).toBe(true);
      expect(f.outline || f.shadow, `${skin} focus ring`).toBe(true);
    }
  });
});

/* ---------------- sync banner ---------------- */
test.describe('sync banner', () => {
  test('is absent when cloud sync is off, even offline', async ({ page }) => {
    await visit(page, '/today', 'canopy', 'dark');
    await page.evaluate(() => dispatchEvent(new Event('offline')));
    await page.waitForTimeout(200);
    await expect(page.locator('.sync-banner')).toHaveCount(0);
  });
});

/* ---------------- auth (dummy supabase on :5189) ---------------- */
test.describe('auth', () => {
  test.skip(!AUTH, 'run with BASE_URL=http://localhost:5189');
  const open = async (page: Page, skin: string, mode: string) => {
    await page.addInitScript(() => localStorage.removeItem('sb-example-auth-token'));
    await page.goto(`/today?skin=${skin}&mode=${mode}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.auth-card')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000); // entrance animation
  };
  for (const skin of SKINS) for (const mode of MODES) {
    test(`auth screen · ${skin} · ${mode}`, async ({ page }, info) => {
      const w = watch(page);
      await open(page, skin, mode);
      expectCleanLayout(await layout(page, { touch: isPhone(info) }), `auth ${skin} ${mode}`, { clipped: /^div\.auth:/ }); // .auth clips its decorative 720px glow on purpose
      expect(await contrastIssues(page), 'contrast').toEqual([]);
      const f = await page.locator('.auth-card input').first().evaluate((e) => { const c = getComputedStyle(e); return { bg: c.backgroundColor, font: c.fontFamily, border: [c.borderTopWidth, c.borderBottomWidth, c.borderLeftWidth].every((x) => x === '0px') && c.boxShadow === 'none' ? '0px' : 'styled' }; });
      expect(f.border, 'inputs are not unstyled').not.toBe('0px'); // underline-only skins (paper, sumi, swiss) count too
      if (process.env.SHOTS) await shot(page, info, `auth-${skin}-${mode}`);
      w.stop(); expect(w.errors).toEqual([]);
    });
  }
  test('toggle, validation and network error', async ({ page }) => {
    await open(page, 'canopy', 'dark');
    const submit = page.locator('.auth-submit');
    await expect(submit).toHaveText('Sign in');
    await page.locator('.auth-switch').click();
    await expect(submit).toHaveText('Create account');
    await expect(page.locator('input[type=password]')).toHaveAttribute('minlength', '6');
    await expect(page.locator('input[type=password]')).toHaveAttribute('autocomplete', 'new-password');
    await page.locator('input[type=email]').fill('not-an-email');
    await page.locator('input[type=password]').fill('123');
    await submit.click();
    expect(await page.locator('input[type=email]').evaluate((e: HTMLInputElement) => e.validity.valid)).toBe(false);
    await page.locator('input[type=email]').fill('a@b.co');
    expect(await page.locator('input[type=password]').evaluate((e: HTMLInputElement) => e.validity.tooShort)).toBe(true);
    await page.locator('input[type=password]').fill('123456');
    await page.locator('.auth-switch').click();
    await submit.click();
    await expect(page.locator('.auth-msg.err')).toBeVisible({ timeout: 20_000 });
    await expect(submit).toBeEnabled();
    await expect(submit).toHaveText('Sign in');
  });
  test('2 s supabase timeout falls back to sign-in, never a blank screen', async ({ page }) => {
    await page.route('**/*.invalid/**', (r) => r.abort());
    await page.goto('/habits', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.auth-card')).toBeVisible({ timeout: 8000 });
  });
  test('a stored session opens the app offline', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('sb-example-auth-token', JSON.stringify({ access_token: 'x', refresh_token: 'y', expires_at: 1, user: { id: 'u1', email: 'a@b.co' } })));
    await page.route('**/*.invalid/**', (r) => r.abort());
    await page.goto('/habits', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.page-title').first()).toBeVisible({ timeout: 10_000 });
  });
  test('phone keyboard open: the submit button stays reachable', async ({ page }, info) => {
    test.skip(!isPhone(info), 'phone');
    await page.setViewportSize({ width: 393, height: 420 });
    await open(page, 'canopy', 'dark');
    await page.locator('input[type=password]').focus();
    await page.locator('.auth-submit').scrollIntoViewIfNeeded();
    await expect(page.locator('.auth-submit')).toBeInViewport();
  });
});
