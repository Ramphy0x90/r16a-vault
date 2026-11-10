import { parse } from 'tldts';

/**
 * Decides whether a stored credential belongs to the page in a tab.
 *
 * Matching is by registrable domain from the Public Suffix List, private suffixes included,
 * so `alice.github.io` and `bob.github.io` are different sites and `example.co.uk` is the
 * unit of trust rather than `co.uk`. Only secure origins match, except plain http on the
 * loopback names that local development uses.
 */

export type MatchLevel = 'exact' | 'domain';

/** Stored in the credential meta as `match`. Absent means `domain`. */
export type MatchMode = 'domain' | 'host';

export interface Site {
  readonly scheme: 'https' | 'http';
  readonly host: string;
  /** Empty when the URL uses the scheme's default port. */
  readonly port: string;
  readonly origin: string;
  /** Null for IP addresses, loopback names and hosts that are themselves a public suffix. */
  readonly registrableDomain: string | null;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Parses a URL as typed by a user or read from a tab. A missing scheme means https, the same
 * normalisation the web app applies when saving. Anything other than https, or http on a
 * loopback host, is not a site we ever match or fill.
 */
export function parseSite(input: string): Site | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const scheme = url.protocol.slice(0, -1);
  const host = url.hostname;
  if (!host) return null;
  if (scheme === 'http' && !LOOPBACK.has(host)) return null;
  if (scheme !== 'https' && scheme !== 'http') return null;
  const info = parse(host, { allowPrivateDomains: true });
  const registrableDomain = info.isIp || LOOPBACK.has(host) ? null : (info.domain ?? null);
  return { scheme, host, port: url.port, origin: url.origin, registrableDomain };
}

/**
 * How well a credential URL fits the page. Scheme must be equal, a port stated on the
 * credential must be equal, and `host` mode or a site without a registrable domain allows
 * only the exact host.
 */
export function matchSite(
  credentialUrl: string | null | undefined,
  pageUrl: string,
  mode: MatchMode = 'domain',
): MatchLevel | null {
  if (!credentialUrl) return null;
  const cred = parseSite(credentialUrl);
  const page = parseSite(pageUrl);
  if (!cred || !page || cred.scheme !== page.scheme) return null;
  if (cred.port && cred.port !== page.port) return null;
  if (cred.host === page.host) return 'exact';
  if (mode === 'host' || !cred.registrableDomain) return null;
  return cred.registrableDomain === page.registrableDomain ? 'domain' : null;
}

/** True when both URLs belong to the same registrable domain, or the same host without one. */
export function sameSite(a: string, b: string): boolean {
  const x = parseSite(a);
  const y = parseSite(b);
  if (!x || !y) return false;
  if (x.registrableDomain && y.registrableDomain)
    return x.registrableDomain === y.registrableDomain;
  return x.host === y.host;
}
