/**
 * The Zaltys client crypto protocol as pure functions over libsodium.
 *
 * This file is the single source of truth for key derivation, wrapping and blob sealing in
 * the web app and the browser extension. It is tested byte for byte against shared/crypto-test-vectors.json, and
 * the Flutter client implements the same steps against the same file. Changing anything
 * here without regenerating the vectors breaks interoperability on purpose.
 */
import type { Sodium } from './sodium';

export const BLOB_VERSION = 0x01;
export const NONCE_BYTES = 24;
export const KEY_BYTES = 32;
export const SALT_BYTES = 16;
/** Shortest master password any client accepts for a new account or a password change. */
export const MIN_MASTER_PASSWORD = 12;
const MIN_BLOB = 1 + NONCE_BYTES + 16;

export const VAULT_KEY_AAD = 'r16a-vault:vk:v1';
export const credentialAad = (id: string, field: 'meta' | 'secret'): string =>
  `r16a-vault:cred:v1:${id.toLowerCase()}:${field}`;

export interface KdfParams {
  readonly alg: 'argon2id13';
  readonly opslimit: number;
  readonly memlimit: number;
}

export const DEFAULT_KDF: KdfParams = {
  alg: 'argon2id13',
  opslimit: 3,
  memlimit: 64 * 1024 * 1024,
};

/**
 * Bounds applied to parameters received from the server. The floor stops a hostile server
 * from downgrading key stretching, the ceiling stops it from exhausting the device.
 */
export function assertAcceptableKdf(kdf: KdfParams): void {
  const ok =
    kdf.alg === 'argon2id13' &&
    Number.isInteger(kdf.opslimit) &&
    Number.isInteger(kdf.memlimit) &&
    kdf.opslimit >= 3 &&
    kdf.opslimit <= 10 &&
    kdf.memlimit >= 64 * 1024 * 1024 &&
    kdf.memlimit <= 1024 * 1024 * 1024;
  if (!ok) throw new CryptoError('kdf-rejected');
}

export class CryptoError extends Error {
  constructor(readonly code: 'kdf-rejected' | 'decrypt-failed' | 'bad-envelope') {
    super(code);
    this.name = 'CryptoError';
  }
}

/**
 * Encodes into a buffer owned by this realm and wipes the encoder output. Some runtimes
 * return arrays from another realm, which libsodium refuses to wipe.
 */
export function encodeUtf8(text: string): Uint8Array {
  const raw = new TextEncoder().encode(text);
  const out = new Uint8Array(raw.length);
  out.set(raw);
  raw.fill(0);
  return out;
}

/** NFC keeps passwords typed on different platforms byte identical. No trimming or case folding. */
export function passwordBytes(password: string): Uint8Array {
  return encodeUtf8(password.normalize('NFC'));
}

export function stretch(
  sodium: Sodium,
  password: Uint8Array,
  salt: Uint8Array,
  kdf: KdfParams,
): Uint8Array {
  return sodium.crypto_pwhash(
    KEY_BYTES,
    password,
    salt,
    kdf.opslimit,
    kdf.memlimit,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}

export interface Subkeys {
  readonly authKey: Uint8Array;
  readonly wrapKey: Uint8Array;
}

/** Derives both subkeys and wipes the master key, which must not outlive this call. */
export function splitMasterKey(sodium: Sodium, masterKey: Uint8Array): Subkeys {
  try {
    return {
      authKey: sodium.crypto_kdf_derive_from_key(KEY_BYTES, 1, 'r16aauth', masterKey),
      wrapKey: sodium.crypto_kdf_derive_from_key(KEY_BYTES, 2, 'r16awrap', masterKey),
    };
  } finally {
    sodium.memzero(masterKey);
  }
}

export function sealWithNonce(
  sodium: Sodium,
  key: Uint8Array,
  plaintext: Uint8Array,
  aad: string,
  nonce: Uint8Array,
): Uint8Array {
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, aad, null, nonce, key);
  const out = new Uint8Array(1 + NONCE_BYTES + ct.length);
  out[0] = BLOB_VERSION;
  out.set(nonce, 1);
  out.set(ct, 1 + NONCE_BYTES);
  return out;
}

/** Production sealing. A fresh random nonce per call is safe with XChaCha20's 192 bit nonce. */
export function seal(
  sodium: Sodium,
  key: Uint8Array,
  plaintext: Uint8Array,
  aad: string,
): Uint8Array {
  return sealWithNonce(sodium, key, plaintext, aad, sodium.randombytes_buf(NONCE_BYTES));
}

export function open(sodium: Sodium, key: Uint8Array, blob: Uint8Array, aad: string): Uint8Array {
  if (blob.length < MIN_BLOB || blob[0] !== BLOB_VERSION) throw new CryptoError('bad-envelope');
  try {
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      blob.subarray(1 + NONCE_BYTES),
      aad,
      blob.subarray(1, 1 + NONCE_BYTES),
      key,
    );
  } catch {
    throw new CryptoError('decrypt-failed');
  }
}

export function wrapVaultKey(
  sodium: Sodium,
  wrapKey: Uint8Array,
  vaultKey: Uint8Array,
): Uint8Array {
  return seal(sodium, wrapKey, vaultKey, VAULT_KEY_AAD);
}

export function unwrapVaultKey(
  sodium: Sodium,
  wrapKey: Uint8Array,
  wrapped: Uint8Array,
): Uint8Array {
  const key = open(sodium, wrapKey, wrapped, VAULT_KEY_AAD);
  if (key.length !== KEY_BYTES) throw new CryptoError('decrypt-failed');
  return key;
}

export function toBase64(sodium: Sodium, bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}

export function fromBase64(sodium: Sodium, text: string): Uint8Array {
  try {
    return sodium.from_base64(text, sodium.base64_variants.ORIGINAL);
  } catch {
    throw new CryptoError('bad-envelope');
  }
}
