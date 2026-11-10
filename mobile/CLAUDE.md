# mobile

The Zaltys mobile client for Android and iOS. Flutter 3.44.6 with Dart 3.12, package `r16a_vault`, Android id `dev.r16a.r16a_vault`, iOS bundle `dev.r16a.r16aVault`. Architecture is in `docs/SPEC.md` section 9.

## Rules specific to this folder

- Crypto goes only through `lib/core/crypto/` (`vault_crypto.dart`, `protocol.dart`) on the `sodium` package. Argon2id runs in `sodium.runIsolated`.
- The vault key is a libsodium `SecureKey` held by `VaultController` (`vaultProvider`). It is disposed on lock and never written anywhere.
- Only the session token is stored, through `TokenStore` (`flutter_secure_storage`, iOS `unlocked_this_device`). Server address, theme and auto-lock minutes go in shared preferences (`core/prefs/prefs.dart`). Nothing secret goes into preferences.
- Logic lives in Riverpod notifiers, providers and services. Screens read providers. Small widgets take values and callbacks. Feature code goes in `lib/features/<feature>/`, cross-cutting code in `lib/core/`.
- Vault screens wrap in `SecureScreen` (`core/security/secure_screen.dart`), which uses `no_screenshot` to block screenshots and blur the app switcher. It is applied in `home_shell.dart` and `unlock_screen.dart`.
- Icons come from `tabler_icons_next` through `TIcon` (`core/ui/tabler_icon.dart`), so they pick up the Material icon theme colours. The brand is the plain word "Zaltys" until a real logo exists.
- Colours come from `core/theme/theme.dart`, which builds them with `HSLColor.fromAHSL` from the same hues as web. Never hard-code colours in widgets.

## Providers and routing

- `vaultProvider` holds lock state and the key, `sessionServiceProvider` runs login, register, unlock, SSO and logout, and `apiClientProvider` wraps dio. The client adds the bearer token and `X-R16a-Request`, does not follow redirects, and fires `sessionExpiredProvider` on a 401 `unauthenticated`.
- `credentialsProvider`, `credentialQueryProvider` and `visibleCredentialsProvider` drive the list and search. `generatorProvider` and `wordlistProvider` drive the generator.
- `routerProvider` (`core/router.dart`) is go_router with a redirect on `vaultProvider.status`. Routes are `/login`, `/register`, `/unlock`, and a shell with `/vault` (plus `/vault/add`), `/generator` and `/settings`.

## Auto-lock

`core/autolock/auto_lock.dart` locks after the chosen inactivity minutes, and on resume when the app was hidden longer than 30 s (`backgroundGrace`). Timers do not run while the OS suspends the app, so the background check compares timestamps on resume. Typing on the soft keyboard does not produce pointer events, so forms dispatch a `UserActivity` notification on every change.

## How to do common tasks

- Run `flutter analyze`, `flutter test` and `dart format lib test` (`--output=none --set-exit-if-changed` to check).
- Run against a local server with `flutter run`. On the sign-in screen use `http://10.0.2.2:8080` (Android emulator) or `http://localhost:8080` (iOS simulator). Plain HTTP is allowed only for loopback and emulator hosts in debug builds.
- To test against a live server, use `R16A_LIVE_URL=http://localhost:8080 flutter test test/live_api_test.dart`. It is skipped otherwise.
- Build a debug APK with `flutter build apk --debug`.
- Single sign-on uses a verified https callback, `https://<host>/app/oidc-callback`. The host is fixed at build time and must match in three places, `--dart-define=ZALTYS_SSO_HOST`, the Gradle property `-PssoHost`, and the iOS build setting `SSO_HOST`. The default is `zaltys.app`.

## Gotchas

- iOS has never been compiled here (no macOS). `ios/Runner/PrivacyInfo.xcprivacy` and `Runner.entitlements` were added by hand and must be checked in Xcode.
- Release builds are still signed with the debug key (`android/app/build.gradle.kts`). Store publishing steps are listed in `docs/OPERATING.md` section 8.
- SSO needs iOS 17.4 or later for https callbacks. Older iOS and non-matching servers get a message instead of the flow.
- The clipboard uses a platform channel `dev.r16a.vault/clipboard` (`MainActivity.kt`, `AppDelegate.swift`). Android 13+ marks clips as sensitive, and iOS keeps them off Universal Clipboard with an expiry.
- Android backups are off (`allowBackup="false"` and `data_extraction_rules.xml`), so the stored token never leaves the device.
- `otp` is always called with `isGoogle: true` and an explicit algorithm (SPEC 9.1), because otherwise the secret is not base32 decoded and codes differ from other authenticators.
- The light theme does not match web yet. Web moved to an emerald primary and mint-tinted surfaces on 2026-11-10, while `theme.dart` still uses the older ink primary and grey neutrals. Dark matches.
