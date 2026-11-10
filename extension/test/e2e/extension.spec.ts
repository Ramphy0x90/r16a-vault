/// <reference types="chrome" />
import { resolve } from 'node:path';

import { chromium, expect, test as base, type BrowserContext, type Worker } from '@playwright/test';

// Loads the built extension the way a user would load it unpacked. Headless extension support
// exists only in Playwright's bundled Chromium, so the channel is fixed.
const test = base.extend<{ context: BrowserContext; worker: Worker; id: string }>({
  context: async ({}, use) => {
    const path = resolve(process.cwd(), '.output/chrome-mv3');
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`],
    });
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },
  id: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },
});

test('starts without any host access', async ({ worker }) => {
  const granted = await worker.evaluate(() => chrome.permissions.getAll());
  expect(granted.origins ?? []).toEqual([]);
  expect(granted.permissions).not.toContain('tabs');
});

test('the popup asks for a server before anything else', async ({ context, id }) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await expect(popup.getByText('Connect the extension to your Zaltys server')).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Open settings' })).toBeVisible();
});

test('the options page shows the exact values an operator must allow', async ({ context, id }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/options.html`);
  await expect(page.getByText(`chrome-extension://${id}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`https://${id}.chromiumapp.org/oidc`, { exact: true })).toBeVisible();
});

test('answers well formed messages from its own pages and ignores the rest', async ({
  context,
  id,
}) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  const reply = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'state.get' }));
  expect(reply).toMatchObject({ ok: true, data: { status: 'setup' } });

  for (const msg of [
    { type: 'vault.decrypt', id: 'x' },
    { type: 'state.get', extra: true },
  ]) {
    const out = await popup.evaluate(
      (m) =>
        chrome.runtime.sendMessage(m).then(
          (r: unknown) => r ?? 'no reply',
          () => 'no reply',
        ),
      msg,
    );
    expect(out).toBe('no reply');
  }
});

test('web pages cannot reach the extension at all', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('data:text/html,<p>hostile page</p>');
  const reachable = await page.evaluate(
    () =>
      typeof (globalThis as { chrome?: { runtime?: { sendMessage?: unknown } } }).chrome?.runtime
        ?.sendMessage,
  );
  expect(reachable).toBe('undefined');
});

test('the vault key is never in local storage', async ({ worker }) => {
  const local = await worker.evaluate(() => chrome.storage.local.get(null));
  expect(Object.keys(local)).not.toContain('vaultKey');
});

test('clears a copied secret from the clipboard through the offscreen document', async ({
  context,
  worker,
  id,
}) => {
  // Playwright cannot target extension origins, so the throwaway test browser grants it everywhere.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.bringToFront();
  await popup.evaluate(() => navigator.clipboard.writeText('hunter2-secret'));
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'clipboard.copied' }));
  // Fire the 30 second alarm now. Unpacked extensions may schedule alarms this short.
  await worker.evaluate(() => chrome.alarms.create('clipboard-clear', { when: Date.now() + 50 }));
  await expect
    .poll(() => popup.evaluate(() => navigator.clipboard.readText()), { timeout: 5_000 })
    .toBe('');
  const pending = await worker.evaluate(() => chrome.storage.session.get('clipboardPending'));
  expect(pending).toEqual({});
});
