import { browser } from 'wxt/browser';

import * as store from './store';

/**
 * Clears a copied secret from the clipboard after 30 seconds.
 *
 * The popup writes the clipboard itself, because it is a focused document. Clearing happens
 * after the popup may have closed, so it runs here. Without `clipboardRead` there is no way to
 * check whether the clipboard still holds our value, so it is cleared unconditionally, the same
 * trade off the web app makes when reading is refused (SPEC D14, EXTENSION_SPEC Q4).
 */

export const CLEAR_ALARM = 'clipboard-clear';
const CLEAR_AFTER_MS = 30_000;
const OFFSCREEN_PATH = '/offscreen.html';

export async function scheduleClear(): Promise<void> {
  await store.setSession({ clipboardPending: true });
  await browser.alarms.create(CLEAR_ALARM, { when: Date.now() + CLEAR_AFTER_MS });
}

export async function clearNow(): Promise<void> {
  if (!(await store.session('clipboardPending'))) return;
  await browser.alarms.clear(CLEAR_ALARM);
  const cleared = import.meta.env.FIREFOX ? await clearHere() : await clearOffscreen();
  // A failed clear stays pending, so the next lock or extension page visit tries again.
  if (cleared) await store.removeSession('clipboardPending');
}

/** Firefox event pages have a DOM. MDN warns writes may still be refused there. */
async function clearHere(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText('');
    return true;
  } catch {
    return false;
  }
}

/** Chromium service workers have no DOM, so an offscreen document performs the write. */
async function clearOffscreen(): Promise<boolean> {
  const offscreen = (browser as unknown as { offscreen?: ChromeOffscreen }).offscreen;
  if (!offscreen) return false;
  const existing = await offscreen.hasDocument?.().catch(() => false);
  if (!existing) {
    await offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['CLIPBOARD'],
      justification: 'Clear a copied password from the clipboard after 30 seconds.',
    });
  }
  try {
    const reply: unknown = await browser.runtime.sendMessage({
      target: 'offscreen',
      type: 'clipboard.clear',
    });
    return (reply as { ok?: boolean } | undefined)?.ok === true;
  } finally {
    await offscreen.closeDocument().catch(() => undefined);
  }
}

interface ChromeOffscreen {
  createDocument(p: { url: string; reasons: string[]; justification: string }): Promise<void>;
  closeDocument(): Promise<void>;
  hasDocument?(): Promise<boolean>;
}
