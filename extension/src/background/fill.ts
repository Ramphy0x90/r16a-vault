import { browser } from 'wxt/browser';
import { matchSite, parseSite, sameSite } from '@zaltys/vault-core';

import { pageFill, type PageResult } from '../fill/page';
import { ApiError } from './api';
import * as store from './store';
import { decrypt, tabUrl } from './vault';

/**
 * Decides whether a credential may be filled into a tab and performs the fill.
 *
 * Runs only after an explicit user action in the popup or context menu. The page first gets a
 * probe without any secret, the decision happens here in trusted code, and only then does the
 * page receive one username and password, together with the origin it must still be on
 * (docs/EXTENSION_SPEC.md section 6).
 */

export type FillOutcome =
  | { readonly status: 'filled'; readonly fields: readonly string[] }
  | { readonly status: 'confirm-cross-site'; readonly actionHost: string }
  | { readonly status: 'refused'; readonly reason: string };

async function inject(tabId: number, args: Parameters<typeof pageFill>[0]): Promise<PageResult> {
  const [result] = await browser.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: pageFill,
    args: [args],
  });
  const value = result?.result as PageResult | undefined;
  if (!value) throw new ApiError(0, 'fill-unavailable');
  return value;
}

export async function fill(
  tabId: number,
  credentialId: string,
  confirmCrossSite: boolean,
): Promise<FillOutcome> {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (!tab?.active) return { status: 'refused', reason: 'tab-not-active' };
  const pageUrl = await tabUrl(tabId);
  const site = pageUrl ? parseSite(pageUrl) : null;
  if (!pageUrl || !site) return { status: 'refused', reason: 'not-secure' };
  if (site.scheme === 'http' && !(await store.settings()).allowLoopbackHttp) {
    return { status: 'refused', reason: 'not-secure' };
  }

  const { meta, secret } = await decrypt(credentialId);
  if (!matchSite(meta.url, pageUrl, meta.match === 'host' ? 'host' : 'domain')) {
    return { status: 'refused', reason: 'no-match' };
  }

  const probe = await inject(tabId, { mode: 'probe' });
  if (!probe.ok) return { status: 'refused', reason: probe.reason };
  // The probe reports the document's own origin, which is what the fill will run in. It must
  // be the page the user looked at and the credential belongs to.
  if (probe.origin !== site.origin) return { status: 'refused', reason: 'origin-changed' };
  if (probe.action) {
    const action = parseSite(probe.action);
    if (!action) return { status: 'refused', reason: 'insecure-action' };
    if (!sameSite(probe.action, site.origin) && !confirmCrossSite) {
      return { status: 'confirm-cross-site', actionHost: action.host };
    }
  }

  const result = await inject(tabId, {
    mode: 'fill',
    expectedOrigin: probe.origin,
    username: meta.username,
    password: secret.password,
  });
  if (!result.ok) return { status: 'refused', reason: result.reason };
  return { status: 'filled', fields: result.filled };
}
