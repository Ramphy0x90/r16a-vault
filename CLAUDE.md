# Zaltys

Zaltys is a self-hosted, zero-knowledge credential vault. All vault crypto runs on the client, so the server stores only ciphertext it cannot decrypt. It is a Rust (axum) backend on PostgreSQL, an Angular web app and a Flutter mobile app.

The repo, crates, packages and env vars still use the old name `r16a-vault` / `R16A_`. Keep those identifiers; say "Zaltys" in prose and user-facing text.

## Non-negotiable rules

- Agents never commit, push, tag, stash, reset, rebase or switch branches. `git status` and `git diff` are fine. Leave every change in the working tree for the human.
- Never implement crypto primitives. Clients use libsodium (`libsodium-wrappers-sumo` on web, `sodium` on Flutter). The server uses audited RustCrypto crates (`argon2`, `hmac`, `sha2`, `subtle`).
- Never log, return or put in errors any secret. That covers master passwords, auth keys, session tokens, vault keys and ciphertext blobs. DTOs holding key material print `[redacted]` in `Debug`.
- Comments explain behaviour, intent, invariants and the non-obvious why. Never restate the code. No colon and no em dash inside comment sentences.
- Verify library versions against the registry (crates.io, npm, pub.dev) before adding or bumping, never from memory.
- Secrets never have defaults. At startup the backend refuses a missing required secret and any placeholder or repetitive secret value.

## Security invariants

Breaking any of these is a security bug. Details live in `docs/SPEC.md`.

- The server never receives the master password, master key, wrap key or unwrapped vault key (SPEC 3, 3.3).
- The vault key exists only in client memory and is never written to any storage (SPEC 2.1, 8.2, 9.2).
- Every credential blob is XChaCha20-Poly1305 with the vault key, a fresh random 24 byte nonce, and AAD `r16a-vault:cred:v1:{id}:{meta|secret}` (SPEC 3.4, 3.5).
- `wrappedVaultKey` is returned only after an `authKey` proof, by login or `/auth/unlock`, never by `/me` (SPEC 4.5, D1).
- Every credential query is scoped by the session's `user_id`. Foreign ids return 404, never 403 (SPEC 5, R7).
- Both clients must pass `shared/crypto-test-vectors.json`. A crypto change means new vectors and both clients changed together (SPEC 3.8).
- Any change to KDF parameters or bounds, AAD format, blob format, token handling or session lifetime is a security change and needs a `docs/DECISIONS.md` entry.

## Architecture

Same-origin deployment. nginx serves the web app at `/` and proxies `/api` to the backend, so the API emits no CORS headers. The web client authenticates with an HttpOnly `__Host-session` cookie plus a CSRF header and Origin check. Mobile uses a bearer token kept in platform secure storage. The server stores an Argon2id hash of `auth_key`, the SHA-256 of session tokens, and opaque blobs. Per-account login throttling lives in PostgreSQL, so it holds across replicas.

```
master_password (NFC) + kdf_salt --Argon2id (client, >= 64 MiB, t>=3)--> master_key
master_key --kdf id 1 "r16aauth"--> auth_key   (sent to server, stored as Argon2id hash)
master_key --kdf id 2 "r16awrap"--> wrap_key   (never leaves the client)
vault_key  = random 32 B at registration, wrapped by wrap_key, AAD "r16a-vault:vk:v1"
credential = meta blob + secret blob, each sealed with vault_key and AAD bound to id and field
```

## Repo map

- `backend/` Rust API server, migrations, `sqlx` offline cache in `.sqlx/`.
- `web/` Angular 22 app, nginx config and its Dockerfile.
- `mobile/` Flutter app (Android and iOS).
- `shared/` crypto test vectors, the EFF wordlist, the vector generator (`scripts/`) and the independent RustCrypto checker (`tools/vector-verify`).
- `deploy/` Docker Compose (prod-like and dev) and Kubernetes manifests.
- `docs/` SPEC (source of truth), DECISIONS, OPERATING guide, privacy notice template, generated `openapi.json`.
- `.github/workflows/deploy.yaml` CI that tests, scans, builds, pushes and deploys on push to `main`.

## Commands

All verified on 2026-11-10. Web needs Node 24.22.2 (`source ~/.nvm/nvm.sh && nvm use 24.22.2`).

| Task | Command |
|---|---|
| Dev database | `docker compose -f deploy/compose/docker-compose.dev.yml up -d` |
| Whole stack in Docker | `cd deploy/compose && cp .env.example .env` (fill it), then `docker compose up -d --build` |
| Backend run | `cd backend && cargo run` (reads `backend/.env` in debug builds) |
| Backend test | `cd backend && DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres cargo test` |
| Backend lint | `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo deny check` |
| Web run | `cd web && npm start` (port 4200, proxies `/api` to 8081) |
| Web test, lint, build | `npm test`, `npm run lint`, `npm run build` |
| Web format | `npm run format` or `npm run format:check` |
| Mobile | `cd mobile && flutter analyze`, `flutter test`, `dart format lib test`, `flutter run` |
| Vector check | `cd shared/tools/vector-verify && cargo run --release` |
| k8s validation | `docker run --rm -v "$PWD/deploy/k8s":/m:ro ghcr.io/yannh/kubeconform:latest -strict -summary /m` |

Per-app details and less common commands are in each app's `CLAUDE.md`.

## Conventions

- Feature-oriented folders in every app. Cross-cutting code lives in `core/`, reusable presentational pieces in `shared/` (web) or `core/ui/` (mobile).
- Smart and dumb split. Containers and services or providers own logic and I/O. Presentational components and widgets take inputs and emit events.
- Backend modules split `handlers.rs` (HTTP only), `service.rs` (rules) and `repository.rs` (SQL only, compile-time checked).
- Web is standalone components, signals, zoneless, `OnPush`, typed reactive forms, functional guards.
- Mobile uses Riverpod notifiers and providers, with go_router redirects driven by the lock state.
- Colours are HSL design tokens with semantic names (`--color-surface`, `--color-text-muted`). Components never use raw colours. Contrast is measured in SPEC 10.2.

## Where to look next

- [backend/CLAUDE.md](backend/CLAUDE.md), [web/CLAUDE.md](web/CLAUDE.md), [mobile/CLAUDE.md](mobile/CLAUDE.md), [deploy/CLAUDE.md](deploy/CLAUDE.md)
- [docs/SPEC.md](docs/SPEC.md) for crypto, API contract, data model and threat model
- [docs/DECISIONS.md](docs/DECISIONS.md) for why things are the way they are
- [docs/OPERATING.md](docs/OPERATING.md) for running Zaltys for other people (GDPR, retention, incidents)

## Keeping these files current

When a change alters a rule, command, invariant or folder structure documented in a `CLAUDE.md`, update that file in the same change. When a design decision is made or reversed, add or supersede an entry in `docs/DECISIONS.md`. Crypto and API detail belongs in `docs/SPEC.md`, not here.
