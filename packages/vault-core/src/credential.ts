import {
  CryptoError,
  credentialAad,
  encodeUtf8,
  fromBase64,
  open,
  seal,
  toBase64,
  type KdfParams,
} from './protocol';
import type { Sodium } from './sodium';

/**
 * The plaintext shape of a credential (SPEC 3.6) and how it is sealed and opened.
 *
 * Meta holds what the list needs, secret holds what is decrypted only on reveal, copy or fill.
 * Readers accept unknown keys and ignore them, so newer clients can add keys without breaking
 * older ones.
 */

export interface CredentialMeta {
  readonly name: string;
  readonly url: string | null;
  readonly username: string;
  /** Lets the list offer a TOTP button without decrypting the secret blob. */
  readonly hasTotp?: boolean;
  /** `host` limits matching to the exact host. Absent means the registrable domain. */
  readonly match?: 'host';
}

export interface CredentialSecret {
  readonly password: string;
  readonly mfaSecret: string | null;
}

/** Everything the server needs to create or re-key an account. The vault key never leaves. */
export interface KeyMaterial {
  readonly authKey: string;
  readonly salt: string;
  readonly kdf: KdfParams;
  readonly wrappedVaultKey: string;
}

export interface SealedCredential {
  readonly meta: string;
  readonly secret: string;
}

export function sealCredential(
  sodium: Sodium,
  vaultKey: Uint8Array,
  id: string,
  meta: CredentialMeta,
  secret: CredentialSecret,
): SealedCredential {
  const metaPlain = encodeUtf8(JSON.stringify(meta));
  const secretPlain = encodeUtf8(JSON.stringify(secret));
  try {
    return {
      meta: toBase64(sodium, seal(sodium, vaultKey, metaPlain, credentialAad(id, 'meta'))),
      secret: toBase64(sodium, seal(sodium, vaultKey, secretPlain, credentialAad(id, 'secret'))),
    };
  } finally {
    sodium.memzero(metaPlain);
    sodium.memzero(secretPlain);
  }
}

export function openMeta(
  sodium: Sodium,
  vaultKey: Uint8Array,
  id: string,
  blobB64: string,
): CredentialMeta {
  const value = openJson(sodium, vaultKey, id, 'meta', blobB64);
  if (typeof value['name'] !== 'string' || typeof value['username'] !== 'string') {
    throw new CryptoError('decrypt-failed');
  }
  return {
    name: value['name'],
    username: value['username'],
    url: typeof value['url'] === 'string' ? value['url'] : null,
    hasTotp: value['hasTotp'] === true,
    ...(value['match'] === 'host' ? { match: 'host' as const } : {}),
  };
}

export function openSecret(
  sodium: Sodium,
  vaultKey: Uint8Array,
  id: string,
  blobB64: string,
): CredentialSecret {
  const value = openJson(sodium, vaultKey, id, 'secret', blobB64);
  if (typeof value['password'] !== 'string') throw new CryptoError('decrypt-failed');
  return {
    password: value['password'],
    mfaSecret: typeof value['mfaSecret'] === 'string' ? value['mfaSecret'] : null,
  };
}

function openJson(
  sodium: Sodium,
  vaultKey: Uint8Array,
  id: string,
  field: 'meta' | 'secret',
  blobB64: string,
): Record<string, unknown> {
  const plain = open(sodium, vaultKey, fromBase64(sodium, blobB64), credentialAad(id, field));
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plain));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new CryptoError('decrypt-failed');
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    throw e instanceof CryptoError ? e : new CryptoError('decrypt-failed');
  } finally {
    sodium.memzero(plain);
  }
}
