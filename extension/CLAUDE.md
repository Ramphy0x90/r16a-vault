# extension

The Zaltys browser extension, Manifest V3 for Chromium (121+) and Firefox (140+) from one WXT 0.21.5 project. The design, threat model and permissions are in `docs/EXTENSION_SPEC.md`; read it before changing anything security relevant.

## Rules specific to this folder

- **Trust zones.** The background, popup, options and offscreen pages are trusted. The page fill function (`src/fill/page.ts`) runs inside hostile pages. The vault key, wrap key, auth key and token never reach it. It receives one username and password for one fill, after a click.
- **No page-to-extension channel.** There are no declared content scripts, no `onMessageExternal`, no `externally_connectable` and no `web_accessible_resources`. The fill function returns values from `scripting.executeScript` and never sends messages.
- **Every message** goes through `parseMessage` and `isTrustedSender` (`src/messages/schema.ts`). A new message type needs an exact schema there, a handler in `src/background/router.ts`, and tests in `test/schema.test.ts`. Never add a generic "decrypt" or "get credential by id" message.
- **Storage.** The vault key lives only in `storage.session` (`src/background/store.ts`). Never put it in `storage.local`, IndexedDB, a module variable that outlives a call, or a message to the popup. Plaintext secrets leave the background one value at a time (`vault.reveal`, fill).
- **Permissions.** Changing permissions means updating `wxt.config.ts`, `test/manifest.test.ts`, and the table in EXTENSION_SPEC section 4 together. No `<all_urls>`, no `tabs`, no `clipboardRead`.
- **Shared code.** Crypto, TOTP, the generator, URL matching and URL normalisation come from `@zaltys/vault-core`; colours from `@zaltys/design-tokens`. Never copy them here.
- **UI.** Build it with `src/ui/dom.ts`, which sets `textContent` and attributes only. Never use `innerHTML`. Prefer text buttons over icons.
- **Background.** Every background listener is registered synchronously in `src/entrypoints/background.ts`, because Chrome only wakes the worker for listeners registered at startup. Keep state in storage, not in module variables.

## How to do common tasks

- Build with `npm run build:chrome` / `npm run build:firefox`, and package with `npm run zip:chrome` / `npm run zip:firefox`.
- Check with `npm run typecheck`, `npm run format:check`, `npm test` and `npm run test:e2e` (needs `npx playwright install chromium` once). Validate the Firefox build with `npx web-ext@10.8.0 lint --source-dir .output/firefox-mv3`.
- The live flow test is `npm run test:e2e:flow`. It needs `R16A_E2E_DATABASE_URL` (the dev app role) and a debug backend build. It starts its own backend with this extension's origin allowed.
- **Fill rules.** Change `src/fill/page.ts` (what is visible and fillable) or `src/background/fill.ts` (whether to fill at all), and add a fixture or case in `test/page.test.ts`. jsdom has no layout, so size and clipping rules must also pass the live flow test in a real browser.

## Gotchas

- `src/fill/page.ts` is serialised with `Function.prototype.toString`. It must not reference imports, module constants or helpers outside its own body. A test rebuilds it from its source text to catch this.
- `URL.origin` is the opaque `"null"` for extension schemes in some environments, which makes every extension page look alike. Compare extension URLs as strings against `runtime.getURL('/')`, as `isTrustedSender` does.
- Chrome service workers reject dynamic `import()`. WXT bundles the background as an IIFE, so libsodium's lazy import is inlined. Check `background.js` after dependency changes.
- Firefox popups cannot show `confirm()` or `alert()`, so questions are inline bars.
- `permissions.request` only works directly inside a click or submit handler, on both browsers.
- CI runs the Chromium tests inside `mcr.microsoft.com/playwright`, because the self-hosted runner lacks Chromium's system libraries (`libnspr4.so` errors). Bumping `@playwright/test` means updating that image tag and digest in `.github/workflows/deploy.yaml` too.
- Firefox has no `offscreen` API and no `storage.session.setAccessLevel`. Firefox already keeps session storage away from content scripts.
- The wordlist is copied from `shared/` by a build hook, so `browser.runtime.getURL` types don't list it.
- A real browser gives a `width: 0` input a few pixels of padding and border. The fill function's minimum size of 8 px exists because of that; a jsdom-only test missed it.
