import { describe, expect, it } from 'vitest';

import { isTrustedSender, parseMessage } from '../src/messages/schema';

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const BASE = `chrome-extension://${ID}/`;

describe('parseMessage', () => {
  it('accepts well formed messages', () => {
    expect(parseMessage({ type: 'state.get' })).toEqual({ type: 'state.get' });
    expect(parseMessage({ type: 'vault.list' })).not.toBeNull();
    expect(parseMessage({ type: 'vault.list', tabId: 4 })).not.toBeNull();
    expect(
      parseMessage({
        type: 'fill.request',
        tabId: 1,
        id: '0b8f1f3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b',
        confirmCrossSite: false,
      }),
    ).not.toBeNull();
    expect(
      parseMessage({ type: 'settings.set', settings: { theme: 'dark', autoLockMinutes: 15 } }),
    ).not.toBeNull();
  });

  it('rejects unknown types, extra fields and missing fields', () => {
    expect(parseMessage({ type: 'vault.decrypt', id: 'x' })).toBeNull();
    expect(parseMessage({ type: 'state.get', extra: 1 })).toBeNull();
    expect(parseMessage({ type: 'auth.unlock' })).toBeNull();
    expect(parseMessage({ type: 'toString' })).toBeNull();
    expect(parseMessage({ type: '__proto__' })).toBeNull();
    expect(parseMessage(null)).toBeNull();
    expect(parseMessage('state.get')).toBeNull();
    expect(parseMessage([{ type: 'state.get' }])).toBeNull();
  });

  it('rejects wrong types and out of range values', () => {
    expect(parseMessage({ type: 'vault.reveal', id: 'not-a-uuid', field: 'password' })).toBeNull();
    expect(
      parseMessage({
        type: 'vault.reveal',
        id: '0b8f1f3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b',
        field: 'secret',
      }),
    ).toBeNull();
    expect(parseMessage({ type: 'vault.list', tabId: -1 })).toBeNull();
    expect(parseMessage({ type: 'vault.list', tabId: 1.5 })).toBeNull();
    expect(parseMessage({ type: 'auth.unlock', password: 'x'.repeat(5000) })).toBeNull();
    expect(parseMessage({ type: 'settings.set', settings: { autoLockMinutes: 7 } })).toBeNull();
    expect(
      parseMessage({ type: 'settings.set', settings: { theme: 'dark', evil: true } }),
    ).toBeNull();
  });
});

describe('isTrustedSender', () => {
  it('accepts only the popup and options page of this extension', () => {
    expect(isTrustedSender({ id: ID, url: `${BASE}popup.html` }, ID, BASE)).toBe(true);
    expect(isTrustedSender({ id: ID, url: `${BASE}options.html` }, ID, BASE)).toBe(true);
  });

  it('rejects content scripts, other extensions and other pages', () => {
    expect(
      isTrustedSender({ id: ID, url: 'https://evil.example/popup.html', tab: {} }, ID, BASE),
    ).toBe(false);
    expect(
      isTrustedSender(
        { id: 'ponmlkjihgfedcbaponmlkjihgfedcba', url: `${BASE}popup.html` },
        ID,
        BASE,
      ),
    ).toBe(false);
    expect(isTrustedSender({ id: ID, url: `${BASE}offscreen.html` }, ID, BASE)).toBe(false);
    expect(isTrustedSender({ id: ID }, ID, BASE)).toBe(false);
    expect(
      isTrustedSender({ id: ID, url: `chrome-extension://${'p'.repeat(32)}/popup.html` }, ID, BASE),
    ).toBe(false);
    expect(isTrustedSender({ id: ID, url: `${BASE}popup.html.evil` }, ID, BASE)).toBe(false);
    expect(isTrustedSender({ id: ID, url: `${BASE}popup.html?x=1` }, ID, BASE)).toBe(true);
  });
});
