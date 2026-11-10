# Zaltys browser extension specification

Status: **APPROVED 2026-11-10.** Q1 WXT, Q2 npm workspace at the root, Q3 (a) explicit origin list for both browsers, Q4 (a) no `clipboardRead`, Q5 Chrome 121 and Firefox 128 ESR (proposed minimums, not objected to).

This extends `docs/SPEC.md`. Every rule and invariant there applies here unchanged unless section 11 lists a deviation. Open decisions that need your answer are collected in section 12.

---

## 1. Scope

**v1.** A Manifest V3 extension for Chromium browsers and Firefox, from one codebase in `extension/`. The popup signs in, unlocks and locks. It lists credentials that match the current tab first, then lets you search all. It copies username, password and TOTP code (with a countdown), reveals secrets with auto-hide, fills the current page on request, adds a credential prefilled with the current site, and generates passwords with the same options as web. The options page sets the server URL, the auto-lock timeout and the theme, and signs out.

**Not v1, design kept open.** Inline icons in page fields, offering to save submitted logins, passkeys. Section 10 notes what each would add.

**Minimum browsers.** Chrome 121 and Firefox 140 ESR (raised from 128 during the build, see section 14). Both read a manifest that carries `background.service_worker` and `background.scripts` together (Firefox 121 and later ignore the first and run the second as an event page). Both have `storage.session` and `idle`, and Chrome 109 and later has `offscreen`.

---

## 2. Threat model additions

Assets and adversaries from SPEC 2 still apply. The extension adds the following.

| Adversary | Capability | Outcome by design |
|---|---|---|
| **E1. Hostile web page** | Runs script in the tab, controls the DOM the fill script sees, can navigate at any moment, can host lookalike forms and hidden fields | Never receives anything without a user click. On click it receives one username and password, and only if the page is https, the origin still matches the credential at fill time, and the fields are visible in the top frame. It can still read what was filled (inherent to autofill). |
| **E2. Compromised content script** (renderer exploit in that tab) | Code in the isolated world of one tab | Has no channel to request secrets. Content scripts never send messages to the background in v1, and session storage is closed to them. At most it sees the one credential filled into that tab. |
| **E3. Another installed extension** | Its own extension APIs | Cannot message Zaltys (no `externally_connectable`, no `onMessageExternal` listener). An extension with broad host permissions can read pages, so it can see filled values (out of scope, same as any password manager). |
| **E4. Local attacker with disk access** (browser profile copied while the vault is locked) | Reads `storage.local` | Gets the server URL, preferences and a bearer token for a locked session. That is the A9 position from SPEC 2.2, which allows listing ciphertext and deleting entries but no offline attack, because `wrappedVaultKey` needs an `authKey` proof. The vault key is never on disk. |
| **E5. Local attacker at an unlocked, unattended browser** | Uses the popup | Same as A8. Mitigated by auto-lock on timeout, system idle and screen lock, and by browser close. |
| **E6. Malicious or compromised server** | As A2 and A3 | As SPEC A2. The A3 risk of a modified web bundle does **not** apply, because extension code ships in the package, not from the server. |

**Residual risks.** Filled credentials are readable by the page they were filled into. The token in `storage.local` survives restarts (section 5.3). Strings holding a decrypted password cannot be zeroed (SPEC 2.4). Clipboard clearing on Firefox may be best effort only (section 7.3).

---

## 3. Architecture

### 3.1 Trust zones

| Zone | Contexts | Holds | Talks to |
|---|---|---|---|
| **Trusted** | Background (Chrome service worker, Firefox event page), popup, options page, Chrome offscreen document | Vault key (in `storage.session`), token, decrypted entries in memory while needed | Server (fetch with host permission), each other through `runtime` messaging |
| **Untrusted** | Fill script injected into a page | One username and password, for one fill | Nothing. It returns a result value from `executeScript` and exits |

The vault key, wrap key, auth key and session token never enter the untrusted zone.

### 3.2 Where things run

- **Background** owns the API client, session state, auto-lock, the context menu, all crypto and the fill decision. Argon2id runs here, so the popup stays responsive and an unlock survives the popup closing. Chrome allows WASM in the service worker with `'wasm-unsafe-eval'`, and 64 MiB is well within limits.
- **Popup** is UI only. It asks the background for data through typed messages and never touches the vault key. It may write to the clipboard itself, because it is a focused document (section 7.3).
- **Offscreen document** (Chrome only) exists solely to clear the clipboard after the popup has closed. Firefox does not implement `offscreen`, and its event page has a DOM.
- **Fill script** is a single function injected with `scripting.executeScript({ func, args })` into the top frame of the active tab. It is not a declared content script and never stays resident.

### 3.3 Build tool. Recommended WXT 0.21.5, alternative plain Vite 8

| | WXT | Vite plus own manifest builder |
|---|---|---|
| Chrome and Firefox manifests from one config | Built in, including the Firefox background conversion | We write and maintain it |
| Zip for each store plus the AMO sources zip | `wxt zip -b firefox` | Own script |
| Multi-entry build (background, popup, options, offscreen, IIFE fill function) | Built in | Several Vite configs |
| Dependency surface | Larger, and pre-1.0 (0.21) | Smallest |
| Runtime code shipped | A thin `browser` wrapper | None |

**Recommendation: WXT**, pinned to an exact version, with auto-imports disabled. The manifest output is checked by a unit test that asserts the permission set, so an upgrade cannot silently widen permissions. Sources disagree on the exact Firefox output, so the generated manifests for both browsers are inspected in the first build step. If WXT proves unsuitable there, we fall back to plain Vite before writing feature code.

### 3.4 UI

Plain TypeScript with a small DOM helper (about 100 lines, `createElement` and `textContent` only, never `innerHTML`) and a minimal signal store. No framework. The popup is about six views, which does not justify a framework, and it keeps the CSP surface and bundle small. Design tokens come from a shared stylesheet (section 9.2). Keyboard navigation, focus rings, labels and 44 px touch targets follow SPEC 10.

### 3.5 Shared crypto package `packages/vault-core`

It holds what is framework-free today and moves without change in behaviour.

| Module | From web | Contents |
|---|---|---|
| `protocol.ts` | `web/src/app/core/crypto/protocol.ts` | Constants, AAD builders, KDF bounds, stretch and derive, seal and open, base64 helpers |
| `sodium.ts` | `web/src/app/core/crypto/sodium.ts` | Lazy `libsodium-wrappers-sumo` loader |
| `totp.ts` | `web/src/app/core/totp/totp.ts` | Parse, normalise, code, countdown |
| `generator.ts` | `web/src/app/generator/generator.ts` | Password and passphrase generation, entropy |
| `match.ts` | new | URL matching (section 6.2), shared so web can use it later |

Web keeps its Angular wrappers (`VaultCryptoService`, the Argon2 worker, `GeneratorStore`) and imports from `@zaltys/vault-core`. The vector tests move with the code and run against `shared/crypto-test-vectors.json` in the package's own Vitest suite. Web keeps its own tests for the wrappers.

**Risk to web.** Two packages importing `libsodium-wrappers-sumo` need one installed copy, so the repo becomes an npm workspace (root `package.json` with `web`, `extension`, `packages/*`). That changes three things in web. Installs run from the root, one root `package-lock.json` replaces `web/package-lock.json`, and `web/Dockerfile` must copy the root manifest and `packages/`. CI changes the same way. The extraction itself is a move of four files.

**Order of work**, each step verified before the next:
1. Root workspace containing only `web`. Then `npm ci`, web build, lint, tests, the Docker image build and the CI job must all pass with no source change.
2. Create `packages/vault-core` by moving the four modules and their vector tests. Update web imports. Web build and tests, the package tests, and the Docker image must pass. Mobile is untouched.
3. Backend changes (section 8) with integration tests.
4. The extension.

---

## 4. Permissions

| Permission | Kind | Why it is needed | Warning shown |
|---|---|---|---|
| `storage` | required | `storage.session` for the vault key, `storage.local` for URL, token and preferences | none |
| `activeTab` | required | Temporary access to the tab where the user clicked the toolbar button or the context menu. Gives the tab URL for matching and lets us inject the fill function, without any standing host access | none |
| `scripting` | required | `executeScript` for the probe and fill functions (section 6) | none |
| `alarms` | required | Auto-lock and clipboard clearing timers that survive the background being unloaded | none |
| `idle` | required | Lock on system idle or screen lock | none |
| `contextMenus` (`menus` on Firefox) | required | "Fill with Zaltys" on editable fields, a user gesture that also grants `activeTab` | none |
| `clipboardWrite` | required | Writing and clearing the clipboard from the offscreen document (Chrome) and the event page (Firefox) | none on Chrome |
| `offscreen` | required, Chrome only | Clearing the clipboard after the popup closed | none |
| `identity` | required | `launchWebAuthFlow` for SSO (section 8.3) | none |
| Server origin | **optional**, requested at runtime | `optional_host_permissions: ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"]`. The options page requests exactly the one origin the user entered, inside the click handler as both browsers require, and removes the old origin when the server changes | "Access your data on <host>" |

**Not requested.** `<all_urls>` or any other host permission, `tabs` (`activeTab` already gives the active tab's URL), `webRequest`, `declarativeNetRequest`, `cookies`, `clipboardRead` (see decision Q4), `externally_connectable`, `web_accessible_resources`, and declared `content_scripts`.

**CSP.** `content_security_policy.extension_pages = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"`. There is no remote code, no `eval` and no inline script, and everything is bundled. A test asserts the built manifest's CSP and permission lists.

---

## 5. State and storage

### 5.1 Where each value lives

| Value | Location | Lifetime |
|---|---|---|
| Server URL, auto-lock minutes, theme, per-site UI state | `storage.local` | Until changed or sign out |
| Session token | `storage.local` | Until logout, sign out, server expiry or revocation |
| Vault key (base64), username, KDF params and salt for the unlock screen | `storage.session` | Until lock or browser close |
| Decrypted meta list | Background memory only, rebuilt on demand | Gone when the background unloads |
| Decrypted secret | Popup memory only, for one reveal, copy or fill | Cleared after 30 s, on hide, on view change and on lock |

### 5.2 Vault key in `storage.session`

The background unloads when idle (Chrome after about 30 s, Firefox event pages similarly), so module variables are lost. `storage.session` is in memory, never on disk, and cleared when the browser closes or the extension reloads or updates.

- **Chrome.** The default access level is trusted contexts only. We still call `storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })` at startup, so the intent is explicit.
- **Firefox.** `setAccessLevel` is not implemented. Session storage is not exposed to content scripts at all, because the opt-in that would expose it is the unimplemented part (Bugzilla 1823717 and 1724754), and the `onChanged` leak to content scripts was fixed in 115 (1842009). We call `setAccessLevel` only when it exists.
- **Lock** removes the key and the cached state with `storage.session.clear()` and drops the in-memory meta list.
- Only the background reads the key. The popup asks the background to decrypt.

### 5.3 Token in `storage.local`, the trade-off

Keeping the token means a browser restart lands on Unlock (master password only) instead of Login (server, username, password). The cost is E4. A copied profile yields a locked session token, which can list ciphertext and delete entries until it expires (server idle 30 min, absolute 12 h by default) or is revoked from Settings > Sessions. It gives no route to the vault key. Users who prefer otherwise can turn on "Forget session when the browser closes" in options, which keeps the token in `storage.session` instead.

### 5.4 Auto-lock

- `alarms` fire at the configured timeout (1, 5, 15 or 30 minutes, default 5, same choices as web). Activity in the popup re-arms the alarm. Chrome's minimum alarm granularity of 30 s is fine for minute-based timeouts.
- `idle.setDetectionInterval(60)`. `onStateChanged` with `locked` locks immediately. `idle` locks when the configured timeout is shorter than the detection interval. Firefox documents the same states. Whether `locked` fires on every Firefox platform is not documented, so it is tested manually.
- Browser close clears `storage.session`, and an extension update or reload does the same.
- On every background start we check that an unlocked state has not outlived its deadline (stored next to the key), because alarms may be lost while the background is unloaded.

---

## 6. Fill

### 6.1 Flow

1. The user clicks **Fill** in the popup, or **Fill with Zaltys** in the context menu on an editable field. Both are user gestures that grant `activeTab` for that tab. Nothing ever fills on page load.
2. The background reads the tab URL and refuses unless it is `https:`. The only exceptions are `http://localhost` and `http://127.0.0.1`, behind an explicit options toggle for development, off by default.
3. **Probe.** The background injects a probe function into the top frame only (`frameIds: [0]`, never `allFrames`). The probe returns the document's `location.origin`, whether a password field exists, and for each candidate form its fields' visibility and the form action URL. It returns no page content beyond that.
4. **Decide**, in the background. Origin must still match the credential (section 6.2). Fields must be visible (non-zero size, not `display:none`, not `visibility:hidden`, opacity above 0, inside the viewport's scrollable area, not `aria-hidden`, not disabled or read-only). If the form action posts to a different registrable domain, the popup shows a warning and the user must confirm.
5. **Fill.** The background decrypts the secret, then injects the fill function with `args: [{ expectedOrigin, username, password, fieldHints }]`. The function first compares `location.origin` to `expectedOrigin` and does nothing on mismatch, which closes the window where the page navigated between probe and fill. It sets values through the native value setter, dispatches `input` and `change` events, and returns `filled` or a refusal reason.
6. The decrypted password string is dropped after the call.

**Multi-step logins** (username page, then password page). The probe reports which fields exist, and the fill function fills what is present. The user clicks Fill again on the second page.

**Never filled.** Cross-origin iframes (we inject the top frame only, so same-origin iframes are also skipped in v1), hidden or zero-size fields, `http` pages, pages whose origin changed, and `about:`, `chrome:`, `moz-extension:` or store pages (the browsers refuse those anyway).

### 6.2 URL matching

- The registrable domain is computed with `tldts` 7.4.19, which bundles the Public Suffix List including private suffixes (`github.io`, `co.uk`, `blogspot.com`), so `alice.github.io` never matches `bob.github.io`.
- Match levels, highest first. **Exact host** (`login.example.com` with `login.example.com`), then **same registrable domain** (`login.example.com` with `www.example.com`). The scheme must be https on both sides. Ports must match when the credential states one.
- A credential can be set to **exact host only**, stored as the optional meta key `"match": "host"` (absent means domain). Web and mobile ignore unknown meta keys already (SPEC 3.6), so this is forward compatible. SPEC 3.6 gains the key.
- IP addresses and `localhost` match by exact host only.
- The popup lists exact matches first, then domain matches, then the full searchable list.

---

## 7. Messaging, clipboard, SSO

### 7.1 Message protocol

All messages go popup or options to background with `runtime.sendMessage`. The background answers with `{ ok: true, data }` or `{ ok: false, error: <slug> }`.

**Sender checks on every message.** `sender.id === runtime.id`, and the sender's URL starts with `runtime.getURL('/')`. That second check rejects content scripts, which carry the page URL. Messages that change state must also come from `popup.html` or `options.html` specifically. There is no `onMessageExternal` and no `onConnectExternal`.

**Schema.** A discriminated union validated by a hand-written validator per type. Unknown `type`, unknown fields, wrong field types and oversize strings are rejected. Types in v1:

| Type | Payload | Returns |
|---|---|---|
| `state.get` | none | `{status, username?, serverUrl?, oidcEnabled}` |
| `auth.login` | `{username, password}` | `{status}` |
| `auth.unlock` | `{password}` | `{status}` |
| `auth.sso` | none | `{status}` or `{pending, suggestedUsername}` |
| `auth.register` | `{username, password}` | `{status}` (SSO first sign-in only) |
| `auth.lock`, `auth.logout` | none | `{status}` |
| `vault.list` | `{tabId?}` | Matches for that tab plus all metas (no secrets) |
| `vault.reveal` | `{id, field: 'password' or 'totp'}` | The value, for display or copy in the popup |
| `vault.create` | `{name, url, username, password, mfaSecret?, match?}` | `{id}` |
| `vault.delete` | `{id}` | none |
| `fill.request` | `{tabId, id, confirmCrossDomain?}` | `filled` or a refusal or warning reason |
| `settings.get`, `settings.set` | Typed settings object | Settings |
| `server.set` | `{url}` (permission already granted by the options page) | `{oidcEnabled, registrationEnabled}` |
| `activity` | none | Re-arms auto-lock |

Content scripts get no message type at all. In particular there is no generic "decrypt" or "get credential by id" reachable from a page.

**Passwords in messages.** The master password travels popup to background once per login or unlock inside the extension's own process boundary. Messages are never logged.

### 7.2 Server access

- `fetch` from the background only, with `credentials: 'omit'`, so no browser cookie for the server is ever attached. Headers are `Authorization: Bearer`, `X-R16a-Request: 1` and a JSON body. No CORS is involved, because host permission lets extension contexts read cross-origin responses.
- The server URL must be `https://`, except `http://localhost` and `http://127.0.0.1` for development. Validation reuses the mobile rules.

### 7.3 Clipboard

- **Copy** happens in the popup with `navigator.clipboard.writeText`. The popup is a focused document, so this works on both browsers without extra permission.
- **Clear after 30 s.** The popup registers an alarm in the background with a hash of the copied value. When it fires:
  - **Chrome.** The background creates the offscreen document (reason `CLIPBOARD`). It writes an empty string with `document.execCommand('copy')` on a textarea, because sources disagree on whether `navigator.clipboard` works in an unfocused offscreen document. Both are tried and the working one is recorded in the first build step.
  - **Firefox.** The event page clears directly. MDN warns that background clipboard writes may fail in Firefox, so this is verified early. If it fails, the clear runs the next time any extension page is open, and on lock. Firefox users are told about this in the README.
- **Compare before clearing.** Clearing only when the clipboard still holds our value needs `clipboardRead`, which shows a warning that the extension can read clipboard data. See decision Q4. Without it, we clear unconditionally after 30 s, the same fallback the web app uses when reading is refused (SPEC D14).
- Lock clears a pending copy immediately.

### 7.4 SSO

- The popup triggers `auth.sso`. The background generates a PKCE-style verifier, computes `redirect = identity.getRedirectURL('oidc')` (Chrome `https://<extension-id>.chromiumapp.org/oidc`, Firefox `https://<id-derived-subdomain>.extensions.allizom.org/oidc`), and calls `identity.launchWebAuthFlow({ url: <server>/api/v1/auth/oidc/start?client=extension&challenge=…&redirect=<redirect>, interactive: true })`.
- The browser captures the final redirect to that URL, which no website can serve, and returns it to the extension that launched the flow. The background calls `POST /auth/oidc/exchange {code, verifier}`, exactly as mobile does.
- The backend accepts a `redirect` only if it is exactly one of the configured extension redirect URLs (section 8.3), so a flow cannot be pointed at an attacker URL.

---

## 8. Backend changes

### 8.1 Client kind `extension`

`ClientKind` gains `Extension` (`"extension"`). Login, register, unlock and OIDC exchange treat it like `mobile`, so the token is returned in the body and no cookie is set. Migration `0004` widens the `oidc_flows.client` check to include `extension`.

### 8.2 Session client column

Migration `0004` also adds `sessions.client text null check (client in ('web','mobile','extension'))`. It is set on session creation, and existing rows stay null and are shown as before. `GET /me/sessions` returns `client`. The web and mobile session lists show "Zaltys extension on Chrome" (browser from the user agent) and can revoke it. Extension `fetch` cannot set its own `User-Agent`, which is why the client must be stored explicitly.

### 8.3 OIDC for the extension

- `/auth/oidc/start?client=extension&challenge=<S256>&redirect=<url>`. The redirect must equal one entry of the new config `R16A_OIDC_EXTENSION_REDIRECTS` (comma separated, exact URLs, empty by default, which disables extension SSO). Each value must be `https://<32 a-p chars>.chromiumapp.org/oidc` or `https://<subdomain>.extensions.allizom.org/oidc`.
- The callback redirects to that URL with the one-time code, which is single use, valid 60 s and bound to the challenge as for mobile. Exchange is unchanged.

### 8.4 CSRF and extension origins

Background POSTs carry `Origin: chrome-extension://<id>` on Chrome and `Origin: moz-extension://<uuid>` on Firefox, where the UUID is random **per install**. `Sec-Fetch-Site` is not `same-origin` either. Today's CSRF layer would reject prelogin, login and register from the extension. Bearer requests are already exempt, so the rest of the API is unaffected.

**Proposed rule.** A request without a bearer token passes the CSRF layer when **all** of these hold:
- `X-R16a-Request: 1` is present. A web page can never send a custom header cross-origin, because the server answers no preflight.
- **No** session cookie is present.
- `Origin` is a well formed extension origin (`chrome-extension://` plus 32 letters a to p, or `moz-extension://` plus a UUID). When the optional `R16A_EXTENSION_ORIGINS` is set, it must also be listed there. Decision 029 replaced the original listed-only rule (024), because store installs on Firefox each have their own origin.

Under these conditions the request carries no ambient authority, so there is nothing to forge. The cookie condition keeps the rule from ever weakening web cookie sessions. See decision Q3 for the Firefox per-install UUID.

No CORS headers are added. None are needed (section 7.2), and there is no wildcard anywhere.

### 8.5 Tests

These are integration tests, with `sqlx::test`.
- `client=extension` login and register return a token and set no cookie. Unlock with bearer rotates and returns the token.
- CSRF accepts a well formed extension origin without a cookie, and rejects it when a session cookie is present, when the origin is malformed or not an extension origin, when the custom header is missing, and when a configured list does not include it.
- OIDC start rejects unconfigured, malformed and http redirects, and accepts a configured one. The exchange works for an extension flow.
- `/me/sessions` reports `client`.
- Migration `0004` runs on PostgreSQL 15 (CI) and 18 (dev).

### 8.6 Config added

`R16A_EXTENSION_ORIGINS` and `R16A_OIDC_EXTENSION_REDIRECTS`. Both are lists of exact values with no wildcards, and both are documented in the README config table.

---

## 9. Repository layout and tooling

### 9.1 Folders

```
package.json            npm workspace root (web, extension, packages/*)
packages/vault-core/    shared crypto, TOTP, generator, URL matching, vector tests
packages/design-tokens/ tokens.css (HSL scales and semantic tokens) shared by web and extension
extension/
  wxt.config.ts         manifest per browser, permissions, CSP
  src/entrypoints/      background.ts, popup/, options/, offscreen/
  src/background/       api client, session, auto-lock, fill decision, messaging router
  src/fill/             probe and fill functions (self-contained, injected with func)
  src/ui/               DOM helper, components, views
  src/messages/         schema and validators
  test/                 Vitest unit tests, fixtures/ (HTML pages), e2e/ (Playwright)
  CLAUDE.md  README.md
```

### 9.2 Design tokens

`web/src/styles.css` keeps component styles but `@import`s `packages/design-tokens/tokens.css`. The tokens move without change, and web's look is untouched. The extension imports the same file. The popup is 360 px wide, which matches web's narrowest supported viewport.

### 9.3 Commands (to be verified when built)

`npm run build:chrome`, `build:firefox` (unpacked output), `zip:chrome`, `zip:firefox` (store packages plus the AMO sources zip), `test` (Vitest), `test:e2e` (Playwright, Chromium), `lint`. Nothing is published to any store.

### 9.4 Testing

- **vault-core.** Shared vectors (moved from web), TOTP vectors, generator statistics, and URL matching including `co.uk`, `github.io`, IP hosts, ports, punycode and an uppercase host.
- **Extension unit tests.** Message validation (unknown types, extra fields, wrong senders), fill target selection over fixture DOMs in happy-dom, the origin re-check, manifest permissions and CSP.
- **Fixture pages** in `extension/test/fixtures/` covering normal login, multi-step login, cross-origin iframe, hidden field trap, a form posting cross-domain, and an http page. The manual run is documented in `extension/README.md`.
- **Playwright** for Chromium, using `launchPersistentContext` with `--load-extension`. Headless works only with Playwright's bundled `chromium` channel, so the e2e suite uses that channel. Firefox e2e is not set up in v1, and Firefox is tested manually with `web-ext run`.

---

## 10. Future features, kept possible

- **Inline field icons.** Needs a declared content script (or `registerContentScripts`) on the user's origins and a narrow content-script-to-background message carrying only "user clicked icon in field X". It also needs a separate threat review, because it adds a channel from pages to the background.
- **Save submitted logins.** Same content script, plus a message carrying a candidate username and password from page to background. This is high risk, because pages could spam it, so it needs a review.
- **Passkeys.** WebAuthn provider APIs are still browser-specific and are left out until they are stable on both.
- **Edit credential.** Shares the gap with web and mobile.

---

## 11. Deviations from your brief

| # | Deviation | Reason |
|---|---|---|
| X1 | "Origin" for CSRF, not CORS. No CORS config is added. | Host permissions make CORS irrelevant for extension fetches. What blocks the extension is the CSRF Origin check, and section 8.4 handles it with an explicit list. |
| X2 | The content script never messages the background in v1. The fill uses two `executeScript` calls whose results come back as return values. | Removes the whole content-script message channel. That is stronger than validating such messages, and the sender-tab check from your brief becomes moot. |
| X3 | No declared content scripts. `activeTab` plus `scripting` only. | As your brief prefers. Inline icons in v2 would change this. |
| X4 | Top frame only, so same-origin iframes are not filled either. | Simpler and safer for v1. Can be widened later to same-origin frames. |
| X5 | Firefox clipboard clearing after the popup closes may be best effort. | MDN documents that background clipboard writes can fail in Firefox. |
| X6 | Firefox e2e tests are manual in v1. | Playwright does not load Firefox extensions. `web-ext` covers manual runs. |
| X7 | Optional "forget session when the browser closes" setting. | Gives users who care about E4 a choice, at no cost. |
| X8 | Design tokens extracted to `packages/design-tokens`. | "Same design tokens as web" without copying them. |

---

## 12. Decisions needed from you

- **Q1. Build tool.** WXT (recommended, section 3.3) or plain Vite.
- **Q2. npm workspace at the repo root.** It is needed for a single shared libsodium copy (section 3.5) and changes web's install, lockfile, Dockerfile and CI. The alternative is a TypeScript path alias without a workspace, which needs every consumer to resolve `libsodium-wrappers-sumo` and `otpauth` itself and is fragile. Recommended workspace.
- **Q3. Firefox origin for CSRF.** The Firefox origin UUID is random per install, so an explicit allowlist means each Firefox user's origin (shown on the options page) must be added to `R16A_EXTENSION_ORIGINS` by the operator.
  - **(a) Explicit list for both browsers.** Recommended for a personal or family server.
  - **(b) Explicit list for Chrome, plus any `moz-extension://` origin on cookie-less requests that carry the custom header.** Security argument as in 8.4, but broader.
  - **(c)** Both behaviours, with (b) behind its own config flag.
  - *Outcome.* (a) was chosen first, then replaced before store publishing by any well formed extension origin for both browsers, with the list as an optional restriction (decision 029).
- **Q4. `clipboardRead`.**
  - **(a)** Do not request it, and clear unconditionally after 30 s (same as web's fallback). Recommended.
  - **(b)** Request it as an optional permission behind an options toggle, to clear only our own value.
- **Q5.** Confirm that the minimum browsers are Chrome 121 and Firefox 128 ESR.

---

## 13. Verification notes (checked 2026-11-10)

- Firefox does not support `background.service_worker` and runs `background.scripts` as an event page. Both keys may coexist from Chrome 121 and Firefox 121. [MDN background](https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background), [Mozilla add-ons blog](https://blog.mozilla.org/addons/?p=9038).
- Firefox `storage.session.setAccessLevel` is not implemented, and session storage is not exposed to content scripts. [Bugzilla 1823717](https://bugzilla.mozilla.org/show_bug.cgi?id=1823717), [1724754](https://bugzilla.mozilla.org/show_bug.cgi?id=1724754), [1842009](https://bugzilla.mozilla.org/show_bug.cgi?id=1842009), [MDN setAccessLevel](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/StorageArea/setAccessLevel).
- Redirect URLs are `https://<id>.chromiumapp.org/*` on Chrome and on Firefox `getRedirectURL()` on `extensions.allizom.org`. Firefox 75 and later requires the value returned by `getRedirectURL()`. [Chrome identity](https://developer.chrome.com/docs/extensions/reference/api/identity), [MDN identity](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/identity).
- Extension POSTs carry an extension `Origin`, and Firefox does so too. [Chromium extensions group](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/AlpwfYIy25A), [Mozilla Discourse](https://discourse.mozilla.org/t/choosing-origin-header-from-background-script/129856), [Chrome cross-origin requests](https://developer.chrome.com/docs/extensions/mv3/xhr). To be confirmed with real requests in step 3.
- `offscreen` exists on Chrome only. Clipboard access from it is contested between sources, and Firefox background clipboard writes may fail. [Chrome offscreen blog](https://developer.chrome.com/blog/Offscreen-Documents-in-Manifest-v3?hl=en), [extension.js guide](https://extension.js.org/docs/implementation-guide/offscreen-documents), [MDN clipboard](https://developer.mozilla.org/Add-ons/WebExtensions/Interact_with_the_clipboard).
- `permissions.request` must run inside a user gesture on both browsers, and Firefox MV3 host permissions are opt-in. [Chrome permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions), [Mozilla Discourse](https://discourse.mozilla.org/t/request-permissions-at-install-time-manifest-v3/121543).
- `activeTab` is granted on toolbar and context menu gestures in Firefox MV3 as in Chrome, and `scripting` is still required. [MDN activeTab](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/activeTab_permission).
- `idle.onStateChanged` reports `active`, `idle` and `locked` on both browsers, with a default interval of 60 s. [Chrome idle](https://developer.chrome.com/docs/extensions/reference/api/idle?hl=en), [MDN onStateChanged](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/idle/onStateChanged).
- Playwright loads Chromium extensions through `launchPersistentContext`, headless only on the bundled `chromium` channel. [Playwright docs](https://playwright.dev/docs/chrome-extensions).
- Package versions from the npm registry on 2026-11-10. `wxt` 0.21.5, `vite` 8.3.7, `tldts` 7.4.19, `libsodium-wrappers-sumo` 0.8.4 (same as web), `otpauth` 9.6.0, `@playwright/test` 1.65.0, `web-ext` 10.8.0, `vitest` 5.1.0. TypeScript stays on 6.0.x to match web (SPEC D12).

---

## 14. Implementation notes (2026-11-10)

What changed or was learnt while building, beyond the approved text.

| # | Note |
|---|---|
| N1 | Firefox minimum raised to 140 (Android 142). `browser_specific_settings.gecko.data_collection_permissions` exists only from those versions and `web-ext lint` flags lower minimums. Declared value `authenticationInfo`, to be reviewed before any submission. |
| N2 | The fill function treats a field as visible only from 8 by 8 px and rejects fields inside collapsed `overflow: hidden` ancestors. The live browser test found that a `width: 0` input still has a few pixels of padding and border, which jsdom does not model. |
| N3 | `isTrustedSender` compares the sender URL as a string against `runtime.getURL('/')`. `URL.origin` is opaque `null` for extension schemes in some environments, which would make every extension page look alike. Found by the unit test. |
| N4 | The cross-site form confirmation is an inline bar, because Firefox popups cannot show `confirm()`. |
| N5 | Beyond section 3.5, `vault-core` also took the credential codec (meta and secret shapes, seal and open), URL normalisation, wordlist parsing and the master password minimum, so web and the extension share them too. |
| N6 | Clipboard clearing through the offscreen document is verified in Chromium by an automated test. On Firefox it is untested and may be refused (section 7.3). A failed clear is retried on lock. |
| N7 | Firefox is verified only by `web-ext lint` (no errors or warnings) and a headless install into Firefox 153 ESR. The popup, fill and SSO flows on Firefox still need a manual run (extension/README.md). |
| N8 | Extension SSO (section 7.4) is covered by backend integration tests with an in-process identity provider. It has not been run against a real identity provider from the extension. |
| N9 | End to end tests use a separate `--mode e2e` build that is granted `http://localhost` up front, because automation cannot accept the permission prompt. Release builds never carry it, and `test/manifest.test.ts` asserts that. |

