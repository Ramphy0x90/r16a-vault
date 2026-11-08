# Privacy notice template

Fill in everything in square brackets, remove what does not apply, have it reviewed, publish it, and set `R16A_PRIVACY_URL` to its address. This is a starting point, not legal advice.

---

# Privacy notice for [service name]

Last updated [date]

## Who we are

[Name of the person or organisation running this server], [postal address], [email]. We are responsible for the personal data described here. [Data protection officer or representative, if any.]

## What this service is

[Service name] is a password vault. Your entries are encrypted on your own device before they reach our server. We cannot read them, and we never receive your master password.

## What we process and why

| Data | Purpose | Legal basis | How long |
|---|---|---|---|
| Your username | Your account | Contract (GDPR Art. 6(1)(b)) | Until you delete your account |
| Encrypted vault entries, their number, size and timestamps | Storing your vault | Contract | Until you delete them or your account |
| Technical account data (a hash derived from your master password, a salt, your encrypted vault key) | Letting you sign in and unlock | Contract | Until you delete your account |
| Your devices and their last activity (browser or app type, times) | Keeping you signed in; letting you review and end sessions | Contract and our legitimate interest in security (Art. 6(1)(f)) | Until the session ends, at most [12 hours] |
| Your network (IP address shortened to its first three parts) and the pages requested | Protecting the service against abuse | Legitimate interest in security | [About N days] |
| Counts of failed sign in attempts, stored in a form that cannot be linked back to you | Slowing down password guessing | Legitimate interest in security | 24 hours after the last attempt |
| [Your identity at Authentik (issuer and subject)] | [Signing in with single sign on] | [Contract] | [Until you delete your account] |

We do not use analytics, advertising or tracking. The web app stores only your theme and auto lock settings in your browser.

## Backups

[We back up the database every N and keep backups for N days.] After you delete your account, your data disappears from backups once those have expired.

## Who receives data

[Hosting provider, country.] [Identity provider, if used.] We do not sell or share your data otherwise.

## Transfers abroad

[None / Countries and safeguards.]

## Your rights

You may ask for access to your data, correction, deletion, restriction, objection and, where applicable, portability. You can delete your account yourself in Settings > Delete account. To exercise other rights, contact [email]. We cannot provide the contents of your vault, because only your device can decrypt it. Exporting entries yourself is [not yet available / available in Settings].

You can complain to a supervisory authority, in Switzerland the Federal Data Protection and Information Commissioner (FDPIC), in the EU the authority of your country.

## Security

Your vault is encrypted with Argon2id and XChaCha20-Poly1305 on your device. Connections use TLS. Choose a strong master password, it cannot be recovered or reset.

## Changes

We will update this notice when our processing changes and show the date above.
