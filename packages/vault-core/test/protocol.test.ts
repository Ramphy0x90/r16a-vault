import { beforeAll, describe, expect, it } from 'vitest';

import vectors from '../../../shared/crypto-test-vectors.json';

import { loadSodium, type Sodium } from '../src/sodium';
import {
  CryptoError,
  assertAcceptableKdf,
  credentialAad,
  encodeUtf8,
  open,
  passwordBytes,
  sealWithNonce,
  splitMasterKey,
  stretch,
  unwrapVaultKey,
  type KdfParams,
} from '../src/protocol';

const hex = (u8: Uint8Array): string =>
  Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (h: string): Uint8Array =>
  Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));
const utf8 = (s: string): Uint8Array => encodeUtf8(s);
const kdfOf = (c: { opslimit: number; memlimit: number }): KdfParams => ({
  alg: 'argon2id13',
  ...c,
});

describe('crypto protocol against shared vectors', () => {
  let sodium: Sodium;

  beforeAll(async () => {
    sodium = await loadSodium();
  });

  describe('argon2id', () => {
    for (const c of vectors.argon2id) {
      it(`derives the master key and subkeys for ${c.name}`, () => {
        const pw = passwordBytes(c.password);
        expect(hex(pw)).toBe(c.passwordNfcUtf8Hex);
        const master = stretch(sodium, pw, unhex(c.saltHex), kdfOf(c));
        expect(hex(master)).toBe(c.masterKeyHex);
        const keys = splitMasterKey(sodium, master);
        expect(hex(keys.authKey)).toBe(c.authKeyHex);
        expect(hex(keys.wrapKey)).toBe(c.wrapKeyHex);
        expect(master.every((b) => b === 0)).toBe(true);
      }, 30_000);
    }

    it('treats composed and decomposed forms of the same password as identical', () => {
      const composed = vectors.argon2id.find((c) => c.name === 'non-ascii-composed');
      const decomposed = vectors.argon2id.find((c) => c.name === 'non-ascii-decomposed');
      expect(composed?.password).not.toBe(decomposed?.password);
      expect(composed?.masterKeyHex).toBe(decomposed?.masterKeyHex);
      expect(hex(passwordBytes(decomposed?.password ?? ''))).toBe(composed?.passwordNfcUtf8Hex);
    });
  });

  it('derives subkeys from a fixed master key', () => {
    const keys = splitMasterKey(sodium, unhex(vectors.kdf.masterKeyHex));
    expect(hex(keys.authKey)).toBe(vectors.kdf.authKeyHex);
    expect(hex(keys.wrapKey)).toBe(vectors.kdf.wrapKeyHex);
  });

  it('wraps and unwraps the vault key', () => {
    const w = vectors.wrap;
    const blob = sealWithNonce(
      sodium,
      unhex(w.wrapKeyHex),
      unhex(w.vaultKeyHex),
      w.aad,
      unhex(w.nonceHex),
    );
    expect(hex(blob)).toBe(w.blobHex);
    expect(hex(unwrapVaultKey(sodium, unhex(w.wrapKeyHex), blob))).toBe(w.vaultKeyHex);
  });

  for (const field of ['meta', 'secret'] as const) {
    it(`seals and opens the credential ${field} blob`, () => {
      const c = vectors.credential;
      const f = c[field];
      expect(credentialAad(c.credentialId, field)).toBe(f.aad);
      const blob = sealWithNonce(
        sodium,
        unhex(c.vaultKeyHex),
        utf8(f.plaintext),
        f.aad,
        unhex(f.nonceHex),
      );
      expect(hex(blob)).toBe(f.blobHex);
      const plain = open(sodium, unhex(c.vaultKeyHex), unhex(f.blobHex), f.aad);
      expect(new TextDecoder().decode(plain)).toBe(f.plaintext);
    });
  }

  for (const n of vectors.negative.cases) {
    it(`rejects ${n.name}`, () => {
      expect(() =>
        open(sodium, unhex(vectors.negative.vaultKeyHex), unhex(n.blobHex), n.aad),
      ).toThrow(CryptoError);
    });
  }

  it('refuses KDF parameters outside the floor and ceiling', () => {
    expect(() =>
      assertAcceptableKdf({ alg: 'argon2id13', opslimit: 2, memlimit: 64 * 1024 * 1024 }),
    ).toThrow();
    expect(() => assertAcceptableKdf({ alg: 'argon2id13', opslimit: 3, memlimit: 1024 })).toThrow();
    expect(() =>
      assertAcceptableKdf({ alg: 'argon2id13', opslimit: 11, memlimit: 64 * 1024 * 1024 }),
    ).toThrow();
    expect(() =>
      assertAcceptableKdf({ alg: 'argon2id13', opslimit: 3, memlimit: 64 * 1024 * 1024 }),
    ).not.toThrow();
  });
});
