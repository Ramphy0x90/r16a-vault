# r16a-vault specification

Status: **APPROVED 2026-11-08** with amendments A1 to A5 (section 11.1). Kept in sync with the implementation, see section 11.2 for changes made while building.

Date: 2026-11-08

This document is the source of truth for the build. Section 11 lists every place where it deviates from or adds to the original brief, with reasons.

---

## 1. Goals and non-goals

**Goal.** A self-hosted, zero-knowledge credential vault. One account holds many credentials (name, URL, username, password, optional TOTP secret). The server stores only ciphertext it cannot decrypt.

**Clients.** Angular web app (P0), Flutter mobile app (P1). Both use libsodium and share one crypto protocol, enforced by shared test vectors.

**Non-goals for this build.** Sharing between users, organisations, attachments, export, import, browser extension, biometric unlock, account recovery. The design leaves room for export, QR import, biometric unlock and an extension (section 12).

---

## 2. Threat model

### 2.1 Assets

| Asset | Where it lives |
|---|---|
| Credential plaintext (name, URL, username, password, MFA secret) | Client memory only, while unlocked |
| Master password | User's head. Client memory only during derivation |
| `master_key`, `wrap_key` | Client memory only, during derivation. Byte buffers are zeroed right after use |
| `vault_key` | Client memory only, while unlocked. Never persisted |
| `auth_key` | Sent to the server at login. Server stores only an Argon2id hash |
| Session token | Web: HttpOnly cookie. Mobile: platform secure storage. Server stores only SHA-256 |
| Server secrets (DB password, pepper, prelogin HMAC secret, OIDC client secret) | Environment variables / Kubernetes Secret |

### 2.2 Adversaries and what they get

| Adversary | Capability | Outcome by design |
|---|---|---|
| **A1. Database thief** (backup leak, SQL injection elsewhere) | Reads every table | Gets ciphertext, wrapped vault keys, KDF salts, `auth_hash`. To read a vault, they must brute force the master password through client Argon2id (64 MiB, t=3) **and** they cannot verify guesses against `auth_hash` cheaply, because it is Argon2id over a 256-bit key plus a pepper they do not have (if the pepper is configured and not leaked with the DB). Offline guessing against `wrapped_vault_key` costs one client Argon2id per guess. |
| **A2. Malicious or compromised server operator** | Reads and modifies DB and server code at rest | Cannot read credentials. Cannot swap blobs between rows or fields undetected (AAD binding). **Can** delete rows, roll back a row to an older version of the same row (no rollback protection, see 2.4), and see metadata such as row count, blob sizes and timestamps. |
| **A3. Active server attacker serving modified web JS** | Controls what the browser runs | **Wins.** Any web-delivered E2EE app has this property. A modified bundle can exfiltrate the master password. Mitigations: self-hosting, CSP, Subresource Integrity on the bundle. The mobile app is not exposed to this because its code ships through the app store / sideload. Documented as a known limitation. |
| **A4. Network attacker** | Passive or active on the network | TLS required in production (HSTS). Even with TLS stripped, they see only `auth_key` (not the master password) and ciphertext. A captured `auth_key` lets them log in and download ciphertext, which equals A1's position for that user. |
| **A5. Online guesser** | Calls login / unlock | Per-IP rate limit, per-account exponential backoff (global, DB-backed), generic errors, no enumeration through prelogin or login timing. |
| **A6. XSS in the web app** | Runs script in the origin while unlocked | Can read decrypted data in memory. Mitigated by strict CSP (no inline script, no `eval`, only `'wasm-unsafe-eval'`), Trusted Types where libraries allow, Angular's built-in sanitisation, and no `innerHTML` with user data. Session cookie is HttpOnly so it cannot be stolen for later use. |
| **A7. CSRF** | Cross-site form or fetch | `SameSite=Strict` cookie, plus a required `X-R16a-Request: 1` header, plus an `Origin` check on every state-changing request. |
| **A8. Stolen unlocked device / shoulder surfing** | Physical access | Auto-lock on inactivity and on background/hidden, reveal auto-hides after 30 s, clipboard cleared after 30 s, screenshots and the app switcher preview blocked on mobile vault screens. |
| **A9. Stolen locked session** (cookie or bearer token) | Valid session, no master password | Can list ciphertext and delete credentials, but **cannot** obtain `wrapped_vault_key`, which is only returned after an `auth_key` proof (login or unlock). Sensitive operations (change password, sign out everywhere, delete account) also require a fresh `auth_key`. |

### 2.3 Trust assumptions

- The client platform (OS, browser, libsodium build) is not compromised.
- libsodium, RustCrypto `argon2`, `hmac`, `sha2` and `rustls` are correct.
- In production, the operator configures HTTPS and the web bundle is served unmodified.

### 2.4 Accepted residual risks (documented in README)

- **No rollback or deletion protection.** The server can replay an older ciphertext of the *same* row or drop rows. Fixing this needs a signed vault manifest. Out of scope.
- **Metadata leakage.** The server sees the number of credentials, approximate blob sizes (so roughly the length of names and passwords), timestamps, IPs and user agents.
- **Memory hygiene.** JavaScript and Dart strings are immutable and garbage collected, so plaintext strings cannot be reliably zeroed. We zero every `Uint8Array` / `Uint8List` / libsodium `SecureKey` we own, drop references quickly, and keep secret blobs encrypted until needed. This is best effort, not a guarantee.
- **Username enumeration via registration.** `POST /auth/register` must say "username taken". This is rate limited. Admins can disable open registration (`R16A_REGISTRATION_ENABLED=false`).
- **Prelogin KDF params.** Unknown users get default params. If an operator later raises defaults, accounts with old params become distinguishable from unknown ones. Acceptable.
- **Clipboard on web.** Browsers may refuse `navigator.clipboard.readText()`. If we cannot read the clipboard to compare, we overwrite it with an empty string after 30 s anyway, which may clobber something the user copied later. Clipboard managers on the OS may retain copies regardless.
- **Web delivery (A3).**

---

## 3. Cryptographic design

All vault crypto runs on the client with libsodium. The server never sees `master_key`, `wrap_key`, `vault_key` or any plaintext credential field.

### 3.1 Libraries (verified 2026-11-08)

| Client | Library | Version |
|---|---|---|
| Web | `libsodium-wrappers-sumo` (sumo needed for `crypto_pwhash`) | 0.8.4 |
| Flutter | `sodium` (the successor of the now deprecated `sodium_libs`, see 11.2) | 4.0.4 |
| Server | RustCrypto `argon2` | 0.6.0 |
| Server | `hmac` + `sha2` | 0.13.0 / 0.11.1 |
| Server | `subtle` | 2.6.1 |

### 3.2 Primitives

| Purpose | Primitive | Parameters |
|---|---|---|
| Password stretching | `crypto_pwhash`, `ALG_ARGON2ID13` | opslimit 3, memlimit 67 108 864 (64 MiB), salt 16 B, output 32 B |
| Subkeys | `crypto_kdf_derive_from_key` (BLAKE2b) | 32 B output, contexts `r16aauth` (id 1) and `r16awrap` (id 2) |
| AEAD | `crypto_aead_xchacha20poly1305_ietf` | random 24 B nonce per encryption |
| Randomness | `randombytes_buf` | none |
| TOTP HMAC | via `otpauth` (web) / `otp` (Flutter) | RFC 6238 |

### 3.3 Key hierarchy

```
master_password (UTF-8, NFC-normalised, not trimmed)
  + kdf_salt (16 B random, per user, stored server side)
  --crypto_pwhash Argon2id13 (opslimit, memlimit from user record)-->  master_key (32 B)

master_key --crypto_kdf_derive_from_key(id=1, ctx="r16aauth")-->  auth_key (32 B)
master_key --crypto_kdf_derive_from_key(id=2, ctx="r16awrap")-->  wrap_key (32 B)

vault_key = randombytes_buf(32)                     (once, at registration)
wrapped_vault_key = seal(wrap_key, vault_key, aad="r16a-vault:vk:v1")
```

- The master password is NFC-normalised before hashing so that the same password typed on different keyboards/OSes produces the same bytes. It is **not** trimmed or case folded.
- `master_key` and `wrap_key` are zeroed immediately after deriving `auth_key` and unwrapping or wrapping `vault_key`.
- KDF params are stored per user (`kdf_opslimit`, `kdf_memlimit`, plus implicit algorithm `argon2id13`). The client refuses params below the floor (opslimit 3, memlimit 64 MiB) from the server, so a malicious server cannot downgrade a user to a weak KDF during prelogin. The client also refuses params above a ceiling (opslimit 10, memlimit 1 GiB) to avoid a DoS on the device.
- Argon2id runs in a Web Worker on web and in a background isolate (`sodium.runIsolated`) on Flutter.

### 3.4 Sealed blob format

Every AEAD output uses the same envelope.

```
blob = version (1 B, 0x01) || nonce (24 B) || ciphertext || tag (16 B)
```

- Minimum length 41 B (empty plaintext). Maximum 8192 B.
- Base64 (standard alphabet, with padding) on the wire, `bytea` in PostgreSQL.
- `seal(key, plaintext, aad)` draws a fresh random nonce. Tests use `seal_with_nonce` to get deterministic vectors. The fixed-nonce function is test-only and not exported from the production crypto service API.
- Decryption checks the version byte first, then AEAD-opens with the expected AAD. Any failure yields one generic "decryption failed" error.

### 3.5 AAD strings (UTF-8, exact)

| Blob | AAD |
|---|---|
| Wrapped vault key | `r16a-vault:vk:v1` |
| Credential meta | `r16a-vault:cred:v1:{credentialId}:meta` |
| Credential secret | `r16a-vault:cred:v1:{credentialId}:secret` |

`{credentialId}` is the lowercase hyphenated UUID string. The client generates it as UUIDv4 using the CSPRNG before encrypting. This binds every ciphertext to its row and field, so a server swapping `meta_ct` and `secret_ct`, or moving a blob to another row, is detected as a decryption failure. The client shows "This entry could not be decrypted" for such rows and never crashes the list.

### 3.6 Credential plaintext

Both blobs are compact JSON, UTF-8, with these exact keys. Unknown keys are ignored on read and preserved on edit (forward compatibility).

```jsonc
// meta, decrypted for the list. hasTotp lets the list offer a code without opening the secret.
{ "name": "string (1..200)", "url": "string | null (<= 2048)", "username": "string (<= 512)", "hasTotp": "boolean, optional" }
// secret, decrypted only on reveal, copy, or TOTP display
{ "password": "string (<= 4096)", "mfaSecret": "string | null" }
```

`mfaSecret` stores either a bare base32 secret (normalised to uppercase without spaces or `=` padding) or a full `otpauth://totp/...` URI when the user pastes one, so that `algorithm`, `digits` and `period` survive. This is the future hook for QR import.

### 3.7 Change master password

Client: prelogin, derive current `auth_key`, then pick a new random salt, derive `new_master_key`, `new_auth_key`, `new_wrap_key`, and re-wrap the **same** `vault_key`. Credentials are not re-encrypted. The server verifies `currentAuthKey`, swaps hash, salt, params and wrapped key in one transaction, and deletes every other session of the user.

### 3.8 Test vectors (`shared/crypto-test-vectors.json`)

Contents, each with hex inputs and hex outputs.

1. Argon2id13 `master_key` for an ASCII password and a non-ASCII password given in **both** composed (NFC) and decomposed (NFD) forms, which must yield the same `master_key` after client normalisation (A2). Both clients assert this.
2. `auth_key` and `wrap_key` from a fixed `master_key`.
3. Wrapped vault key with a fixed `wrap_key`, `vault_key` and nonce.
4. Meta and secret blobs for a fixed credential id, `vault_key`, nonce and JSON plaintext.
5. Negative cases that must fail to open (swapped AAD, wrong version byte, truncated blob).
6. TOTP codes. RFC 6238 Appendix B vectors for SHA1, SHA256 and SHA512, plus a base32 normalisation case (lowercase with spaces) and an `otpauth://` URI case with 8 digits and 60 s period.

Generation. A Node script (`shared/scripts/generate-vectors.mjs`) using `libsodium-wrappers-sumo` produces vectors 1 to 5. To avoid the web suite only agreeing with itself, the Argon2id and AEAD values are cross-checked during generation against an independent implementation (Python `argon2-cffi` low-level API and `cryptography`'s ChaCha20Poly1305 over HChaCha20 subkey, or PyNaCl if available). TOTP vectors come from the RFC text. The Angular and Flutter suites both assert against this file.

---

## 4. Authentication and sessions

### 4.1 Username normalisation

`trim` (Unicode whitespace) → NFC → lowercase (Unicode `to_lowercase`). Allowed after normalisation: 3 to 64 characters, letters, digits, `.`, `_`, `-`. Same rule on client (for display) and server (authoritative).

### 4.2 Prelogin

`POST /api/v1/auth/prelogin {username}` → `{kdf: {alg: "argon2id13", opslimit, memlimit}, salt}`.

Unknown username: `salt = HMAC-SHA256(R16A_PRELOGIN_SECRET, "r16a:prelogin-salt" || 0x00 || normalized_username)[0..16]`, default params. The label separates this use of the secret from the throttle key below. The real and fake paths both perform one indexed DB lookup and one HMAC (the HMAC result is discarded on the real path) so timing and shape match.

### 4.3 Register

`POST /api/v1/auth/register {username, authKey, kdf, salt, wrappedVaultKey, client}`.

- Server validates sizes (authKey 32 B, salt 16 B, wrapped key exactly 1 + 24 + 32 + 16 = 73 B, version 0x01) and that `kdf` meets the floor.
- `auth_hash = Argon2id(authKey)` as PHC string via `argon2` with a random 16 B salt and `R16A_AUTH_PEPPER` as the Argon2 `secret` input when configured.
- **Server Argon2 params** are m = 19 MiB, t = 2, p = 1 (OWASP minimum). `auth_key` is already a 256-bit uniformly random value, so the server hash exists only to stop a DB thief from replaying `auth_hash` as a login token and to bind the pepper. Heavier server params would only add a DoS lever. Stored as PHC, so they can be raised later with rehash-on-login.
- Creates a full session and returns it as on login. Returns 409 `username-taken` if the name exists.
- Disabled with 403 when `R16A_REGISTRATION_ENABLED=false`.

### 4.4 Login

`POST /api/v1/auth/login {username, authKey, client: "web" | "mobile"}`.

- Unknown user: verify against a fixed dummy PHC hash computed at startup so timing matches.
- Throttle check (4.7) happens before verification.
- Failure → 401 with one generic problem type `invalid-credentials`.
- Success → create full session, reset throttle, return `{wrappedVaultKey, kdf, salt, user: {id, username}}` plus the token (cookie for web, `token` field for mobile).
- Rehash on login if the stored PHC params are below current server params.

### 4.5 Unlock (added, see section 11)

`POST /api/v1/auth/unlock {authKey}` with a valid session cookie or bearer token.

Verifies `authKey` against the session's user with the same throttle and rate limit as login. On success returns `{wrappedVaultKey, kdf, salt}` and, for a `pre_auth` session, upgrades it to `full` and rotates the token. This is the only way besides login to obtain `wrappedVaultKey`, so a stolen locked session cannot run an offline attack.

### 4.6 Sessions

- Token is 32 B from the OS CSPRNG, base64url without padding. DB stores `SHA-256(token)`.
- The token is rotated on login and on every successful unlock (A4). Unlock replaces `token_hash` on the session row and returns or sets the new token, so a token observed before unlock stops working.
- Web cookie `__Host-session=…; HttpOnly; Secure; SameSite=Strict; Path=/`, no `Domain`. The token never appears in a web response body.
- Dev mode cookie. When `R16A_DEV_INSECURE_COOKIE=true`, the cookie is named `r16a_session_dev` without `Secure`. Startup **fails** if this flag is set while `R16A_PUBLIC_URL` starts with `https://`.
- Mobile receives `token` in the JSON body and sends `Authorization: Bearer <token>`. Bearer requests are exempt from the CSRF header and Origin checks because browsers cannot attach them cross-site.
- Idle timeout 30 min (`R16A_SESSION_IDLE_SECS`), absolute lifetime 12 h (`R16A_SESSION_ABSOLUTE_SECS`). `expires_at` stores the absolute deadline. Each authenticated request checks both. `last_seen_at` is updated at most once per 60 s per session to limit write load (sliding refresh).
- A background task deletes expired and idle sessions every 10 minutes. It is idempotent, so running it on several replicas is safe.
- `pre_auth` sessions (OIDC only) live at most 10 minutes and can call only `/auth/unlock`, `/auth/register` (OIDC first sign-in), `/auth/logout` and `/me`.

### 4.7 Abuse protection

| Layer | Mechanism |
|---|---|
| Per-IP | `governor` 0.10 keyed limiter (the engine behind `tower_governor`, used directly for problem+json 429 responses). Two buckets. Proof endpoints (login, register, unlock, logout-all, change password, delete account, OIDC exchange) burst 10, refill 1 per 6 s. Prelogin and OIDC start or callback burst 30, refill 1 per 2 s. IPv6 is bucketed per /64. In memory, so per replica. |
| Per-account | Table `login_throttle(key_hash, failures, next_allowed_at)`, where `key_hash = HMAC-SHA256(R16A_PRELOGIN_SECRET, "r16a:throttle" || 0x00 || normalized_username)`, so the table never contains a raw username (A1). After the 5th consecutive failure, delay = min(2^(failures − 5) s, 15 min). Requests before `next_allowed_at` get 429 with `Retry-After`. Keyed by normalised username **including unknown usernames**, so throttling behaviour does not reveal existence. Reset on success. Never a permanent lockout. Rows untouched for 24 h (`R16A_THROTTLE_TTL_SECS`) are deleted by the cleanup task. DB-backed, so global across replicas. |
| Client IP | Taken from the socket peer, or from the right-most untrusted `X-Forwarded-For` entry only when the peer is inside `R16A_TRUSTED_PROXY_CIDRS`. |
| Request shape | Global body limit 64 KiB, request timeout 15 s, `#[serde(deny_unknown_fields)]` on every DTO, base64 decode with explicit length checks. |
| Argon2 concurrency | A semaphore caps concurrent server Argon2 verifications (default 2 × CPU) so a flood of logins cannot exhaust memory. |

### 4.8 CSRF and origin

For cookie-authenticated requests with methods POST, PUT, PATCH, DELETE, the server requires `X-R16a-Request: 1` **and** an `Origin` header equal to `R16A_PUBLIC_URL`'s origin. Login, register and prelogin from the web also require both, which blocks login CSRF. Same origin deployment (`/` web, `/api` backend) means no CORS headers are ever emitted.

### 4.9 Sensitive operations

| Operation | Endpoint | Proof |
|---|---|---|
| Change master password | `PUT /api/v1/me/master-password` | `currentAuthKey` |
| Sign out everywhere | `POST /api/v1/auth/logout-all` | `authKey` |
| Delete account | `DELETE /api/v1/me` | `authKey` (the client also requires typing the username) |

All three count toward the same per-account throttle as login. Delete account cascades credentials and sessions and clears the cookie.

### 4.10 OIDC with Authentik (P2, off by default)

Config `R16A_OIDC_ENABLED=false` by default. When on, needs `R16A_OIDC_ISSUER_URL`, `R16A_OIDC_CLIENT_ID`, `R16A_OIDC_CLIENT_SECRET`, `R16A_OIDC_DISPLAY_NAME`.

- Backend is a confidential client (BFF), authorization code + PKCE (S256) via `openidconnect` 4.1. Validates `state`, `nonce`, issuer, audience, signature, `exp`. Discovery at startup with retry.
- Flow state (`state` hash, `nonce`, PKCE verifier, client kind, mobile challenge, created_at) lives in table `oidc_flows` with a 10 minute TTL, so any replica can complete the callback.
- Linking on `(issuer, subject)` only. Never on email.
- **Existing linked user.** Callback creates a `pre_auth` session. The client shows the Unlock page. `POST /auth/unlock` with `authKey` upgrades it to `full`. Same rate limit and throttle as local login.
- **First sign-in, no linked user.** Callback creates a row in `oidc_pending (token_hash, issuer, subject, suggested_username, expires_at)` and sets a short-lived pending cookie. The Register page, opened in "complete OIDC sign-up" mode, calls `POST /auth/register` with the same crypto payload. The server consumes the pending row and sets `oidc_issuer`, `oidc_subject` on the new user.
- Linking an existing local account to OIDC is not built (future, needs an in-session `authKey` proof).
- **Mobile.** The app generates its own PKCE-style verifier, opens the system browser at `/api/v1/auth/oidc/start?client=mobile&challenge=<S256>`, the callback redirects to `r16avault://oidc-callback?code=<one-time code>`, and the app calls `POST /api/v1/auth/oidc/exchange {code, verifier}`. The code is single use, valid 60 s, and useless without the verifier, which defeats custom-scheme hijacking by another app.

---

## 5. API contract

Base path `/api/v1`. JSON bodies use camelCase. Binary fields are standard base64 strings. All responses carry `Cache-Control: no-store`. Errors are RFC 9457 `application/problem+json` with `type` (a stable slug URI like `urn:r16a:problem:invalid-credentials`), `title`, `status`, and `requestId`. No internal details ever.

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/auth/prelogin` | none | `{username}` | 200 `{kdf, salt}` |
| POST | `/auth/register` | none, or the OIDC pending cookie (web) or `X-R16a-Oidc-Pending` header (mobile) | `{username, authKey, kdf, salt, wrappedVaultKey, client}` | 201 `LoginResponse`, links the OIDC identity when a pending token is presented |
| POST | `/auth/login` | none | `{username, authKey, client}` | 200 `LoginResponse` |
| POST | `/auth/unlock` | session (full or pre_auth) | `{authKey}` | 200 `{wrappedVaultKey, kdf, salt, token?}`, token rotated |
| POST | `/auth/logout` | session | none | 204, cookie cleared |
| POST | `/auth/logout-all` | full session | `{authKey}` | 204, all sessions (full and pre_auth) and any OIDC pending and exchange rows for the user deleted, cookie cleared |
| GET | `/auth/config` | none | none | 200 `{oidcEnabled, oidcDisplayName, registrationEnabled}` |
| GET | `/auth/oidc/start` | none | query `client`, `challenge?` | 303 to IdP, sets the flow binding cookie for web |
| GET | `/auth/oidc/callback` | flow cookie (web) | query from IdP | 303 to `/unlock`, `/register?oidc=1`, `/login?oidc_error=<slug>` or the app scheme |
| POST | `/auth/oidc/exchange` | none | `{code, verifier}` | 200 `{token, state: "pre_auth" \| "pending", suggestedUsername?}` |
| GET | `/auth/oidc/pending` | pending cookie or `X-R16a-Oidc-Pending` | none | 200 `{suggestedUsername?}` |
| GET | `/me` | session | none | 200 `{id, username, kdf, salt, sessionState, createdAt}` |
| PUT | `/me/master-password` | full session | `{currentAuthKey, newAuthKey, newSalt, newKdf, newWrappedVaultKey}` | 204 |
| DELETE | `/me` | full session | `{authKey}` | 204, cookie cleared |
| GET | `/credentials` | full session | none | 200 `[{id, meta, secret, createdAt, updatedAt}]` ordered by `createdAt` |
| POST | `/credentials` | full session | `{id, meta, secret}` | 201 same shape |
| DELETE | `/credentials/{id}` | full session | none | 204, or 404 if not found **or not owned** |

`LoginResponse = {user: {id, username}, kdf, salt, wrappedVaultKey, token?}`, where `token` is present only for `client = "mobile"`.

Credential rules. `id` must be a valid UUID. Blobs must decode, be 41 to 8192 bytes, and start with 0x01. A duplicate `id` returns 409. Every query includes `WHERE user_id = $session_user`. Maximum 5000 credentials per user (413) to bound storage abuse.

Operational endpoints on the main port, outside `/api`. `GET /healthz` (process alive) and `GET /readyz` (DB `SELECT 1` within 2 s). `/metrics` on a separate port is optional and will only be built if time remains.

OpenAPI. Generated with `utoipa` 6 from the Rust handlers and DTOs, served at `/api/v1/openapi.json` (disabled unless `R16A_EXPOSE_OPENAPI=true`) and also written to `docs/openapi.json` by a test, so CI catches drift.

---

## 6. Data model (PostgreSQL 18)

Migrations are embedded with `sqlx::migrate!`. Primary keys use PG18 native `uuidv7()` except credentials, where the client supplies the id.

```sql
create table users (
  id                 uuid primary key default uuidv7(),
  username           text not null unique,
  auth_hash          text not null,
  kdf_salt           bytea not null check (octet_length(kdf_salt) = 16),
  kdf_opslimit       integer not null,
  kdf_memlimit       bigint not null,
  wrapped_vault_key  bytea not null,
  oidc_issuer        text,
  oidc_subject       text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (oidc_issuer, oidc_subject)
);

create table sessions (
  id            uuid primary key default uuidv7(),
  user_id       uuid not null references users(id) on delete cascade,
  token_hash    bytea not null unique,
  state         text not null check (state in ('pre_auth', 'full')),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  user_agent    text
);
create index on sessions (user_id);
create index on sessions (expires_at);

create table credentials (
  id          uuid primary key,
  user_id     uuid not null references users(id) on delete cascade,
  meta_ct     bytea not null check (octet_length(meta_ct) between 41 and 8192),
  secret_ct   bytea not null check (octet_length(secret_ct) between 41 and 8192),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on credentials (user_id);

-- added, see section 11
create table login_throttle (
  key_hash         bytea primary key,  -- HMAC of the normalised username, never the raw name
  failures         integer not null default 0,
  next_allowed_at  timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- OIDC, see backend/migrations/20261108000002_oidc.sql for the full definitions
-- oidc_flows           state hash, nonce, PKCE verifier, client kind, browser binding hash, mobile challenge
-- oidc_pending         token hash, issuer, subject, suggested username
-- oidc_exchange_codes  code hash, mobile challenge, kind, session id (cascades), identity
-- All rows expire within 10 minutes (codes within 60 seconds) and are swept by the cleanup task.
```

`user_agent` is truncated to 256 characters. It is shown nowhere yet but is kept for a future "active sessions" screen.

### 6.1 Database roles

Two roles.

- `r16a_owner` owns the schema and runs migrations. Used only by the one-shot `migrate` command (`r16a-vault-backend migrate`), which runs as a compose one-shot service and as a Kubernetes Job before rollout.
- `r16a_app` is `NOSUPERUSER NOCREATEDB NOCREATEROLE`, owns nothing, and has `USAGE` on the schema and `SELECT, INSERT, UPDATE, DELETE` on the tables via `ALTER DEFAULT PRIVILEGES`. The server process connects as `r16a_app` and never runs migrations in production.

For local `cargo run` convenience, `R16A_MIGRATE_ON_START=true` lets the server migrate itself using `R16A_DATABASE_URL`. It defaults to false. `deploy/k8s/provision.sql` creates the database, both roles and grants.

---

## 7. Backend (Rust)

### 7.1 Stack (versions verified 2026-11-08 on crates.io, toolchain rustc 1.97)

| Crate | Version | Notes |
|---|---|---|
| axum | 0.8.9 | |
| tokio | 1.54.1 | |
| tower / tower-http | 0.5.3 / 0.7.1 | trace, timeout, body limit, set-header, request-id |
| governor | 0.10.4 | keyed GCRA limiter, see 4.7 |
| sqlx | 0.9.0 | postgres, runtime tokio, tls rustls, macros, migrate, uuid, time |
| argon2 | 0.6.0 | |
| hmac / sha2 / subtle | 0.13.0 / 0.11.1 / 2.6.1 | |
| rand | 0.10.3 | OS RNG only |
| secrecy / zeroize | 0.10.3 / 1.9.1 | |
| serde / thiserror / tracing | 1.0.229 / 2.0.21 / 0.1.44 | plus tracing-subscriber JSON |
| uuid / time / base64 | 1.29.1 / 0.3.55 / 0.23.1 | |
| unicode-normalization | 0.1.26 | |
| utoipa | 6.0.0 | |
| openidconnect | 4.1.0 | rustls only. Pulls `rsa`, see 11.2 D27 |

Exact APIs are checked against docs.rs during implementation, not from memory. No OpenSSL anywhere, so the musl static build stays simple.

### 7.2 Layout

```
backend/
  Cargo.toml  deny.toml  Dockerfile  .sqlx/  migrations/
  src/
    main.rs            entry, `serve` and `migrate` subcommands
    app.rs             router assembly, middleware stack
    config/            env parsing and validation, fail fast
    error/             AppError, problem+json mapping
    http/              extractors (Session, ClientIp, Json with limits), CSRF layer, security headers
    auth/              handlers, service, repository (prelogin, register, login, unlock, logout)
    sessions/          token issue, lookup, sliding refresh, cleanup task
    credentials/       handlers, service, repository
    account/           /me, change password, delete
    oidc/              P2
    crypto/            server-side helpers (auth hash, prelogin HMAC, token hashing), no vault crypto
  tests/               sqlx::test integration tests per feature
```

### 7.3 Rules

- `#![forbid(unsafe_code)]`, edition 2024, `cargo clippy --all-targets -- -D warnings`, `cargo fmt --check`, `cargo deny check` (advisories, licenses, bans, sources). `cargo-deny` is installed via `cargo install` if missing.
- Handlers do HTTP only. Services hold rules. Repositories hold SQL only, compile-time checked with `sqlx::query!`, with the offline cache in `backend/.sqlx` so Docker builds need no DB.
- Config secrets (`R16A_DATABASE_URL`, `R16A_PRELOGIN_SECRET`, optional `R16A_AUTH_PEPPER`, OIDC secret) are `SecretString`, have no defaults, and must be at least 32 bytes of entropy where they are keys. Startup fails with a message naming the missing variable, never its value.
- Logging. Request id, method, matched route, status, latency. Request and response bodies are never logged. A custom `Debug` on every DTO with key material prints `[redacted]`. Panics are caught by a layer and converted to a generic 500.
- Security headers on API responses. `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`.

### 7.4 Tests

`sqlx::test` integration tests cover every endpoint, including invalid input, auth failure, generic error shape, CSRF header and Origin enforcement, rate limit 429, throttle backoff, idle and absolute expiry (by moving timestamps in the DB), logout-all, change password invalidating other sessions, delete cascade, and **cross-user isolation** (user B cannot list, delete or overwrite user A's credentials and gets 404). Unit tests cover username normalisation, blob validation, IP extraction and config validation.

---

## 8. Web app (Angular)

### 8.1 Stack (verified 2026-11-08)

Angular 22.2 (`@angular/core` 22.2.5, CLI 22.2.6), **TypeScript 6.0.x** (Angular 22 peer range is `>=6.0 <6.1`, so not TS 7), `angular-eslint` 22.6, ESLint 10, Vitest via the Angular CLI unit-test builder, `libsodium-wrappers-sumo` 0.8.4, `otpauth` 9.6.0.

### 8.2 Architecture

```
web/src/app/
  core/          api client, interceptors (CSRF header, 401 handling), guards, VaultCryptoService,
                 crypto.worker.ts, VaultSessionStore, ClipboardService, ThemeService, AutoLockService
  auth/          login, register, unlock (container + presentational components)
  credentials/   list page, credential row, reveal field, TOTP display, add dialog, delete confirm
  generator/     generator page, GeneratorService, EFF wordlist asset
  settings/      theme, auto-lock, change password, sign out everywhere, delete account
  shared/        buttons, inputs, dialog, toast, icons, countdown ring
```

- Standalone components, signals, zoneless, `OnPush` everywhere, built-in control flow, typed reactive forms, functional guards and interceptors, strict TS.
- Route guards. `anonymousGuard` (login, register), `sessionGuard` (has session, any lock state), `unlockedGuard` (vault key in memory, else redirect to `/unlock`). Routes lazy-load per feature.
- `VaultCryptoService` is the only code that calls libsodium. Its public API takes and returns domain types (`CredentialMeta`, sealed base64 strings). Raw keys never leave it.
- `VaultSessionStore` holds `vaultKey` as a private `Uint8Array` inside a closure, plus signals for `lockState` and decrypted meta list. `lock()` zeros the key, clears decrypted state and any revealed secret.
- Auto-lock. Inactivity timeout (default 5 min, options 1, 5, 15, 30), `visibilitychange` hidden for more than 60 s, logout. The timeout preference lives in localStorage (not sensitive).
- Revealed secrets are held in a component-local signal, cleared after 30 s, on hide, on route change and on lock.

### 8.3 Web security headers (nginx)

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-$csp_nonce' 'wasm-unsafe-eval';
  style-src 'self' 'nonce-$csp_nonce'; img-src 'self' data:; font-src 'self';
  connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self';
  form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script';
  trusted-types angular angular#bundler default
Strict-Transport-Security: max-age=63072000; includeSubDomains   (production only)
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=(self), clipboard-write=(self)
```

- Angular injects component styles at runtime, so styles use a per-response nonce generated by nginx, injected into both the CSP header and `<app-root ngCspNonce="...">` with `sub_filter` (A3). Critical CSS inlining is disabled because it relies on an inline `onload` handler. Fallback if the nonce cannot be made to work within about 30 minutes is `style-src 'self'` with no inline styles at all.
- The theme is applied before first paint by a tiny external `theme-init.js` (no inline script).
- Trusted Types is enforced. libsodium's ESM build uses no `eval` or `new Function`. The only sink outside Angular's own policies is the Worker constructor for Argon2, covered by a `default` policy that accepts only same origin `/worker-*.js` URLs and throws for anything else.
- `script-src` carries the same nonce, because Angular emits an inline import map with Subresource Integrity hashes for every lazy chunk. No `'unsafe-inline'` is used anywhere.
- libsodium is loaded lazily, which keeps the initial bundle under 300 kB.
- `base-uri` is `'self'` rather than `'none'`, because the page uses `<base href="/">`.
- `index.html` is served with `Cache-Control: no-store` (A3), because it carries the per-response nonce. Hashed bundles are `immutable`. The SPA fallback serves `index.html` for unknown paths.

### 8.4 Forms

- Login uses `autocomplete="username"` and `current-password`. Register uses `new-password`.
- Vault entry password inputs use `autocomplete="off"` plus `data-1p-ignore`, `data-lpignore` so the browser does not offer to save vault entries.

---

## 9. Mobile app (Flutter)

### 9.1 Stack (verified 2026-11-08 on pub.dev, Flutter 3.44.6)

`sodium` 4.0.4, `flutter_riverpod` 3.5.0, `go_router` 18.1.3, `dio` 5.11.1, `flutter_secure_storage` 11.2.0, `otp` 3.2.1 (always called with `isGoogle: true` and an explicit algorithm, see 11.2), `no_screenshot` 2.0.1 (Android `FLAG_SECURE`, iOS screenshot prevention and app switcher blur), `unorm_dart` 0.3.3 for NFC, `flutter_web_auth_2` 5.1.0 for the OIDC browser flow, `uuid` 4.6 with its crypto RNG, `crypto` for SHA-256 of the PKCE challenge.

### 9.2 Architecture

```
mobile/lib/
  core/         api (dio + bearer interceptor + 401 handler), crypto (VaultCrypto using sodium_libs),
                vault session notifier, auto-lock (AppLifecycleListener), router, theme (HSLColor tokens), clipboard
  auth/         login, register, unlock
  credentials/  list, tile, reveal, TOTP, add sheet, delete confirm
  generator/    page and service (shared EFF wordlist asset)
  settings/     theme, auto-lock, change password, sign out everywhere, delete account
```

- Riverpod notifiers own logic. Smart widgets read providers. Dumb widgets take values and callbacks.
- `vault_key` is a `SecureKey` (libsodium-allocated, zeroed on dispose) held by a notifier, never written to storage. Only the session token goes to `flutter_secure_storage`.
- Argon2id runs through `sodium.runIsolated`.
- Lock when the app is backgrounded for more than 30 s (configurable with the auto-lock setting).
- Android 13+ copied secrets get `ClipDescription.EXTRA_IS_SENSITIVE` through a small platform channel (`MainActivity.kt`). Android backups are disabled so the stored token never leaves the device in a backup.
- API base URL is set at first launch on the login screen (self-hosted), stored in shared preferences, and must be `https://` unless it is a loopback or emulator host in debug builds.

---

## 10. Design system and UX

### 10.1 Colour tokens

HSL triplets in CSS custom properties. Scales 50 to 950 for brand (h 160, s 84%), neutral (h 160, s 8%), danger (h 0, s 72%), warning (h 38, s 92%). Brand lightness steps are 96, 90, 80, 65, 50, 39 (brand-500 anchor), 33, 26, 20, 15, 10. Neutral steps are 98, 95, 90, 80, 65, 50, 40, 30, 18, 11, 7. Flutter mirrors the same triplets with `HSLColor.fromAHSL`, and its widget tests run Flutter's text contrast and tap target guidelines.

Semantic tokens per theme.

| Token | Light | Dark |
|---|---|---|
| `--color-bg` | neutral l 98% | neutral l 7% |
| `--color-surface` | white | neutral l 11% |
| `--color-text` | neutral l 10% | neutral l 95% |
| `--color-text-muted` | neutral l 40% | neutral l 65% |
| `--color-primary` (button fill, link text) | brand l 26% (brand-700) | brand l 50% (brand-400) |
| `--color-on-primary` | white | neutral l 7% |
| `--color-danger` | danger l 45% | danger l 65% |
| `--color-warning-text` | warning l 30% | warning l 60% |
| `--color-border` (input boundary) | neutral l 50% | neutral l 40% |
| `--color-border-subtle` (decorative dividers, no contrast requirement) | neutral l 90% | neutral l 18% |
| `--color-focus` | brand l 33% (brand-600) | brand l 65% (brand-300) |

### 10.2 Measured contrast (WCAG 2.x relative luminance, computed 2026-11-08)

| Pair | Ratio | Requirement |
|---|---|---|
| White text on brand-500 l 39% (the raw brand colour) | **2.59** | fails 4.5, not used for text |
| Light. `on-primary` white on primary l 26% | 5.35 | 4.5 text |
| Light. Primary link l 26% on bg l 98% | 5.13 | 4.5 text |
| Light. Text l 10% on bg l 98% | 16.58 | 4.5 |
| Light. Muted l 40% on bg l 98% | 5.15 | 4.5 |
| Light. Input border l 50% on surface white | 3.68 | 3.0 UI |
| Light. Focus ring l 33% on white | 3.55 | 3.0 UI |
| Light. White on danger l 45% | 5.81 | 4.5 |
| Light. Danger l 45% text on bg l 98% | 5.57 | 4.5 |
| Light. Warning l 30% text on bg l 98% | 5.18 | 4.5 |
| Dark. `on-primary` l 7% on primary l 50% | 11.89 | 4.5 |
| Dark. Primary l 50% on surface l 11% | 10.72 | 3.0 UI |
| Dark. Link brand-300 l 65% on bg l 7% | 13.08 | 4.5 |
| Dark. Text l 95% on bg l 7% | 16.76 | 4.5 |
| Dark. Muted l 65% on surface l 11% | 7.20 | 4.5 |
| Dark. Input border l 40% on surface l 11% | 3.13 | 3.0 UI |
| Dark. Danger l 65% on bg l 7% | 5.71 | 4.5 |
| Dark. Warning l 60% on bg l 7% | 10.10 | 4.5 |

The brand green is used at full saturation as an accent (logo, active states with a text label next to them, TOTP ring), never as the only carrier of text contrast.

### 10.3 UX

As in the brief section 9.2, specifically:

- Credentials list with initial-letter avatar (colour derived from a hash of the name, picked from a contrast-checked set), name, URL host, username. Client-side search over decrypted meta. Empty state with "Add credential".
- Reveal toggle with `aria-pressed` and an accessible label, auto-hide after 30 s.
- Copy for username, password and TOTP. A toast says "Copied. Clipboard clears in 30 seconds."
- TOTP grouped `123 456` with a circular countdown. With `prefers-reduced-motion` the ring steps once per second instead of animating smoothly.
- Add credential dialog with an inline generator panel, URL scheme normalisation (`example.com` → `https://example.com`), TOTP secret field that accepts base32 or `otpauth://` and previews the current code before saving.
- Delete confirmation naming the credential. Delete account requires the exact username and the master password.
- Generator. Random mode (length 8 to 128, default 20, upper, lower, digits, symbols, exclude ambiguous `Il1O0o`, at least one of each selected class via rejection-sampled placement then a Fisher–Yates shuffle). Passphrase mode with the EFF large wordlist (7776 words, bundled as an asset, checksum verified in tests), word count 3 to 20 (default 6), separator, capitalise, include number. All indices use rejection sampling over `randombytes_buf` (no modulo bias). Entropy estimate in bits with label (weak below 50, fair 50 to 70, strong 70 to 100, excellent above 100). Generated values never leave the client.
- Keyboard navigable, visible focus rings, labels, `aria-describedby` errors, responsive to 360 px, touch targets at least 44 px.
- Every async view has loading, empty and error states with human-readable messages.

**Edit credential.** Not built. The brief makes it optional after everything else, and it is listed as the first next step in the README.

---

## 11. Deviations from and additions to the brief

| # | Change | Reason |
|---|---|---|
| D1 | **New endpoint `POST /api/v1/auth/unlock`.** `wrappedVaultKey` is returned only by login and unlock, never by `/me`. | The brief has an Unlock page and rate-limits unlock but lists no endpoint. Without a server-verified unlock, the client would need `wrappedVaultKey` from an unauthenticated-by-password call, which lets a stolen session run an offline brute force with no rate limit. It also gives OIDC one upgrade path. |
| D2 | **New table `login_throttle`**, keyed by normalised username including unknown names. | Per-account backoff must be global across replicas and must not reveal whether a username exists. `tower_governor` is in-memory and per IP. |
| D3 | **New endpoint `GET /api/v1/auth/config`.** | The login page needs to know whether to show the Authentik button and the register link. |
| D4 | **New config `R16A_REGISTRATION_ENABLED`** (default true). | Self-hosters usually want to close sign-ups after creating their account. Also limits registration-based enumeration. |
| D5 | **Client-side KDF floor and ceiling.** | Stops a malicious server from downgrading Argon2 parameters during prelogin, and stops it from DoSing devices with huge params. |
| D6 | **Server Argon2 params m 19 MiB, t 2, p 1**, plus a concurrency semaphore. | `auth_key` is a high-entropy key, not a password. Heavier params buy nothing and enlarge the DoS surface. |
| D7 | **Master password is NFC-normalised** before Argon2. | Avoids lockouts when the same password is typed on platforms that produce different Unicode forms. |
| D8 | **`mfaSecret` may hold a full `otpauth://` URI.** | Keeps algorithm, digits and period from the issuer, and prepares for QR import. |
| D9 | **Credentials have UUIDv4 from the client** instead of "v4 or v7". | v7 leaks creation time to anyone holding the id, and the server already records `created_at`. v4 is simpler and identical on both clients. |
| D10 | **Separate `migrate` subcommand and two DB roles**, migration on start off by default. | Lets the runtime role own nothing, as the brief asks. |
| D11 | **OIDC tables `oidc_flows`, `oidc_pending`, `oidc_exchange_codes`** and the mobile verifier on `/oidc/start` and `/oidc/exchange`. | The brief's `sessions.user_id` is `not null`, so a first-time OIDC user with no account cannot have a session row. The mobile verifier closes custom-scheme hijacking of the one-time code. DB-backed so callbacks work on any replica. |
| D12 | **TypeScript 6.0.x**, not the latest 7.0.2. | Angular 22.2 declares `typescript >=6.0 <6.1` as a peer dependency. "Latest stable" is applied per framework compatibility. |
| D13 | **Style CSP uses a per-request nonce**, critical CSS inlining off. | Angular injects component styles at runtime. A nonce avoids `'unsafe-inline'` for styles as well. |
| D14 | **Web clipboard clear overwrites unconditionally** if `readText()` is denied. | Browsers often block clipboard reads. Leaving a password in the clipboard is worse than clearing something newer. |
| D15 | **`/metrics` is optional** and built only if time remains. | Not needed for the definition of done. |
| D16 | **Credential cap of 5000 per user.** | Bounds storage abuse by a single account. |
| D17 | **No CORS at all**, and bearer-auth requests skip the CSRF checks. | Same origin deployment. Bearer tokens are not sent automatically by browsers, so CSRF does not apply. |
| D18 | **Mobile server URL entered by the user.** | Self-hosted, so there is no fixed backend. |

---

### 11.1 Approval amendments

| # | Amendment |
|---|---|
| A1 | `login_throttle` rows are keyed by `HMAC(server_secret, normalized_username)`, never the raw username. Expired rows are removed on a TTL. |
| A2 | Test vectors include a non-ASCII master password in composed and decomposed forms, asserted by both clients. |
| A3 | Style nonce generated per response by nginx, injected into the header and `ngCspNonce`. `index.html` is `Cache-Control: no-store`. Fallback after about 30 minutes of trouble is `style-src 'self'` with no inline styles. |
| A4 | Session token rotated on login and on unlock. Logout-all also deletes OIDC pre-auth sessions and pending rows. |
| A5 | Clipboard trade-off D14 accepted. The toast must state that the clipboard will be cleared. |

### 11.2 Changes made during implementation

| # | Change | Reason |
|---|---|---|
| D19 | `governor` used directly instead of `tower_governor`, with a separate larger bucket for prelogin and OIDC redirects. | Direct use gives problem+json 429 responses with `Retry-After`. A shared bucket let ordinary prelogin traffic exhaust the password proof budget. |
| D20 | Server HMACs carry domain labels (`r16a:prelogin-salt`, `r16a:throttle`). | One secret serves two purposes without one output being usable as the other. |
| D21 | Flutter uses `sodium` 4.0.4 instead of `sodium_libs`. | `sodium_libs` is deprecated and re-exports `sodium`. `sodium` 4.1 needs Dart 3.13, newer than the installed Flutter 3.44.6 with Dart 3.12. |
| D22 | `no_screenshot` instead of `screen_protector`. | `screen_protector` 1.5.3 does not compile its Kotlin sources under AGP 9 with Flutter's `android.builtInKotlin=false` template. |
| D23 | `unorm_dart` for NFC on mobile. | Dart has no built in Unicode normaliser and the protocol requires NFC. Verified by the composed and decomposed vectors. |
| D24 | Meta blob may carry `hasTotp`. | Lets the list show a 2FA badge and a code button without opening the secret blob. Readers ignore unknown keys. |
| D25 | Mobile asks for the server address on the sign in screen. | Self hosted, no fixed backend. HTTPS is required except loopback and the emulator host in debug builds. |
| D26 | Web OIDC flows are bound to the starting browser by a short lived `SameSite=Lax` cookie whose hash is stored with the flow. `GET /auth/oidc/pending` added. | Prevents login CSRF through a forged callback link, and lets the register page show the suggested username. |
| D27 | `cargo deny` ignores RUSTSEC-2023-0071 (Marvin attack in `rsa`). | The advisory covers RSA private key operations. `openidconnect` only verifies provider signatures with public keys, and the server holds no RSA private key. Recorded with this reason in `backend/deny.toml`. |
| D28 | `Cache-Control: no-store` and the API security headers apply to every backend response, including problem responses. | Found during the final review, problem responses were rebuilt without the headers of inner layers. Covered by a test. |
| D29 | Kubernetes namespace enforces Pod Security Admission `restricted`. | Any later manifest that drops the hardening is rejected by the API server. |

## 12. Future features, kept possible

- **QR import of MFA secrets.** `mfaSecret` already accepts `otpauth://` URIs. A camera scanner only has to feed that field.
- **Biometric unlock on mobile.** Would store `vault_key` wrapped by a hardware-backed, biometry-gated key (Keystore / Secure Enclave). The key hierarchy already separates `vault_key` from the password, so this adds a second wrapper without server changes.
- **Browser extension.** Same API with bearer tokens, like mobile.
- **Export.** Client-side decrypt and download. No server change.
- **KDF upgrade.** Per-user params plus change master password already allow raising them.

---

## 13. Deployment

- `backend/Dockerfile`. Multi-stage, `rust` builder with the `x86_64-unknown-linux-musl` target, `SQLX_OFFLINE=true`, final `gcr.io/distroless/static-debian13:nonroot`, user 65532, no shell, read-only root FS compatible (no writes outside `/tmp`, which is not needed either).
- `web/Dockerfile`. Node builder, final `nginxinc/nginx-unprivileged` (latest stable Alpine tag, verified at build time), port 8080, headers from 8.3, `/api` proxied to the backend for compose. Temp dirs on an `emptyDir` / tmpfs so the root FS can be read-only.
- `deploy/compose/docker-compose.yml`. `postgres:18` (18.6 at time of writing), a one-shot `db-init` that creates the app role, a one-shot `migrate`, `backend`, `web` on `http://localhost:8080`, healthchecks, `.env.example`. Compose uses `R16A_DEV_INSECURE_COOKIE=true` because it serves plain HTTP on localhost.
- `deploy/k8s/`. Namespace with Pod Security Admission `restricted`, ServiceAccounts without API tokens, ConfigMap, Secret template (placeholders, ready for SOPS + age, not encrypted, plaintext copies ignored by git), migrate Job, backend and web Deployments (requests and limits, `runAsNonRoot`, drop ALL caps, read-only root FS, `seccompProfile: RuntimeDefault`, `allowPrivilegeEscalation: false`, probes), Services, an Ingress with `ingressClassName: traefik` and a cert-manager `cluster-issuer` annotation routing `/api` to the backend and `/` to web on one host, NetworkPolicies (default deny, web ingress from Traefik, backend ingress from Traefik, backend egress to PostgreSQL CIDR on 5432 and DNS, plus Authentik on 443 when OIDC is enabled), and `provision.sql`. Validated with `kubeconform`.
- Image scanning with Trivy (run via the `aquasec/trivy` container, since it is not installed locally), with zero criticals as the bar.

Tooling not installed locally that the build will fetch. `cargo-deny` (cargo install), `kubeconform` and Trivy (container images). Nothing is pushed to any registry.

---

## 14. Implementation status (2026-11-08)

| Item | State |
|---|---|
| P0 backend, web, Docker images, compose | Done. Browser end to end run against compose passes, 48 API messages inspected with no plaintext credential field, password or web session token on the wire, no CSP or Trusted Types violations. |
| P1 Flutter | Done. Unit, vector and widget tests pass, debug APK builds, live flow test against compose passes. Not run on a device or emulator, iOS not built (no macOS here). |
| P2 OIDC | Done on backend, web and mobile. Backend tested against an in process provider with real RS256 tokens. Not yet tested against a real Authentik instance. |
| P3 Kubernetes | Done. kubeconform strict passes on all resources. |
| Edit credential | Not built. |

## 15. Delivery plan

1. P0 backend. Config, DB, migrations, auth, sessions, credentials, account, tests, OpenAPI.
2. Shared test vectors and their generator.
3. P0 web. Crypto service and worker, all pages, design tokens, tests, nginx headers.
4. P0 Docker images and compose, manual end-to-end pass in a browser with network inspection.
5. P1 Flutter app with parity.
6. P2 OIDC (backend, web, mobile).
7. P3 Kubernetes manifests, kubeconform, Trivy.
8. Edit credential, if everything else is done.
9. README, final review, summary of changed files, open risks and next steps.

Nothing is committed at any step. All changes stay in the working tree for review.
