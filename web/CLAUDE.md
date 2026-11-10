# web

The Zaltys web client. Angular 22.2 with TypeScript 6.0, standalone, signals, zoneless, Vitest through the Angular CLI. It is served by nginx (`nginx/`, `Dockerfile`) with a strict CSP. Architecture and headers are described in `docs/SPEC.md` section 8.

## Rules specific to this folder

- Use Node 24.22.2 (`source ~/.nvm/nvm.sh && nvm use 24.22.2`). Angular 22 needs Node 24.15 or newer.
- The protocol, credential codec, TOTP, generator, URL normalisation and design tokens live in `packages/vault-core` and `packages/design-tokens`, shared with the extension. Change them there, never by copying into `web/`. In web, only `core/crypto/` (`vault-crypto.service.ts`, `pwhash.worker.ts`) calls into the crypto. Everything else passes domain values and base64 strings.
- The vault key lives only in `VaultSessionStore` as a private field, reached through `withKey`. Never copy it into a signal, a service field, storage or a log.
- Every component is `OnPush`. Feature code goes in `auth/`, `credentials/`, `generator/`, `settings/` and `shell/`. Cross-cutting services go in `core/` and presentational pieces in `shared/`.
- Never use `innerHTML`, `bypassSecurityTrust*`, inline `<script>`, inline event handlers or `style` attributes built from strings at runtime. Trusted Types and the CSP block them in production even when `ng serve` does not.
- A service that adds listeners to `document` or `window` must remove them through `DestroyRef`. See Gotchas.
- Colours come only from the semantic tokens in `packages/design-tokens/tokens.css`, loaded before `src/styles.css` through `angular.json`. A new token needs a light and a dark value (dark is defined twice, for `[data-theme='dark']` and for the system preference), and new text pairings need a contrast row in SPEC 10.2.
- Icons are a generated subset. Add the name to `scripts/gen-icons.mjs`, run `node scripts/gen-icons.mjs`, and use `<app-icon name="...">`. Use icons only when they are the whole control, carry state, or mark an error. Never decorate labelled buttons.

## Responsibilities

- `VaultCryptoService` is the Angular wrapper around `@zaltys/vault-core`. It derives keys with Argon2id in `pwhash.worker.ts`, wraps and unwraps the vault key, and delegates blob sealing and opening to the shared credential codec. KDF bounds are enforced by `assertAcceptableKdf` in `vault-core`.
- `VaultSessionStore` holds `status` (`unknown`, `anonymous`, `locked`, `unlocked`), the username, the vault key and `lockEpoch`. `lock()` wipes the key and bumps `lockEpoch` so views drop decrypted secrets.
- `SessionService` bootstraps state from `/me`, runs login, register, unlock and logout, and calls the API through `core/api/`.
- Guards in `core/session/guards.ts` admit exactly one state each. `anonymousGuard` covers login and register, `lockedGuard` covers unlock, `unlockedGuard` covers the shell with vault, generator and settings. Any other state redirects to its home route.
- `AutoLockService` locks after inactivity (default 5 minutes, choices 1, 5, 15, 30, stored in localStorage) and when the tab stays hidden for 60 s.
- `ClipboardService` clears copied secrets after 30 s, retries when the page regains focus, and clears immediately on lock.

## How to do common tasks

- Install with `npm ci` at the repo root, not in `web/`. Run `npm start` for dev on port 4200, proxying `/api` to `127.0.0.1:8081`. The backend must run with `R16A_PUBLIC_URL=http://localhost:4200`.
- Test, lint, format and build with `npm test`, `npm run lint`, `npm run format` or `format:check`, and `npm run build`. `npm run build` first runs `sync-shared`, which copies the wordlist and licence texts from `shared/` into `public/`.
- To try the real CSP locally, run `docker compose -f deploy/compose/docker-compose.dev.yml --profile web up -d --build`, which serves on port 8080.
- For a new route, lazy-load the page in `app.routes.ts` under the right guard and set `title` to "<Page> · Zaltys".
- For a password field that must not be autofilled, use `<app-password-input noAutofill>`. It sets `autocomplete="new-password"` plus the 1Password, LastPass, Bitwarden and Dashlane opt-outs, because browsers ignore `autocomplete="off"` on password fields.

## CSP and nonce

- nginx sets `$csp_nonce` from `$request_id` and replaces `__CSP_NONCE__` in `index.html` (`<app-root ngCspNonce="__CSP_NONCE__">`) through `sub_filter`. Angular then uses it for runtime styles and its import map. `index.html` is `no-store` because it carries the nonce.
- `inlineCritical` must stay `false` in `angular.json`, because critical CSS inlining relies on an inline `onload` handler.
- The theme is applied before first paint by `public/theme-init.js`, an external file because inline scripts are forbidden.
- The Trusted Types `default` policy (`core/crypto/trusted-types.ts`) accepts only same-origin `worker-*.js` URLs. A new worker or third-party script loader breaks unless it fits that pattern.
- Never add `'unsafe-inline'`, `'unsafe-eval'`, external hosts or CDN fonts. Fonts are self-hosted through Fontsource.

## Accessibility

Controls are 36 px on fine pointers and 44 px on touch, with 16 px inputs on touch so iOS does not zoom. Every input has a label, and errors link through `aria-describedby` with `role="alert"` on form errors. Toggles expose `aria-pressed`, and focus rings use `--color-focus`. Reduced motion drops movement. Text contrast is AA and measured in SPEC 10.2.

## Gotchas

- With few CPUs (CI runners, `taskset -c 0`), Vitest runs several spec files in one worker that shares `document`. A service that never removes its listeners keeps reacting to events from later files. Reproduce with `taskset -c 0 npx ng test --watch=false`.
- Every nginx `location` that adds a header must `include /etc/nginx/snippets/security-headers.conf`, because `add_header` in a location drops all inherited headers.
- The nginx template is rendered with envsubst, which only replaces variables that are defined. Give every new `R16A_*` variable an `ENV` default in the `Dockerfile`, or it stays literal in the config.
- `@zaltys/vault-core` ships TypeScript source, not built JavaScript. `angular.json` excludes it from the dev server's dependency pre-bundling (`serve.options.prebundle.exclude`), otherwise `ng serve` fails with `Could not resolve './protocol'` while `ng build` still works. Any new source-only workspace package needs the same entry.
- `ng serve` sends no CSP, so CSP and Trusted Types violations show up only in the Docker or production build.
