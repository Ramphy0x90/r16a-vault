/// <reference types="chrome" />
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';

import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  DEFAULT_KDF,
  KEY_BYTES,
  SALT_BYTES,
  loadSodium,
  passwordBytes,
  splitMasterKey,
  stretch,
  toBase64,
  wrapVaultKey,
} from '@zaltys/vault-core';

/**
 * The whole path a user takes, against a real backend and the real extension build. It proves
 * the CSRF extension origin rule, Argon2 inside the service worker, decryption, matching and
 * the two step fill on fixture pages.
 *
 * Needs the dev database and a debug backend build:
 *   R16A_E2E_DATABASE_URL=postgres://r16a_app:app-dev-password@127.0.0.1:5432/r16a npm run test:e2e:flow
 */
const DATABASE_URL = process.env['R16A_E2E_DATABASE_URL'];
test.skip(!DATABASE_URL, 'set R16A_E2E_DATABASE_URL to run against a live backend');

const BACKEND = resolve(process.cwd(), '../backend/target/debug/r16a-vault-backend');
const MASTER = 'e2e master password long enough';

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address() as AddressInfo;
  await new Promise((r) => s.close(r));
  return port;
}

async function serveFixtures(): Promise<{ server: Server; port: number }> {
  const dir = resolve(process.cwd(), 'test/fixtures');
  const server = createServer((req, res) => {
    const name = (req.url ?? '/').replace(/^\//, '').split('?')[0] || 'login.html';
    readFile(resolve(dir, name.replace(/[^a-z-.]/g, '')))
      .then((body) => res.writeHead(200, { 'content-type': 'text/html' }).end(body))
      .catch(() => res.writeHead(404).end());
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, port: (server.address() as AddressInfo).port };
}

async function startBackend(port: number): Promise<ChildProcess> {
  const child = spawn(BACKEND, ['serve'], {
    env: {
      PATH: process.env['PATH'],
      R16A_DATABASE_URL: DATABASE_URL,
      R16A_PUBLIC_URL: `http://localhost:${port}`,
      R16A_BIND: `127.0.0.1:${port}`,
      R16A_PRELOGIN_SECRET: 'e2e-prelogin-Kq8vZ2pT7mWx4nRb9cLd3fGh',
      R16A_DEV_INSECURE_COOKIE: 'true',
      R16A_RATE_LIMIT_BURST: '1000',
      R16A_LOG_FORMAT: 'pretty',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    const up = await fetch(`http://127.0.0.1:${port}/healthz`).then(
      (r) => r.ok,
      () => false,
    );
    if (up) return child;
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('backend did not start');
}

/** Registers a user the way a client does, so the extension has an account to sign in to. */
async function register(server: string, username: string): Promise<Uint8Array> {
  const sodium = await loadSodium();
  const salt = sodium.randombytes_buf(SALT_BYTES);
  const keys = splitMasterKey(sodium, stretch(sodium, passwordBytes(MASTER), salt, DEFAULT_KDF));
  const vaultKey = sodium.randombytes_buf(KEY_BYTES);
  const res = await fetch(`${server}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-r16a-request': '1' },
    body: JSON.stringify({
      username,
      authKey: toBase64(sodium, keys.authKey),
      kdf: DEFAULT_KDF,
      salt: toBase64(sodium, salt),
      wrappedVaultKey: toBase64(sodium, wrapVaultKey(sodium, keys.wrapKey, vaultKey)),
      client: 'mobile',
    }),
  });
  expect(res.status).toBe(201);
  return keys.authKey;
}

async function unregister(server: string, username: string, authKey: Uint8Array): Promise<void> {
  const sodium = await loadSodium();
  const login = await fetch(`${server}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-r16a-request': '1' },
    body: JSON.stringify({ username, authKey: toBase64(sodium, authKey), client: 'mobile' }),
  }).then((r) => r.json() as Promise<{ token: string }>);
  await fetch(`${server}/api/v1/me`, {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
      'x-r16a-request': '1',
      authorization: `Bearer ${login.token}`,
    },
    body: JSON.stringify({ authKey: toBase64(sodium, authKey) }),
  });
}

type Reply = { ok: true; data: unknown } | { ok: false; error: string };
const msg = (page: Page, m: Record<string, unknown>): Promise<Reply> =>
  page.evaluate((x) => chrome.runtime.sendMessage(x) as Promise<Reply>, m);

test('sign in, add, match, fill, lock and unlock against a live backend', async () => {
  test.setTimeout(120_000);
  const path = resolve(process.cwd(), '.output/chrome-mv3-e2e');
  const context: BrowserContext = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const backendPort = await freePort();
  const server = `http://localhost:${backendPort}`;
  const backend = await startBackend(backendPort);
  const fixtures = await serveFixtures();
  const username = `e2e-${Date.now()}`;
  const authKey = await register(`http://127.0.0.1:${backendPort}`, username);

  try {
    // The fixture stays the active tab of its window, the extension page opens in another one.
    const site = await context.newPage();
    await site.goto(`http://localhost:${fixtures.port}/login.html`);
    const pagePromise = context.waitForEvent('page');
    await worker.evaluate(() => chrome.windows.create({ url: 'options.html', type: 'popup' }));
    const ext = await pagePromise;
    await ext.waitForLoadState();

    expect(await msg(ext, { type: 'server.set', url: server })).toMatchObject({ ok: true });
    expect(
      await msg(ext, { type: 'settings.set', settings: { allowLoopbackHttp: true } }),
    ).toMatchObject({ ok: true });
    expect(await msg(ext, { type: 'auth.login', username, password: 'wrong password' })).toEqual({
      ok: false,
      error: 'invalid-credentials',
    });
    expect(await msg(ext, { type: 'auth.login', username, password: MASTER })).toMatchObject({
      ok: true,
      data: { status: 'unlocked', username },
    });

    const created = await msg(ext, {
      type: 'vault.create',
      name: 'Fixture site',
      url: `http://localhost:${fixtures.port}`,
      username: 'alice@example.com',
      password: 'fixture password',
      mfaSecret: 'JBSWY3DPEHPK3PXP',
      match: 'domain',
    });
    expect(created).toMatchObject({ ok: true });
    const credentialId = (created as { data: { id: string } }).data.id;

    const [tab] = await ext.evaluate(
      (port) => chrome.tabs.query({ url: `http://localhost:${port}/*` }),
      fixtures.port,
    );
    const tabId = tab?.id as number;
    const listed = await msg(ext, { type: 'vault.list', tabId });
    expect(listed).toMatchObject({
      ok: true,
      data: { items: [{ id: credentialId, level: 'exact', hasTotp: true }] },
    });
    expect(JSON.stringify(listed)).not.toContain('fixture password');

    const totp = await msg(ext, { type: 'vault.reveal', id: credentialId, field: 'totp' });
    expect(totp).toMatchObject({ ok: true, data: { field: 'totp' } });
    expect(JSON.stringify(totp)).not.toContain('JBSWY3DPEHPK3PXP');

    expect(
      await msg(ext, { type: 'fill.request', tabId, id: credentialId, confirmCrossSite: false }),
    ).toEqual({
      ok: true,
      data: { status: 'filled', fields: ['username', 'password'] },
    });
    await expect(site.locator('[name=email]')).toHaveValue('alice@example.com');
    await expect(site.locator('[name=password]')).toHaveValue('fixture password');
    await expect(site.locator('[name=q]')).toHaveValue('');

    await site.goto(`http://localhost:${fixtures.port}/hidden-trap.html`);
    expect(
      await msg(ext, { type: 'fill.request', tabId, id: credentialId, confirmCrossSite: false }),
    ).toEqual({
      ok: true,
      data: { status: 'refused', reason: 'no-fields' },
    });

    // A form that posts to another site needs an explicit confirmation before anything is filled.
    await site.goto(`http://localhost:${fixtures.port}/cross-site-action.html`);
    expect(
      await msg(ext, { type: 'fill.request', tabId, id: credentialId, confirmCrossSite: false }),
    ).toEqual({
      ok: true,
      data: { status: 'confirm-cross-site', actionHost: 'collector.example.net' },
    });
    await expect(site.locator('[name=password]')).toHaveValue('');
    expect(
      await msg(ext, { type: 'fill.request', tabId, id: credentialId, confirmCrossSite: true }),
    ).toMatchObject({
      ok: true,
      data: { status: 'filled' },
    });

    expect(await msg(ext, { type: 'auth.lock' })).toMatchObject({
      ok: true,
      data: { status: 'locked' },
    });
    const session = await worker.evaluate(() => chrome.storage.session.get(null));
    expect(Object.keys(session)).not.toContain('vaultKey');
    expect(await msg(ext, { type: 'vault.list' })).toEqual({ ok: false, error: 'locked' });
    expect(await msg(ext, { type: 'auth.unlock', password: MASTER })).toMatchObject({
      ok: true,
      data: { status: 'unlocked' },
    });
    expect(await msg(ext, { type: 'vault.delete', id: credentialId })).toMatchObject({ ok: true });
  } finally {
    await context.close();
    await unregister(`http://127.0.0.1:${backendPort}`, username, authKey).catch(() => undefined);
    backend.kill();
    fixtures.server.close();
  }
});
