import { beforeAll, describe, expect, it } from 'vitest';

import { CryptoError, KEY_BYTES } from '../src/protocol';
import { openMeta, openSecret, sealCredential } from '../src/credential';
import { loadSodium, type Sodium } from '../src/sodium';

describe('credential codec', () => {
  let sodium: Sodium;
  let key: Uint8Array;
  const id = '0b8f1f3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';

  beforeAll(async () => {
    sodium = await loadSodium();
    key = sodium.randombytes_buf(KEY_BYTES);
  });

  it('round trips meta and secret, keeping the exact host setting', () => {
    const sealed = sealCredential(
      sodium,
      key,
      id,
      { name: 'Bank', url: 'https://login.bank.example', username: 'me', match: 'host' },
      { password: 'pw', mfaSecret: null },
    );
    expect(openMeta(sodium, key, id, sealed.meta)).toEqual({
      name: 'Bank',
      url: 'https://login.bank.example',
      username: 'me',
      hasTotp: false,
      match: 'host',
    });
    expect(openSecret(sodium, key, id, sealed.secret).password).toBe('pw');
  });

  it('refuses a blob moved to another field or row', () => {
    const sealed = sealCredential(
      sodium,
      key,
      id,
      { name: 'n', url: null, username: 'u' },
      { password: 'p', mfaSecret: null },
    );
    expect(() => openSecret(sodium, key, id, sealed.meta)).toThrow(CryptoError);
    expect(() => openMeta(sodium, key, crypto.randomUUID(), sealed.meta)).toThrow(CryptoError);
  });
});
