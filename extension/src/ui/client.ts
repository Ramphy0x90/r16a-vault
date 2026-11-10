import { browser } from 'wxt/browser';

import type { Message, Reply } from '../messages/schema';

/** Sends a typed message to the background and returns its data, or throws the error slug. */
export async function send<T>(msg: Message): Promise<T> {
  const reply = (await browser.runtime.sendMessage(msg)) as Reply<T> | undefined;
  if (!reply) throw new Error('no-reply');
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}

const MESSAGES: Record<string, string> = {
  'invalid-credentials': 'Wrong username or master password.',
  'too-short': 'Use at least 12 characters.',
  mismatch: 'The two passwords do not match.',
  'too-many-requests': 'Too many attempts. Wait a moment and try again.',
  network: 'The server could not be reached.',
  'no-server': 'Set your Zaltys server in the settings first.',
  'permission-missing': 'Allow access to the server when your browser asks.',
  'invalid-server': 'Use an https address, for example https://zaltys.app.',
  unauthenticated: 'Your session has ended. Sign in again.',
  locked: 'The vault is locked.',
  'decrypt-failed': 'This entry could not be decrypted.',
  'kdf-rejected': 'The server sent unsafe key settings. Contact your server operator.',
  'invalid-totp': 'This does not look like a valid authenticator secret.',
  'invalid-url': 'Use a web address such as example.com.',
  'username-taken': 'That username is taken.',
  'invalid-username':
    'Use an email address, or 3 or more letters, digits, dots, hyphens or underscores.',
  'registration-disabled': 'This server does not accept new accounts.',
  'sso-failed': 'Single sign on did not complete.',
  'oidc-denied': 'Single sign on was cancelled.',
  csrf: 'The server refused this extension. It may need updating, or its operator only allows listed extensions (see settings).',
  'not-secure': 'Zaltys only fills pages served over https.',
  'no-match': 'This entry does not belong to the current site.',
  'no-fields': 'No visible login fields were found on this page.',
  'origin-changed': 'The page changed before filling. Nothing was filled.',
  'insecure-action': 'This form sends its data without https. Nothing was filled.',
  'tab-not-active': 'Switch back to the page and try again.',
  'fill-unavailable': 'Zaltys cannot fill this page.',
};

export function messageFor(error: unknown): string {
  const slug = error instanceof Error ? error.message : String(error);
  return MESSAGES[slug] ?? 'Something went wrong. Try again.';
}
