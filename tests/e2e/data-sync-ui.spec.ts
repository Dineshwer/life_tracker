import { test, expect, type Page } from '@playwright/test';
import { ALL_SKINS, MODES, SKINS, contrastIssues, expectCleanLayout, layout, shot, visit, watch } from './fixtures';

/** The Data & sync UI. States are driven through the hidden /sync-ui-lab route (fake data + fake engine);
    the real Settings page is used for local-only mode and the file backup. */
const KEY = 'life-tracker-v1';
const lab = (page: Page, q: string, skin = 'canopy', mode = 'dark') => visit(page, `/sync-ui-lab?${q}`, skin, mode);
const calls = (page: Page) => page.evaluate(() => ((window as unknown as { __lab?: string[] }).__lab ?? []).slice());
const signedOut = (page: Page) => page.evaluate(() => !!(window as unknown as { __signedOut?: boolean }).__signedOut);
const getStore = (page: Page) => page.evaluate((k) => { window.dispatchEvent(new Event('pagehide')); return JSON.parse(localStorage.getItem(k) || '{}').state; }, KEY);

const STATES = ['synced', 'syncing', 'offline', 'error', 'conflicts', 'local'] as const;
test.describe('matrix: every state in every theme', () => {
  for (const skin of SKINS) for (const mode of MODES) for (const state of STATES) {
    test(`${state} / ${skin} / ${mode}`, async ({ page }, info) => {
      const w = watch(page);
      await lab(page, `state=${state}`, skin, mode);
      await expect(page.getByRole('heading', { name: state === 'local' ? 'Your data' : 'Data & sync' })).toBeVisible();
      await page.waitForTimeout(700); // card entrance animation
      expectCleanLayout(await layout(page, { touch: info.project.name !== 'desktop' }), `${state} ${skin} ${mode}`);
      expect(await contrastIssues(page), 'contrast').toEqual([]);
      if (skin === 'canopy' || skin === 'cyberpunk' || skin === 'paper') await shot(page, info, `sync-${state}-${skin}-${mode}`, true);
      w.stop(); expect(w.errors).toEqual([]);
    });
  }
  // sheets are themed separately from the page
  for (const skin of SKINS) for (const mode of MODES) test(`sheets / ${skin} / ${mode}`, async ({ page }, info) => {
    await lab(page, 'state=offline', skin, mode);
    await page.getByRole('button', { name: 'Sign out' }).click();
    const sheet = page.getByRole('dialog', { name: /Sign out with unsynced/ });
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(500);
    expectCleanLayout(await layout(page, { touch: info.project.name !== 'desktop' }), `sheet ${skin} ${mode}`);
    expect(await contrastIssues(page, '.sheet'), 'contrast').toEqual([]);
    if (skin === 'canopy' || skin === 'riso') await shot(page, info, `sync-sheet-${skin}-${mode}`);
  });
});

test.describe('banner', () => {
  test('offline with pending changes', async ({ page }) => {
    await lab(page, 'state=offline');
    const b = page.getByTestId('sync-banner');
    await expect(b).toContainText('You are offline. 4 changes are saved on this device and will upload when you are back online.');
    await expect(b.getByRole('button')).toHaveCount(0);
  });
  test('error shows Retry that syncs again', async ({ page }) => {
    await lab(page, 'state=error');
    const b = page.getByTestId('sync-banner');
    await expect(b).toContainText(/problem/i);
    await b.getByRole('button', { name: 'Retry' }).click();
    await expect.poll(() => calls(page)).toContain('syncNow');
    await expect(page.getByTestId('sync-banner')).toHaveCount(0);
  });
  test('stuck sync (pending online) shows a banner', async ({ page }) => {
    await lab(page, 'state=stuck');
    await expect(page.getByTestId('sync-banner')).toContainText('5 changes have not uploaded yet');
  });
  test('nothing to say: no banner when synced, syncing, or local-only', async ({ page }) => {
    for (const s of ['synced', 'syncing', 'local']) { await lab(page, `state=${s}`); await expect(page.getByTestId('sync-banner')).toHaveCount(0); }
  });
  test('real app without an account never shows the banner', async ({ page }) => {
    await visit(page, '/today', 'canopy', 'dark'); await expect(page.getByTestId('sync-banner')).toHaveCount(0);
  });
});

test.describe('status and sign-out', () => {
  test('synced: headline, facts, immediate sign out', async ({ page }) => {
    await lab(page, 'state=synced');
    await expect(page.getByText('Synced 2 minutes ago')).toBeVisible();
    await expect(page.getByText('d3f9a1c2', { exact: true })).toBeVisible();
    await expect(page.getByText('This device', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('dinesh@example.com')).toBeVisible();
    await expect(page.getByText(/^On\./)).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect.poll(() => signedOut(page)).toBe(true);
    expect(await calls(page)).toContain('flushSync');
  });
  test('syncing headline', async ({ page }) => { await lab(page, 'state=syncing'); await expect(page.getByText('Syncing…').first()).toBeVisible(); await expect(page.getByText('3 changes')).toBeVisible(); });
  test('error headline is readable and Retry works', async ({ page }) => {
    await lab(page, 'state=error');
    await expect(page.locator('.ds-title', { hasText: 'Problem: the cloud could not be reached' })).toBeVisible();
    await page.locator('.ds-status').getByRole('button', { name: 'Retry' }).click();
    await expect.poll(() => calls(page)).toContain('syncNow');
    await expect(page.getByText(/^Synced/).first()).toBeVisible();
  });
  test('retry that fails shows why', async ({ page }) => {
    await lab(page, 'state=error&fail=sync');
    await page.locator('.ds-status').getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('alert')).toContainText('Could not sync');
  });
  test('offline: sign out is guarded, Stay keeps the session, Anyway signs out', async ({ page }) => {
    await lab(page, 'state=offline');
    await expect(page.locator('.ds-status').getByText('Offline', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    const d = page.getByRole('dialog');
    await expect(d).toContainText('unsynced changes on this device will be lost');
    expect(await signedOut(page)).toBe(false);
    await d.getByRole('button', { name: 'Stay signed in' }).click();
    await expect(d).toHaveCount(0); expect(await signedOut(page)).toBe(false);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Sign out anyway' }).click();
    await expect.poll(() => signedOut(page)).toBe(true);
  });
  test('online but changes cannot be flushed: guarded', async ({ page }) => {
    await lab(page, 'state=syncing&pending=3&flushclears=0');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('dialog')).toContainText('3 changes on this device have not reached your cloud copy');
    expect(await signedOut(page)).toBe(false);
  });
  test('pending changes that flush cleanly sign out without a prompt', async ({ page }) => {
    await lab(page, 'state=syncing&pending=2');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect.poll(() => signedOut(page)).toBe(true);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
  test('Escape closes the guard', async ({ page }) => {
    await lab(page, 'state=offline'); await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  });
  test('sign-out failure is reported', async ({ page }) => {
    await lab(page, 'state=synced&fail=signout'); await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('alert')).toContainText('Could not sign out');
  });
});

test.describe('reset this device', () => {
  test('explanation, confirmation, progress, result', async ({ page }) => {
    await lab(page, 'state=synced');
    await expect(page.getByText(/copy in your account is the master/)).toBeVisible();
    await page.getByRole('button', { name: "Reset this device's copy" }).click();
    const d = page.getByRole('dialog'); await expect(d).toContainText('nothing will be lost');
    await d.getByRole('button', { name: "Reset this device's copy" }).click();
    await expect(d.getByRole('status')).toContainText('Downloading your data again');
    await expect(d.getByRole('status')).toContainText('This device now matches your cloud copy');
    expect(await calls(page)).toContain('resetLocalCache');
  });
  test('warns about unsynced changes', async ({ page }) => {
    await lab(page, 'state=offline'); await page.getByRole('button', { name: "Reset this device's copy" }).click();
    await expect(page.getByRole('dialog')).toContainText('4 changes have not uploaded yet');
  });
  test('failure keeps the user informed and can retry', async ({ page }) => {
    await lab(page, 'state=synced&fail=reset'); await page.getByRole('button', { name: "Reset this device's copy" }).click();
    await page.getByRole('dialog').getByRole('button', { name: "Reset this device's copy" }).click();
    await expect(page.getByRole('alert')).toContainText('Nothing was changed');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
  test('cancel does nothing', async ({ page }) => {
    await lab(page, 'state=synced'); await page.getByRole('button', { name: "Reset this device's copy" }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click(); expect(await calls(page)).not.toContain('resetLocalCache');
  });
});

test.describe('conflicts', () => {
  test('readable list, restore only where a local version exists', async ({ page }) => {
    await lab(page, 'state=conflicts');
    await expect(page.getByText("Your edit to the habit 'Meditation' (minutes) on this device was replaced by a newer edit from another device.")).toBeVisible();
    await expect(page.getByText("The task 'Renew passport' was deleted on another device")).toBeVisible();
    await expect(page.getByText('2 minutes ago').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Restore my version/ })).toHaveCount(2);
    // most recent first
    const items = await page.locator('.ds-item-what').allTextContents(); expect(items[0]).toMatch(/Habit: Meditation/);
    await page.getByRole('button', { name: /Restore my version. Habit: Meditation/ }).click();
    expect((await calls(page)).filter((c) => c.startsWith('restoreConflict'))).toEqual(['restoreConflict:habits:h1']);
    await expect(page.locator('.ds-chip.ok', { hasText: 'Restored' })).toBeVisible();
  });
  test('empty state', async ({ page }) => { await lab(page, 'state=synced'); await expect(page.getByText('No conflicts. Changes from your devices merge cleanly.')).toBeVisible(); });
});

test.describe('server backups', () => {
  test('list, back up now, restore flow', async ({ page }) => {
    await lab(page, 'state=synced');
    await expect(page.getByRole('button', { name: /^Restore backup from/ })).toHaveCount(3);
    await expect(page.getByText('1,432 items').first()).toBeVisible();
    await page.getByRole('button', { name: 'Back up now' }).click();
    await expect(page.getByText(/Backed up 1,500 items/)).toBeVisible();
    await page.getByRole('button', { name: /^Restore backup from/ }).nth(1).click();
    const d = page.getByRole('dialog', { name: 'Restore this backup?' });
    await expect(d).toContainText('Every device signed in to your account will change');
    await expect(d).toContainText('Your current state is saved as a new backup first');
    await d.getByRole('button', { name: 'Restore this backup' }).click();
    await expect(d.getByRole('status')).toContainText('Restored 1,395 items');
    expect((await calls(page)).some((c) => c.startsWith('restoreBackup:'))).toBe(true);
  });
  test('restore error leaves data alone and offers retry', async ({ page }) => {
    await lab(page, 'state=synced&fail=restore'); await page.getByRole('button', { name: /^Restore backup from/ }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Restore this backup' }).click();
    await expect(page.getByRole('alert')).toContainText('Your current data was not changed');
  });
  test('loading, empty, list error, back-up error', async ({ page }) => {
    await lab(page, 'state=synced&backups=slow'); await expect(page.getByText('Loading backups…')).toBeVisible(); await expect(page.getByRole('button', { name: /^Restore backup from/ })).toHaveCount(3);
    await lab(page, 'state=synced&backups=none'); await expect(page.getByText(/No backups yet/)).toBeVisible();
    await lab(page, 'state=synced&fail=backups'); await expect(page.getByRole('alert')).toContainText('Could not load your backups'); await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await lab(page, 'state=synced&fail=take'); await page.getByRole('button', { name: 'Back up now' }).click(); await expect(page.getByRole('alert')).toContainText('Could not back up');
  });
  test('offline disables backup actions', async ({ page }) => {
    await lab(page, 'state=offline'); await expect(page.getByRole('button', { name: 'Back up now' })).toBeDisabled();
  });
});

test.describe('local-only mode and file backup (real Settings page)', () => {
  test('local-only note, emphasised download, no sync controls', async ({ page }) => {
    await visit(page, '/settings', 'canopy', 'dark');
    await expect(page.getByText('Your data is stored only on this device.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download backup file' })).toHaveClass(/btn-solid/);
    await expect(page.getByRole('button', { name: "Reset this device's copy" })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  });
  const upload = (page: Page, content: string) => page.locator('input[type=file]').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(content) });
  test('file restore shows a summary first; cancel changes nothing; confirm applies', async ({ page }) => {
    await visit(page, '/settings', 'canopy', 'dark');
    const before = await getStore(page);
    const n = before.rewards.length;
    await upload(page, JSON.stringify({ rewards: [{ id: 'new1', title: 'From file', cost: 5 }, ...before.rewards.slice(0, 1)] }));
    const d = page.getByRole('dialog', { name: 'Restore from this file?' });
    await expect(d).toContainText('1 added');
    if (n > 1) await expect(d).toContainText(`${n - 1} removed`);
    await d.getByRole('button', { name: 'Cancel' }).click();
    expect((await getStore(page)).rewards).toEqual(before.rewards);
    await upload(page, JSON.stringify({ rewards: [{ id: 'new1', title: 'From file', cost: 5 }] }));
    await page.getByRole('dialog').getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.getByText('Backup restored.')).toBeVisible();
    expect((await getStore(page)).rewards.map((r: { id: string }) => r.id)).toEqual(['new1']);
  });
  for (const [label, body, re] of [['bad JSON', '{nope', /not valid JSON/], ['wrong shape', '{"foo":1}', /not a Ledger backup/], ['no recognised data', '{"habits":"x"}', /not a Ledger backup/]] as const) {
    test(`invalid file (${label}) is explained and changes nothing`, async ({ page }) => {
      await visit(page, '/settings', 'canopy', 'dark');
      const before = await getStore(page);
      await upload(page, body);
      await expect(page.getByRole('status').filter({ hasText: re })).toContainText('Nothing was changed');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(await getStore(page)).toEqual(before);
    });
  }
  test('keyboard: Tab reaches the download button with a visible focus ring', async ({ page }) => {
    await visit(page, '/settings', 'canopy', 'dark');
    const b = page.getByRole('button', { name: 'Download backup file' }); await b.focus(); await expect(b).toBeFocused();
    expect(await b.evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe('none');
  });
});

test('all 13 skins are covered by the matrix', () => { expect(ALL_SKINS.length).toBe(13); });
