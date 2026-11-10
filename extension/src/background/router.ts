import { browser } from 'wxt/browser';

import {
  isTrustedSender,
  parseMessage,
  type Message,
  type Reply,
  type SenderLike,
} from '../messages/schema';
import { ApiError, normaliseServerUrl, originPattern } from './api';
import { configureIdle, lockAndClear } from './autolock';
import { clearNow, scheduleClear } from './clipboard';
import { fill } from './fill';
import * as session from './session';
import * as store from './store';
import * as vault from './vault';

/**
 * The single entry point for messages from the popup and options page.
 *
 * Anything that is not from our own page or does not match its schema is dropped without a
 * reply, so a content script or another extension cannot even learn which types exist.
 * Errors reach the UI as slugs only, never as messages that could carry secrets.
 */

async function handle(msg: Message): Promise<unknown> {
  switch (msg.type) {
    case 'state.get':
      return session.state();
    case 'auth.login':
      await session.login(msg.username, msg.password);
      return session.state();
    case 'auth.unlock':
      await session.unlock(msg.password);
      return session.state();
    case 'auth.sso':
      return session.sso();
    case 'auth.register':
      await session.registerPending(msg.username, msg.password);
      return session.state();
    case 'auth.lock':
      await lockAndClear();
      return session.state();
    case 'auth.logout':
      await session.logout();
      await clearNow();
      return session.state();
    case 'vault.list':
      return vault.list(msg.tabId);
    case 'vault.reveal':
      return vault.reveal(msg.id, msg.field);
    case 'vault.create':
      return { id: await vault.create(msg) };
    case 'vault.delete':
      await vault.remove(msg.id);
      return null;
    case 'fill.request':
      return fill(msg.tabId, msg.id, msg.confirmCrossSite);
    case 'clipboard.copied':
      await scheduleClear();
      return null;
    case 'settings.get':
      return store.settings();
    case 'settings.set': {
      const next = { ...(await store.settings()), ...msg.settings };
      await store.setLocal({ settings: next });
      if (msg.settings.forgetOnClose !== undefined) {
        const current = await store.token();
        if (current) await store.saveToken(current);
      }
      await configureIdle();
      await session.armDeadline();
      return next;
    }
    case 'server.set':
      return setServer(msg.url);
    case 'activity':
      await session.armDeadline();
      return null;
  }
}

/**
 * Switching servers signs out locally, because a token and a vault key belong to one server.
 * The host permission is requested by the options page inside the click, so here we only
 * check it was granted and drop the permission for the previous server.
 */
async function setServer(input: string): Promise<unknown> {
  const url = normaliseServerUrl(input);
  if (!url) throw new ApiError(0, 'invalid-server');
  if (!(await browser.permissions.contains({ origins: [originPattern(url)] }))) {
    throw new ApiError(0, 'permission-missing');
  }
  const previous = await store.local('serverUrl');
  if (previous !== url) {
    await session.logout();
    await store.removeLocal('username');
  }
  await store.setLocal({ serverUrl: url });
  const config = await (await session.api()).authConfig();
  await store.setLocal({
    serverConfig: {
      oidcEnabled: config.oidcEnabled,
      oidcDisplayName: config.oidcDisplayName,
      registrationEnabled: config.registrationEnabled,
    },
  });
  if (previous && previous !== url) {
    await browser.permissions.remove({ origins: [originPattern(previous)] }).catch(() => false);
  }
  return config;
}

function slugOf(e: unknown): string {
  if (e instanceof ApiError) return e.slug;
  if (e instanceof Error && e.name === 'CryptoError') return 'decrypt-failed';
  return 'internal';
}

export function listen(): void {
  browser.runtime.onMessage.addListener((raw: unknown, sender: SenderLike) => {
    if (!isTrustedSender(sender, browser.runtime.id, browser.runtime.getURL('/'))) return undefined;
    const msg = parseMessage(raw);
    if (!msg) return undefined;
    return handle(msg).then(
      (data): Reply => ({ ok: true, data }),
      (e: unknown): Reply => ({ ok: false, error: slugOf(e) }),
    );
  });
}
