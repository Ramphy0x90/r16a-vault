import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

import { AUTOLOCK_ALARM, configureIdle, listenForIdle, lockAndClear } from '../background/autolock';
import { CLEAR_ALARM, clearNow } from '../background/clipboard';
import { createMenu, listenForMenu } from '../background/context-menu';
import { listen } from '../background/router';
import { restrictSessionStorage } from '../background/store';

/**
 * Background of the Zaltys extension. A service worker on Chromium, an event page on Firefox.
 *
 * Both are unloaded when idle, so every listener is registered synchronously here and all
 * state lives in storage, never in module variables (docs/EXTENSION_SPEC.md section 5).
 */
export default defineBackground(() => {
  listen();
  listenForIdle();
  listenForMenu();

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === AUTOLOCK_ALARM) void lockAndClear();
    if (alarm.name === CLEAR_ALARM) void clearNow();
  });

  browser.runtime.onInstalled.addListener(() => {
    createMenu();
  });

  void restrictSessionStorage();
  void configureIdle();
});
