# Operating r16a vault

This guide is for anyone who runs an r16a vault server. Most of it matters once you host it for people other than yourself. It is practical guidance, not legal advice. If you serve the public or an organisation, have it reviewed by a qualified lawyer.

## 1. Who is responsible

Whoever runs the server is the controller for the personal data it processes (GDPR Art. 4(7), Swiss FADP Art. 5(j)). The authors of the software never receive any data.

If you run it only for yourself or your household, the GDPR household exemption usually applies (Art. 2(2)(c)). As soon as you offer accounts to others, for example colleagues, a club or customers, you need everything below.

## 2. What the server can and cannot see

| Data | Visible to the operator | Where | Kept until |
|---|---|---|---|
| Vault contents (names, URLs, usernames, passwords, TOTP secrets) | **No**, ciphertext only | `credentials` table | The user deletes the entry or the account |
| Master password | **No**, never sent | nowhere | |
| Account username | Yes | `users.username` | Account deletion |
| Argon2id hash of the derived auth key, KDF salt, wrapped vault key | Yes, but unusable without the master password | `users` | Account deletion |
| Account creation and change times | Yes | `users` | Account deletion |
| Number of entries, approximate sizes and timestamps | Yes | `credentials` | Entry or account deletion |
| Sessions with device user agent, creation and last activity | Yes | `sessions` | Expiry (idle 30 min, absolute 12 h by default) or sign out |
| Authentik link (issuer and subject) | Yes, if SSO is used | `users.oidc_*` | Account deletion |
| Failed sign in counters | Only as unlinkable HMACs | `login_throttle` | 24 h after the last attempt |
| Client network and request line | Yes | nginx access log, truncated to /24 (IPv4) or /48 (IPv6), no user agent | Log rotation, see section 4 |
| Client IP | Briefly, in memory | per IP rate limiter | Minutes, never written |

Users can see and end their own sessions in **Settings > Sessions**.

## 3. Lawful basis and records

A typical record of processing entry (GDPR Art. 30, FADP Art. 12):

| Field | Entry |
|---|---|
| Purpose | Providing an end to end encrypted credential vault; securing the service against abuse |
| Categories of data subjects | Account holders |
| Categories of data | Username, account and session metadata, device user agent, client network, encrypted vault data the operator cannot read |
| Lawful basis | Contract, Art. 6(1)(b), for the account and vault; legitimate interest, Art. 6(1)(f), for security logs, throttling and session records |
| Recipients | Hosting provider; identity provider if SSO is enabled |
| Transfers abroad | Depends on where you host. List the countries |
| Retention | As in sections 2 and 4 |
| Security measures | Client side encryption (Argon2id, XChaCha20-Poly1305), TLS, hashed session tokens, least privilege database roles, network policies |

Put a data processing agreement in place with your hosting provider and, if used, the operator of the identity provider (GDPR Art. 28, FADP Art. 9).

## 4. Retention

| Item | Default | How to change |
|---|---|---|
| nginx and backend logs (compose) | Rotated at 10 MB, 3 files per container | `x-logging` in `deploy/compose/docker-compose.yml` |
| Logs (Kubernetes) | Whatever your cluster log pipeline keeps | Configure your log aggregator; also check whether Traefik access logs are enabled, they contain full client IPs for API calls |
| Database backups | Not configured by this project | Choose a schedule and a retention period, and state it in your privacy notice |

**Backups and erasure.** Deleting an account removes the user, their entries and sessions immediately. Copies in database backups remain until those backups expire. State the backup retention period in your privacy notice and tell users that deleted data disappears from backups after that period.

## 5. Requests from users

**Access (GDPR Art. 15, FADP Art. 25).** The operator can compile everything except vault contents, which only the user's own client can decrypt.

```sql
-- Replace the username
select id, username, created_at, updated_at, oidc_issuer, oidc_subject from users where username = 'alice';
select state, user_agent, created_at, last_seen_at, expires_at from sessions
  where user_id = (select id from users where username = 'alice');
select count(*), min(created_at), max(updated_at) from credentials
  where user_id = (select id from users where username = 'alice');
```

Add any log lines for the user's networks if you can identify them.

**Erasure.** Users delete their own account in Settings. Operators can delete one with `delete from users where username = 'alice';` (cascades to entries and sessions).

**Portability.** Export of decrypted entries is not built yet. Until it is, say so in your privacy notice.

## 6. Security incidents

A database leak exposes usernames, timestamps, device user agents and the SSO link in plain text. Vault entries stay encrypted, but an attacker can try to guess weak master passwords offline at the cost of one Argon2id run (64 MiB) per guess. Encryption therefore does not automatically remove the duty to notify.

1. Contain the incident and preserve evidence.
2. Assess the risk. Consider who is affected and how strong their master passwords are likely to be.
3. Notify the supervisory authority within 72 hours if there is a risk to people (GDPR Art. 33). In Switzerland, notify the FDPIC as soon as possible if the risk is high (FADP Art. 24).
4. Tell users to change their master password and the passwords stored in the vault if the risk is high (GDPR Art. 34).
5. Do not rotate `R16A_PRELOGIN_SECRET` or `R16A_AUTH_PEPPER` in a hurry. Changing the pepper invalidates every login. Plan any rotation as a migration.

## 7. Privacy notice

Start from `docs/PRIVACY_NOTICE_TEMPLATE.md`, publish it, and set `R16A_PRIVACY_URL` so both apps link to it from the sign in and register pages and from Settings.

## 8. Publishing the mobile apps

The repository is not ready for store submission. Before you publish, you need to:

- Replace the template `applicationId`, set up an upload key and Play App Signing, and stop signing release builds with the debug key (`mobile/android/app/build.gradle.kts`).
- Decide the export classification for strong encryption, then set `ITSAppUsesNonExemptEncryption` in `mobile/ios/Runner/Info.plist`. Answering no for a password manager would be incorrect.
- Add `mobile/ios/Runner/PrivacyInfo.xcprivacy` to the Runner target in Xcode, and fill `NSPrivacyCollectedDataTypes` so it matches your App Store privacy label.
- Answer the Play Data safety form and the App Store privacy label consistently with your privacy notice. The publisher receives no data, while each operator receives the data in section 2.
- Publish a web page explaining account deletion, as Play requires: in app via Settings > Delete account, otherwise by contacting the operator.
- Provide a reachable review server and a demo account for app review.
- For single sign-on, put the release key's SHA-256 fingerprint and the iOS app ID into `R16A_ANDROID_CERT_FINGERPRINTS` and `R16A_APPLE_APP_IDS` on the web container, and enable Associated Domains for the app ID. Check with `curl https://zaltys.app/.well-known/assetlinks.json` and Google's Statement List tester.
