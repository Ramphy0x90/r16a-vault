import { browser } from 'wxt/browser';
import {
  CryptoError,
  DEFAULT_KDF,
  KEY_BYTES,
  SALT_BYTES,
  assertAcceptableKdf,
  fromBase64,
  loadSodium,
  passwordBytes,
  splitMasterKey,
  stretch,
  toBase64,
  unwrapVaultKey,
  wrapVaultKey,
  type KdfParams,
  type Subkeys,
} from '@zaltys/vault-core';

import { Api, ApiError } from './api';
import * as store from './store';

/**
 * Sign in, unlock, single sign on and lock for the background.
 *
 * The master password arrives from the popup, is stretched here (Argon2id runs in the
 * background so an unlock survives the popup closing) and is dropped when the function
 * returns. Derived keys are zeroed as soon as they have been used. The only key that outlives
 * a call is the vault key, and it lives in session storage until lock or browser close.
 */

export type Status = 'setup' | 'anonymous' | 'locked' | 'unlocked';

export interface StateView {
  readonly status: Status;
  readonly username: string | null;
  readonly serverUrl: string | null;
  readonly ssoPending: { readonly suggestedUsername: string | null } | null;
  readonly sso: { readonly displayName: string } | null;
}

export async function api(): Promise<Api> {
  const server = await store.local('serverUrl');
  if (!server) throw new ApiError(0, 'no-server');
  return new Api(server, await store.token());
}

export async function state(): Promise<StateView> {
  const serverUrl = (await store.local('serverUrl')) ?? null;
  const pending = await store.session('ssoPending');
  const config = await store.local('serverConfig');
  const base = {
    serverUrl,
    sso: config?.oidcEnabled ? { displayName: config.oidcDisplayName ?? 'Single sign on' } : null,
    username: (await store.local('username')) ?? null,
    ssoPending: pending ? { suggestedUsername: pending.suggestedUsername } : null,
  };
  if (!serverUrl) return { ...base, status: 'setup' };
  if (!(await store.token())) return { ...base, status: 'anonymous' };
  return { ...base, status: (await vaultKeyPresent()) ? 'unlocked' : 'locked' };
}

async function vaultKeyPresent(): Promise<boolean> {
  const deadline = await store.session('lockDeadline');
  if (deadline !== undefined && Date.now() >= deadline) {
    await lock();
    return false;
  }
  return (await store.session('vaultKey')) !== undefined;
}

async function derive(password: string, saltB64: string, kdf: KdfParams): Promise<Subkeys> {
  assertAcceptableKdf(kdf);
  const sodium = await loadSodium();
  const salt = fromBase64(sodium, saltB64);
  if (salt.length !== SALT_BYTES) throw new CryptoError('bad-envelope');
  const pw = passwordBytes(password);
  try {
    return splitMasterKey(sodium, stretch(sodium, pw, salt, kdf));
  } finally {
    sodium.memzero(pw);
  }
}

async function wipe(keys: Subkeys): Promise<void> {
  const sodium = await loadSodium();
  sodium.memzero(keys.authKey);
  sodium.memzero(keys.wrapKey);
}

async function storeVaultKey(keys: Subkeys, wrappedB64: string): Promise<void> {
  const sodium = await loadSodium();
  const vaultKey = unwrapVaultKey(sodium, keys.wrapKey, fromBase64(sodium, wrappedB64));
  try {
    await store.setSession({ vaultKey: toBase64(sodium, vaultKey) });
  } finally {
    sodium.memzero(vaultKey);
  }
  await armDeadline();
}

/** Re-arms the auto lock deadline. Called on unlock and on activity in the popup. */
export async function armDeadline(): Promise<void> {
  if (!(await store.session('vaultKey'))) return;
  const minutes = (await store.settings()).autoLockMinutes;
  const when = Date.now() + minutes * 60_000;
  await store.setSession({ lockDeadline: when });
  await browser.alarms.create('autolock', { when });
}

/**
 * Runs `fn` with the vault key as bytes and zeroes the copy afterwards. Throws `locked` when
 * there is no key, so callers never handle a missing key silently.
 */
export async function withVaultKey<T>(fn: (key: Uint8Array) => Promise<T> | T): Promise<T> {
  if (!(await vaultKeyPresent())) throw new ApiError(0, 'locked');
  const sodium = await loadSodium();
  const encoded = await store.session('vaultKey');
  if (!encoded) throw new ApiError(0, 'locked');
  const key = fromBase64(sodium, encoded);
  try {
    return await fn(key);
  } finally {
    sodium.memzero(key);
  }
}

export async function login(username: string, password: string): Promise<void> {
  const client = await api();
  const pre = await client.prelogin(username);
  const keys = await derive(password, pre.salt, pre.kdf);
  try {
    const res = await client.login(username, toBase64(await loadSodium(), keys.authKey));
    if (!res.token) throw new ApiError(0, 'no-token');
    await store.saveToken(res.token);
    await store.setLocal({ username: res.user.username });
    await storeVaultKey(keys, res.wrappedVaultKey);
  } finally {
    await wipe(keys);
  }
}

export async function unlock(password: string): Promise<void> {
  const client = await api();
  const me = await client.me();
  const keys = await derive(password, me.salt, me.kdf);
  try {
    const res = await client.unlock(toBase64(await loadSodium(), keys.authKey));
    if (res.token) await store.saveToken(res.token);
    await store.setLocal({ username: me.username });
    await storeVaultKey(keys, res.wrappedVaultKey);
  } catch (e) {
    if (e instanceof ApiError && e.slug === 'unauthenticated') await store.forgetToken();
    throw e;
  } finally {
    await wipe(keys);
  }
}

/** Drops the vault key and everything derived from it. The session token stays. */
export async function lock(): Promise<void> {
  await store.removeSession('vaultKey', 'lockDeadline');
  await browser.alarms.clear('autolock');
}

export async function logout(): Promise<void> {
  try {
    await (await api()).logout();
  } catch {
    // The server may be unreachable or the session already gone. Local state goes either way.
  }
  await lock();
  await store.forgetToken();
  await store.removeSession('ssoPending');
}

const base64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/**
 * Single sign on through the browser's identity window. The server returns a one time code to
 * the extension's own redirect URL, which no website can serve, and the code is useless without
 * the verifier that never leaves this function (docs/EXTENSION_SPEC.md section 7.4).
 */
export async function sso(): Promise<StateView> {
  const server = await store.local('serverUrl');
  if (!server) throw new ApiError(0, 'no-server');
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64Url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
  const redirect = browser.identity.getRedirectURL('oidc');
  const start = new URL(`${server}/api/v1/auth/oidc/start`);
  start.search = new URLSearchParams({ client: 'extension', challenge, redirect }).toString();
  const final = await browser.identity.launchWebAuthFlow({
    url: start.toString(),
    interactive: true,
  });
  if (!final || !final.startsWith(redirect)) throw new ApiError(0, 'sso-failed');
  const params = new URL(final).searchParams;
  const code = params.get('code');
  if (!code) throw new ApiError(0, params.get('error') ?? 'sso-failed');
  const res = await new Api(server, null).oidcExchange(code, verifier);
  if (res.state === 'pre_auth') {
    await store.saveToken(res.token);
    await store.removeSession('ssoPending');
  } else {
    await store.setSession({
      ssoPending: { token: res.token, suggestedUsername: res.suggestedUsername ?? null },
    });
  }
  return state();
}

/** Completes a first SSO sign in by creating the account with a new master password. */
export async function registerPending(username: string, password: string): Promise<void> {
  const pending = await store.session('ssoPending');
  if (!pending) throw new ApiError(0, 'no-pending-sso');
  const sodium = await loadSodium();
  const salt = toBase64(sodium, sodium.randombytes_buf(SALT_BYTES));
  const vaultKey = sodium.randombytes_buf(KEY_BYTES);
  const keys = await derive(password, salt, DEFAULT_KDF);
  try {
    const res = await (
      await api()
    ).register(
      {
        username,
        authKey: toBase64(sodium, keys.authKey),
        kdf: DEFAULT_KDF,
        salt,
        wrappedVaultKey: toBase64(sodium, wrapVaultKey(sodium, keys.wrapKey, vaultKey)),
      },
      pending.token,
    );
    if (!res.token) throw new ApiError(0, 'no-token');
    await store.saveToken(res.token);
    await store.setLocal({ username: res.user.username });
    await store.removeSession('ssoPending');
    await storeVaultKey(keys, res.wrappedVaultKey);
  } finally {
    sodium.memzero(vaultKey);
    await wipe(keys);
  }
}
