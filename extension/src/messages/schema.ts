/**
 * The only messages the background accepts, from the popup and the options page.
 *
 * Every message is checked twice before it is handled. The sender must be one of our own
 * extension pages (see `isTrustedSender`), and the payload must match its schema exactly, with
 * no unknown type, no unknown field and no oversize string. Content scripts have no message
 * type at all, the fill script only returns values from `scripting.executeScript`.
 */

export type MatchMode = 'domain' | 'host';
export type RevealField = 'password' | 'totp';

export type Message =
  | { type: 'state.get' }
  | { type: 'auth.login'; username: string; password: string }
  | { type: 'auth.unlock'; password: string }
  | { type: 'auth.sso' }
  | { type: 'auth.register'; username: string; password: string }
  | { type: 'auth.lock' }
  | { type: 'auth.logout' }
  | { type: 'vault.list'; tabId?: number }
  | { type: 'vault.reveal'; id: string; field: RevealField }
  | {
      type: 'vault.create';
      name: string;
      url: string | null;
      username: string;
      password: string;
      mfaSecret: string | null;
      match: MatchMode;
    }
  | { type: 'vault.delete'; id: string }
  | { type: 'fill.request'; tabId: number; id: string; confirmCrossSite: boolean }
  | { type: 'clipboard.copied' }
  | { type: 'settings.get' }
  | { type: 'settings.set'; settings: SettingsPatch }
  | { type: 'server.set'; url: string }
  | { type: 'activity' };

export type MessageType = Message['type'];

export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  readonly autoLockMinutes: 1 | 5 | 15 | 30;
  readonly theme: Theme;
  /** Keeps the session token in session storage, so closing the browser signs out. */
  readonly forgetOnClose: boolean;
  /** Development only. Allows filling on http://localhost and http://127.0.0.1. */
  readonly allowLoopbackHttp: boolean;
}

export type SettingsPatch = Partial<Settings>;

const MAX_TEXT = 4096;
const MAX_URL = 2048;
const MAX_NAME = 200;
const MAX_USERNAME = 512;
const MAX_PASSWORD = 1024;

type Validator = (value: unknown) => boolean;

const str =
  (max: number, min = 0): Validator =>
  (v) =>
    typeof v === 'string' && v.length >= min && v.length <= max;
const nullable =
  (inner: Validator): Validator =>
  (v) =>
    v === null || inner(v);
const oneOf =
  (...values: readonly unknown[]): Validator =>
  (v) =>
    values.includes(v);
const bool: Validator = (v) => typeof v === 'boolean';
const tabId: Validator = (v) => Number.isSafeInteger(v) && (v as number) >= 0;
const uuid: Validator = (v) =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);

const settingsPatch: Validator = (v) =>
  isRecord(v) &&
  exact(
    v,
    {},
    {
      autoLockMinutes: oneOf(1, 5, 15, 30),
      theme: oneOf('system', 'light', 'dark'),
      forgetOnClose: bool,
      allowLoopbackHttp: bool,
    },
  );

/** Required and optional fields per type. Anything not listed here is rejected. */
const SCHEMAS: Record<MessageType, [Record<string, Validator>, Record<string, Validator>?]> = {
  'state.get': [{}],
  'auth.login': [{ username: str(MAX_USERNAME, 1), password: str(MAX_PASSWORD, 1) }],
  'auth.unlock': [{ password: str(MAX_PASSWORD, 1) }],
  'auth.sso': [{}],
  'auth.register': [{ username: str(MAX_USERNAME, 1), password: str(MAX_PASSWORD, 1) }],
  'auth.lock': [{}],
  'auth.logout': [{}],
  'vault.list': [{}, { tabId }],
  'vault.reveal': [{ id: uuid, field: oneOf('password', 'totp') }],
  'vault.create': [
    {
      name: str(MAX_NAME, 1),
      url: nullable(str(MAX_URL)),
      username: str(MAX_USERNAME),
      password: str(MAX_TEXT),
      mfaSecret: nullable(str(MAX_TEXT)),
      match: oneOf('domain', 'host'),
    },
  ],
  'vault.delete': [{ id: uuid }],
  'fill.request': [{ tabId, id: uuid, confirmCrossSite: bool }],
  'clipboard.copied': [{}],
  'settings.get': [{}],
  'settings.set': [{ settings: settingsPatch }],
  'server.set': [{ url: str(MAX_URL, 1) }],
  activity: [{}],
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

function exact(
  value: Record<string, unknown>,
  required: Record<string, Validator>,
  optional: Record<string, Validator> = {},
): boolean {
  for (const key of Object.keys(value)) {
    if (!(key in required) && !(key in optional)) return false;
  }
  for (const [key, check] of Object.entries(required)) {
    if (!(key in value) || !check(value[key])) return false;
  }
  for (const [key, check] of Object.entries(optional)) {
    if (key in value && !check(value[key])) return false;
  }
  return true;
}

/** Returns the message when it matches its schema exactly, otherwise null. */
export function parseMessage(raw: unknown): Message | null {
  if (!isRecord(raw) || typeof raw['type'] !== 'string') return null;
  if (!Object.prototype.hasOwnProperty.call(SCHEMAS, raw['type'])) return null;
  const [required, optional] = SCHEMAS[raw['type'] as MessageType];
  const { type: _type, ...fields } = raw;
  return exact(fields, required, optional) ? (raw as Message) : null;
}

/** The subset of a runtime message sender we rely on. */
export interface SenderLike {
  readonly id?: string;
  readonly url?: string;
  readonly tab?: unknown;
}

/** Pages allowed to send messages. Popup and options only, never a web page. */
const PAGES = ['popup.html', 'options.html'] as const;

/**
 * True only for our own popup or options page. A content script carries the id of this
 * extension but the URL of the web page it runs in, so the URL check is what excludes it.
 *
 * The URL is compared as a string against `runtime.getURL('/')`. `URL.origin` is not usable
 * here, because it is the opaque `null` for extension schemes in some environments, which
 * would make every extension page look alike.
 */
export function isTrustedSender(
  sender: SenderLike,
  runtimeId: string,
  extensionBase: string,
): boolean {
  if (sender.id !== runtimeId || !sender.url || !extensionBase.endsWith('/')) return false;
  if (!sender.url.startsWith(extensionBase)) return false;
  const path = sender.url.slice(extensionBase.length).split(/[?#]/, 1)[0];
  return PAGES.some((p) => path === p);
}

export type Reply<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
