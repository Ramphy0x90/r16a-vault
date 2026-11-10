import type { KdfParams } from '@zaltys/vault-core';

/**
 * HTTP client for the Zaltys API, used only by the background.
 *
 * Requests never carry cookies (`credentials: 'omit'`), so the browser's own session for the
 * server can never be attached or overwritten from here. Authentication is the bearer token,
 * and `X-R16a-Request` lets the server's CSRF layer accept the extension origin before the
 * extension holds a token (docs/EXTENSION_SPEC.md section 8.4).
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** The problem slug, for example `invalid-credentials`, or a local one such as `network`. */
    readonly slug: string,
  ) {
    super(slug);
    this.name = 'ApiError';
  }
}

export interface LoginResponse {
  readonly user: { readonly id: string; readonly username: string };
  readonly kdf: KdfParams;
  readonly salt: string;
  readonly wrappedVaultKey: string;
  readonly token?: string;
}

export interface UnlockResponse {
  readonly kdf: KdfParams;
  readonly salt: string;
  readonly wrappedVaultKey: string;
  readonly token?: string;
}

export interface Me {
  readonly id: string;
  readonly username: string;
  readonly kdf: KdfParams;
  readonly salt: string;
  readonly sessionState: 'pre_auth' | 'full';
}

export interface CredentialRow {
  readonly id: string;
  readonly meta: string;
  readonly secret: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AuthConfig {
  readonly oidcEnabled: boolean;
  readonly oidcDisplayName: string | null;
  readonly registrationEnabled: boolean;
}

export interface OidcExchange {
  readonly token: string;
  readonly state: 'pre_auth' | 'pending';
  readonly suggestedUsername?: string;
}

const TIMEOUT_MS = 20_000;

export class Api {
  constructor(
    private readonly base: string,
    private readonly token: string | null,
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extra?: HeadersInit,
  ): Promise<T> {
    const headers = new Headers(extra);
    headers.set('X-R16a-Request', '1');
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    let res: Response;
    try {
      res = await fetch(`${this.base}/api/v1${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new ApiError(0, 'network');
    }
    if (res.status === 204) return undefined as T;
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const type = (data as { type?: unknown } | null)?.type;
      const slug =
        typeof type === 'string' ? type.replace('urn:r16a:problem:', '') : `http-${res.status}`;
      throw new ApiError(res.status, slug);
    }
    return data as T;
  }

  authConfig(): Promise<AuthConfig> {
    return this.request('GET', '/auth/config');
  }

  prelogin(username: string): Promise<{ kdf: KdfParams; salt: string }> {
    return this.request('POST', '/auth/prelogin', { username });
  }

  login(username: string, authKey: string): Promise<LoginResponse> {
    return this.request('POST', '/auth/login', { username, authKey, client: 'extension' });
  }

  register(
    body: {
      username: string;
      authKey: string;
      kdf: KdfParams;
      salt: string;
      wrappedVaultKey: string;
    },
    pendingToken: string,
  ): Promise<LoginResponse> {
    return this.request(
      'POST',
      '/auth/register',
      { ...body, client: 'extension' },
      { 'X-R16a-Oidc-Pending': pendingToken },
    );
  }

  unlock(authKey: string): Promise<UnlockResponse> {
    return this.request('POST', '/auth/unlock', { authKey });
  }

  logout(): Promise<void> {
    return this.request('POST', '/auth/logout');
  }

  me(): Promise<Me> {
    return this.request('GET', '/me');
  }

  oidcExchange(code: string, verifier: string): Promise<OidcExchange> {
    return this.request('POST', '/auth/oidc/exchange', { code, verifier });
  }

  listCredentials(): Promise<CredentialRow[]> {
    return this.request('GET', '/credentials');
  }

  createCredential(id: string, meta: string, secret: string): Promise<CredentialRow> {
    return this.request('POST', '/credentials', { id, meta, secret });
  }

  deleteCredential(id: string): Promise<void> {
    return this.request('DELETE', `/credentials/${encodeURIComponent(id)}`);
  }
}

/**
 * Validates the server address the user typed. HTTPS is required, except loopback hosts for
 * local development, the same rule the mobile app applies.
 */
export function normaliseServerUrl(input: string): string | null {
  const raw = input.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
  return url.origin;
}

/** The host permission pattern for exactly one server origin. */
export function originPattern(origin: string): string {
  const u = new URL(origin);
  return `${u.protocol}//${u.hostname}/*`;
}
