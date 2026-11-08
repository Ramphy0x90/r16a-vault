# r16a-vault

A self-hosted, zero-knowledge credential vault. You keep logins (name, website, username, password, optional authenticator secret) in an account. Every entry is encrypted on your device before it is sent, so the server stores your vault contents only as ciphertext it cannot read. The operator of a server can still see account metadata: your username, sign in times, devices and client networks. [docs/OPERATING.md](docs/OPERATING.md) lists exactly what.

| Part | Stack | Path |
|---|---|---|
| Backend | Rust 2024, axum 0.8, sqlx 0.9, PostgreSQL 18 | `backend/` |
| Web app | Angular 22 (standalone, signals, zoneless), libsodium | `web/` |
| Mobile app | Flutter 3.44, Riverpod 3, go_router, libsodium | `mobile/` |
| Shared crypto test vectors and wordlist | | `shared/` |
| Compose and Kubernetes | | `deploy/` |
| Specification and threat model | | `docs/SPEC.md` |
| OpenAPI document | | `docs/openapi.json` |

## How it works

At sign-up the client generates a random 32-byte **vault key**. Your master password goes through Argon2id (64 MiB, 3 passes) on your device to produce a master key. That master key is split with libsodium's KDF into an **auth key** and a **wrap key**.

- The **auth key** is all the server ever sees of your password. The server stores only a peppered Argon2id hash of it.
- The **wrap key** encrypts the vault key. The server keeps that wrapped copy, but can't open it.

Every credential becomes two XChaCha20-Poly1305 blobs. A *meta* blob (name, URL, username) is decrypted for the list. A *secret* blob (password, authenticator secret) is decrypted only when you reveal or copy it, or show a code. Each blob is bound to its row ID and field through the associated data, so the server can't swap blobs undetected. Changing your master password only re-wraps the vault key.

Sessions use opaque random tokens; the server stores only their SHA-256. The web app receives the token as a `__Host-` HttpOnly, `SameSite=Strict` cookie, and mobile keeps it in platform secure storage. A session alone never yields the wrapped vault key, which is only returned after a password proof (login or unlock). Auto-lock drops the vault key from memory.

Optional single sign-on with Authentik (or any OIDC provider) only proves who you are. You still unlock with your master password, because the server can never derive your vault key. Details, the threat model and every deviation from the brief are in [docs/SPEC.md](docs/SPEC.md).

## Run it locally

There are two ways: everything in Docker, or mix and match, where you choose which parts run in Docker and which run natively.

### Everything in Docker (closest to production)

```sh
cd deploy/compose
cp .env.example .env          # fill in every value, e.g. with: openssl rand -base64 48
docker compose up -d --build  # http://localhost:8080
docker compose down           # stop (add -v to also delete the database)
```

### Mix and match for development

`deploy/compose/docker-compose.dev.yml` always starts PostgreSQL. Profiles add the backend and the web app in Docker. Everything uses throwaway dev credentials and binds to 127.0.0.1 only.

**1. Database** (always needed)

```sh
cd deploy/compose
docker compose -f docker-compose.dev.yml up -d
```

This starts PostgreSQL 18 on `127.0.0.1:5432`. The `r16a` database and both roles are created on first start. If you already run a Postgres on 5432, use another port with `R16A_DEV_DB_PORT=5433` and change the URLs in `backend/.env` to match.

**2. Backend.** Pick one of these.

```sh
# Natively
cd backend
cp .env.example .env    # dev values that match the dev database
cargo run               # http://127.0.0.1:8081, runs migrations on start

# Or in Docker
cd deploy/compose
docker compose -f docker-compose.dev.yml --profile backend up -d --build
```

Debug builds read `backend/.env` automatically; release builds and containers only read real environment variables. Queries compile against the committed `.sqlx` cache, so building doesn't need the database.

**3. Web app.** Pick one of these.

```sh
# Natively, with hot reload
cd web
npm ci
ng serve                # or: npm start. Opens on http://localhost:4200 and proxies /api to 127.0.0.1:8081

# Or in Docker, the production nginx build with the real CSP headers
cd deploy/compose
docker compose -f docker-compose.dev.yml --profile web up -d --build    # http://localhost:8080
```

The Docker web container uses host networking and proxies `/api` to `127.0.0.1:8081`, so it works with either backend. The dev backend accepts both origins (4200 through `R16A_PUBLIC_URL`, 8080 through `R16A_EXTRA_ORIGINS`). The backend refuses `R16A_EXTRA_ORIGINS` unless the dev cookie mode is on.

Profiles combine, e.g. `--profile backend --profile web`. To stop, run `docker compose -f docker-compose.dev.yml --profile backend --profile web down`, and add `-v` to wipe the dev database.

**4. Mobile**

```sh
cd mobile
flutter run
```

On the sign-in screen, enter the server address:
- Android emulator: `http://10.0.2.2:8080` (or `:4200`)
- iOS simulator: `http://localhost:8080`

Plain HTTP is accepted only for these local addresses, and only in debug builds.

**Backend tests** use the dev database's superuser:

```sh
cd backend
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres cargo test
```

Running the pieces natively needs:
- Rust 1.94 or newer
- Node 24.15 or newer (an Angular 22 requirement)
- Flutter 3.44 with Dart 3.12
- `sqlx-cli`, only if you change queries

Plain HTTP on localhost can't use `__Host-` cookies, so every local setup runs with `R16A_DEV_INSECURE_COOKIE=true`. The backend refuses that flag when `R16A_PUBLIC_URL` uses https.

## Configuration (backend)

All settings are environment variables, validated at startup. Secrets have no defaults, and a missing or invalid one stops the process with a message naming the variable (never its value).

| Variable | Default | Meaning |
|---|---|---|
| `R16A_DATABASE_URL` | required | Runtime role connection. |
| `R16A_MIGRATE_DATABASE_URL` | `R16A_DATABASE_URL` | Owner role connection, used by `migrate`. |
| `R16A_PUBLIC_URL` | required | Exact public origin. Checked against `Origin` for CSRF. |
| `R16A_PRELOGIN_SECRET` | required, at least 32 chars | Keys the fake prelogin salts and the throttle table. |
| `R16A_AUTH_PEPPER` | unset | Argon2 secret for stored auth hashes. Keep it out of database backups, and never change it (existing logins would stop working). |
| `R16A_BIND` | `0.0.0.0:8081` | Listen address. |
| `R16A_SESSION_IDLE_SECS` / `R16A_SESSION_ABSOLUTE_SECS` | `1800` / `43200` | Session idle timeout and absolute lifetime. |
| `R16A_TRUSTED_PROXY_CIDRS` | none | Only peers in these ranges may set `X-Forwarded-For`. |
| `R16A_REGISTRATION_ENABLED` | `true` | Turn off after creating your account. |
| `R16A_PRIVACY_URL` | unset | Your privacy notice. Both apps link to it when set. Start from `docs/PRIVACY_NOTICE_TEMPLATE.md`. |
| `R16A_RATE_LIMIT_BURST` / `R16A_RATE_LIMIT_PERIOD_MS` | `10` / `6000` | Per-IP limit for password proofs. Prelogin gets three times the burst. |
| `R16A_DEV_INSECURE_COOKIE` | `false` | Plain HTTP on localhost only. |
| `R16A_EXTRA_ORIGINS` | none | Further origins allowed by the CSRF check, comma separated. Development only, refused unless `R16A_DEV_INSECURE_COOKIE` is on. |
| `R16A_MIGRATE_ON_START` | `false` | Convenience for local runs. Production uses the `migrate` command. |
| `R16A_LOG_FORMAT` | `json` | `pretty` for development. |
| `R16A_EXPOSE_OPENAPI` | `false` | Serves `/api/v1/openapi.json`. |
| `R16A_OIDC_ENABLED` | `false` | Turns on single sign-on. |
| `R16A_OIDC_ISSUER_URL`, `R16A_OIDC_CLIENT_ID`, `R16A_OIDC_CLIENT_SECRET` | required with OIDC | Provider settings. |
| `R16A_OIDC_DISPLAY_NAME` | `Authentik` | Button label. |
| `R16A_OIDC_SCOPES` | `openid profile` | Extra scopes. |
| `R16A_OIDC_MOBILE_REDIRECT` | `r16avault://oidc-callback` | App scheme for mobile sign-in. |

Commands: `r16a-vault-backend serve` (the default), `migrate`, and `healthcheck`, which the distroless image uses because it has no shell or curl.

### Authentik

Create an OAuth2/OpenID provider with:
- Client type **confidential**
- Redirect URI `https://<your host>/api/v1/auth/oidc/callback`
- Scopes `openid profile`
- Signing key RS256

Set the issuer URL to the provider's `/application/o/<slug>/` URL. Accounts link on issuer plus subject, never on email. On first sign-in the user picks a username and master password; later sign-ins land on the unlock screen.

## Tests and checks

```sh
# Backend: 58 tests, including sqlx::test integration tests for every endpoint,
# cross-user isolation, throttling, expiry, CSRF and OIDC against a mock provider
cd backend
cargo test
cargo clippy --all-targets -- -D warnings
cargo fmt --check
cargo deny check
cargo audit --ignore RUSTSEC-2023-0071

# After changing a query, refresh the offline cache used by Docker builds
cargo sqlx prepare -- --all-targets

# After changing the API, refresh docs/openapi.json
R16A_WRITE_OPENAPI=1 cargo test --test openapi

# Web: 75 tests, including the shared crypto vectors, TOTP, generator statistics,
# guards, clipboard, and reveal/copy component tests
cd web && npm test && npm run lint && npm run format:check

# Mobile: 48 tests, including the shared vectors, TOTP, generator, and credential tile widgets
cd mobile && flutter test && flutter analyze

# Mobile flows against a running server
R16A_LIVE_URL=http://localhost:8080 flutter test test/live_api_test.dart

# Interop guard: recompute every libsodium vector with RustCrypto
cd shared/tools/vector-verify && cargo run --release

# Regenerate the vectors (only when the protocol changes, on both clients)
cd shared/scripts && npm ci && npm run generate

# Kubernetes manifests
docker run --rm -v "$PWD/deploy/k8s":/m:ro ghcr.io/yannh/kubeconform -strict -summary \
  -ignore-filename-pattern 'kustomization|sops' /m

# Image scan
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy image \
  --severity HIGH,CRITICAL r16a-vault-web:local
```

### Manual end-to-end checklist

Against `docker compose up`, with the browser's network tab open:

1. Open <http://localhost:8080>; you land on **Sign in**. Create an account and read the warning that the master password can't be recovered.
2. The empty vault shows **Add credential**. Add one with a website such as `example.com` (it becomes `https://example.com/`) and authenticator secret `JBSWY3DPEHPK3PXP`. The dialog previews the current code.
3. Expand the row. Reveal the password (the eye button reads as pressed); it hides again after 30 seconds. Copy the username, password and code. The toast says the clipboard will be cleared in 30 seconds.
4. **Show code** shows a grouped live code with a countdown.
5. In **Generator**, try password and passphrase modes, check the entropy label, and use **Use in a new credential**.
6. In **Settings**, switch the theme and reload; the choice is kept. Reloading also locks the vault: unlock with your password.
7. Press **Lock**, then unlock. Change the master password; signing in with the old one now fails and the new one works, and your entries are still there.
8. Delete the credential (the confirmation names it). Delete the account by typing the username and password; signing in now fails.
9. In the network tab, check that no request or response contains a credential field, the master password, or the session token. Bodies hold only base64 ciphertext, key proofs and salts.

## Running it for other people

If you host accounts for anyone beyond your household you are responsible for their personal data. Read [docs/OPERATING.md](docs/OPERATING.md) for what the server stores, retention, backups, answering user requests, incident handling and the steps before publishing the mobile apps, and publish a privacy notice based on [docs/PRIVACY_NOTICE_TEMPLATE.md](docs/PRIVACY_NOTICE_TEMPLATE.md).

## Deploy to Kubernetes

The manifests in `deploy/k8s` assume a kubeadm cluster with Traefik, cert-manager and an existing PostgreSQL instance.

1. On PostgreSQL, run `psql -v owner_pw='...' -v app_pw='...' -f deploy/k8s/provision.sql` as a superuser.
2. Push the two images to your registry. Replace `registry.example.internal/...:0.1.0` in `backend.yaml`, `web.yaml` and `migrate-job.yaml`, and `vault.example.com` in `configmap.yaml` and `ingress.yaml`.
3. In `networkpolicy.yaml`, set the PostgreSQL and Authentik addresses (`10.0.0.10/32`, `10.0.0.20/32`). In `configmap.yaml`, set the pod CIDR of your CNI (`R16A_TRUSTED_PROXY_CIDRS`). The policies assume Traefik runs in a namespace called `traefik`.
4. Copy `secret.template.yaml` to `secret.dec.yaml`, fill it in, and encrypt it with `sops --encrypt secret.dec.yaml > secret.enc.yaml` using the age key in `.sops.yaml`. Delete the plaintext copy; `*.dec.yaml` is git-ignored.
5. Apply the namespace and secret. Run `kubectl apply -f migrate-job.yaml` and wait for it to complete; rename the Job for every release. Then run `kubectl apply -k deploy/k8s`.

Every pod:
- runs as non-root with a read-only root filesystem
- drops all capabilities and uses the `RuntimeDefault` seccomp profile
- has no service account token mounted

The namespace enforces the Pod Security `restricted` profile. Network policies deny everything except Traefik to web and backend, web to backend, backend and migration to PostgreSQL, and backend to Authentik.

## Known limitations

- **Web delivery trust.** Whoever controls the server can serve modified JavaScript that captures your master password. That's true of every browser-based end-to-end encrypted app. The strict CSP, Trusted Types and SRI make injection harder, not impossible; the mobile app isn't exposed this way.
- **No rollback protection.** A malicious server can't read or swap entries, but it can delete them or replay an older version of the same entry.
- **Metadata.** The server sees how many entries you have, rough blob sizes, timestamps, IP addresses and user agents.
- **Memory.** JavaScript and Dart strings can't be wiped. Byte buffers and libsodium keys are wiped and plaintext is dropped quickly, but this is best effort.
- **Clipboard on web.** If the browser blocks reading the clipboard, it's cleared after 30 seconds regardless, which can erase something you copied later. OS clipboard managers may keep copies.
- **Username enumeration** is possible through registration (the "taken" message). It's rate limited; turn off registration after setup.
- **Rate limits are per replica.** The per-account backoff is global (stored in the database). Under a distributed guessing attack, anonymous sign in to one account can be slowed to about one attempt a minute; unlocking an existing session is never affected.
- **Kubernetes needs a NetworkPolicy-enforcing CNI** (Calico, Cilium). See [deploy/k8s/README.md](deploy/k8s/README.md).
- **No project licence or security contact yet.** Add a `LICENSE` and `SECURITY.md` before sharing the code.
- **No account recovery**, by design. A forgotten master password means a lost vault.
- **Not yet done:** editing a credential, linking an existing local account to OIDC, export, QR import of authenticator secrets, biometric unlock, a browser extension.
- **Mobile** was tested with unit, widget and live API tests and a debug APK build. It hasn't been run on a device or emulator, and the iOS build hasn't been tried.
- **OIDC** was tested against a mock provider that signs real RS256 tokens, not against a live Authentik instance.
