import { expect, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';

export const ALL_SKINS = ['canopy', 'paper', 'grimoire', 'pop', 'arcade', 'sumi', 'bauhaus', 'riso', 'blueprint', 'swiss', 'collage', 'rings', 'cyberpunk'] as const;
export const ALL_MODES = ['dark', 'light'] as const;
const pick = <T extends string>(all: readonly T[], env?: string): T[] => (env ? all.filter((x) => env.split(',').includes(x)) : [...all]);
/** SKINS / MODES env vars narrow the matrix while iterating. */
export const SKINS = pick(ALL_SKINS, process.env.SKINS);
export const MODES = pick(ALL_MODES, process.env.MODES);

/** Messages that are noise in a sandbox without internet (web fonts, images from other sites, etc). */
const IGNORED = [/ERR_INTERNET_DISCONNECTED/, /ERR_NAME_NOT_RESOLVED/, /ERR_CONNECTION/, /ERR_NETWORK/, /Failed to load resource: net::/, /fonts\.(googleapis|gstatic)/, /i\.ytimg\.com/, /youtube/i, /hn\.algolia/, /api\.invidious/, /Download the React DevTools/, /React Router Future Flag/];

export interface Watch { errors: string[]; stop(): void }
/** Collect console errors and uncaught exceptions. Call before navigating. */
export function watch(page: Page): Watch {
  const errors: string[] = [];
  const onErr = (e: Error) => errors.push('pageerror: ' + e.message.slice(0, 300));
  const onMsg = (m: import('@playwright/test').ConsoleMessage) => { if (m.type() === 'error' && !IGNORED.some((r) => r.test(m.text()))) errors.push('console.error: ' + m.text().slice(0, 300)); };
  page.on('pageerror', onErr); page.on('console', onMsg);
  return { errors, stop() { page.off('pageerror', onErr); page.off('console', onMsg); } };
}

/** Open a route in a theme with the demo data. `extra` is appended to the query string (e.g. 'lv=9'). Waits for fonts and the first paint to settle. */
export async function visit(page: Page, route: string, skin: string, mode: string, extra = '') {
  const sep = route.includes('?') ? '&' : '?';
  await page.goto(`${route}${sep}skin=${skin}&mode=${mode}&demo=1${extra ? '&' + extra : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load').catch(() => {});
  await page.evaluate(() => (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready).catch(() => {});
  await page.waitForTimeout(500);
}

/** Save a screenshot under test-results/shots/<project>/ for visual review; returns the path. */
export async function shot(page: Page, info: TestInfo, name: string, fullPage = false) {
  const dir = path.join('test-results', 'shots', info.project.name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  return file;
}

export interface Layout { hscroll: number; offscreen: string[]; clipped: string[]; unstyledButtons: string[]; tinyTargets: string[]; emptyBox: string[]; tabbarGap: number | null }
/** Structural checks that catch most layout bugs. All measurements are taken in the page. */
export async function layout(page: Page, opts: { touch?: boolean } = {}): Promise<Layout> {
  return page.evaluate((touch) => {
    const vw = window.innerWidth;
    const out = { hscroll: document.documentElement.scrollWidth - vw, offscreen: [] as string[], clipped: [] as string[], unstyledButtons: [] as string[], tinyTargets: [] as string[], emptyBox: [] as string[], tabbarGap: null as number | null };
    const name = (el: Element) => el.tagName.toLowerCase() + (typeof (el as HTMLElement).className === 'string' && (el as HTMLElement).className ? '.' + (el as HTMLElement).className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ':' + ((el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20));
    const scroller = (el: Element) => { for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) { const o = getComputedStyle(e).overflowX; if ((o === 'auto' || o === 'scroll') && e.scrollWidth > e.clientWidth + 1) return true; } return false; };
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
      if (el.closest('[data-qa-ignore]') || el.closest('canvas')) continue;
      const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
      if ((r.right > vw + 1 || r.left < -1) && cs.position !== 'fixed' && !scroller(el) && !el.closest('.hero-tree')) out.offscreen.push(name(el) + ` [${Math.round(r.left)},${Math.round(r.right)}]`);
      const h = el as HTMLElement;
      if ((cs.overflowX === 'hidden' || cs.overflow === 'hidden') && h.scrollWidth > h.clientWidth + 3 && h.clientWidth > 40 && cs.textOverflow !== 'ellipsis' && !['SVG', 'IMG', 'CANVAS'].includes(el.tagName.toUpperCase()) && !el.closest('svg') && !el.closest('.hero') && !el.closest('.tp-mini') && !/hero/.test(typeof h.className === 'string' ? h.className : '')) out.clipped.push(name(el) + ` ${h.scrollWidth}>${h.clientWidth}`);
      if (el.tagName === 'BUTTON' && cs.backgroundColor === 'rgb(239, 239, 239)' && cs.borderTopStyle === 'outset') out.unstyledButtons.push(name(el));
      if (el.tagName === 'BUTTON' && cs.backgroundColor === 'rgb(239, 239, 239)' && cs.borderTopWidth === '2px') out.unstyledButtons.push(name(el));
      if (touch && ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && (r.height < 32 || r.width < 28) && !(el instanceof HTMLInputElement && ['checkbox', 'radio', 'hidden'].includes(el.type))) {
        // small visual controls are allowed when an invisible padded hit area covers them (see styles/touch.css)
        const before = getComputedStyle(el, '::before');
        if (!(before.content !== 'none' && before.position === 'absolute')) out.tinyTargets.push(name(el) + ` ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      if (['BUTTON', 'A'].includes(el.tagName) && !(el.textContent || '').trim() && !el.getAttribute('aria-label') && !el.querySelector('svg,img') && !el.getAttribute('title')) out.emptyBox.push('unlabelled ' + name(el));
    }
    const tb = document.querySelector('.tabbar'); const main = document.querySelector('.main');
    if (tb && main && getComputedStyle(tb).display !== 'none') {
      window.scrollTo(0, document.body.scrollHeight);
      const bottoms = [...main.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.getBoundingClientRect().bottom);
      out.tabbarGap = Math.round(tb.getBoundingClientRect().top - Math.max(...bottoms));
      window.scrollTo(0, 0);
    }
    return out;
  }, !!opts.touch);
}

/** Fail with a readable list when a layout check found problems. Tweak per page with `allow`. */
export function expectCleanLayout(l: Layout, label: string, allow: Partial<Record<keyof Layout, RegExp>> = {}) {
  const keep = (k: keyof Layout, arr: string[]) => (allow[k] ? arr.filter((s) => !allow[k]!.test(s)) : arr);
  const problems = [
    l.hscroll > 0 ? `horizontal scroll by ${l.hscroll}px` : '',
    ...keep('offscreen', l.offscreen).slice(0, 6).map((s) => 'off-screen: ' + s),
    ...keep('clipped', l.clipped).slice(0, 6).map((s) => 'clipped: ' + s),
    ...keep('unstyledButtons', l.unstyledButtons).slice(0, 6).map((s) => 'unstyled button: ' + s),
    ...keep('tinyTargets', l.tinyTargets).slice(0, 6).map((s) => 'tiny tap target: ' + s),
    ...keep('emptyBox', l.emptyBox).slice(0, 6),
    l.tabbarGap !== null && l.tabbarGap < 8 ? `content too close to the tab bar (${l.tabbarGap}px)` : '',
  ].filter(Boolean);
  expect(problems, `${label}\n  ` + problems.join('\n  ')).toEqual([]);
}

/** WCAG contrast violations from axe (the usual reason a theme looks wrong in one mode). Returns a short list. */
export async function contrastIssues(page: Page, include?: string): Promise<string[]> {
  let b = new AxeBuilder({ page }).withRules(['color-contrast']);
  if (include) b = b.include(include);
  const r = await b.analyze();
  return r.violations.flatMap((v) => v.nodes.slice(0, 8).map((n) => `${n.target.join(' ')} :: ${(n.any[0]?.message ?? '').slice(0, 110)}`));
}
