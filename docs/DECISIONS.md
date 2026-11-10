# Decisions

A short log of significant design decisions for Zaltys and why they were made. `docs/SPEC.md` holds the full detail. References like D1, A3 and R7 point to its section 11 tables. Add a new entry for every new decision, and mark replaced entries as superseded instead of deleting them.

### 001 Zero-knowledge key hierarchy
2026-11-08 · accepted
Context: The server must store credentials without being able to read them, even if it is compromised (SPEC 2.2).
Decision: Clients stretch the master password with Argon2id into `master_key`, derive `auth_key` and `wrap_key` from it, and wrap a random `vault_key` that encrypts every credential (SPEC 3.3). Only `auth_key` and ciphertext reach the server.
Consequences: A database or operator compromise yields only ciphertext and an offline guessing target that costs one client Argon2id per guess. Lost master passwords cannot be recovered, and a modified web bundle can still steal the password (accepted, A3 in SPEC 2.2).

### 002 Separate meta and secret blobs per credential
2026-11-08 · accepted
Context: The list needs name, URL and username, while passwords and TOTP secrets should stay sealed until needed.
Decision: Each credential stores a meta blob (name, url, username, optional `hasTotp`) and a secret blob (password, mfaSecret), sealed independently (SPEC 3.6, D24).
Consequences: Listing and search never decrypt passwords, and secrets live in memory only while shown. The server sees two blob sizes per row, which leaks rough lengths (SPEC 2.4).

### 003 AAD binds every blob to its row and field
2026-11-08 · accepted
Context: A malicious server could swap blobs between rows or between the meta and secret fields.
Decision: AAD is `r16a-vault:cred:v1:{id}:meta` or `:secret`, and `r16a-vault:vk:v1` for the wrapped vault key (SPEC 3.5).
Consequences: Swaps and moves fail decryption and show as "could not be decrypted". Rollback of a row to an older version of itself is still possible (SPEC 2.4).

### 004 `/auth/unlock` endpoint
2026-11-08 · accepted (D1)
Context: Unlocking needs `wrappedVaultKey`. Returning it from `/me` would let a stolen locked session run an unlimited offline attack.
Decision: `wrappedVaultKey` is returned only by login and `POST /auth/unlock`, both of which require an `authKey` proof under the same throttle.
Consequences: A stolen session can list ciphertext but cannot attack the master password offline. OIDC gets a single upgrade path from `pre_auth`.

### 005 Client-side KDF floor and ceiling
2026-11-08 · accepted (D5)
Context: KDF parameters come from the server at prelogin, so a hostile server could weaken or inflate them.
Decision: Clients refuse parameters below opslimit 3 and 64 MiB, and above opslimit 10 and 1 GiB.
Consequences: No silent downgrade and no device DoS. Raising the floor later requires migrating accounts through change master password.

### 006 Lighter server-side Argon2
2026-11-08 · accepted (D6)
Context: The server hashes `auth_key`, which is already a uniformly random 256-bit key.
Decision: Server Argon2id uses m 19 MiB, t 2, p 1 with an optional pepper, behind a semaphore that refuses with 429 after a 2 s wait (SPEC 4.3, 4.7, R2).
Consequences: The hash still blocks replay of a stolen `auth_hash` without making login a memory DoS lever. Stored as PHC, so the parameters can be raised with rehash on login.

### 007 `login_throttle` keyed by HMAC
2026-11-08 · accepted (D2, A1, D20, R1)
Context: Per-account backoff must hold across replicas without storing usernames or IPs, and must not let a stranger lock out a known user.
Decision: A database table keyed by labelled HMACs of the server secret, with source, account and session buckets, each claimed atomically before Argon2 (SPEC 4.7).
Consequences: Global, enumeration-safe throttling with no permanent lockout. The cost is one extra upsert per proof and a cleanup task.

### 008 Client-generated UUIDv4 credential ids
2026-11-08 · accepted (D9, R7)
Context: The id must exist before encryption, because it is part of the AAD.
Decision: Clients generate a UUIDv4 with the CSPRNG. The primary key is `(user_id, id)` and creation is serialised per user for the quota.
Consequences: No creation time leaks through the id, and a duplicate id in another account reveals nothing. Ids are unique per owner only.

### 009 Per-request CSP nonce for styles and the import map
2026-11-08 · accepted (D13, A3)
Context: Angular injects component styles at runtime and emits an inline import map, and `'unsafe-inline'` is not acceptable.
Decision: nginx generates a nonce per response, puts it in the CSP header and in `ngCspNonce` through `sub_filter`. `index.html` is `no-store` and critical CSS inlining is off (SPEC 8.3).
Consequences: Strict CSP with Trusted Types works. `index.html` cannot be cached, and any inline-loading feature has to fit the nonce.

### 010 Session token rotation on login and unlock
2026-11-08 · accepted (A4)
Context: A token observed while locked or before login should not survive the next proof.
Decision: A new token is issued on login and on every successful unlock. Logout-all deletes every session including `pre_auth` ones (SPEC 4.6).
Consequences: Fixation and pre-unlock token theft stop working after the next unlock. Clients must accept a token from the unlock response.

### 011 OIDC still requires the master password
2026-11-08 · accepted (D11)
Context: Single sign-on proves identity, but the identity provider never has the key to the vault.
Decision: OIDC sign-in creates only a `pre_auth` session, and the user unlocks with the master password, or registers one on first sign-in. Linking is by issuer and subject, never email (SPEC 4.10).
Consequences: Zero knowledge holds with SSO. Users still need their master password on every unlock, and SSO alone never opens a vault.

### 012 Separate migration role
2026-11-08 · accepted (D10, R4)
Context: The runtime role should not be able to alter or drop the schema.
Decision: A `migrate` subcommand runs as the schema owner. The server connects as an app role that owns nothing. In Kubernetes, only the init container receives the owner URL (SPEC 6.1).
Consequences: A compromised server process cannot change the schema. Deployments need two database roles and two URLs.

### 013 Kubernetes Pod Security Admission restricted
2026-11-08 · superseded by 015 (D29)
Context: Hardening should be enforced by the API server, not only by the manifests.
Decision: The namespace manifest enforced PSA `restricted`.
Consequences: Removed with the namespace manifest when the Kubernetes setup was simplified. The hardening itself stays in each Deployment.

### 014 Verified https links for the mobile OIDC callback
2026-11-09 · accepted (R12)
Context: Any app can register a custom URL scheme, start a flow with its own verifier, and receive the code if the identity provider signs the user in silently.
Decision: The callback is `https://<public host>/app/oidc-callback`, claimed through Android App Links and iOS associated domains. The backend refuses non-https or foreign-origin mobile redirects.
Consequences: Only the genuine app receives codes. SSO needs iOS 17.4 or later, a build-time host, and the signing-key fingerprints served by the web container.

### 015 Minimal Kubernetes manifests in the cluster's house style
2026-11-09 · accepted
Context: The first manifest set (kustomize, SOPS, NetworkPolicy, PSA namespace, migration Job) did not match the other r16a apps and was hard to operate.
Decision: One Deployment and Service per image plus one Ingress, a Secret created by hand on the cluster, migrations in an init container, and no NetworkPolicy (SPEC 13, R5).
Consequences: Simple to operate and consistent with the cluster. In-cluster and LAN peers can spoof `X-Forwarded-For` for the per-IP limiter, while per-account throttling still applies.

### 016 `gen_random_uuid()` instead of `uuidv7()`
2026-11-09 · accepted
Context: The shared production database is PostgreSQL 15, and `uuidv7()` exists only from 18.
Decision: `users.id` and `sessions.id` default to `gen_random_uuid()`, built in since PostgreSQL 13. CI tests run on `postgres:15`.
Consequences: Works on the shared server. Ids lose time ordering, which nothing depended on.

### 017 No CORS, CSRF via header and Origin
2026-11-08 · accepted (D17)
Context: Web and API share one origin, and the web client authenticates with a cookie.
Decision: The API emits no CORS headers. Cookie requests that change state need `X-R16a-Request: 1` and a matching `Origin`. Bearer requests skip both checks (SPEC 4.8).
Consequences: No cross-origin surface. Serving the web app from another origin would need a new decision.

### 018 Web clipboard clears unconditionally when reading is denied
2026-11-08 · accepted (D14, A5, R8)
Context: Browsers often refuse `clipboard.readText()`, so the client cannot tell whether the clipboard still holds its secret.
Decision: After 30 s the clipboard is overwritten anyway, retried on focus, and cleared on lock. The toast says it will be cleared.
Consequences: Secrets do not linger. Something the user copied later may be wiped.

### 019 npm workspace and shared `vault-core` package
2026-11-10 · accepted
Context: The browser extension needs the same client crypto, TOTP, generator and URL rules as the web app. A second copy would drift, and two installs of libsodium would bloat both apps.
Decision: The repo root is an npm workspace (`packages/*`, `web`, `extension`) with one lockfile. `packages/vault-core` holds the framework-free protocol, credential codec, TOTP, generator, URL normalisation and URL matching, tested against `shared/crypto-test-vectors.json`. Web keeps only its Angular wrappers.
Consequences: One implementation for both clients, with web's dependency versions unchanged. Installs run from the root, `web/package-lock.json` is gone, and the web Dockerfile copies every workspace manifest and installs `--workspace web` only. The package is marked side-effect free, so web's initial bundle stays the same.

### 020 Design tokens as a shared package
2026-11-10 · accepted
Context: The extension must look like the web app without copying its colour system.
Decision: The token part of `web/src/styles.css` moved unchanged to `packages/design-tokens/tokens.css`, which both apps load.
Consequences: One place to change colours and contrast. Component styles stay per app.

### 021 WXT for the browser extension
2026-11-10 · accepted
Context: One codebase has to produce correct Manifest V3 builds for Chromium (service worker) and Firefox (event page), plus store zips and the Firefox sources zip.
Decision: WXT 0.21.5 pinned exactly, auto imports off. A unit test asserts the generated permission set and CSP, so an upgrade cannot widen them silently (EXTENSION_SPEC 3.3).
Consequences: Browser differences and packaging come for free. WXT is pre 1.0 and adds about 90 build-time packages. Nothing from it ships except a thin `browser` wrapper.

### 022 Extension trust zones and the two-step fill
2026-11-10 · accepted
Context: Content scripts run inside hostile pages. Validating messages from them would still leave a channel from pages to the vault.
Decision: There are no content scripts and no messages from pages. On a click, one self-contained function is injected into the top frame twice. A probe without secrets comes first. Then the background decides, and a fill function receives one username and password plus the origin the page must still be on. Only https pages are filled, with the localhost exception off by default. Hidden or tiny fields, frames, and changed origins are refused, and cross-site form actions need confirmation (EXTENSION_SPEC 6).
Consequences: A compromised page can at most read what was filled into it. Same-origin iframes and inline field icons are left for later, and the inline icons would need a reviewed content-script channel.

### 023 Vault key in `storage.session`, token in `storage.local`
2026-11-10 · accepted
Context: MV3 backgrounds unload when idle, so module variables cannot hold the key, and users expect a browser restart to ask only for the master password.
Decision: The base64 vault key and its lock deadline live in `storage.session`, in memory and restricted to trusted contexts. The bearer token lives in `storage.local`, or in session storage when the user turns on "forget on close" (EXTENSION_SPEC 5).
Consequences: Restart lands on Unlock. A copied browser profile yields a locked session token (the A9 position), which is revocable from the sessions list and expires with the server's session lifetime.

### 024 CSRF accepts listed extension origins on cookie-less requests
2026-11-10 · superseded by 029
Context: Extension POSTs carry `chrome-extension://<id>` or `moz-extension://<per-install uuid>` as their Origin, which the CSRF layer rejected. The extension needs prelogin, login and register before it holds a token.
Decision: `R16A_EXTENSION_ORIGINS` lists exact extension origins, for both browsers. A request passes the CSRF layer this way only if its origin is listed, it carries `X-R16a-Request: 1`, and it has no session cookie. No CORS headers are added.
Consequences: Web cookie sessions keep their full protection. Each Firefox install must be listed by the operator, because the Firefox origin is random per install.

### 025 Extension single sign-on through the identity API
2026-11-10 · accepted
Context: The extension cannot receive an App Link or a verified https link, but browsers offer a redirect URL that only the launching extension can receive.
Decision: `client=extension` on `/auth/oidc/start` requires a PKCE challenge and a `redirect` equal to an entry of `R16A_OIDC_EXTENSION_REDIRECTS`. The redirect is stored with the flow and checked again at the callback. The one-time code exchange is the same as mobile's.
Consequences: No website can capture the code, and an operator can revoke a redirect even while flows are running. Extension SSO is off until a redirect is configured.

### 026 Sessions record their client kind
2026-11-10 · accepted
Context: Extension fetches cannot set their own User-Agent, so the session list could not name them.
Decision: Migration `0004` adds `sessions.client` (`web`, `mobile`, `extension`, null for older rows). The session list API returns it, and web and mobile show "Zaltys extension on <browser>".
Consequences: Users can recognise and revoke extension sessions. Older sessions still fall back to user agent parsing.

### 027 No `clipboardRead`, unconditional clear after 30 seconds
2026-11-10 · accepted (EXTENSION_SPEC Q4 option a)
Context: Clearing only when the clipboard still holds our value needs `clipboardRead`, which shows a warning that the extension can read clipboard data.
Decision: The extension doesn't request `clipboardRead`. The popup copies, and the background clears unconditionally 30 seconds later, through an offscreen document on Chromium and directly on Firefox.
Consequences: Same trade-off as the web fallback (SPEC D14). Clearing is verified in Chromium; on Firefox it may be refused and is then retried on lock.

### 028 Firefox minimum 140 instead of 128
2026-11-10 · accepted, amends EXTENSION_SPEC Q5
Context: New Firefox add-ons must declare `data_collection_permissions`, a key Firefox supports only from 140 (142 on Android). `web-ext lint` flags any lower minimum.
Decision: `strict_min_version` 140.0, `gecko_android` 142.0. Chromium stays at 121.
Consequences: Covers the current Firefox ESR. Firefox 128 to 139 users cannot install it.

### 029 CSRF accepts any extension origin on cookie-less requests
2026-11-10 · accepted, supersedes 024
Context: Publishing the extension to the stores made the explicit list unworkable. Firefox gives every install a random origin, so each store user would need adding by hand. A secret built into the extension was considered and rejected, because store packages are public and anyone can read it.
Decision: Without a bearer token, a request passes the CSRF layer by the extension path when its Origin is a well formed `chrome-extension://<32 a-p>` or `moz-extension://<uuid>`, it carries `X-R16a-Request: 1`, and it has no session cookie. `R16A_EXTENSION_ORIGINS` becomes an optional restriction; when set, only listed origins pass.
Consequences: Store installs work on both browsers with no server change. The origin never proved which extension was calling, and a web page still cannot claim an extension origin or send the custom header, so the CSRF guarantee is unchanged. Any installed extension or native script can reach the sign-in API, as any native client already could, and the auth key proof and per-account throttle remain the real gate. Web cookie sessions keep their full protection.

### 030 Email addresses are valid usernames
2026-11-10 · accepted
Context: People expect to sign in with their email address. The old rule allowed only letters, digits, `.`, `_` and `-`, up to 64 characters.
Decision: Usernames may also contain `+` and `@`, up to 254 characters, the SMTP path limit. Normalisation is unchanged (trim, NFC, lowercase), so `Alice@Example.com` and `alice@example.com` are one account. The server never sends mail and does not validate the address format.
Consequences: Existing usernames stay valid. Lowercasing the whole address merges local parts that a mail server might treat as distinct, which is harmless because the address is only an identifier. A username that is an email address is personal data like any other username (OPERATING.md section 2).
