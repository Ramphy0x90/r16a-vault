import { browser } from 'wxt/browser';

import type { Settings } from '../messages/schema';

/**
 * Everything the background persists, and where.
 *
 * `storage.local` is on disk and holds only what is useless without the master password, the
 * server URL, settings and (unless the user opted out) the session token of a locked session.
 * `storage.session` lives in memory, is cleared when the browser closes, and is the only place
 * the vault key may exist outside a running function (docs/EXTENSION_SPEC.md section 5).
 */

export const DEFAULT_SETTINGS: Settings = {
  autoLockMinutes: 5,
  theme: 'system',
  forgetOnClose: false,
  allowLoopbackHttp: false,
};

interface LocalShape {
  serverUrl?: string;
  /** The server's public auth settings, cached when the server is set. */
  serverConfig?: {
    oidcEnabled: boolean;
    oidcDisplayName: string | null;
    registrationEnabled: boolean;
  };
  settings?: Settings;
  token?: string;
  username?: string;
}

interface SessionShape {
  /** Base64 vault key. Present only while unlocked. */
  vaultKey?: string;
  /** Epoch milliseconds after which the vault must be locked even if no alarm fired. */
  lockDeadline?: number;
  /** Used instead of the local token when the user chose to forget the session on close. */
  token?: string;
  username?: string;
  /** First SSO sign in, waiting for the user to choose a master password. */
  ssoPending?: { token: string; suggestedUsername: string | null };
  /** Set while a copied secret waits to be cleared from the clipboard. */
  clipboardPending?: boolean;
}

export async function local<K extends keyof LocalShape>(key: K): Promise<LocalShape[K]> {
  const got = await browser.storage.local.get(key);
  return got[key] as LocalShape[K];
}

export async function setLocal(values: LocalShape): Promise<void> {
  await browser.storage.local.set(values);
}

export async function removeLocal(...keys: (keyof LocalShape)[]): Promise<void> {
  await browser.storage.local.remove(keys);
}

export async function session<K extends keyof SessionShape>(key: K): Promise<SessionShape[K]> {
  const got = await browser.storage.session.get(key);
  return got[key] as SessionShape[K];
}

export async function setSession(values: SessionShape): Promise<void> {
  await browser.storage.session.set(values);
}

export async function removeSession(...keys: (keyof SessionShape)[]): Promise<void> {
  await browser.storage.session.remove(keys);
}

/**
 * Chrome already limits session storage to trusted contexts by default. Saying so explicitly
 * documents the intent and guards against a future default change. Firefox does not implement
 * the method and never exposes session storage to content scripts.
 */
export async function restrictSessionStorage(): Promise<void> {
  const area = browser.storage.session as {
    setAccessLevel?: (o: { accessLevel: string }) => Promise<void>;
  };
  await area.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
}

export async function settings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await local('settings')) ?? {}) };
}

/** The session token, from whichever area the user's setting puts it in. */
export async function token(): Promise<string | null> {
  return (await session('token')) ?? (await local('token')) ?? null;
}

export async function saveToken(value: string): Promise<void> {
  if ((await settings()).forgetOnClose) {
    await setSession({ token: value });
    await removeLocal('token');
  } else {
    await setLocal({ token: value });
    await removeSession('token');
  }
}

export async function forgetToken(): Promise<void> {
  await removeLocal('token');
  await removeSession('token');
}
