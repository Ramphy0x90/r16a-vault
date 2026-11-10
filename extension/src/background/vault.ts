import { browser } from 'wxt/browser';
import {
  canonicalTotpSecret,
  loadSodium,
  matchSite,
  normaliseUrl,
  openMeta,
  openSecret,
  parseSite,
  parseTotp,
  sealCredential,
  secondsRemaining,
  totpCode,
  type CredentialMeta,
  type CredentialSecret,
  type MatchLevel,
} from '@zaltys/vault-core';

import type { MatchMode, RevealField } from '../messages/schema';
import { ApiError, type CredentialRow } from './api';
import { api, withVaultKey } from './session';

/**
 * Credential listing, reveal, create and delete for the popup.
 *
 * Metas are decrypted per request and returned without any secret. A secret is decrypted only
 * for one reveal, copy or fill and only the single requested value leaves this module. For TOTP
 * that is the current code, never the secret it comes from.
 */

export interface ListedCredential {
  readonly id: string;
  readonly name: string;
  readonly username: string;
  readonly url: string | null;
  readonly host: string | null;
  readonly hasTotp: boolean;
  readonly match: MatchMode;
  /** How well it fits the current tab, null when it does not. */
  readonly level: MatchLevel | null;
}

export interface VaultList {
  /** The tab's site, when the popup asked for one and the tab is an https page. */
  readonly site: { readonly origin: string; readonly host: string } | null;
  readonly items: readonly ListedCredential[];
  /** Rows that failed to decrypt, shown as a count rather than hidden silently. */
  readonly broken: number;
}

export async function tabUrl(tabId: number): Promise<string | null> {
  try {
    const tab = await browser.tabs.get(tabId);
    return tab.url ?? null;
  } catch {
    return null;
  }
}

export async function list(tabId?: number): Promise<VaultList> {
  const rows = await (await api()).listCredentials();
  const page = tabId === undefined ? null : await tabUrl(tabId);
  const site = page ? parseSite(page) : null;
  return withVaultKey(async (key) => {
    const sodium = await loadSodium();
    const items: ListedCredential[] = [];
    let broken = 0;
    for (const row of rows) {
      let meta: CredentialMeta;
      try {
        meta = openMeta(sodium, key, row.id, row.meta);
      } catch {
        broken++;
        continue;
      }
      const match: MatchMode = meta.match === 'host' ? 'host' : 'domain';
      items.push({
        id: row.id,
        name: meta.name,
        username: meta.username,
        url: meta.url,
        host: meta.url ? (parseSite(meta.url)?.host ?? null) : null,
        hasTotp: meta.hasTotp === true,
        match,
        level: page ? matchSite(meta.url, page, match) : null,
      });
    }
    const rank = (l: MatchLevel | null): number => (l === 'exact' ? 0 : l === 'domain' ? 1 : 2);
    items.sort((a, b) => rank(a.level) - rank(b.level) || a.name.localeCompare(b.name));
    return { site: site ? { origin: site.origin, host: site.host } : null, items, broken };
  });
}

async function row(id: string): Promise<CredentialRow> {
  const found = (await (await api()).listCredentials()).find((r) => r.id === id);
  if (!found) throw new ApiError(404, 'not-found');
  return found;
}

/** Opens one credential's meta and secret. Callers must drop the secret as soon as possible. */
export async function decrypt(
  id: string,
): Promise<{ meta: CredentialMeta; secret: CredentialSecret }> {
  const r = await row(id);
  return withVaultKey(async (key) => {
    const sodium = await loadSodium();
    return {
      meta: openMeta(sodium, key, r.id, r.meta),
      secret: openSecret(sodium, key, r.id, r.secret),
    };
  });
}

export type Revealed =
  | { readonly field: 'password'; readonly value: string }
  | {
      readonly field: 'totp';
      readonly code: string;
      readonly remaining: number;
      readonly period: number;
    };

export async function reveal(id: string, field: RevealField): Promise<Revealed> {
  const { secret } = await decrypt(id);
  if (field === 'password') return { field, value: secret.password };
  const config = secret.mfaSecret ? parseTotp(secret.mfaSecret) : null;
  if (!config) throw new ApiError(0, 'no-totp');
  const now = Date.now();
  return {
    field,
    code: totpCode(config, now),
    remaining: secondsRemaining(config, now),
    period: config.period,
  };
}

export async function create(input: {
  name: string;
  url: string | null;
  username: string;
  password: string;
  mfaSecret: string | null;
  match: MatchMode;
}): Promise<string> {
  const mfa = input.mfaSecret?.trim() ? input.mfaSecret.trim() : null;
  if (mfa && !parseTotp(mfa)) throw new ApiError(0, 'invalid-totp');
  const url = normaliseUrl(input.url ?? '');
  if (url === undefined) throw new ApiError(0, 'invalid-url');
  const id = crypto.randomUUID();
  const meta: CredentialMeta = {
    name: input.name.trim(),
    url,
    username: input.username,
    hasTotp: mfa !== null,
    ...(input.match === 'host' ? { match: 'host' as const } : {}),
  };
  const secret: CredentialSecret = {
    password: input.password,
    mfaSecret: mfa ? canonicalTotpSecret(mfa) : null,
  };
  const sealed = await withVaultKey(async (key) =>
    sealCredential(await loadSodium(), key, id, meta, secret),
  );
  await (await api()).createCredential(id, sealed.meta, sealed.secret);
  return id;
}

export async function remove(id: string): Promise<void> {
  await (await api()).deleteCredential(id);
}
