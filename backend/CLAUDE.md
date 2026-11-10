# backend

The Zaltys API server. Rust 2024 (MSRV 1.94), axum 0.8, sqlx 0.9 on PostgreSQL 13 or later, crate `r16a-vault-backend`. API contract and data model are in `docs/SPEC.md` sections 4 to 7.

## Rules specific to this folder

- `#![forbid(unsafe_code)]`. Clippy runs with `-D warnings`, rustfmt `max_width = 120`, `cargo deny check` must pass (`deny.toml` ignores RUSTSEC-2023-0071 with a stated reason).
- Handlers do HTTP only, `service.rs` holds the rules, repositories hold SQL only. In `auth/` the users SQL lives in `users.rs`.
- SQL goes through `sqlx::query!` macros so it is checked at compile time. The offline cache in `.sqlx/` is committed and must be refreshed after any query change.
- Request bodies use `ApiJson<T>` (`http/json.rs`), never axum's `Json` extractor, so framework errors that may echo input never reach the client. DTOs carry `#[serde(deny_unknown_fields)]`.
- Binary fields arrive as base64 and are checked by `http/wire.rs` (length, version byte). The server never inspects ciphertext beyond the envelope.
- Errors are `AppError` (`error/mod.rs`), rendered as RFC 9457 problem+json with `type` `urn:r16a:problem:<slug>` and a `requestId`. `Internal(String)` is logged, never shown. Never put secrets or input values into an error.
- Proof endpoints (anything that verifies an `authKey`) must call `state.ip_limiter.check(ip)` and go through `auth::service::verify_proof`, which claims throttle buckets before Argon2 runs. Prelogin and OIDC redirects use `state.prelogin_limiter`.
- Credential queries always filter on the session's `user_id`. Not found and not owned both return 404.

## Module layout

`main.rs` (subcommands `serve`, `migrate`, `healthcheck`), `app.rs` (router and middleware order), `config/` (env parsing, fail fast), `error/`, `http/` (CSRF, client IP, rate limiter, request id, JSON and base64 wire helpers), `auth/` (prelogin, register, login, unlock, logout, throttle, username normalisation), `sessions/` (token issue and rotation, `AnySession` and `FullSession` extractors, cleanup task), `account/` (`/me`, sessions list, change password, delete), `credentials/`, `oidc/`, `crypto/` (server hashing and HMAC only, no vault crypto), `openapi.rs`, `state.rs`.

## How to do common tasks

**Add an endpoint end to end**
1. DTOs in the module's `dto.rs` with `deny_unknown_fields`, `utoipa::ToSchema`, and a redacting `Debug` for any key material.
2. Handler in `handlers.rs` with a `#[utoipa::path(...)]` annotation. Take `FullSession` (unlocked only) or `AnySession` (also `pre_auth`), `State<AppState>` and `ApiJson<T>`.
3. Rules in `service.rs`, SQL in `repository.rs` with `sqlx::query!`.
4. Route it in `app.rs` under the `api` router. Cookie requests that change state pass the CSRF layer automatically.
5. Register the handler in `openapi.rs` `paths(...)`, then refresh `docs/openapi.json` with `R16A_WRITE_OPENAPI=1 cargo test --test openapi`.
6. Integration tests in `tests/<feature>.rs` with `#[sqlx::test]`, covering auth failure, invalid input and cross-user access.

**Add a migration.** Create `migrations/<timestamp>_<name>.sql`. Never edit an applied migration (see Gotchas). Write SQL that runs on PostgreSQL 15, the production version. Migrations run as the schema owner. The runtime role only gets `select, insert, update, delete` through default privileges, so a migration needing other grants must state them.

**Refresh the sqlx cache.** `SQLX_OFFLINE=false DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/r16a cargo sqlx prepare -- --all-targets`. Check with `cargo sqlx prepare --check -- --all-targets`.

**Add a config value.** Parse it in `config/mod.rs` with a clear error naming the variable, never its value. Secrets go through `secret_bytes` (no default, length, placeholder and repetition checks). Document it in the README config table.

## Config

Env vars are `R16A_*`. Required are `R16A_DATABASE_URL`, `R16A_PUBLIC_URL` and `R16A_PRELOGIN_SECRET`. `R16A_AUTH_PEPPER` is optional but must never change once accounts exist. The full table is in the README. `R16A_DEV_INSECURE_COOKIE=true` enables plain HTTP and the dev cookie name, and startup fails if it is set with an https public URL. Debug builds load `backend/.env` through dotenvy; release builds and containers read only the real environment.

## Database roles and migrations

Two roles, see SPEC 6.1. The owner runs `r16a-vault-backend migrate` (env `R16A_MIGRATE_DATABASE_URL`), the server connects as the app role, which owns nothing. Compose names them `r16a_owner` and `r16a_app`, Kubernetes uses `r16a_vault_owner` and `r16a_vault_app`. `R16A_MIGRATE_ON_START=true` lets `cargo run` migrate itself, for local use only.

## Rate limiting and throttling

Two layers, SPEC 4.7. `http/rate_limit.rs` is an in-memory per-IP GCRA limiter per replica. `auth/throttle.rs` is the global per-account backoff in `login_throttle`, keyed by labelled HMACs so the table holds no usernames, IPs or session ids. Each attempt is claimed by one atomic upsert before Argon2. Server Argon2 runs in `spawn_blocking` behind a semaphore and refuses with 429 after a 2 s wait.

## Tests

`#[sqlx::test]` gives each test a fresh database with migrations applied, so `DATABASE_URL` must point at a server where that user can create databases. `tests/common/mod.rs` builds a test `Config` and app. The OIDC tests run against an in-process provider with the key in `tests/fixtures/`.

## Gotchas

- Editing an applied migration changes its checksum, and every database that already ran it refuses to start. Production had not applied `0001` when `uuidv7()` was replaced, and the dev DB checksum was patched by hand. Add a new migration instead.
- `uuidv7()` exists only from PostgreSQL 18. The shared cluster runs 15 and CI tests on `postgres:15`. Dev compose still uses 18, so dev alone will not catch this.
- `backend/.env.example` sets `SQLX_OFFLINE=true`, which the query macros also read. Override with `SQLX_OFFLINE=false` when running `cargo sqlx prepare`.
- `parallel_attempts_cannot_share_one_window` is timing sensitive. It allows one extra pass per elapsed backoff window, because slow CI runners let a window expire mid-burst.
- The `migrate` command does not load the full server config, so it fails only on the database URL. Its errors carry no URL or password.
