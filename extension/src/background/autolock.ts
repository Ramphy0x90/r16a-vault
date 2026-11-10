import { browser } from 'wxt/browser';

import { clearNow } from './clipboard';
import { lock } from './session';
import * as store from './store';

/**
 * Locks the vault on the configured timeout, on system idle and on screen lock.
 *
 * The deadline is an alarm, so it fires even after the background was unloaded, and it is
 * also stored next to the key, so a missed alarm is caught the next time anything asks for the
 * key. Closing the browser clears session storage, which locks as well.
 */

export const AUTOLOCK_ALARM = 'autolock';

export async function lockAndClear(): Promise<void> {
  await lock();
  await clearNow();
}

export async function configureIdle(): Promise<void> {
  const minutes = (await store.settings()).autoLockMinutes;
  // The system counts as idle after the same timeout the user chose for the vault.
  browser.idle.setDetectionInterval(Math.max(15, minutes * 60));
}

export function listenForIdle(): void {
  browser.idle.onStateChanged.addListener((state) => {
    if (state === 'locked' || state === 'idle') void lockAndClear();
  });
}
