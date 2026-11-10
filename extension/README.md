# Zaltys browser extension

Unlock your Zaltys vault from the browser toolbar, find the credentials for the current site, fill them into the page, copy passwords and one-time codes, and generate passwords. One codebase builds for Chromium browsers (Chrome 121+) and Firefox (140+).

The design and its security model are in [docs/EXTENSION_SPEC.md](../docs/EXTENSION_SPEC.md). In short:
- The vault key lives only in the browser's in-memory session storage.
- Web pages never get a channel to the extension.
- A page receives one username and password, only after you click Fill, and only if it's still the https site the credential belongs to.

## Build

From the repository root, run `npm ci` once. Then, in `extension/`:

| Command | Result |
|---|---|
| `npm run build:chrome` | Unpacked build in `.output/chrome-mv3/` |
| `npm run build:firefox` | Unpacked build in `.output/firefox-mv3/` |
| `npm run zip:chrome` | `.output/zaltysextension-<version>-chrome.zip` |
| `npm run zip:firefox` | Firefox zip, plus the sources zip that Firefox Add-ons reviewers ask for |
| `npm test` | Unit tests (message validation, fill rules on fixture pages, manifest permissions) |
| `npm run test:e2e` | Playwright tests against the built Chromium extension |
| `npm run test:e2e:flow` | Full sign in, fill and lock flow against a live backend (see below) |
| `npm run typecheck`, `npm run format:check` | Static checks |

Nothing here publishes to a store.

## Load it

- **Chrome, Edge, Brave:** open `chrome://extensions`, turn on Developer mode, choose *Load unpacked*, and pick `.output/chrome-mv3`.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, choose *Load Temporary Add-on*, and pick `.output/firefox-mv3/manifest.json`. Alternatively run `npx web-ext@10.8.0 run --source-dir .output/firefox-mv3`.

## Connect it to your server

1. **Set the server.** Open the extension's settings, enter your server address and choose *Connect*. The browser asks for access to that one site. The extension has no access to any site until then.
2. **Sign in** from the toolbar popup. The server accepts any Zaltys extension by default, so nothing changes on the server.
3. **Restricting extensions (optional).** An operator who wants only specific installs can set `R16A_EXTENSION_ORIGINS` on the backend, using the origin shown under *For your server operator*. A Chrome origin stays the same for a store install, or for an unpacked folder that doesn't move. A Firefox origin is random per install.
4. **Single sign-on (optional).** Add the redirect URL shown on the same page to `R16A_OIDC_EXTENSION_REDIRECTS`.

## Manual test run

The pages in `test/fixtures/` cover the cases the fill rules must handle:

```sh
cd extension/test/fixtures
python3 -m http.server 8765 --bind 127.0.0.1    # serves http://localhost:8765/
```

1. In the extension settings, turn on *Allow filling on http://localhost*. It's for development only and off by default.
2. Add a credential with website `http://localhost:8765`.
3. Open each page and use *Fill* in the popup:

| Page | Expected |
|---|---|
| `login.html` | Email and password filled, the search box above them stays empty |
| `multi-step.html` | Only the username filled |
| `hidden-trap.html` | Refused, "No visible login fields". Every field stays empty |
| `cross-site-action.html` | Asks first, because the form posts to `collector.example.net`. Fills only after *Fill anyway* |
| `cross-origin-iframe.html` | Refused, nothing filled inside the frame |
| `http-page.html` served from another machine's IP over http | Refused, "only fills pages served over https" |

Also check:
- **Auto-lock:** set *Lock after* to 1 minute, wait, reopen the popup, and it asks to unlock.
- **Clipboard:** copy a password, wait 30 seconds, and paste somewhere. The clipboard is empty.
- **Screen lock:** lock the screen while unlocked; the popup asks to unlock afterwards.

`npm run test:e2e:flow` automates most of the table above in Chromium against a real backend:

```sh
(cd ../backend && cargo build)
R16A_E2E_DATABASE_URL=postgres://r16a_app:app-dev-password@127.0.0.1:5432/r16a npm run test:e2e:flow
```

It uses a separate build (`--mode e2e`) that is granted `http://localhost` up front, because tests can't click the permission prompt. Release builds never carry that permission, and `test/manifest.test.ts` checks it.

## Known limitations

- **Firefox is tested by hand only.** Playwright cannot load Firefox extensions. `web-ext lint` passes and Firefox 153 ESR installs the build, but the flows above still need a manual run on Firefox.
- **Clipboard clearing on Firefox may be best effort.** Mozilla documents that background clipboard writes can be refused. A clear that fails is retried on lock. On Chromium, clearing is verified by an automated test.
- **The clipboard is cleared unconditionally after 30 seconds,** like the web app's fallback. Checking first would need the `clipboardRead` permission, which the extension deliberately doesn't request.
- **Only the top frame is filled.** Login forms inside iframes, even same-origin ones, are not filled in v1.
- **Firefox for Android is untested.** Its manifest minimum is set only so the data collection declaration validates.
- **Firefox data collection declaration:** `authenticationInfo` is declared because sign-in proofs and encrypted vault data go to the server you configure. Review this before any submission to Firefox Add-ons.
